# How Nitr works

One page on the execution model. Everything else in these docs makes
more sense once this is clear.

## The shape of a Nitr process

```
                     ┌──────────────────────────────────────┐
   HTTP  ──────────► │  Rust: hyper, router, static files,  │
                     │  CORS, compression, limits, health   │
                     └───────────────┬──────────────────────┘
                                     │  only a matching dynamic route
                                     ▼
                     ┌──────────────────────────────────────┐
                     │  Lua state pool (one per CPU core)   │
                     │  ┌────────┐ ┌────────┐ ┌────────┐    │
                     │  │ state1 │ │ state2 │ │ state3 │ …  │
                     │  └────────┘ └────────┘ └────────┘    │
                     └──────────────────────────────────────┘
                              each: app.lua loaded once,
                              routes + middleware compiled,
                              memory cap + execution budget
```

A request is checked out against one state, runs there, and the state
goes back to the pool. States never share Lua values with each other.

## The two scripts

| Script       | Runs                                               | Purpose                                    |
| ------------ | -------------------------------------------------- | ------------------------------------------ |
| `config.lua` | **exactly once**, at startup, before any request   | setup; its return value becomes `nitr.cfg` |
| `app.lua`    | **once per Lua state** (and again on every reload) | builds and returns the application         |

### `config.lua`

```lua
-- Optional. The database connection arrives as the script's vararg.
local db = ...
db:execute("PRAGMA optimize")
return {
    app_name = "my-app",
    started_at = nitr.time.iso8601(nitr.time.now()),
}
```

It must return **plain data** — tables, strings, numbers, booleans. The
return value is serialized and snapshotted into every state, so a
function or a coroutine in there is an error, not a hidden bug. Every
handler then reads it as `nitr.cfg`.

### `app.lua`

```lua
local app = nitr.app()
app:use(some_middleware)     -- global middleware, before any route
app:get("/x", handler)       -- routes
app:on_error(handler)        -- the app-wide error response
return app                   -- ← the script MUST return the app
```

This script does not handle a request. It _describes_ the application,
once. The router, the middleware chain and the error handler are all
composed at load time, so per-request work is just: match, call.

> [!TIP] Why this matters for performance
>
> Middleware is `function(next) return function(req) ... end end` — a
> factory. The outer function runs once, at load; only the inner
> function runs per request. Expensive setup (compiling a validation
> schema, building a lookup table) belongs in the outer scope of
> `app.lua` or in the factory, never inside the request function.

## The pool of Lua states

Nitr does not run Lua on one interpreter behind a lock. It creates
`workers` independent states (default: the CPU core count), each having
loaded `app.lua` on its own. A request:

1. **checks out** a free state — waiting at most `[limits] pool_wait_ms`
   before the request is shed with `503` + `Retry-After`;
2. **runs** the middleware chain and handler in that state, under its
   memory limit and execution budget;
3. **returns** the state to the pool — unless the state was poisoned (it
   hit the memory limit, or a panic was contained), in which case it is
   dropped and rebuilt, never reused.

Consequences worth internalising:

- **Concurrency is bounded by `workers`.** More concurrent handlers than
  states means queueing, and past `pool_wait_ms` it means shedding. That
  is deliberate backpressure, not a bug.
- **Module-level Lua state is per-state, not per-process.** A counter in
  a Lua upvalue counts what _that one state_ did. For anything shared,
  use [`nitr.cache`](./server/cache) (bounded, shared, plain data) or
  [`nitr.db`](./server/database).
- **Blocking is contagious within a state.** Nitr keeps blocking work
  off the async threads for you — `nitr.db` queries run on a blocking
  pool, `nitr.fetch` is async, and [streaming
  responses](./server/streaming) hold their state for the stream's
  lifetime (which is why `max_streams` defaults to `workers - 1`).

## What never reaches Lua

A surprising amount of HTTP is answered in Rust before a Lua state is
even checked out:

- static files (with ETag / `Last-Modified` / `304` / range requests)
- `404` when nothing matched, `405` (with `Allow`) when only the method
  is wrong, `204` + `Allow` for a bare `OPTIONS`
- CORS preflights
- `/healthz` and `/readyz`
- every [limit](./server/configuration/file#limits): oversized URI,
  headers, body, too many connections, rate limit
- response compression, and precompressed `.br` / `.gz` sidecars

This is why Nitr can be small and still correct: the parts of HTTP that
are tedious and easy to get wrong are not written in your handler.

## The request lifecycle, end to end

1. Connection accepted (subject to `max_connections`).
2. Headers read within `header_read_ms`, bounded by `max_header_bytes`
   and `max_uri_bytes`.
3. Rate limit checked (`[rate_limit]`), if enabled.
4. Health endpoints, CORS preflight, static mounts — answered here if
   they match.
5. Route matched. No match → `404`/`405`, still no Lua.
6. A Lua state is checked out (`pool_wait_ms`, else `503`).
7. Global middleware → route middleware → handler, all inside the
   state's execution budget (`exec_timeout_ms`) and memory limit
   (`memory_limit`).
8. The returned table becomes the response; body reading and multipart
   streaming happen against Rust-side limits as the handler asks for
   them.
9. Compression, conditional-request handling and cookie headers applied.
10. State returned to the pool; the `request` span closes, emitting the
    access-log line.

## Reloading and shutdown

- **`SIGHUP`** (or `nitr reload`, which finds the process via its
  `pidfile`) rebuilds the Lua pool without dropping connections. The
  listener and keep-alive connections survive.
- **`--dev`** watches the scripts, routes and templates directories and
  does the same rebuild on save.
- **`SIGTERM`/`SIGINT`** drains: stop accepting → `/readyz` flips to
  `503 draining` → in-flight requests finish within `[shutdown] grace`
  (+ `stream_grace` for live streams) → exit. A drain that runs out of
  time exits non-zero, because a cut request is not a clean shutdown.

## Where the safety comes from

| Risk                                | What stops it                                                                                                              |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `while true do end`                 | instruction-count hook enforcing `exec_timeout_ms`                                                                         |
| runaway allocation                  | per-state `memory_limit` (8 MiB); the state is dropped and rebuilt                                                         |
| filesystem / process access         | `io` and `os` are not in the stdlib by default; `require` is confined to the scripts directory; native modules cannot load |
| a huge upload eating the heap       | multipart parts stream to disk **in Rust** and never become Lua strings                                                    |
| SSRF via `nitr.fetch`               | private/loopback ranges refused inside the resolver the connector uses; every redirect hop re-checked                      |
| one bad request killing the process | per-request panic containment; the state is recycled, the process lives                                                    |

The full picture, including what the sandbox explicitly does _not_
defend against, is in [Security & the sandbox](./server/security).

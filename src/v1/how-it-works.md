# How Nitr works

One page on the execution model. Everything else in these docs makes
more sense once this is clear.

## The shape of a Nitr process

```
   TCP  ──────────────┐
                      ▼
        ┌──────────────────────────────────────────┐
        │  TLS handshake — only with [tls] enabled │
        │  runs in the connection's own task,      │
        │  bounded by handshake_ms; ALPN: http/1.1 │
        └───────────────────┬──────────────────────┘
                            │
                            ▼
        ┌──────────────────────────────────────────┐
        │  Rust: hyper, health probes, limits,     │
        │  rate limit, CORS, router, static files, │
        │  compression                             │
        └───────────────────┬──────────────────────┘
                            │  only a matching dynamic route
                            ▼
        ┌──────────────────────────────────────────┐
        │  Lua state pool (one per CPU core)       │
        │  ┌────────┐ ┌────────┐ ┌────────┐        │
        │  │ state1 │ │ state2 │ │ state3 │ …      │
        │  └────────┘ └────────┘ └────────┘        │
        └──────────────────────────────────────────┘
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

> [!WARNING] This chunk runs outside the async executor
>
> The top level of a script is not a handler, so a builtin that _yields_
> cannot run there. That includes the argon2 password functions
> (`nitr.crypto.password_hash` and friends), which do their work on the
> blocking pool. Mint hashes with
> [`nitr hash-password`](./server/passwords) and store the result;
> hashing at boot fails with an explanatory error rather than silently
> working.

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
  off the async threads for you — `nitr.db` queries and argon2 hashing
  run on a blocking pool, `nitr.fetch` is async, and [streaming
  responses](./server/streaming) hold their state for the stream's
  lifetime (which is why `max_streams` defaults to `workers - 1`).

## What never runs Lua

A surprising amount of HTTP is answered in Rust without calling a single
Lua function:

- static files (with ETag / `Last-Modified` / `304` / range requests)
- `404` when nothing matched, `405` (with `Allow`) when only the method
  is wrong, `204` + `Allow` for a bare `OPTIONS` on a known path
- CORS preflights
- `/healthz` and `/readyz`
- every [limit](./server/configuration/file#limits): oversized URI,
  headers, body, too many connections, rate limit
- a request carrying **more than one `Authorization` header** — refused
  with `400`, because a handler would see one credential while a proxy
  in front may have authenticated on the other
- response compression, and precompressed `.br` / `.gz` sidecars
- the TLS handshake itself, when `[tls]` is enabled

This is why Nitr can be small and still correct: the parts of HTTP that
are tedious and easy to get wrong are not written in your handler.

> [!NOTE] "No Lua" is not always "no Lua state"
>
> The router and the static mounts are compiled into each pooled state
> by `app.lua`, so Nitr borrows a state to consult them — a `404`, a
> `405` and a static file all pass through a checked-out state. No Lua
> _executes_: nothing is compiled, no handler is called, and the state
> is returned as soon as the response exists. Health probes are the one
> case answered before any of this, ahead of rate limiting and the pool
> entirely, because a liveness check that could queue behind a saturated
> pool would cause the restart it is meant to prevent.

## The request lifecycle, end to end

1. The accept loop waits for a free connection slot
   (`[limits] max_connections`) and then accepts; at the cap it stops
   accepting rather than queueing connections unboundedly.
2. With `[tls] enabled`, the handshake runs **in the connection's own
   task**, bounded by `[tls] handshake_ms` (unset: `min(header_read_ms,
10s)`). A `ClientHello` that arrives one byte a minute costs that one
   connection, not the accept loop.
3. Headers read by hyper within `header_read_ms`, into a buffer of
   `max_header_bytes`. An expired deadline just closes the connection —
   no request exists yet to answer.
4. `/healthz` and `/readyz` answered here, before anything
   request-shaped happens.
5. Nitr's own pre-Lua checks: rate limit (`[rate_limit]`, `429` +
   `Retry-After`), URI length (`max_uri_bytes`, `414`), a second
   `Authorization` header (`400`), and a declared `Content-Length` over
   `max_body_bytes` (`413`).
6. CORS preflight answered, if this is one.
7. A Lua state is checked out (`pool_wait_ms`, else `503` +
   `Retry-After`).
8. The route is matched against that state's compiled dispatch table. A
   router miss falls through to the static mounts; still no Lua runs,
   and an unmatched path ends as `404` / `405` / `204` + `Allow`.
9. Global middleware → route middleware → handler, all inside the
   state's execution budget (`exec_timeout_ms`) and memory limit
   (`memory_limit`).
10. The returned table becomes the response; body reading and multipart
    streaming happen against Rust-side limits as the handler asks for
    them. A body that turned out to be oversized answers `413`, and one
    that stalled past `body_read_ms` answers `408` and closes the
    connection — neither reaches `on_error`, because the client is the
    culprit, not the application.
11. `X-Request-ID`, CORS headers and compression are applied; a `HEAD`
    response keeps every header the `GET` would have had and loses only
    the body.
12. State returned to the pool; the `request` span closes, emitting the
    access-log line.

## Reloading and shutdown

- **`SIGHUP`** (or `nitr reload`, which finds the process via its
  `pidfile`) rebuilds the Lua pool without dropping connections. The
  listener and keep-alive connections survive; in-flight requests finish
  on the old pool, and if the rebuild fails the old pool stays.
- **With `[tls]` enabled, the same reload re-reads the certificate and
  key** and swaps them in **only if the new pair validates** — a server
  that stopped terminating TLS because an ACME client wrote a half-file
  would be strictly worse than one serving a stale certificate. The two
  halves are independent: a failed TLS re-read still reloads the pool,
  and vice versa. Connections already established keep the certificate
  they handshook with.
- **A reload does not re-read `nitr.toml`.** It re-runs the
  configuration _script_ and re-reads the certificate _files_; the
  limits, the rate limit, the CORS and compression policies, the cache,
  the listen address and `workers` are fixed at startup and need a
  restart.
- **`--dev`** watches the handler script's directory tree (which covers
  `require`d modules and `routes/`), the configuration script and the
  templates directory, and triggers the same rebuild on save. Only files
  a rebuild actually reads count — a `.lua` source or anything under the
  templates tree. The SQLite database and its WAL sidecars sit in a
  watched directory too, and reacting to those would turn one save into
  an endless reload loop.
- **`SIGTERM`/`SIGINT`** drains: stop accepting → `/readyz` flips to
  `503 draining` → in-flight requests finish within `[shutdown] grace`
  (+ `stream_grace` for live streams) → exit. A drain that runs out of
  time exits non-zero, because a cut request is not a clean shutdown.

## Where the safety comes from

| Risk                                         | What stops it                                                                                                                                                           |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `while true do end`                          | instruction-count hook enforcing `exec_timeout_ms`                                                                                                                      |
| runaway allocation                           | per-state `memory_limit` (8 MiB); the state is dropped and rebuilt                                                                                                      |
| filesystem / process access                  | `io` and `os` are not in the stdlib by default; `require` is confined to the scripts directory; native modules cannot load; `debug` is refused at startup               |
| a huge upload eating the heap                | multipart parts stream to disk **in Rust** and never become Lua strings                                                                                                 |
| an upload written somewhere it should not be | `part:save` resolves only inside `[multipart] upload_dir`; absolute paths and `..` are refused rather than re-rooted, and with the key unset `part:save` does not exist |
| a session cookie readable from JS            | the session and CSRF cookies default to `HttpOnly` + `SameSite=Lax`, and a caller's options table _extends_ those defaults — `http_only` cannot be un-set               |
| a session cookie sent in the clear           | `[cookies] secure` (`"auto"` follows `[tls] enabled`, `"always"` for a terminating proxy in front); a configuration resolving to "not secure" warns at startup          |
| SSRF via `nitr.fetch`                        | private/loopback ranges refused inside the resolver the connector uses; every redirect hop re-checked                                                                   |
| one bad request killing the process          | per-request panic containment; the state is recycled, the process lives                                                                                                 |

The full picture, including what the sandbox explicitly does _not_
defend against, is in [Security & the sandbox](./server/security).

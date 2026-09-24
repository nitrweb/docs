# How Nitr works

The execution model on one page. The rest of the docs make more sense
once this is clear.

## The shape of a Nitr process

```
   TCP / TLS
       │
       ▼
  ┌──────────────────────────────────────────┐
  │  Rust: HTTP, health probes, limits,      │
  │  rate limit, CORS, router, static files, │
  │  input validation, compression           │
  └───────────────────┬──────────────────────┘
                      │  only a matching Lua route
                      ▼
  ┌──────────────────────────────────────────┐
  │  Lua state pool (one per CPU core)       │
  │  ┌────────┐ ┌────────┐ ┌────────┐        │
  │  │ state1 │ │ state2 │ │ state3 │ …      │
  │  └────────┘ └────────┘ └────────┘        │
  └──────────────────────────────────────────┘
       each: app.lua loaded once,
       with its own memory and time limits
```

Each request borrows one Lua state, runs there, and gives it back.
States never share Lua values.

## The two scripts

| Script       | Runs                                              | Purpose                                    |
| ------------ | ------------------------------------------------- | ------------------------------------------ |
| `config.lua` | **once** at startup (and again on each reload)    | setup; its return value becomes `nitr.cfg` |
| `app.lua`    | **once per Lua state** (and again on each reload) | builds and returns the application         |

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

It must return **plain data**: tables, strings, numbers and booleans. A
copy goes to every state, where handlers read it as `nitr.cfg`.

### `app.lua`

```lua
local app = nitr.app()
app:use(some_middleware)     -- global middleware, before any route
app:get("/x", handler)       -- routes
app:on_error(handler)        -- the app-wide error response
return app                   -- ← the script MUST return the app
```

This script describes the application; it does not handle a request.
Routes, middleware and the error handler are set up once, when the
state loads.

> [!WARNING] No waiting builtins at the top level of `app.lua`
>
> The top level of `app.lua`, and of the modules it `require`s, runs
> outside a request. Builtins that wait on work (`nitr.db` queries,
> `nitr.fetch`, `nitr.template:render`, the argon2 password functions)
> fail there with an error that says so. Call them from a handler, or do
> the work in `config.lua`, where they are allowed. For a password hash,
> create it once with [`nitr hash-password`](./server/passwords) and
> store the result.

> [!TIP] Do expensive setup once
>
> Middleware is a factory: `function(next) return function(req) ... end end`.
> The outer function runs once at load; only the inner one runs per
> request. Build schemas and lookup tables at the top of `app.lua` or in
> the outer function, not inside the request function.

## The pool of Lua states

Nitr creates `workers` independent states (default: the number of CPU
cores), each with its own copy of `app.lua`. A request:

1. **borrows** a free state, waiting up to `[limits] pool_wait_ms`
   before it is answered with `503` and `Retry-After`;
2. **runs** the middleware and handler there, within the state's memory
   and time limits;
3. **returns** the state to the pool. A state that hit its memory limit
   or crashed is thrown away and rebuilt instead.

What this means for your code:

- **At most `workers` handlers run at once.** Extra requests wait, and
  are refused with `503` after `pool_wait_ms`.
- **Lua variables are per state, not per process.** A counter in a Lua
  variable only counts what one state saw. For shared data, use
  [`nitr.cache`](./server/cache) or [`nitr.db`](./server/database).
- **A streaming response holds its state** until the stream ends, which
  is why `max_streams` defaults to `workers - 1`. See
  [Streaming](./server/streaming).

Slow work does not block other requests: `nitr.db` queries, password
hashing and template rendering run on a separate thread pool, and
`nitr.fetch` is asynchronous.

## What never runs Lua

Nitr answers a lot of HTTP in Rust, without calling your code:

- static files, including ETags, `304` and range requests
- `404`, `405` (with `Allow`), and a bare `OPTIONS` on a known path
- CORS preflights
- `/healthz` and `/readyz`
- the [OpenAPI document and Swagger UI](./server/openapi/), when enabled
- a route's [`input`](./server/validation/route-input) checks, so a bad
  request gets `415` or `422` before your handler runs
- every [limit](./server/configuration/file#limits): URI, headers, body
  size, connections, rate limit
- a request with more than one `Authorization` header (`400`)
- response compression, and precompressed `.br` / `.gz` files
- the TLS handshake, when `[tls]` is enabled

## The request lifecycle

1. The connection is accepted, up to `[limits] max_connections`. With
   `[tls]` on, the handshake runs next, bounded by `[tls] handshake_ms`.
2. Headers are read, within `header_read_ms` and `max_header_bytes`.
3. `/healthz` and `/readyz` are answered here, before rate limiting and
   the pool.
4. Pre-Lua checks: rate limit (`429`), URI length (`414`), a second
   `Authorization` header (`400`), and a declared body over
   `max_body_bytes` (`413`).
5. CORS preflights are answered.
6. A Lua state is borrowed (`503` after `pool_wait_ms`).
7. The route is matched. With no match, static files are tried, then
   `404` / `405`.
8. Global middleware, then route middleware, then the handler, within
   `exec_timeout_ms` and `memory_limit`.
9. The returned table becomes the response. A body that turns out too
   large gets `413`; one that arrives too slowly gets `408`. Neither
   reaches `on_error`.
10. `X-Request-ID`, CORS headers and compression are added, the state
    goes back to the pool, and the access-log line is written.

## Reloading and shutdown

- **`SIGHUP`** (or [`nitr reload`](./server/cli), which needs a
  `pidfile`) rebuilds the Lua pool without dropping connections.
  In-flight requests finish on the old pool; if the rebuild fails, the
  old pool stays. With `[tls]` on, it also re-reads the certificate and
  key, and only switches to them if they are valid.
- **A reload does not re-read `nitr.toml`.** It re-runs `config.lua`
  and `app.lua`. Limits, policies, the listen address and `workers`
  need a restart.
- **`nitr dev`** watches your Lua files and templates and rebuilds on
  save.
- **`SIGTERM` / `SIGINT`** drain the server: stop accepting, switch
  `/readyz` to `503`, let in-flight requests finish within
  `[shutdown] grace` (plus `stream_grace` for streams), then exit. If
  time runs out, the exit code is non-zero.

## Safety

Each state runs without `io` and `os`, with an 8 MiB memory limit and a
30-second time limit that stops even `while true do end`. `require` only
loads from your scripts directory, native modules and bytecode cannot
load, uploads stream to disk without entering Lua, and a crash in one
request does not take down the process. [Security & the
sandbox](./server/security) has the full picture, including what the
sandbox does not protect against.

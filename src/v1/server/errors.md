# Error Handling

How failures behave, and what you can rely on.

## Three layers, from most to least common

| Failure                                                | What happens                                                                                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| A Lua error, timeout, or memory limit in your handler  | Classified into a structured error, offered to your `on_error` handler, otherwise answered with `500`                               |
| Invalid input or an overloaded server                  | Rejected **in Rust before your code runs** (`404`, `405`, `413`, `414`, `429`, `503`, …)                                            |
| A panic in Rust (a bug in Nitr or an extension module) | Contained at the request boundary: the response is `500`, the Lua state is recycled, the process and every other connection survive |

`Result`-style errors are the normal currency; panic containment is a
last-resort safety net for genuine bugs, not something an application
can or should trigger deliberately. If you ever see `kind = "panic"`,
[report it](../report-security-issues).

## The error value

Your error handler — and the structured log line — sees the failure as a
table with a closed set of fields:

```lua
{
  kind = "lua",            -- always present, see below
  message = "attempt to index a nil value (local 'user')",
  source = "app.lua",      -- the failing chunk, when known
  line = 42,               -- the failing line, when known
  module = "nitr.db",      -- the failing module, when attributed
  traceback = "...",       -- bounded Lua call stack (innermost first)
  cause = { "...", ... },  -- bounded underlying Rust error chain
}
```

### `err.kind`

A **closed set**. Lua code cannot forge a kind, so branching on it is
stable in a way matching on message text never is.

| `err.kind`  | Meaning                                                                                 |
| ----------- | --------------------------------------------------------------------------------------- |
| `"lua"`     | An error raised by your script, or by a Lua library it called                           |
| `"nitr"`    | A `nitr.*` builtin failed, or was called wrongly (bad argument, invalid response shape) |
| `"module"`  | A registered extension module (`nitr.ext.*`) failed                                     |
| `"timeout"` | The handler exceeded `[lua] exec_timeout_ms`                                            |
| `"memory"`  | The state hit `[lua] memory_limit`                                                      |
| `"panic"`   | A Rust panic was contained at the request boundary — a bug, not an application error    |

> [!TIP] Branch on `kind`, never on `message`
>
> Messages are diagnostics and may be reworded at any time. `kind` is
> part of the [stability promise](../stability).

## `on_error` handlers

Register an app-wide handler, a per-route one, or both. **The per-route
handler wins** where both exist.

```lua
local app = nitr.app()

app:on_error(function(err, req)
    nitr.log.error("handler failed", {
        error = err.message, kind = err.kind,
        source = err.source, line = err.line,
    })

    if err.kind == "timeout" then
        return nitr.error(504, { code = "TIMEOUT" })
    end
    return nitr.error(500, { code = "INTERNAL" })
end)

app:get("/report", generate_report, {
    on_error = function(err, req)
        return nitr.error(503, { code = "REPORT_UNAVAILABLE" })
    end,
})
```

### The rules

- It runs **only for failures in your handler chain** — the first row of
  the table above. Rust-side rejections such as `404` or `413` never
  reach it: there is no application failure to explain.
- It receives the error table and the original request, and must return
  a response table.
- **If the error handler itself fails**, or returns something that is
  not a valid response, Nitr logs that and falls back to its own error
  response. Error handling never recurses.
- **The failure is logged before your handler runs**, structured, with
  `error.kind`, `error.source`, `error.line` and `error.module` — so
  handling an error does not hide it from the logs.

## Returned errors vs raised errors

Two different things, and the difference matters:

```lua
-- A RETURNED error: a deliberate response. on_error is NOT involved.
if not user then
    return nitr.error(404, { code = "NOT_FOUND" })
end

-- A RAISED error: an unexpected failure. on_error IS involved.
local body = req:json()      -- raises on invalid JSON
```

Use returned errors for the outcomes you planned for. Let raised errors
raise — `on_error` and the structured log line exist precisely to give
them one consistent treatment.

## Catching an error yourself

`pcall` plus `nitr.errinfo` gives you the same structured form inside a
handler:

```lua
local ok, caught = pcall(function()
    return risky_operation()
end)

if not ok then
    local err = nitr.errinfo(caught)
    nitr.log.warn("recovered", { kind = err.kind, message = err.message })
    return nitr.json({ result = nil, degraded = true })
end
```

`nitr.errinfo(caught)` classifies a pcall-caught error into `kind`,
`message`, `source`, `line`, `traceback`, `cause` and `pretty`.

> [!WARNING] Do not `pcall` everything
>
> A blanket `pcall` around your whole handler turns every bug into a
> silent degraded response and hides it from `on_error` and from the
> logs. Catch what you can genuinely recover from; let the rest raise.

## Status codes Nitr produces

Responses your application never sees, answered in Rust:

| Status | When                                                                                                                               | Notes                                                                                        |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `404`  | No route or static mount matched                                                                                                   |                                                                                              |
| `405`  | The path exists, the method does not                                                                                               | Carries `Allow`; a bare `OPTIONS` on a known path gets `204` + `Allow` instead               |
| `408`  | No complete headers within `header_read_ms`, or a body read stalled beyond `body_read_ms`                                          | A stalled body gets `Connection: close`; an expired header read simply closes the connection |
| `413`  | Body beyond `max_body_bytes` (declared or counted while reading)                                                                   | Also for multipart parts beyond their limits                                                 |
| `414`  | URI beyond `max_uri_bytes`                                                                                                         |                                                                                              |
| `429`  | Per-IP budget exceeded (`[rate_limit]`)                                                                                            | Carries `Retry-After`                                                                        |
| `500`  | A handler failure `on_error` did not answer — timeout, memory and contained panics included                                        | See the two modes below                                                                      |
| `503`  | No free Lua state within `pool_wait_ms` (carries `Retry-After: 1`), streaming rejected at `max_streams`, or the server is draining | Shed **before** any Lua runs                                                                 |

## Development versus production

The `500` body has two deliberately different faces, switched by
`dev_mode`:

**Production** answers with exactly `Internal Server Error`. No message,
no paths, no traceback. Failure details are for the operator and live in
the structured log line — not in what an attacker can read by causing
errors.

**Development** renders the error in context: the concise headline
(`kind: message (source:line)`), the failing source with the line
marked, the bounded traceback and the cause chain — as HTML when the
client accepts it, plain text otherwise.

Your own `on_error` responses are returned verbatim in **both** modes;
withholding detail there is your call.

## The configured limits

Every limit that produces one of the statuses above:

| Key                                                     | Section        | Default              | On violation                |
| ------------------------------------------------------- | -------------- | -------------------- | --------------------------- |
| `max_body_bytes`                                        | `[limits]`     | 1 MiB                | `413`                       |
| `max_uri_bytes`                                         | `[limits]`     | 8 KiB                | `414`                       |
| `max_header_bytes`                                      | `[limits]`     | 16 KiB               | connection-level rejection  |
| `max_connections`                                       | `[limits]`     | 1024                 | listener stops accepting    |
| `pool_wait_ms`                                          | `[limits]`     | 5000                 | `503` + `Retry-After`       |
| `header_read_ms`                                        | `[limits]`     | 30000                | connection closed           |
| `body_read_ms`                                          | `[limits]`     | 30000                | `408` + `Connection: close` |
| `max_form_parts` / `max_field_bytes` / `max_file_bytes` | `[limits]`     | 64 / 64 KiB / 10 MiB | `413`                       |
| `requests` per `window`                                 | `[rate_limit]` | off                  | `429` + `Retry-After`       |
| `exec_timeout_ms`                                       | `[lua]`        | 30000                | `kind = "timeout"` → `500`  |
| `memory_limit`                                          | `[lua]`        | 8 MiB                | `kind = "memory"` → `500`   |

## A production-shaped error handler

```lua
app:on_error(function(err, req)
    -- 1. Log everything, structured. This is the operator's copy.
    nitr.log.error("request failed", {
        error  = err.message,
        kind   = err.kind,
        source = err.source,
        line   = err.line,
        module = err.module,
        path   = req.path,
    })

    -- 2. Answer with a stable, machine-readable shape. No internals.
    if err.kind == "timeout" then
        return nitr.error(504, { code = "TIMEOUT", request_id = req.id })
    end
    if err.kind == "memory" then
        return nitr.error(503, { code = "OVERLOADED", request_id = req.id })
    end
    return nitr.error(500, { code = "INTERNAL", request_id = req.id })
end)
```

> [!TIP] Return the request id
>
> `req.id` is also on every log line for that request and in the
> client's `X-Request-ID` header. A user quoting it lets you find the
> exact failure in seconds.

## Reporting a Nitr bug

A `kind = "panic"` error, a process crash, or a `500` with no
corresponding log line is a Nitr bug. An actionable report includes:

- the structured log line (`error.kind` and friends), plus the panic
  message if there is one;
- Nitr's version and how it was built (release binary, `cargo install`,
  distro package);
- the smallest handler that reproduces it — the `source`/`line` fields
  usually point straight at it.

See [Report Security Issues](../report-security-issues) if it has a
security dimension, otherwise
[open an issue](https://github.com/joseluisq/nitr/issues).

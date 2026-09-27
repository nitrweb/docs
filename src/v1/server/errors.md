# Error Handling

Failures fall into three groups:

| Failure                                                | What happens                                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| A Lua error, timeout, or memory limit in your handler  | Logged, passed to your `on_error` handler if you have one, otherwise answered with `500`                                        |
| A bad or unwanted request                              | Answered by Nitr **before your code runs** (`404`, `405`, `413`, `429`, `503`, …); see the [table](#status-codes-nitr-produces) |
| A panic in Rust (a bug in Nitr or an extension module) | Answered with `500`. The Lua state is replaced; the process and other connections keep running                                  |

## The error value

`on_error` receives the failure as a table:

```lua
{
  kind = "lua",            -- always present, see below
  message = "attempt to index a nil value (local 'user')",
  source = "app.lua",      -- the failing file, when known
  line = 42,               -- the failing line, when known
  module = "nitr.db",      -- the failing module, when known
  traceback = "...",       -- Lua call stack, innermost first
  cause = { "...", ... },  -- underlying Rust errors
}
```

### `err.kind`

| `err.kind`  | Meaning                                                                           |
| ----------- | --------------------------------------------------------------------------------- |
| `"lua"`     | An error raised by your script, or by a Lua library it called                     |
| `"nitr"`    | A `nitr.*` function failed or was called wrongly (bad argument, invalid response) |
| `"module"`  | An extension module (`nitr.ext.*`) failed                                         |
| `"timeout"` | The handler exceeded `[lua] exec_timeout_ms`                                      |
| `"memory"`  | The Lua state hit `[lua] memory_limit`                                            |
| `"panic"`   | A Rust panic. This is a Nitr bug; please [report it](#reporting-a-nitr-bug)       |

Branch on `kind`, never on `message`: messages may change, the set of
kinds is covered by the [stability promise](../stability). `"nitr"` and
`"timeout"` are recognized from the message text, so a script can
produce them with `error(...)`. Use `kind` for logging and choosing a
status, not for security decisions.

## `on_error` handlers

Register an app-wide handler, a per-route one, or both. The per-route
handler wins.

```lua
local app = nitr.app()

app:on_error(function(err, req)
    nitr.log.error("request failed", {
        error = err.message, kind = err.kind,
        source = err.source, line = err.line, path = req.path,
    })

    if err.kind == "timeout" then
        return nitr.error(504, { code = "TIMEOUT", request_id = req.id })
    end
    return nitr.error(500, { code = "INTERNAL", request_id = req.id })
end)

app:get("/report", generate_report, {
    on_error = function(err, req)
        return nitr.error(503, { code = "REPORT_UNAVAILABLE" })
    end,
})
```

- It runs only for failures in your handler and middleware. Requests
  Nitr rejects itself (`404`, `413`, …) never reach it.
- It receives the error table and the request, and must return a
  response.
- Nitr logs the failure (with `error.kind`, `error.source`,
  `error.line`, `error.module`) before calling it, so handling an error
  never hides it.
- If `on_error` itself fails or returns an invalid response, Nitr logs
  that and sends its own `500`.

Returning `req.id` helps: it appears on every log line for the request
and in the client's `X-Request-ID` header.

In `nitr test`, `resp.error` holds the same table (plus `handled`,
true when `on_error` answered), so a failing test shows the cause. See
[Testing](./testing#when-a-request-fails).

## `on_invalid`: when the input was wrong

`on_error` means _your code failed_. `on_invalid` means _the request
was wrong_: it did not satisfy the route's
[`input`](./validation/route-input) declaration.

```lua
app:on_invalid(function(err, req)
    -- err = { code, message, fields, errors }
    if req:accepts("application/json", "text/html") == "text/html" then
        return nitr.html(render_form_with_errors(err.fields), 422)
    end
    return nitr.error(422, { code = err.code, fields = err.fields })
end)
```

|                    | `on_invalid`                        | `on_error`                           |
| ------------------ | ----------------------------------- | ------------------------------------ |
| Fires on           | A request that failed its `input`   | An error raised in the handler chain |
| Receives           | `{ code, message, fields, errors }` | The [error table](#the-error-value)  |
| Default answer     | A JSON `422`                        | `500 Internal Server Error`          |
| Per-route override | `{ on_invalid = fn }`               | `{ on_error = fn }`                  |

A validation `check` function that raises (a nil index, a typo) is a
bug, not invalid input, so it goes to `on_error`. See
[Messages & errors](./validation/messages) for the shape of `err`.

## Returned errors vs raised errors

```lua
-- Returned: a planned response. on_error is not involved.
if not user then
    return nitr.error(404, { code = "NOT_FOUND" })
end

-- Raised: an unexpected failure. on_error handles it.
local body = req:json()      -- raises on invalid JSON
```

Return errors for outcomes you planned for, and let unexpected ones
raise so they are logged and handled in one place.

## Catching an error yourself

`pcall` plus `nitr.errinfo` gives you the same table inside a handler:

```lua
local ok, caught = pcall(risky_operation)
if not ok then
    local err = nitr.errinfo(caught)
    nitr.log.warn("recovered", { kind = err.kind, message = err.message })
    return nitr.json({ result = nil, degraded = true })
end
```

`nitr.errinfo` returns `kind`, `message`, `source`, `line`,
`traceback`, `cause` and `pretty`. Only catch what you can recover
from: a `pcall` around a whole handler hides bugs from `on_error` and
the logs. Timeouts cannot be caught; `pcall` raises them again, so they
always reach `on_error`.

## Status codes Nitr produces

These are answered by Nitr; your handler never sees the request.

| Status | When                                                                                                              | Notes                                                                |
| ------ | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `400`  | More than one `Authorization` header                                                                              |                                                                      |
| `404`  | No route or static file matched                                                                                   |                                                                      |
| `405`  | The path exists, the method does not (and, for `GET`/`HEAD`, no static file matches)                              | Has `Allow`. `OPTIONS` on a known path gets `204` + `Allow` instead  |
| `408`  | A body read stalled past `body_read_ms`                                                                           | Closes the connection. Slow headers (`header_read_ms`) just close it |
| `413`  | Body over `max_body_bytes`, or an uncaught multipart limit error                                                  | Checked from `Content-Length` and while reading                      |
| `414`  | URI over `max_uri_bytes`                                                                                          |                                                                      |
| `415`  | The body's media type is not one the route's [`input`](./validation/route-input#bodies-and-content-types) accepts | Has `Accept`; the JSON body lists the accepted types                 |
| `422`  | The request failed the route's `input`                                                                            | Shaped by [`on_invalid`](#on-invalid-when-the-input-was-wrong)       |
| `429`  | Per-IP rate limit exceeded (`[rate_limit]`)                                                                       | Has `Retry-After`                                                    |
| `500`  | A handler failure that `on_error` did not answer                                                                  | See below                                                            |
| `503`  | No free Lua state within `pool_wait_ms`, too many open streams, or the server is shutting down                    | `pool_wait_ms` answers carry `Retry-After: 1`                        |

The limits behind these statuses (`max_body_bytes`, `pool_wait_ms`,
`exec_timeout_ms`, …) and their defaults are listed in
[Defaults](./defaults) and [`[limits]`](./configuration/file#limits).
Multipart limits (`max_form_parts`, `max_field_bytes`,
`max_file_bytes`) raise Lua errors in the handler. Uncaught, they answer
`413` without calling `on_error`; see
[Upload limits](./requests#upload-limits).

## Development versus production

The default `500` body depends on `dev_mode`:

- **Production:** exactly `Internal Server Error`. No message, paths or
  traceback; the details go to the log.
- **Development:** the error in context: `kind: message (source:line)`,
  the failing source lines, the traceback and cause chain, as HTML when
  the client accepts it, plain text otherwise.

Responses from your own `on_error` are sent as you wrote them in both
modes.

## Reporting a Nitr bug

A `kind = "panic"` error, a process crash, or a `500` without a log
line is a Nitr bug. Include the log line (and panic message), the Nitr
version and how you installed it, and the smallest handler that
reproduces it. [Open an issue](https://github.com/nitrweb/nitr/issues),
or see [Report Security Issues](../report-security-issues) if it has a
security side.

# Logging

Nitr writes structured logs. At the default level you get one line per
request, and every line a request produces carries its id, method and
path.

## Configuration

```toml
[log]
format = "text"     # "text" for people, "json" for a log shipper
level = "info"      # default: info (debug in dev mode)
```

`RUST_LOG` overrides `level` and accepts the usual `tracing` filter
syntax:

```sh
RUST_LOG=info,nitr_http=debug nitr run
```

Text output is coloured only in a terminal; piped output and JSON are
plain. Set `NO_COLOR` to turn colour off. For production, use
`format = "json"`: one JSON object per line.

## Logging from Lua

```lua
nitr.log.debug("cache miss", { key = key })
nitr.log.info("order created", { order_id = id, total = total })
nitr.log.warn("upstream slow", { host = "api.example.com", ms = 2300 })
nitr.log.error("payment failed", { order_id = id, reason = reason })
```

The optional second argument is encoded as JSON into a `fields` value.
Lines from Lua have the target `lua`. In text format:

```text
INFO request{id=01a0d32f-… method=POST path=/api/orders}:lua_handler: lua: order created fields={"order_id":1042,"total":39.9}
```

In JSON format:

```json
{
  "timestamp": "2026-09-24T11:31:53.176814Z",
  "level": "INFO",
  "fields": {
    "message": "order created",
    "fields": "{\"order_id\":1042,\"total\":39.9}"
  },
  "target": "lua",
  "span": { "name": "lua_handler" },
  "spans": [
    {
      "id": "01a0d32f-…",
      "method": "POST",
      "path": "/api/orders",
      "name": "request"
    },
    { "name": "lua_handler" }
  ]
}
```

You never pass the request id around: every line logged while handling
a request is inside its `request` span.

## Spans

Nitr wraps each request in a small, fixed set of spans. Each span logs
one `close` line when it ends, with its fields plus `time.busy` and
`time.idle`.

| Span            | Level | Covers                                     | Fields                                                                            |
| --------------- | ----- | ------------------------------------------ | --------------------------------------------------------------------------------- |
| `request`       | INFO  | The whole request                          | `id`, `method`, `path`, `status`                                                  |
| `pool_checkout` | DEBUG | Waiting for a free Lua state               | `wait_ms`, `outcome` (`hit` or `shed`)                                            |
| `lua_handler`   | DEBUG | Your middleware and handler                | `elapsed_ms`                                                                      |
| `db_query`      | DEBUG | One SQL statement                          | `kind` (`query`, `query_row`, `query_one`, `execute`, `tx`), `stmt`, `elapsed_ms` |
| `fetch`         | DEBUG | One outbound exchange (per redirect/retry) | `host`, `method`, `status`, `ip`, `elapsed_ms`                                    |

At `info`, you see one `request` close line per request, which works as
an access log. At `debug` the inner spans show where the time went:

```text
DEBUG request{…}:pool_checkout{wait_ms=0 outcome="hit"}: close time.busy=38µs time.idle=77µs
DEBUG request{…}:lua_handler:db_query{kind="query" stmt="26d8ca3f" elapsed_ms=3}: close …
DEBUG request{…}:lua_handler{elapsed_ms=4}: close time.busy=3.9ms time.idle=564µs
 INFO request{id=01a0d32f-… method=GET path=/dashboard status=200}: close time.busy=6.7ms time.idle=588µs
```

Notes:

- `stmt` is a short hash of the SQL text, so you can group repeats of
  the same statement without logging the SQL.
- `outcome = "shed"` matches a `503` answer: no Lua state became free in
  time. When a damaged Lua state is replaced, the pool logs a separate
  event with `outcome = "rebuilt"`.
- `ip` on `fetch` is the address actually connected to, after the
  [SSRF checks](./fetch#the-ssrf-policy).
- Prefer the integer `elapsed_ms` and `wait_ms` fields over parsing
  `time.busy`.

## Request ids

Every request gets a UUIDv7. It is `req.id` in Lua, sent back to the
client as `X-Request-ID`, and on every log line for that request.

```lua
return nitr.error(500, { code = "INTERNAL", request_id = req.id })
```

When a user quotes that id, you can find the exact failure. To reuse an
id set by your proxy, see `trust_request_id` in the
[configuration reference](./configuration/file#top-level).

## Redaction rules

What Nitr itself logs is limited to hosts, methods, status codes, ids,
durations and counts:

- **No SQL text and no bound values.** `db_query` logs only the kind, a
  hash of the statement and the duration.
- **No full URLs.** Query strings carry tokens. `fetch` logs the host and
  connected IP, never the path or query.
- **No header values, cookies or session data.**

Control characters in a log message (such as a `\n` from a request path)
are escaped, so request data cannot fake an extra log line.

> [!WARNING] Your own fields are your responsibility
>
> `nitr.log.*` logs whatever you pass it.
>
> ```lua
> nitr.log.info("login", { password = form.password })   -- ❌ never
> nitr.log.info("login", { user_id = user.id })          -- ✅
> ```

## Error logging

A failing handler is logged **before** your `on_error` runs, so handling
an error never hides it from the logs:

```json
{
  "level": "ERROR",
  "fields": {
    "message": "handler failed: attempt to index a nil value (local 'user')",
    "error.kind": "lua",
    "error.source": "app.lua",
    "error.line": 42
  },
  "target": "nitr_http::handler",
  "span": {
    "id": "01a0d32f-…",
    "method": "GET",
    "path": "/dashboard",
    "name": "request"
  }
}
```

`error.module` names the failing module (such as `nitr.db`) when it is known. In dev mode
the stack traceback follows at `debug` level.

## What to alert on

| Signal          | Where to look                                            |
| --------------- | -------------------------------------------------------- |
| Error rate      | `level = "ERROR"`, or `status >= 500` on `request`       |
| Latency         | `time.busy` on `request`                                 |
| Overload        | `outcome = "shed"` on `pool_checkout`, or `status = 503` |
| Rate limiting   | `status = 429`                                           |
| Upstream health | `status` and `elapsed_ms` on `fetch`                     |
| Recycled states | `outcome = "rebuilt"`                                    |

## Debugging

`nitr.dbg(value)` prints a value's structure to the log at `debug` level
and returns it unchanged, so it fits inside an expression:

```lua
local data = nitr.dbg(req:json())        -- logs it, then carries on
```

It needs `"dbg"` in `[std] features`. Leave it out of production: it
prints everything, passwords included.

In `nitr test`, each test's log lines are captured and printed only when
it fails; `t.logs()` returns them for assertions. See
[Testing](./testing#logs).

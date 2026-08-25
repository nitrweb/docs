# Logging

What Nitr's logs contain, and what they promise.

## Configuration

```toml
[log]
format = "text"     # "text" for humans, "json" for a log shipper
level = "info"      # default: info (debug in dev mode)
```

`RUST_LOG` overrides `level` and takes the usual `tracing` filter
syntax:

```sh
RUST_LOG=info,nitr_http=debug nitr run
```

`format = "json"` emits one JSON object per line with every field below
as a real key.

## Logging from Lua

```lua
nitr.log.debug("cache miss", { key = key })
nitr.log.info("order created", { order_id = id, total = total })
nitr.log.warn("upstream slow", { host = "api.example.com", ms = 2300 })
nitr.log.error("payment failed", { order_id = id, reason = reason })
```

The second argument's fields become **real keys** in JSON output — not
interpolated text. That is the difference between a log you can query
and a log you can only grep:

```json
{
  "timestamp": "2026-08-22T10:15:00Z",
  "level": "INFO",
  "message": "order created",
  "order_id": 1042,
  "total": 39.9,
  "id": "018f...",
  "method": "POST",
  "path": "/api/orders"
}
```

Note that `id`, `method` and `path` arrived on their own: every log
event inside the `request` span carries the span's fields as context, so
your lines are correlated with the request without you passing anything
around.

## Spans

Nitr instruments the request path with a small, fixed hierarchy. A span
contributes twice: events inside it carry its fields, and the span emits
one **close** line when it ends, carrying its fields plus `time.busy` /
`time.idle`.

| Span            | Level | Opened around                                | Fields                                                                        |
| --------------- | ----- | -------------------------------------------- | ----------------------------------------------------------------------------- |
| `request`       | INFO  | the whole request, dispatch to response      | `id`, `method`, `path`, `status` (recorded at completion)                     |
| `pool_checkout` | DEBUG | waiting for a free Lua state                 | `wait_ms`, `outcome` (`hit` / `shed`)                                         |
| `lua_handler`   | DEBUG | the script's middleware + handler chain      | `elapsed_ms`                                                                  |
| `db_query`      | DEBUG | one SQL statement (`nitr.db`)                | `kind` (`query` / `query_row` / `query_one` / `execute` / `tx`), `elapsed_ms` |
| `fetch`         | DEBUG | one outbound network exchange (`nitr.fetch`) | `host`, `method`, `status`, `ip`, `elapsed_ms`                                |

Everything nests under `request`, so any line — including a `fetch` SSRF
denial — arrives already correlated with the request id, method and
path.

### What you see at each level

At the default `info` level, exactly **one close line per request**: the
`request` span, which reads as an access-log entry.

At `debug` (the dev-mode default) the inner spans appear too, and
decompose where the time went — pool wait vs. script execution vs.
database vs. upstream calls:

```
pool_checkout{wait_ms=0 outcome=hit} close
db_query{kind=query elapsed_ms=3} close
fetch{host=api.example.com method=GET status=200 ip=93.184.216.34 elapsed_ms=142} close
lua_handler{elapsed_ms=149} close
request{id=018f... method=GET path=/dashboard status=200} close time.busy=151ms
```

`level = "warn"` silences the spans wholesale; there is no separate
switch.

### Notes on individual spans

- **`pool_checkout`.** `outcome = "shed"` pairs with the `503` the
  request was answered with. A damaged state being replaced logs a
  separate `outcome = "rebuilt"` event from the pool.
- **`fetch`.** One span **per network exchange** — a call that redirects
  twice (or retries) produces one span per hop, each with the status
  that hop answered. `ip` is the address the SSRF-vetted resolution
  actually connected to: the security-relevant fact for an audit trail.
- **Durations.** `elapsed_ms` and `wait_ms` are explicit integer fields.
  Prefer them over parsing the human-formatted `time.busy` /
  `time.idle`.

## Request ids

Every request gets a UUIDv7, available as `req.id`, echoed to the client
as `X-Request-ID`, and present on every log line for that request.

```lua
return nitr.error(500, { code = "INTERNAL", request_id = req.id })
```

A user quoting that id lets you find the exact failure immediately.

```toml
trust_request_id = false     # default
```

Set it to `true` **only behind a proxy** that sets or sanitizes the
header — otherwise a client chooses its own id, and can collide with
someone else's on purpose.

## Redaction rules

Enforced by review. The vocabulary of span fields is deliberately
closed:

- **No SQL text and no bind values.** Statements can embed secrets, and
  logs outlive them. `db_query` carries only the statement kind and its
  duration.
- **No full URLs.** Query strings carry tokens. `fetch` carries the host
  (and connected IP), never the path or query.
- **No header values, no cookie or session material**, anywhere.
- Hosts, methods, status codes, ids, durations and counts are the whole
  vocabulary. A new span field must fit that list or state why not.

> [!WARNING] Your own logs are your own responsibility
>
> These rules bind what **Nitr** emits. `nitr.log.*` will faithfully log
> whatever you hand it:
>
> ```lua
> nitr.log.info("login", { password = form.password })   -- ❌ never
> nitr.log.info("login", { user_id = user.id })          -- ✅
> ```

## Error logging

A handler failure is logged **before** your `on_error` runs, structured,
with `error.kind`, `error.source`, `error.line` and `error.module` — so
handling an error never hides it from the logs.

```json
{
  "level": "ERROR",
  "message": "handler failed",
  "error.kind": "lua",
  "error.message": "attempt to index a nil value (local 'user')",
  "error.source": "app.lua",
  "error.line": 42,
  "id": "018f...",
  "method": "GET",
  "path": "/dashboard"
}
```

## Production setup

```toml
[log]
format = "json"
level = "info"
```

One object per line, ready for a shipper. In a terminal, output is
coloured; through a pipe it is byte-clean plain text, and JSON never
carries ANSI. `NO_COLOR` disables colouring explicitly.

**Fields worth alerting on:**

| Signal          | Field                                                    |
| --------------- | -------------------------------------------------------- |
| Error rate      | `level = "ERROR"`, or `status >= 500` on `request`       |
| Latency         | `time.busy` on `request`                                 |
| Overload        | `outcome = "shed"` on `pool_checkout`, or `status = 503` |
| Rate limiting   | `status = 429`                                           |
| Upstream health | `status` and `elapsed_ms` on `fetch`                     |
| Recycled states | `outcome = "rebuilt"` from the pool                      |

## Debugging

`nitr.dbg(value)` pretty-prints a value's structure to the log and
returns it unchanged, so it can be dropped into an expression:

```lua
local data = nitr.dbg(req:json())        -- logs it, then carries on
```

It needs `"dbg"` in `[std] features`. Keep it out of production
configurations — it is a debugging tool, and it will happily print a
password field.

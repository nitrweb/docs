# Outbound HTTP

`nitr.fetch` makes HTTP requests from a handler. Requests share a
connection pool and are bounded by timeouts, a per-request call budget
and an SSRF policy that blocks private addresses by default.

## Enabling it

```toml
[std]
features = ["json", "http", "log", "fetch"]   # ← "fetch"
```

## The basics

`nitr.fetch(...)` returns an **unsent handle**. Nothing happens until you
call `:send()` (or pass it to `nitr.await_all`):

```lua
app:get("/weather", function(req)
    local resp = nitr.fetch("GET", "https://api.example.com/weather"):send()

    if resp.status ~= 200 then
        return nitr.error(502, { code = "UPSTREAM_FAILED", status = resp.status })
    end

    return nitr.json(resp:json())
end)
```

### Options

```lua
local handle = nitr.fetch("POST", "https://api.example.com/items", {
    headers = { ["Authorization"] = "Bearer " .. nitr.cfg.api_token },
    query   = { include = "details" },       -- encoded and appended
    json    = { name = "widget", qty = 3 },  -- encoded, Content-Type set
    timeout = 5,                             -- seconds
})
```

| Option    | Meaning                                                                      |
| --------- | ---------------------------------------------------------------------------- |
| `headers` | Request headers                                                              |
| `query`   | Query parameters, encoded and appended to the URL                            |
| `json`    | A table sent as a JSON body, with `Content-Type: application/json`           |
| `body`    | A raw string body                                                            |
| `timeout` | Seconds for this call. It can **shorten** `[fetch] timeout`, never extend it |
| `retry`   | `{ attempts, backoff }`; see [Retries](#retries)                             |

### The response

| Field / method | Meaning                                                 |
| -------------- | ------------------------------------------------------- |
| `resp.status`  | Status code                                             |
| `resp.headers` | Response headers                                        |
| `resp.url`     | Final URL, after redirects                              |
| `resp:text()`  | Body as a string, up to `[fetch] max_response_bytes`    |
| `resp:json()`  | Body decoded as JSON                                    |
| `resp:read()`  | Next chunk of the body when streaming; `nil` at the end |

## Running requests concurrently

`nitr.await_all` runs several handles at once. Pass the handles as
**separate arguments**; the results come back as **multiple values** in
the same order:

```lua
app:get("/dashboard/:id", function(req)
    local id = req.params.id
    local user, orders = nitr.await_all(
        nitr.fetch("GET", "https://api.example.com/users/" .. id),
        nitr.fetch("GET", "https://api.example.com/orders?user=" .. id)
    )

    return nitr.json({ user = user:json(), orders = orders:json() })
end)
```

Two 200 ms calls take about 200 ms, not 400 ms. `await_all` also accepts
[`nitr.db:query_async`](./database#concurrent-queries) handles. Passing a
table (`nitr.await_all({ h1, h2 })`) or more handles than
`[fetch] max_concurrent` (default 8) raises.

## Retries

Retries are opt-in per call:

```lua
nitr.fetch("GET", url, { timeout = 5, retry = { attempts = 3 } }):send()
```

| Field      | Meaning                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------- |
| `attempts` | Total attempts (default 3), capped by `[fetch] max_retries` (default 5)                        |
| `backoff`  | `"exponential"` (default: 100 ms, doubling, with jitter, at most 5 s) or `"constant"` (100 ms) |

A request is retried after a network error or a `408`, `429`, `500`,
`502`, `503` or `504`. Only idempotent methods (`GET`, `HEAD`, `PUT`,
`DELETE`, `OPTIONS`) are retried; on `POST` or `PATCH` the option is
ignored and the request is sent once. When every attempt fails, you get
the last response (or the last error). All attempts count as one call
toward `max_per_request`.

> [!WARNING] Set a `timeout` when you set `retry`
>
> Three attempts at the default 30-second timeout can take over 90
> seconds, longer than the handler's own time limit (`[lua]
exec_timeout_ms`, 30 s by default).

## The SSRF policy

By default, requests to loopback, private, link-local, CGNAT, multicast
and other reserved addresses are **refused**, including IPv6 forms that
wrap one of those IPv4 addresses. Every redirect hop is checked again
(up to 5 redirects).

```toml
[fetch]
allowed_hosts = ["api.stripe.com", "hooks.slack.com"]  # only these hosts, on every hop
allow_private_networks = false                          # true permits loopback/private targets
```

When any part of a URL comes from user input, set `allowed_hosts`.

Two more protections are always on:

- **DNS rebinding.** The host name is resolved once, and the connection
  uses that same checked address.
- **Credentials on redirects.** A redirect to a different scheme, host
  or port drops `Authorization`, `Cookie` and `Proxy-Authorization`, so
  an open redirect upstream cannot leak your token.

## Budgets and limits

| Setting                  | Default | Limits                                                               |
| ------------------------ | ------- | -------------------------------------------------------------------- |
| `max_per_request`        | 32      | Outbound calls **one inbound request** may make. `0` removes the cap |
| `max_concurrent`         | 8       | Handles per `nitr.await_all(...)`                                    |
| `max_response_bytes`     | 8 MiB   | Bodies read with `resp:text()` / `resp:json()`                       |
| `connect_timeout`        | 10 s    | Opening a connection                                                 |
| `timeout`                | 30 s    | Each request. A per-call `timeout` can lower it, never raise it      |
| `max_retries`            | 5       | Upper bound on `retry.attempts`                                      |
| `pool_max_idle_per_host` | 8       | Idle connections kept per host                                       |

`max_per_request` stops a loop over user data from turning one inbound
request into thousands of outbound ones. All keys are in the
[`[fetch]` reference](./configuration/file#fetch).

The fetch timeout and the handler's time limit (`[lua] exec_timeout_ms`)
are separate: three sequential 15-second fetches break a 30-second
handler limit even though each is within its own timeout. Run them with
`await_all`, or use shorter per-call timeouts.

## Streaming a response

```lua
app:get("/proxy/report", function(req)
    local upstream = nitr.fetch("GET", "https://api.example.com/report.csv"):send()

    return {
        status  = upstream.status,
        headers = { ["Content-Type"] = "text/csv" },
        body = function(writer)
            while true do
                local chunk = upstream:read()
                if not chunk then break end
                writer:write(chunk)
            end
        end,
    }
end)
```

`resp:read()` never holds the whole body, so `max_response_bytes` does
not apply. The stream still holds a Lua state while it runs; see
[Streaming](./streaming#the-cost-a-stream-holds-a-lua-state).

## Proxies

```toml
[fetch]
proxy = "http://proxy.internal:3128"
allowed_hosts = ["api.example.com"]    # required with a proxy (see below)
no_proxy = false                       # true ignores the proxy env vars
```

Without `proxy`, the `HTTPS_PROXY`, `HTTP_PROXY` and `ALL_PROXY`
environment variables are used.

> [!DANGER] A proxy needs an explicit choice, or the server will not start
>
> Behind a proxy, the proxy resolves host names, so Nitr cannot check the
> address it connects to. When a proxy is configured (in `[fetch]` or
> through the environment), startup fails unless you set
> `allowed_hosts`, set `allow_private_networks = true` (trust the proxy),
> or set `no_proxy = true`. The error names where the proxy came from.

## Error handling

A network failure, a timeout or a policy refusal **raises** (with
`kind = "nitr"`). An HTTP error status does not: a `500` from upstream is
a successful fetch.

```lua
local ok, resp = pcall(function()
    return nitr.fetch("GET", url, { timeout = 5 }):send()
end)

if not ok then
    nitr.log.warn("upstream unreachable", { error = nitr.errinfo(resp).message })
    return nitr.json({ data = nil, degraded = true })
end

if resp.status >= 500 then
    return nitr.error(502, { code = "UPSTREAM_ERROR" })
end

return nitr.json(resp:json())
```

To avoid calling an upstream on every request, cache the result with
[`nitr.cache:remember`](./cache#remember).

## Tracing

```toml
[fetch]
propagate_trace_context = true
```

This sends a W3C `traceparent` header derived from the inbound request
id, so the upstream's logs line up with yours. At `debug` level each
network exchange (each redirect hop and retry) logs a `fetch` span with
the host, method, status, connected IP and duration, never the full URL.
See [Logging](./logging#spans).

## Testing

In `nitr test`, `t.fetch.mock(...)` answers `nitr.fetch` calls without
touching the network. See [Testing](./testing#fetch).

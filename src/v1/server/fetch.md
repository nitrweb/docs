# Outbound HTTP

`nitr.fetch` makes HTTP requests from a handler — through a shared
connection pool, with timeouts, an SSRF policy and a per-request
outbound budget.

## Enabling it

```toml
[std]
features = ["json", "http", "log", "fetch"]   # ← "fetch"
```

## The basics

`nitr.fetch(...)` returns an **unsent handle**. Nothing happens until
you `:send()` it (or hand it to `nitr.await_all`):

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
    query   = { include = "details" },       -- appended, encoded for you
    json    = { name = "widget", qty = 3 },  -- encodes and sets Content-Type
    timeout = 5,                             -- seconds, overrides [fetch] timeout
    retry   = { attempts = 3, backoff = 0.5 },
})
```

| Option    | Meaning                                             |
| --------- | --------------------------------------------------- |
| `headers` | Request headers                                     |
| `query`   | Query parameters, encoded and appended              |
| `json`    | Table body, JSON-encoded, with the content type set |
| `body`    | Raw string body                                     |
| `timeout` | Seconds for this call, overriding `[fetch] timeout` |
| `retry`   | `{ attempts, backoff }` — see [Retries](#retries)   |

### The response

| Field / method | Meaning                                           |
| -------------- | ------------------------------------------------- |
| `resp.status`  | Status code                                       |
| `resp.headers` | Response headers                                  |
| `resp.url`     | Final URL **after redirects**                     |
| `resp:text()`  | Body as a string, bounded by `max_response_bytes` |
| `resp:json()`  | Body decoded as JSON                              |
| `resp:read()`  | Next chunk while streaming; `nil` at the end      |

## Running requests concurrently

`nitr.await_all` runs several handles at once and returns their results
**in order**:

```lua
app:get("/dashboard/:id", function(req)
    local results = nitr.await_all({
        nitr.fetch("GET", "https://api.example.com/users/" .. req.params.id),
        nitr.fetch("GET", "https://api.example.com/orders?user=" .. req.params.id),
        nitr.fetch("GET", "https://billing.example.com/balance/" .. req.params.id),
    })

    return nitr.json({
        user    = results[1]:json(),
        orders  = results[2]:json(),
        balance = results[3]:json(),
    })
end)
```

Three 200 ms calls take 200 ms, not 600 ms. Concurrency is capped by
`[fetch] max_concurrent` (default 8).

### Mixing in a database query

`nitr.db:query_async` produces a handle `await_all` also accepts, so a
query and an upstream call overlap instead of running in series:

```lua
local results = nitr.await_all({
    nitr.db:query_async("SELECT * FROM users WHERE id = ?", { id }, "query_row"),
    nitr.fetch("GET", "https://api.example.com/profile/" .. id),
})

local user    = results[1]
local profile = results[2]:json()
```

## Retries

Opt-in per call, and **only ever applied to idempotent methods** — a
retried `POST` can charge a card twice:

```lua
nitr.fetch("GET", url, { retry = { attempts = 3, backoff = 0.5 } }):send()
```

| Field      | Meaning                                         |
| ---------- | ----------------------------------------------- |
| `attempts` | Total attempts, capped by `[fetch] max_retries` |
| `backoff`  | Seconds between attempts                        |

> [!WARNING] Retries multiply your latency budget
>
> Three attempts at a 30-second timeout is a 90-second worst case —
> longer than the default `exec_timeout_ms`, so the handler dies before
> the retries finish. Set a **per-call `timeout`** whenever you set
> `retry`.

## The SSRF policy

By default, requests to loopback, private, link-local and CGNAT
addresses are **refused**, and every redirect hop is re-checked.

```toml
[fetch]
allowed_hosts = ["api.example.com"]   # exact-host allow-list, all hops
allow_private_networks = false        # permit loopback/RFC1918 targets
```

> [!TIP] Why DNS rebinding does not work here
>
> The hostname is resolved **once**, inside the resolver the connector
> itself uses. A DNS server cannot answer a public address to the policy
> check and a private one to the connect — there is only one resolution,
> and the connection uses it.

When a URL comes from user input, add an allow-list. That turns "not
obviously internal" into "one of these three hosts":

```toml
[fetch]
allowed_hosts = ["api.stripe.com", "hooks.slack.com"]
```

## Budgets and limits

| Setting                  | Default | Bounds                                                                     |
| ------------------------ | ------- | -------------------------------------------------------------------------- |
| `max_per_request`        | 32      | Total outbound calls **one inbound request** may make. `0` removes the cap |
| `max_concurrent`         | 8       | Requests per `nitr.await_all(...)`                                         |
| `max_response_bytes`     | 8 MiB   | `resp:text()` / `resp:json()` bodies                                       |
| `connect_timeout`        | 10 s    | Establishing a connection                                                  |
| `timeout`                | 30 s    | Per request, unless overridden per call                                    |
| `pool_max_idle_per_host` | 8       | Idle connections kept                                                      |

`max_per_request` is the one to think about: it is what stops a loop
over user-supplied data from turning one inbound request into a thousand
outbound ones.

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

`resp:read()` bypasses `max_response_bytes` in the sense that you never
hold the whole body — but the stream still holds a Lua state for its
lifetime. See [Streaming](./streaming#the-cost-a-stream-holds-a-lua-state).

## Proxies

```toml
[fetch]
proxy = "http://proxy.internal:3128"
no_proxy = false                       # true ignores the env vars entirely
```

Unset, `HTTPS_PROXY` and `HTTP_PROXY` from the environment are used.

## Tracing

```toml
[fetch]
propagate_trace_context = true
```

Forwards a W3C `traceparent` derived from the inbound request id, so an
upstream service's logs correlate with yours.

Each network exchange also emits a `fetch` span at debug level:

```
fetch{host=api.example.com method=GET status=200 ip=93.184.216.34 elapsed_ms=142} close
```

One span **per hop** — a call that redirects twice or retries produces
one span each, with the status that hop answered. `ip` is the address
the SSRF-vetted resolution actually connected to: the security-relevant
fact for an audit trail. Full URLs are never logged, because query
strings carry tokens.

## Error handling

A network failure, a timeout or a policy refusal **raises** (with
`kind = "nitr"`). An HTTP error status does not — a `500` from upstream
is a perfectly successful fetch.

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

## Caching upstream responses

An upstream call you make on every request is an upstream call you make
too often:

```lua
local rates = nitr.cache:remember("fx:rates", 300, function()
    return nitr.fetch("GET", "https://api.example.com/rates"):send():json()
end)
```

See [Cache](./cache).

## Timeouts and the execution budget

Two independent clocks apply:

| Clock                                       | Bounds                                 |
| ------------------------------------------- | -------------------------------------- |
| `[fetch] timeout` (or a per-call `timeout`) | one outbound request                   |
| `[lua] exec_timeout_ms`                     | the **whole handler**, 30 s by default |

Three sequential 15-second fetches exceed the handler budget even though
each one is within its own. Either run them concurrently with
`await_all`, or set per-call timeouts that fit inside the handler's
budget.

# Streaming & SSE

When a response is too big to build in memory (a CSV export, a log
tail, a live feed), make the body a **function** instead of a string.

## Streaming bodies

### The writer form

```lua
app:get("/report.csv", function(req)
    return {
        status = 200,
        headers = {
            ["Content-Type"]        = "text/csv; charset=utf-8",
            ["Content-Disposition"] = 'attachment; filename="report.csv"',
        },
        body = function(writer)
            writer:write("id,name,score\n")
            for _, row in ipairs(nitr.db:query("SELECT id, name, score FROM players")) do
                writer:write(string.format("%d,%s,%d\n", row.id, row.name, row.score))
            end
        end,
    }
end)
```

`writer:write(chunk)` sends a chunk and waits while the client is
slower than your code, so the response never piles up in memory. If
the client disconnects, `write` raises and the stream ends.

Each chunk written resets the `[lua] exec_timeout_ms` limit, so the
limit applies to the time between writes, not to the whole stream.

### The iterator form

A function that returns one chunk per call and `nil` at the end also
works. `coroutine.wrap` is the easy way to write one:

```lua
app:get("/chunks", function(req)
    return {
        headers = { ["Content-Type"] = "text/plain; charset=utf-8" },
        body = coroutine.wrap(function()
            for i = 1, 5 do
                coroutine.yield("chunk " .. i .. "\n")
            end
        end),
    }
end)
```

## Server-Sent Events

`nitr.sse(fn)` builds a complete `text/event-stream` response. Your
function receives `send(event, data)`:

```lua
app:get("/events", function(req)
    return nitr.sse(function(send)
        for i = 1, 10 do
            send("tick", { count = i })      -- tables are sent as JSON
        end
        send("done", "stream finished")      -- strings are sent as is
    end)
end)
```

In the browser:

```html
<script>
  const es = new EventSource('/events')
  es.addEventListener('tick', (e) => console.log(JSON.parse(e.data)))
  es.addEventListener('done', (e) => {
    console.log(e.data)
    es.close()
  })
</script>
```

SSE is plain HTTP and browsers reconnect on their own, which makes it a
good fit for progress bars, notifications and live counters. Nitr does
not support WebSockets.

Data with line breaks is sent as several `data:` lines, which the
browser joins back together, so request data cannot inject extra SSE
fields. An event name containing a line break raises. Table data must
be valid UTF-8; encode raw bytes with `nitr.base64.encode` first.

## The cost: a stream holds a Lua state

A streaming response keeps its Lua state busy until the stream ends. A
client reading for ten minutes holds one of your `workers` for ten
minutes. `max_streams` caps how many streams can run at once:

```toml
workers = 8
max_streams = 7      # default: workers - 1, at least 1
```

The default keeps at least one state free for ordinary requests. Past
`max_streams`, a new streaming response is answered `503`.

> [!WARNING] Plan the capacity
>
> Open SSE connections use the same `workers` pool as every other
> request. For hundreds of concurrent listeners, raise `workers` or put
> a dedicated fan-out service in front.

## Pacing a stream

Do not busy-wait between events: a spin loop keeps the state busy and
burns CPU. Nitr has no built-in sleep, but a
[Rust extension module](../library/extension-modules) can add one that
waits without blocking anything:

```rust
// main.rs: mounts nitr.ext.time.sleep(ms)
.module("time", |lua| {
    let t = lua.create_table()?;
    t.set("sleep", lua.create_async_function(|_, ms: u64| async move {
        tokio::time::sleep(std::time::Duration::from_millis(ms)).await;
        Ok(())
    })?)?;
    Ok(t)
})
```

```lua
app:get("/events", function(req)
    return nitr.sse(function(send)
        for i = 1, 5 do
            send("tick", { count = i })
            nitr.ext.time.sleep(1000)
        end
    end)
end)
```

The repository's [`sse` example](../examples#sse) does exactly this.

## Streaming from the database

```lua
app:get("/export.ndjson", function(req)
    return {
        headers = { ["Content-Type"] = "application/x-ndjson" },
        body = function(writer)
            for _, row in ipairs(nitr.db:query("SELECT * FROM events ORDER BY id")) do
                writer:write(nitr.json:encode(row) .. "\n")
            end
        end,
    }
end)
```

`nitr.db:query` still loads every row at once (up to
`[database] max_rows`); streaming only avoids building the response in
memory. For large exports, page the query (`WHERE id > ? LIMIT 1000`)
inside the writer loop.

## Streaming a proxied response

`resp:read()` on a [`nitr.fetch`](./fetch) response returns the
upstream body chunk by chunk, so a proxy never holds all of it:

```lua
app:get("/proxy/*", function(req)
    local upstream = nitr.fetch("GET", "https://api.example.com/" .. req.params.splat):send()
    return {
        status  = upstream.status,
        headers = { ["Content-Type"] = upstream.headers["content-type"] },
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

## Errors mid-stream

Once the first chunk is sent, the status and headers are already on the
wire, so a failure cannot become a `500`. The stream just ends and the
client sees a cut-off response. Do your checks before returning the
body function:

```lua
app:get("/export.csv", function(req)
    if not can_export(req) then
        return nitr.error(403, { code = "FORBIDDEN" })   -- before any chunk
    end
    return { headers = { … }, body = function(writer) … end }
end)
```

For long streams, send a final line or event (`send("done", { ok = true })`)
so the client can tell a finished stream from a cut-off one.

## Shutdown

On shutdown, open streams get extra time after ordinary requests
finish:

```toml
[shutdown]
grace = 30            # seconds for ordinary in-flight requests
stream_grace = 5      # extra seconds, used only if a stream is still open
```

Your process manager's stop timeout must be longer than
`readiness_delay + grace + stream_grace`. See [Deployment](./deployment/).

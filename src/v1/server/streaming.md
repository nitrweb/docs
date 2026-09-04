# Streaming & SSE

When a response is too big to build in memory — a CSV export, a log
tail, a live feed — make the body a **function** instead of a string.

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

`writer:write(chunk)` sends a chunk and **suspends while the client is
slower than the producer**. That backpressure is the point: a million-row
export never has to fit in the state's 8 MiB memory limit.

### The iterator form

Any function returning one chunk per call and `nil` to finish works as a
body. `coroutine.wrap` is the idiomatic way to write one:

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

`nitr.sse(fn)` builds a complete `text/event-stream` response — headers
included. Your function receives a `send`:

```lua
app:get("/events", function(req)
    return nitr.sse(function(send)
        for i = 1, 10 do
            send("tick", { count = i })      -- tables are JSON-encoded
        end
        send("done", "stream finished")      -- strings are sent as-is
    end)
end)
```

On the browser side:

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

> [!TIP] SSE beats WebSockets for one-way updates
>
> It is plain HTTP: no upgrade handshake, no separate protocol, and the
> browser reconnects on its own. Use it for progress, notifications and
> live counters. Nitr does not implement WebSockets.

### Framing is not something data can break out of

The event-stream grammar ends a line at `\r\n`, `\n` **or a bare `\r`**,
and each is a place a value could otherwise start a field of its own.
So:

- **String data is split on all three**, one `data:` line per line, and
  the client reassembles them with `\n` between. Multi-line data works
  as written; a `\r` smuggled in from a request cannot begin a `retry:`
  or `event:` line.
- **An event name containing a line break raises.** A name is one line
  by definition, so this is an error at the `send` rather than a second
  event on the wire.

```lua
send("log", request_line)          -- ✅ any line breaks become data: lines
send(user_supplied_name, payload)  -- ❌ raises if the name has \r or \n
```

Table data goes through the JSON encoder, which has no line breaks to
worry about — but does refuse a string that is not UTF-8, so encode raw
bytes with `nitr.base64.encode` first.

## The cost: a stream holds a Lua state

This is the single most important thing to understand about streaming in
Nitr.

A streaming response **occupies its pooled Lua state for the entire
lifetime of the stream**. A client reading slowly for ten minutes holds
one of your `workers` states for ten minutes.

That is why `max_streams` exists:

```toml
workers = 8
max_streams = 7      # default: workers - 1, at least 1
```

The default reserves at least one state for ordinary requests, so idle
streams cannot pin the whole pool. Past `max_streams`, a new streaming
response is rejected with `503`.

> [!WARNING] Plan the capacity
>
> Long-lived SSE connections and `workers` are the same budget. Serving
> 500 concurrent SSE clients is not what a small pool of Lua states is
> for — put those behind a purpose-built fan-out, or accept that
> `workers` must be large.

## Pacing a stream

Do not busy-wait — a spin loop burns the execution budget and blocks the
state for nothing. Sleep on the async runtime instead, which needs a
[Rust extension module](../library/extension-modules):

```rust
// main.rs — mounts nitr.ext.time.sleep(ms)
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
            nitr.ext.time.sleep(1000)     -- suspends on the tokio timer
        end
    end)
end)
```

Suspending this way costs no execution budget and blocks nothing else.
This is exactly what the repository's
[`sse` example](../examples#sse) does.

## Streaming from the database

Stream rows out as they are read rather than building one giant table:

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

> [!NOTE] The query itself is not lazy
>
> `nitr.db:query` returns all rows. What streaming saves here is the
> **response** buffer, not the result set. For genuinely huge exports,
> page the query (`WHERE id > ? LIMIT 1000`) inside the writer loop.

## Streaming a proxied response

`nitr.fetch`'s `resp:read()` streams the upstream body chunk by chunk,
so a proxy never buffers the whole thing:

```lua
app:get("/proxy/*", function(req)
    local upstream = nitr.fetch("GET", "https://api.example.com/" .. req.params[1]):send()
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

## Shutdown behaviour

A graceful drain gives streams extra time:

```toml
[shutdown]
grace = 30            # ordinary in-flight requests
stream_grace = 5      # extra, spent only if a stream is still live
```

Your supervisor's stop timeout must exceed `grace + stream_grace`, or
the process is killed mid-drain. See [Deployment](./deployment/).

## Errors mid-stream

Once the first chunk has been written, the status and headers are
already on the wire — there is no way to turn a partial `200` into a
`500`. A failure inside the body function ends the stream; the client
sees a truncated response.

So: **validate before you start writing**.

```lua
app:get("/export.csv", function(req)
    local ok, err = check_permissions(req)
    if not ok then
        return nitr.error(403, { code = "FORBIDDEN" })   -- before any chunk
    end

    return { headers = { … }, body = function(writer) … end }
end)
```

For long streams, a sentinel line or a final SSE event lets the client
tell "finished" from "cut off":

```lua
send("done", { ok = true })
```

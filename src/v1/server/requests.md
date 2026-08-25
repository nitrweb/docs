# Requests

Every handler and every middleware receives one argument: `req`.

```lua
app:post("/users/:id", function(req)
    local body = req:json()
    return nitr.json({ id = req.params.id, name = body.name })
end)
```

## Fields

| Field             | Type              | Example                                                |
| ----------------- | ----------------- | ------------------------------------------------------ |
| `req.method`      | string, uppercase | `"GET"`                                                |
| `req.path`        | string            | `"/users/42"`                                          |
| `req.params`      | table             | `{ id = "42" }` — captured by the router               |
| `req.query`       | table             | `{ page = "2" }` — parsed and percent-decoded          |
| `req.headers`     | table             | lowercase names: `req.headers["content-type"]`         |
| `req.cookies`     | object            | `req.cookies.session`, plus `:verify(...)`             |
| `req.id`          | string            | UUIDv7, echoed to the client as `X-Request-ID`         |
| `req.remote_addr` | string            | `"203.0.113.7:54321"`                                  |
| `req.uri`         | table             | `scheme`, `host`, `port`, `path`, `authority`, `query` |

```lua
app:get("/debug", function(req)
    return nitr.json({
        method = req.method,
        path   = req.path,
        host   = req.uri.host,
        agent  = req.headers["user-agent"],
        id     = req.id,
    })
end)
```

> [!TIP] Header names are lowercase
>
> Always. `req.headers["Content-Type"]` is `nil`;
> `req.headers["content-type"]` is the value. HTTP header names are
> case-insensitive, so Nitr picks one case and sticks to it rather than
> making you guess.

> [!NOTE] `req.remote_addr` is the peer
>
> Behind a proxy that is the proxy, not the client. Read
> `X-Forwarded-For` yourself if you trust it — and see
> `[rate_limit] trust_forwarded_for` if you want the limiter to use it
> too.

## Reading the body

Pick the method that matches the content type. All of them are bounded
by `[limits] max_body_bytes`.

### JSON

```lua
app:post("/users", function(req)
    local body = req:json()          -- errors on an empty or invalid body
    return nitr.json({ name = body.name }, 201)
end)
```

`req:json()` **raises** on invalid JSON. That is usually what you want —
the error is classified, logged and answered by
[`on_error`](./errors). To answer it yourself:

```lua
local ok, body = pcall(function() return req:json() end)
if not ok then
    return nitr.error(400, { code = "INVALID_JSON" })
end
```

Better still, validate the shape too:

```lua
local schema = nitr.validate.schema({
    name  = { type = "string", min_len = 1, required = true },
    email = { type = "string", format = "email", required = true },
})

app:post("/users", function(req)
    local data, err = schema:check(req:json())
    if not data then
        return nitr.error(422, { code = "VALIDATION_FAILED", fields = err.fields })
    end
    return nitr.json(create_user(data), 201)
end)
```

See [Validation](./validation).

### Text

```lua
local raw = req:text()               -- the whole body as a string
```

Binary-safe: Lua strings are byte strings, so this handles binary
payloads correctly.

### Form data

For `application/x-www-form-urlencoded` bodies:

```lua
app:post("/login", function(req)
    local form = req:form()
    return authenticate(form.username, form.password)
end)
```

> [!TIP] The parse is cached
>
> Middleware and handler can both call `req:form()` without re-reading
> or re-parsing the body.

### Streaming reads

For bodies you do not want to hold in memory at once:

```lua
app:post("/ingest", function(req)
    local total = 0
    while true do
        local chunk = req:read(64 * 1024)   -- next chunk, or at least n bytes
        if not chunk then break end         -- nil marks the end
        total = total + #chunk
    end
    return nitr.json({ bytes = total })
end)
```

## File uploads

Multipart parts are handled **in Rust** and streamed to disk. A file
never becomes a Lua string, so a 10 MiB upload does not touch the
state's 8 MiB heap.

```lua
app:post("/upload", function(req)
    local saved = {}

    local count = req:multipart(function(part)
        if part.filename then
            local dest = nitr.path.join("uploads", nitr.path.basename(part.filename))
            local bytes = part:save(dest)         -- streams; returns byte count
            table.insert(saved, { name = part.filename, bytes = bytes })
        else
            -- a plain form field
            nitr.log.info("field", { name = part.name, value = part:text() })
        end
    end)

    return nitr.json({ parts = count, files = saved })
end)
```

### The `part` object

| Field / method      | Description                                                                      |
| ------------------- | -------------------------------------------------------------------------------- |
| `part.name`         | Form field name, or `nil`.                                                       |
| `part.filename`     | Client-supplied file name, or `nil`. A `nil` filename means a plain field.       |
| `part.content_type` | Part content type, or `nil`.                                                     |
| `part:text()`       | A non-file field as a string, bounded by `[limits] max_field_bytes`.             |
| `part:save(path)`   | Streams the part to `path` without entering the Lua heap; returns bytes written. |
| `part:discard()`    | Drains and drops the part.                                                       |

> [!DANGER] Never trust `part.filename`
>
> It comes from the client and may contain `../`, absolute paths, or
> Windows-hostile characters. Always run it through
> [`nitr.path.basename`](../api/#nitr-path) — or better, ignore it and
> generate your own name:
>
> ```lua
> local name = nitr.base64.encode(nitr.crypto.random_bytes(16), { url = true })
> part:save(nitr.path.join("uploads", name))
> ```

### The limits that apply

| Limit             | Default | Applies to                                     |
| ----------------- | ------- | ---------------------------------------------- |
| `max_body_bytes`  | 1 MiB   | the whole request, uploads included            |
| `max_form_parts`  | 64      | number of parts                                |
| `max_field_bytes` | 64 KiB  | each non-file field (these become Lua strings) |
| `max_file_bytes`  | 10 MiB  | each uploaded file                             |

Raising `max_file_bytes` alone is not enough — `max_body_bytes` bounds
the entire request. Raise both.

> [!NOTE] Requires the `multipart` Cargo feature
>
> Present in the released `nitr` binary; opt-in for the library crate.

## Content negotiation

`req:accepts(...)` returns the best match for the client's `Accept`
header, or `nil`:

```lua
app:get("/data", function(req)
    local kind = req:accepts("application/json", "text/csv")
    if kind == "text/csv" then
        return { headers = { ["Content-Type"] = "text/csv" }, body = to_csv(rows) }
    end
    return nitr.json(rows)
end)
```

Or let `nitr.negotiate` do the branching and the `406` for you:

```lua
app:get("/data", function(req)
    return nitr.negotiate(req, {
        ["application/json"] = function(req) return nitr.json(rows) end,
        ["text/csv"]         = function(req) return csv_response(rows) end,
    })
end)
```

Nothing matching answers `406`.

## Conditional requests

`req:fresh(etag, last_modified?)` tells you whether the client's cached
copy is still current, per `If-None-Match` / `If-Modified-Since`:

```lua
app:get("/articles/:id", function(req)
    local article = nitr.db:query_row(
        "SELECT id, title, body, updated_at FROM articles WHERE id = ?",
        { req.params.id }
    )
    if not article then
        return nitr.error(404, { code = "NOT_FOUND" })
    end

    local etag = nitr.etag(tostring(article.updated_at))
    if req:fresh(etag) then
        return nitr.status(304)                 -- nothing else to send
    end

    local resp = nitr.json(article)
    resp.headers = resp.headers or {}
    resp.headers["ETag"] = etag
    return resp
end)
```

`nitr.etag(value, weak?)` builds a well-formed entity tag from whatever
identifies the resource — a row version, an `updated_at`, a content
hash.

> [!TIP] Static files do this for you
>
> Files served through `[static]` or `app:static` already carry `ETag`
> and `Last-Modified` and already answer `304`. `req:fresh` is for
> **dynamic** responses.

## Cookies

```lua
local raw    = req.cookies.session                         -- plain value
local verified = req.cookies:verify("session", secret)     -- nil if tampered
```

See [Cookies & sessions](./cookies-sessions).

## Quick reference

| Method                            | Returns                                                              |
| --------------------------------- | -------------------------------------------------------------------- |
| `req:json()`                      | Body decoded as JSON. Errors on empty or invalid input.              |
| `req:text()`                      | Whole body as a (binary-safe) string.                                |
| `req:form()`                      | Urlencoded body as a table. Cached.                                  |
| `req:read(n?)`                    | Next body chunk, or at least `n` bytes; `nil` at the end.            |
| `req:multipart(fn)`               | Calls `fn(part)` per part, in arrival order; returns the part count. |
| `req:accepts(...)`                | Best matching media type, or `nil`.                                  |
| `req:fresh(etag, last_modified?)` | Whether the client's cached copy is current.                         |

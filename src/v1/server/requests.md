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
| `req.params`      | table             | `{ id = "42" }`, captured by the router                |
| `req.query`       | table             | `{ page = "2" }`, parsed and percent-decoded           |
| `req.headers`     | table             | lowercase names: `req.headers["content-type"]`         |
| `req.cookies`     | object            | `req.cookies.session`, plus `:verify(...)`             |
| `req.id`          | string            | UUIDv7, sent back to the client as `X-Request-ID`      |
| `req.remote_addr` | string            | `"203.0.113.7:54321"`                                  |
| `req.uri`         | table             | `scheme`, `host`, `port`, `path`, `authority`, `query` |
| `req.valid`       | table or `nil`    | The validated input; see [below](#req-valid)           |

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

A few details worth knowing:

- **Header names are always lowercase.** `req.headers["Content-Type"]`
  is `nil`.
- **One value per name.** A repeated header or query key keeps its last
  value (`?tag=a&tag=b` gives `"b"`). For every value, split the raw
  string in `req.uri.query` yourself. Multiple `Cookie` headers are
  joined into `req.cookies`, and a request with two `Authorization`
  headers is refused with `400` before it reaches Lua.
- A header value that is not valid UTF-8 reads as `""`.
- **`req.remote_addr` is the direct peer.** Behind a proxy that is the
  proxy. Read `X-Forwarded-For` yourself if you trust it; the rate
  limiter has its own `[rate_limit] trust_forwarded_for` setting.

## Reading the body

Pick the method that matches the content type. All of them are limited
by `[limits] max_body_bytes`; a larger body gets `413`.

> [!WARNING] The body is read once
>
> `json`, `text`, `read` and `multipart` consume it, so a second read in
> the same request sees nothing. `form` is the exception: its result is
> cached.

### JSON

```lua
app:post("/users", function(req)
    local body = req:json()          -- raises on an empty or invalid body
    return nitr.json({ name = body.name }, 201)
end)
```

An invalid body raises an error, which [`on_error`](./errors) answers.
To answer it yourself:

```lua
local ok, body = pcall(req.json, req)
if not ok then
    return nitr.error(400, { code = "INVALID_JSON" })
end
```

Usually it is better to declare the shape on the route and let Nitr
check it before the handler runs:

```lua
local Signup = nitr.validate.schema({
    name  = "string|trim|min_len:1|required",
    email = "string|trim|case:lower|format:email|required",
})

app:post("/users", function(req)
    -- A bad body never gets here; it is answered with 422.
    return nitr.json(create_user(req.valid.body), 201)
end, { input = { body = Signup } })
```

See [Route input validation](./validation/route-input).

### `req.valid`

On a route that declares [`input`](./validation/route-input),
`req.valid` holds the checked values:

| Key                 | What it is                                    |
| ------------------- | --------------------------------------------- |
| `req.valid.body`    | The body, decoded and checked                 |
| `req.valid.query`   | The query string, converted to declared types |
| `req.valid.params`  | The path parameters, likewise                 |
| `req.valid.headers` | The declared headers, by lowercase name       |

Only the declared parts are present, and `req.valid` is `nil` on a
route without `input`. The raw values stay available: `req.params`,
`req.query`, `req:json()` and `req:form()` still return what the client
sent.

### Text

```lua
local raw = req:text()               -- the whole body as a string
```

Lua strings are byte strings, so this works for binary bodies too.

### Form data

For `application/x-www-form-urlencoded` bodies:

```lua
app:post("/login", function(req)
    local form = req:form()
    return authenticate(form.username, form.password)
end)
```

The result is cached, so middleware and handler can both call
`req:form()`.

### Streaming reads

For bodies you do not want to hold in memory at once:

```lua
app:post("/ingest", function(req)
    local total = 0
    while true do
        local chunk = req:read(64 * 1024)   -- at least 64 KiB, less at the end
        if not chunk then break end         -- nil marks the end
        total = total + #chunk
    end
    return nitr.json({ bytes = total })
end)
```

`req:read()` without an argument returns the next chunk as it arrives.

## File uploads

`req:multipart(fn)` calls `fn(part)` once per part of a
`multipart/form-data` body, in the order the client sent them, and
returns the number of parts. Files are streamed to disk by Nitr and
never become Lua strings, so a large upload does not use the Lua
state's memory.

```lua
app:post("/upload", function(req)
    local fields, files = {}, {}

    local count = req:multipart(function(part)
        if part.filename then
            local bytes = part:save(part.safe_filename)
            files[#files + 1] = {
                sent  = part.filename,       -- exactly what the client sent
                saved = part.safe_filename,  -- the name on disk
                bytes = bytes,
            }
        else
            fields[part.name] = part:text()
        end
    end)

    return nitr.json({ parts = count, fields = fields, files = files })
end)
```

A request without a `multipart/form-data` `Content-Type` and a
non-empty `boundary` raises before the first part.

> [!TIP] Validate uploads on the route instead
>
> A route `input` with a `file` rule checks the real file type, size and
> image dimensions before the handler runs, and gives you each upload in
> `req.valid.body`. See [Route input validation](./validation/route-input).
> On such a route the body is already consumed, so `req:multipart`
> raises.

### Where a saved file may land

`part:save(path)` writes only inside one configured directory:

```toml
[multipart]
upload_dir = "uploads"
```

- Without `upload_dir`, `part:save` raises. There is no default.
- `path` is relative to `upload_dir`. Absolute paths, paths that climb
  out with `..`, and symlinks leading outside are refused, not
  rewritten.
- Missing directories are not created. Create `uploads/avatars/`
  yourself before saving to `"avatars/..."`.
- `upload_dir` must exist and be writable at startup.

Nitr refuses to start if `upload_dir` is inside the handler script's
directory or `[templating] dir`, and warns if it is inside
`[static] dir`. See
[Uploads are the one thing Lua can write](./security#uploads-are-the-one-thing-lua-can-write)
and [`[multipart]`](./configuration/file#multipart).

### `part.filename` and `part.safe_filename`

`part.filename` is exactly what the client sent, which may be a path,
contain control characters, or be empty. Keep it for display, never use
it as a path.

`part.safe_filename` is that name reduced to a plain file name:

| Client sent           | `part.safe_filename` |
| --------------------- | -------------------- |
| `report.pdf`          | `report.pdf`         |
| `../../etc/passwd`    | `passwd`             |
| `C:\Windows\evil.exe` | `evil.exe`           |
| `.hidden`             | `hidden`             |
| `"name.txt. . "`      | `name.txt`           |
| `""`, `"..."`, `"/"`  | `upload`             |

Control characters and invisible Unicode (zero-width and bidirectional
marks) are removed, and names are cut to 255 bytes, keeping the
extension. The result never contains a separator, so
`part:save(part.safe_filename)` is safe on its own. `safe_filename` is
`nil` exactly when `filename` is.

> [!WARNING] A safe name is not a unique name
>
> Two uploads of `report.pdf` go to the same file, and the second
> overwrites the first. Prefix a user id, or generate the name:
>
> ```lua
> local name = nitr.base64.encode(nitr.crypto.random_bytes(16), { url = true })
> part:save(name)
> ```

### The `part` object

| Field / method       | Description                                                                |
| -------------------- | -------------------------------------------------------------------------- |
| `part.name`          | Form field name (`""` when the part has none).                             |
| `part.filename`      | Client's file name, raw. `nil` for a plain field.                          |
| `part.safe_filename` | `filename` reduced to a plain file name; `nil` when `filename` is.         |
| `part.content_type`  | Content type sent by the client, or `nil`. Do not trust it.                |
| `part:text()`        | The part as a string, up to `[limits] max_field_bytes`.                    |
| `part:save(path)`    | Streams the part to `path` inside `upload_dir`; returns the bytes written. |
| `part:discard()`     | Skips the part; returns the bytes skipped.                                 |

Each part can be read once: a second `text`, `save` or `discard` raises.
A part the callback ignores is skipped for you. A path that `save`
refuses leaves the part unread, so you can `pcall` and retry; a save
that fails partway removes the partial file. If the callback raises,
the error leaves `req:multipart` and the remaining parts are not
delivered.

### Upload limits

| Limit             | Default | Applies to                          | Raised by       |
| ----------------- | ------- | ----------------------------------- | --------------- |
| `max_body_bytes`  | 1 MiB   | the whole request, uploads included | answered `413`  |
| `max_form_parts`  | 64      | number of parts                     | `req:multipart` |
| `max_field_bytes` | 64 KiB  | each non-file field                 | `part:text()`   |
| `max_file_bytes`  | 10 MiB  | each uploaded file                  | `part:save()`   |

All four live in [`[limits]`](./configuration/file#limits). To accept
bigger files, raise both `max_file_bytes` and `max_body_bytes`.

The last three raise ordinary Lua errors, which reach
[`on_error`](./errors) as a `500` unless you catch them. To answer
`413` instead, `pcall` inside the callback and remember the result. The
callback's return value is ignored, so build the response after
`req:multipart` returns:

```lua
app:post("/upload", function(req)
    local rejected

    req:multipart(function(part)
        if not part.filename then return end
        local ok, err = pcall(part.save, part, part.safe_filename)
        if not ok then rejected = tostring(err) end
    end)

    if rejected then
        nitr.log.warn("upload rejected", { reason = rejected })
        return nitr.error(413, { code = "UPLOAD_TOO_LARGE" })
    end
    return nitr.status(204)
end)
```

To catch `max_form_parts` too, wrap the `req:multipart` call itself in
`pcall`.

`req:multipart` needs the `multipart` Cargo feature, which the released
`nitr` binary includes.

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

`nitr.negotiate` does the branching for you and answers `406` when
nothing matches:

```lua
app:get("/data", function(req)
    return nitr.negotiate(req, {
        ["application/json"] = function(req) return nitr.json(rows) end,
        ["text/csv"]         = function(req) return csv_response(rows) end,
    })
end)
```

## Conditional requests

`req:fresh(etag, last_modified?)` tells you whether the client's cached
copy is still current, based on `If-None-Match` and `If-Modified-Since`:

```lua
app:get("/articles/:id", function(req)
    local article = nitr.db:query_row(
        "SELECT id, title, body, updated_at FROM articles WHERE id = ?",
        { req.params.id }
    )
    if not article then
        return nitr.error(404, { code = "NOT_FOUND" })
    end

    local etag = nitr.etag(article.updated_at)
    if req:fresh(etag) then
        local res = nitr.status(304)
        res.headers.ETag = etag
        return res
    end

    local res = nitr.json(article)
    res.headers.ETag = etag
    return res
end)
```

`nitr.etag(value, weak?)` builds a valid entity tag from whatever
identifies the resource version, such as an `updated_at` or a content
hash. Static files already send `ETag` and `Last-Modified` and answer
`304` themselves; `req:fresh` is for dynamic responses.

## Cookies

```lua
local raw      = req.cookies.session                       -- plain value
local verified = req.cookies:verify("session", secret)     -- nil if tampered
```

See [Cookies & sessions](./cookies-sessions). For every request field
and method, see [`nitr.Request`](../api/types#nitr-request).

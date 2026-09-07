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

> [!NOTE] `req.headers` keeps one value per name
>
> A repeated header collapses to the last value, and a non-UTF-8 value
> reads as `""` — indistinguishable from absent, on purpose, so every
> header value has one type. The names where that would matter are
> handled elsewhere: two `Authorization` headers are refused with a
> `400` before the request reaches Lua (a collapsed credential can
> desync from a proxy in front), and every `Cookie` header is joined
> into `req.cookies`, because a joined cookie string is still a valid
> one.

> [!NOTE] `req.query` keeps the last value for a repeated key
>
> `?tag=a&tag=b` gives `req.query.tag == "b"`. A Lua table has one slot
> per key, so the collapse is unavoidable — and `nitr.url.query_parse`
> collapses the same way. If you need every value, split the raw string
> in `req.uri.query` yourself.

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

Better still, declare the shape on the route and let Nitr check it
**before** the handler runs:

```lua
local Signup = nitr.validate.schema({
    name  = "string|trim|min_len:1|required",
    email = "string|trim|case:lower|format:email|required",
})

app:post("/users", function(req)
    -- Checked, typed and stripped. A bad body never got here.
    return nitr.json(create_user(req.valid.body), 201)
end, { input = { body = Signup } })
```

See [Route input validation](./validation/route-input), and
[Validation](./validation/) for the schema vocabulary.

## `req.valid` — the checked view

On a route that declared [`input`](./validation/route-input), `req.valid`
holds the validated request:

| Key                 | What it is                                                |
| ------------------- | --------------------------------------------------------- |
| `req.valid.body`    | The body, decoded and checked                             |
| `req.valid.query`   | The query string, with text coerced to the declared types |
| `req.valid.params`  | The path parameters, likewise                             |
| `req.valid.headers` | The declared headers, by lowercase name                   |

Only the parts the route declared are present, and `req.valid` itself is
`nil` on a route without an `input` — so `if req.valid then` is a
meaningful test in shared middleware.

The raw request is untouched. `req.params`, `req.query`, `req:json()`
and `req:form()` all still read exactly what arrived, which is what you
want when you need both the normalized view and the original.

```lua
app:post("/notes", function(req)
    local clean = req.valid.body        -- trimmed, typed, stripped
    local raw   = req:json()            -- byte-for-byte what was sent
end, { input = { body = NoteInput } })
```

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

> [!WARNING] The body is read once
>
> `json`, `text`, `read` and `multipart` all consume it. Two of them in
> the same request means the second one sees nothing. `form` is the
> exception: its result is cached.

## File uploads

Multipart parts are parsed **in Rust** and streamed to disk. A file
never becomes a Lua string, so a 100 MB upload does not touch the
state's 8 MiB heap — and because a part is streamed as it arrives, Nitr
needs neither a spool directory nor a reaper for one.

That is also why parts reach you through a callback instead of a table:
collecting them first would mean buffering everything, which is the
thing being avoided. The cost is that you see parts in the order the
client sent them and cannot index them by name.

```lua
app:post("/upload", function(req)
    local fields, files = {}, {}

    local count = req:multipart(function(part)
        if part.filename then
            -- `safe_filename` is the client's name reduced to a plain
            -- file name; `part:save` resolves it inside
            -- `[multipart] upload_dir` either way.
            local bytes = part:save(part.safe_filename)
            files[#files + 1] = {
                sent  = part.filename,       -- exactly what the client sent
                saved = part.safe_filename,  -- what is on disk
                bytes = bytes,
            }
        else
            fields[part.name] = part:text()
        end
    end)

    return nitr.json({ parts = count, fields = fields, files = files })
end)
```

`req:multipart(fn)` returns the number of parts it saw. It requires a
`Content-Type` header naming a `multipart/form-data` body with a
non-empty `boundary` parameter; anything else raises before the first
part.

### Where a saved file may land

`part:save(path)` is the only filesystem **write** Lua can reach, and
both of its inputs come from outside: the path is a string your handler
built, and `part.filename` is a header the client chose. So Nitr does
not take the path at face value — it resolves it inside one configured
root:

```toml
[multipart]
upload_dir = "uploads"
```

| Rule                                             | What happens                                                  |
| ------------------------------------------------ | ------------------------------------------------------------- |
| `upload_dir` unset                               | `part:save` is **unavailable** and raises, naming the setting |
| Path is relative                                 | Resolved under `upload_dir` (`"a.png"`, `"img/a.png"`)        |
| Path is absolute (`/etc/cron.d/x`)               | **Refused**, not re-rooted                                    |
| Path climbs out (`../x`, `img/../../x`)          | **Refused**                                                   |
| Path names the root itself (`""`, `"."`)         | **Refused** — that is a directory, not a file                 |
| Intermediate directory does not exist            | **Refused** — no implicit `mkdir -p`                          |
| Final component is a symlink                     | **Refused** — following one would write through the root      |
| A parent resolves outside the root via a symlink | **Refused** — the parent is canonicalized, not just joined    |

There is deliberately **no default upload root**. The same call
`[templating] dir` makes: there is no safe directory to guess, and an
upload written somewhere nobody chose is worse than a startup error.
Refusing rather than re-rooting is the same idea one level down — where
a file lands always follows from what the source says, so a path that
reads as an escape never quietly becomes something else.

Missing directories are an error rather than a `create_dir_all` for the
same reason: deciding the on-disk shape of an upload tree is your
application's job, and materializing directories out of
attacker-influenced strings is not a favour. If you want
`uploads/avatars/`, create it yourself:

```lua
local dest = nitr.path.join("avatars", part.safe_filename)
local bytes = part:save(dest)        -- `uploads/avatars/` must already exist
```

`upload_dir` must exist **and be writable at startup** — Nitr write-probes
it, because existence is not writability and the alternative symptom is
a `500` on a request nobody can reproduce. See
[`[multipart]`](./configuration/file#multipart).

> [!DANGER] The upload root may not sit under the handler script
>
> `require`'s search path is pinned to the handler script's own
> directory, so an uploaded `.lua` file there would be a loadable
> module — upload-to-RCE written in configuration, and in dev mode the
> watcher might reload it without being asked. That combination
> **refuses to boot**, naming both paths.

> [!WARNING] The upload root inside `[static] dir` only warns
>
> It **warns** rather than refuses, because serving uploads back is a
> real deployment shape (user avatars). But it turns every uploaded byte
> into hosted content, which is a choice to make on purpose rather than
> by accident.

> [!NOTE] What containment does not cover
>
> Two residuals are documented rather than closed: a symlink swapped
> between the check and the open, and a pre-existing hardlink pointing
> at an inode outside the root. Both need an attacker who **already has
> write access inside the upload root** — a local process, not an HTTP
> client — so they are a hardening gap, not a way in.

### `part.filename` and `part.safe_filename`

`part.filename` is exactly what the client sent, untouched: a path, a
traversal, control characters, an empty string. It is kept raw on
purpose — applications legitimately record and display the name a user
chose.

`part.safe_filename` is that same name reduced to something that can
only ever name a plain file: no path separators, no control characters,
never empty.

| Client sent           | `part.safe_filename` | Why                                                       |
| --------------------- | -------------------- | --------------------------------------------------------- |
| `report.pdf`          | `report.pdf`         | ordinary names are left alone                             |
| `../../etc/passwd`    | `passwd`             | only the last segment is a name                           |
| `C:\Windows\evil.exe` | `evil.exe`           | both separators count — the sender's OS is not ours       |
| `/absolute/name.txt`  | `name.txt`           | same rule                                                 |
| `a\0b\7c.txt`         | `abc.txt`            | NUL and control bytes cannot reach a path (escapes shown) |
| `.hidden`             | `hidden`             | a leading dot hides the file                              |
| `"name.txt. . "`      | `name.txt`           | trailing dots and spaces collide on some filesystems      |
| `""`, `"..."`, `"/"`  | `upload`             | a fixed fallback, never an empty name                     |

It is also truncated to 255 bytes (`NAME_MAX`) on a character boundary,
never mid-glyph.

Because the result contains no separator **by construction**,
`part:save(part.safe_filename)` is safe on its own — the upload root is
a backstop rather than the only defence. And `safe_filename` is `nil`
exactly when `filename` is, so `if part.safe_filename then` is the same
"is this a file?" test.

> [!WARNING] A safe name is not a unique name
>
> Two clients uploading `report.pdf` produce the same destination, and
> the second write truncates the first. Uniqueness is application
> policy, not containment — decide it yourself: prefix a user id, keep
> the name in a database row, or generate the name outright.

When you do not want the client's name at all, generate one:

```lua
local name = nitr.base64.encode(nitr.crypto.random_bytes(16), { url = true })
local bytes = part:save(name)        -- URL-safe alphabet, so a safe file name
-- keep `part.filename` in your own records if you want to show it back
```

### The `part` object

| Field / method       | Description                                                                            |
| -------------------- | -------------------------------------------------------------------------------------- |
| `part.name`          | Form field name (an empty string when the part sends none).                            |
| `part.filename`      | Client-supplied file name, raw. `nil` means a plain field, not a file.                 |
| `part.safe_filename` | `filename` reduced to a plain file name; `nil` exactly when `filename` is.             |
| `part.content_type`  | Part content type, or `nil`. Client-supplied — do not trust it to identify the bytes.  |
| `part:text()`        | The part as a string, bounded by `[limits] max_field_bytes`. For ordinary fields.      |
| `part:save(path)`    | Streams the part to `path` inside `[multipart] upload_dir`; returns the bytes written. |
| `part:discard()`     | Drains and drops the part; returns the bytes skipped.                                  |

> [!TIP] A part is a stream, not a buffer
>
> `text`, `save` and `discard` each consume it; a second call raises,
> naming the field. Whatever the callback does — including nothing —
> Nitr drains the part afterwards so the parser can reach the next one.
>
> A callback that **raises** still gets its part drained, but the error
> then propagates out of `req:multipart` and no further part is
> delivered. `pcall` inside the callback if you want the rest of the body
> parsed.

> [!TIP] A refused path leaves the part intact
>
> `part:save` resolves the path **before** it takes the field, so a
> rejected path has consumed nothing and created nothing. You can
> `pcall` it, then retry with `part.safe_filename` or `part:discard()`.
> A save that fails part-way through is different: the partial file is
> removed, so a failed upload never leaves a truncated file for the
> application to trip over later.

### The limits that apply

| Limit             | Default | Applies to                                     |
| ----------------- | ------- | ---------------------------------------------- |
| `max_body_bytes`  | 1 MiB   | the whole request, uploads included            |
| `max_form_parts`  | 64      | number of parts                                |
| `max_field_bytes` | 64 KiB  | each non-file field (these become Lua strings) |
| `max_file_bytes`  | 10 MiB  | each uploaded file                             |

Raising `max_file_bytes` alone is not enough — `max_body_bytes` bounds
the entire request. Raise both.

The last three surface as **ordinary Lua errors**, not a status code:
Nitr cannot know whether an over-cap part is a client mistake or your
protocol. They are raised from three different places, which decides
where a `pcall` has to go:

| Limit             | Raised by                                    |
| ----------------- | -------------------------------------------- |
| `max_form_parts`  | `req:multipart` itself, outside the callback |
| `max_field_bytes` | `part:text()`                                |
| `max_file_bytes`  | `part:save()`                                |

So a `pcall` inside the callback catches the two per-part caps; catching
`max_form_parts` as well means wrapping the `req:multipart` call.
Uncaught, any of them reaches [`on_error`](./errors) as a `500`. Catch
them if you want a `413`:

```lua
app:post("/upload", function(req)
    local rejected

    req:multipart(function(part)
        if not part.filename then return end
        local ok, err = pcall(function()
            return part:save(part.safe_filename)
        end)
        if not ok then
            rejected = tostring(err)
        end
    end)

    if rejected then
        nitr.log.warn("upload rejected", { reason = rejected })
        return nitr.error(413, { code = "UPLOAD_TOO_LARGE" })
    end
    return nitr.status(204)
end)
```

> [!WARNING] `return` inside the callback returns from the callback
>
> The callback's return value is discarded — it cannot answer the
> request. Carry the decision out in a local, as above, and build the
> response after `req:multipart` has finished.

See [Defaults](./defaults).

> [!NOTE] Requires the `multipart` Cargo feature
>
> Present in the released `nitr` binary; opt-in for the library crate.
> The `[multipart]` config section itself parses in every build, so one
> configuration file stays readable whatever the binary was compiled
> with.

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

    local etag = nitr.etag(article.updated_at)
    if req:fresh(etag) then
        local res = nitr.status(304)            -- nothing else to send
        res.headers.ETag = etag
        return res
    end

    local res = nitr.json(article)
    res.headers.ETag = etag
    return res
end)
```

`nitr.etag(value, weak?)` builds a well-formed entity tag from whatever
identifies the resource — a row version, an `updated_at`, a content
hash. Rust compares the validators; Lua decides what identifies the
resource, because that part is application knowledge.

Helper responses (`nitr.json`, `nitr.text`, `nitr.status`, …) always
arrive with a `headers` table already attached, so `res.headers.ETag =`
needs no guard.

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

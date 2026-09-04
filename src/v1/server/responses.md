# Responses

A handler returns a **table**. Nitr turns it into an HTTP response.

```lua
return {
    status  = 200,
    headers = { ["Content-Type"] = "text/plain" },
    body    = "hello",
}
```

Every field is optional — `status` defaults to `200`, and a missing
body is an empty one. The helpers below just build this table for you,
so you can always inspect and adjust what they produced.

## The helpers

| Helper                             | Produces                                                             |
| ---------------------------------- | -------------------------------------------------------------------- |
| `nitr.json(value, status?)`        | JSON body with `Content-Type: application/json`                      |
| `nitr.text(s, status?)`            | `text/plain`                                                         |
| `nitr.html(s, status?)`            | `text/html`                                                          |
| `nitr.redirect(location, status?)` | A redirect (default `302`)                                           |
| `nitr.status(code)`                | An empty response with that status                                   |
| `nitr.error(code, body?)`          | An error response — a string body becomes text, a table becomes JSON |
| `nitr.sse(fn)`                     | A Server-Sent Events stream                                          |
| `nitr.negotiate(req, offers)`      | Picks by `Accept`; `406` when nothing matches                        |

```lua
app:get("/api/users",  function(req) return nitr.json(users())          end)
app:get("/robots.txt", function(req) return nitr.text("User-agent: *")  end)
app:get("/",           function(req) return nitr.html("<h1>Hi</h1>")    end)
app:get("/old",        function(req) return nitr.redirect("/new", 301)  end)
app:delete("/x/:id",   function(req) return nitr.status(204)            end)
```

## Status codes

```lua
nitr.json({ id = 1 }, 201)                        -- Created
nitr.json({ code = "NOT_FOUND" }, 404)            -- via the JSON helper
nitr.error(404, { code = "NOT_FOUND" })           -- or via the error helper
nitr.status(204)                                  -- No Content
```

`nitr.error` exists to make the intent obvious at a glance and to accept
either a string or a table body:

```lua
nitr.error(400, "bad request")                    -- text/plain
nitr.error(422, { code = "VALIDATION_FAILED", fields = errs })  -- JSON
```

## Headers

Set them on the returned table. A value may be a string, an integer, or
an **array of strings** for a multi-value header:

```lua
app:get("/download", function(req)
    return {
        status = 200,
        headers = {
            ["Content-Type"]        = "application/pdf",
            ["Content-Disposition"] = 'attachment; filename="report.pdf"',
            ["Cache-Control"]       = "no-store",
        },
        body = pdf_bytes,
    }
end)
```

Adding a header to a helper's result:

```lua
local resp = nitr.json(data)
resp.headers = resp.headers or {}
resp.headers["X-Total-Count"] = 42
resp.headers["Cache-Control"] = "public, max-age=60"
return resp
```

> [!TIP] `Set-Cookie` is the multi-value case
>
> Use the cookie builder rather than the header directly — it handles
> the multiplicity, the attributes and the signing:
>
> ```lua
> resp.cookies:set("theme", "dark", { path = "/", max_age = 31536000 })
> ```
>
> See [Cookies & sessions](./cookies-sessions).

## Bodies

The body is a **string** (binary-safe — Lua strings are byte strings),
or a **function** for a [streaming body](./streaming):

```lua
body = "plain text"
body = image_bytes                        -- binary is fine
body = function(writer) … end             -- streamed
body = coroutine.wrap(function() … end)   -- iterator form
```

## Content negotiation

Let the client's `Accept` header choose:

```lua
app:get("/report", function(req)
    return nitr.negotiate(req, {
        ["application/json"] = function(req) return nitr.json(rows) end,
        ["text/csv"]         = function(req)
            return {
                headers = { ["Content-Type"] = "text/csv" },
                body    = to_csv(rows),
            }
        end,
    })
end)
```

Values may also be plain responses rather than functions. Nothing
matching answers `406`.

## Caching and conditional responses

Pair `nitr.etag` with `req:fresh`:

```lua
app:get("/config.json", function(req)
    local version = current_version()
    local etag = nitr.etag(version)

    if req:fresh(etag) then
        return nitr.status(304)
    end

    local resp = nitr.json(load_config())
    resp.headers = resp.headers or {}
    resp.headers["ETag"] = etag
    resp.headers["Cache-Control"] = "public, max-age=300"
    return resp
end)
```

`nitr.etag(value, weak?)` builds a well-formed entity tag from whatever
identifies the resource — a row version, an `updated_at`, a hash. Pass
`weak = true` for a `W/"…"` validator when byte-for-byte equality is not
guaranteed.

## Compression, and what you do not do

Do **not** compress in Lua. Turn on `[compression]` and Nitr handles
negotiation, thresholds and encoding in Rust:

```toml
[compression]
enabled = true
algorithms = ["br", "gzip"]
min_size = 1024
```

Precompressed sidecars (`app.js.br` next to `app.js`) are served
whenever they exist, with or without that section.

Range requests (`206`, `416`, `If-Range`) are likewise handled for
static files without any code on your side.

## Redirects

```lua
nitr.redirect("/login")                   -- 302 Found (default)
nitr.redirect("/new-home", 301)           -- Moved Permanently
nitr.redirect("/after-post", 303)         -- See Other — POST → GET
nitr.redirect("/retry", 307)              -- Temporary, method preserved
```

> [!TIP] After a successful POST, use 303
>
> It tells the browser to follow with a `GET`, which is what makes the
> POST/redirect/GET pattern immune to a refresh re-submitting the form.

## Errors as responses

An error response you return deliberately is just a response — it does
**not** go through `on_error`:

```lua
if not user then
    return nitr.error(404, { code = "NOT_FOUND" })
end
```

`on_error` is for failures you did _not_ return: a raised error, a
timeout, a memory limit. See [Errors](./errors).

## A worked example

```lua
app:post("/api/articles", require_auth, function(req)
    local data, err = schema:check(req:json())
    if not data then
        return nitr.error(422, { code = "VALIDATION_FAILED", fields = err.fields })
    end

    local id = nitr.db:transaction(function(tx)
        tx:execute(
            "INSERT INTO articles (title, body, author, created_at) VALUES (?, ?, ?, ?)",
            { data.title, data.body, req.user, nitr.time.now() }
        )
        return tx:query_one("SELECT last_insert_rowid() AS id").id
    end)

    local resp = nitr.json({ id = id, title = data.title }, 201)
    resp.headers = resp.headers or {}
    resp.headers["Location"] = "/api/articles/" .. id
    return resp
end)
```

## Quick reference

| Field     | Type                                                | Default |
| --------- | --------------------------------------------------- | ------- |
| `status`  | number                                              | `200`   |
| `headers` | table — string, integer, or array-of-strings values | none    |
| `body`    | string, or a function for streaming                 | empty   |
| `cookies` | the `Set-Cookie` builder, attached by the helpers   | —       |

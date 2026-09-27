# Responses

A handler returns a **table**, and Nitr turns it into an HTTP response:

```lua
return {
    status  = 200,
    headers = { ["Content-Type"] = "text/plain" },
    body    = "hello",
}
```

| Field     | Type                                                 | Default |
| --------- | ---------------------------------------------------- | ------- |
| `status`  | integer                                              | `200`   |
| `headers` | table of string, integer, or array-of-strings values | none    |
| `body`    | string, or a function for [streaming](./streaming)   | empty   |
| `cookies` | the `Set-Cookie` builder, attached by the helpers    | none    |

The body is binary-safe: Lua strings are byte strings. A `204` or `304`
response with a body is an error.

## The helpers

The helpers build that table for you, with a `headers` table and a
cookie builder already attached, so you can change the result before
returning it.

| Helper                             | Produces                                                      |
| ---------------------------------- | ------------------------------------------------------------- |
| `nitr.json(value, status?)`        | JSON body, `Content-Type: application/json`                   |
| `nitr.text(s, status?)`            | `text/plain; charset=utf-8`                                   |
| `nitr.html(s, status?)`            | `text/html; charset=utf-8`                                    |
| `nitr.redirect(location, status?)` | A redirect (default `302`)                                    |
| `nitr.status(code)`                | An empty response with that status                            |
| `nitr.error(code, body?)`          | A string body is sent as text, a table body as JSON           |
| `nitr.sse(fn)`                     | A [Server-Sent Events](./streaming#server-sent-events) stream |
| `nitr.negotiate(req, offers)`      | Picks by the `Accept` header; `406` when nothing matches      |

```lua
app:get("/api/users",  function(req) return nitr.json(users())          end)
app:get("/robots.txt", function(req) return nitr.text("User-agent: *")  end)
app:get("/",           function(req) return nitr.html("<h1>Hi</h1>")    end)
app:get("/old",        function(req) return nitr.redirect("/new", 301)  end)
app:delete("/x/:id",   function(req) return nitr.status(204)            end)
```

A Lua table becomes a JSON array when its keys are `1..n`, and an object
otherwise. A table mixing list items and named keys (`{ "a", total = 1 }`)
raises, because JSON has no shape for it; see
[`nitr.json`](../api/#nitr-json).

Full signatures are in the [API reference](../api/#responses).

## Status codes

```lua
nitr.json({ id = 1 }, 201)                                      -- Created
nitr.error(404, { code = "NOT_FOUND" })                         -- JSON
nitr.error(400, "bad request")                                  -- text
nitr.status(204)                                                -- No Content
```

A response you return, error or not, is sent as is. `on_error` only
handles errors that are raised; see [Error handling](./errors).

## Headers

A header value may be a string, an integer, or an array of strings for a
header that repeats:

```lua
app:post("/api/articles", function(req)
    local id = create_article(req.valid.body)
    local resp = nitr.json({ id = id }, 201)
    resp.headers["Location"] = "/api/articles/" .. id
    resp.headers["Cache-Control"] = "no-store"
    return resp
end, { input = { body = ArticleInput } })
```

For cookies, use the builder instead of a `Set-Cookie` header:
`resp.cookies:set("theme", "dark", { path = "/" })`. See
[Cookies & sessions](./cookies-sessions).

## Redirects

```lua
nitr.redirect("/login")                   -- 302 Found (default)
nitr.redirect("/new-home", 301)           -- Moved Permanently
nitr.redirect("/after-post", 303)         -- See Other: follow with GET
nitr.redirect("/retry", 307)              -- Temporary, method kept
```

After a successful form `POST`, use `303`. The browser follows with a
`GET`, so a page refresh does not submit the form again.

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

When the client accepts several offers equally (`Accept: */*`), a map
picks the type that sorts first. To choose the order yourself, pass a
list: `{ { "application/json", fn_json }, { "text/csv", fn_csv } }`
prefers the earlier entry.

An offer can also be a response table instead of a function. Nothing
matching answers `406`.

## Caching and conditional responses

Pair `nitr.etag` with [`req:fresh`](./requests#conditional-requests):

```lua
app:get("/config.json", function(req)
    local etag = nitr.etag(current_version())
    if req:fresh(etag) then
        local resp = nitr.status(304)
        resp.headers["ETag"] = etag
        return resp
    end

    local resp = nitr.json(load_config())
    resp.headers["ETag"] = etag
    resp.headers["Cache-Control"] = "public, max-age=300"
    return resp
end)
```

`nitr.etag(value, weak?)` hashes whatever identifies the version (a row
version, an `updated_at`) into a valid entity tag. Pass `true` as
`weak` for a `W/"…"` tag.

## Compression

Do not compress in Lua. Turn on [`[compression]`](./configuration/file#compression)
and Nitr compresses responses for clients that accept it:

```toml
[compression]
enabled = true
algorithms = ["br", "gzip"]
min_size = 1024
```

Static files with a precompressed copy next to them (`app.js.br`,
`app.js.gz`) are served from that copy even without this section. Range
requests on static files are handled for you too.

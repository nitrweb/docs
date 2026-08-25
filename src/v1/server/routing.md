# Routing

Routing happens in **Rust**. `app.lua` registers the routes once, at
load time; matching, parameter extraction and method handling all happen
before a Lua state is even checked out.

## Registering routes

```lua
local app = nitr.app()

app:get("/users", list_users)
app:post("/users", create_user)
app:get("/users/:id", show_user)
app:put("/users/:id", replace_user)
app:patch("/users/:id", update_user)
app:delete("/users/:id", delete_user)

return app
```

One method per registration: `get`, `post`, `put`, `delete`, `patch`,
`head`, `options`.

A handler takes the request and returns a response:

```lua
app:get("/ping", function(req)
    return nitr.text("pong")
end)
```

## Path parameters

`:name` captures one path segment. Captures arrive in `req.params` as
strings:

```lua
app:get("/users/:id", function(req)
    return nitr.json({ id = req.params.id })      -- "/users/42" → "42"
end)

app:get("/orgs/:org/repos/:repo", function(req)
    return nitr.json({
        org  = req.params.org,
        repo = req.params.repo,
    })
end)
```

> [!TIP] Parameters are always strings
>
> `req.params.id` is `"42"`, not `42`. Convert with `tonumber(...)` when
> you need a number — and remember `tonumber("abc")` is `nil`, which is
> often exactly the 404 check you wanted:
>
> ```lua
> local id = tonumber(req.params.id)
> if not id then
>     return nitr.error(404, { code = "NOT_FOUND" })
> end
> ```

## Catch-all routes

A trailing `*` captures the rest of the path, however many segments:

```lua
app:get("/files/*", function(req)
    -- GET /files/docs/2026/report.pdf
    return nitr.text(req.path)
end)
```

Useful for proxies, custom file serving and SPA fallbacks. For plain
static files, prefer [`app:static`](./static-files) — it is served
entirely in Rust, with ETag, ranges and traversal protection.

## Query strings

Parsed and percent-decoded for you:

```lua
-- GET /search?q=rust+lua&page=2
app:get("/search", function(req)
    local q    = req.query.q       -- "rust lua"
    local page = tonumber(req.query.page) or 1
    return nitr.json({ q = q, page = page })
end)
```

Repeated keys keep the **last** value. If you need all of them, parse
the raw query yourself with
[`nitr.url.query_parse`](../api/#nitr-url).

## Methods you do not have to write

| Situation                                 | What Nitr answers              | Reaches Lua? |
| ----------------------------------------- | ------------------------------ | ------------ |
| No route and no static mount matched      | `404`                          | no           |
| Path exists, method does not              | `405` with `Allow`             | no           |
| `HEAD` with only a `GET` route registered | the `GET` route, body stripped | yes          |
| Bare `OPTIONS` on a known path            | `204` with `Allow`             | no           |
| A CORS preflight                          | the configured policy          | no           |

So you register `head` or `options` only when you want to _override_
that behaviour.

## Route middleware

Every argument before the last is middleware for that route only:

```lua
app:get("/admin/stats", require_admin, function(req)
    return nitr.json(collect_stats())
end)

app:post("/admin/users", require_admin, audit_log, function(req)
    return nitr.json(create_user(req:json()), 201)
end)
```

The chain runs left to right, outermost first, and only for that route.
See [Middleware](./middleware).

## A per-route error handler

An optional trailing table sets an error handler that wins over the
app-wide one for this route:

```lua
app:get("/report", generate_report, {
    on_error = function(err, req)
        nitr.log.error("report failed", { error = err.message })
        return nitr.error(503, { code = "REPORT_UNAVAILABLE" })
    end,
})
```

See [Errors](./errors).

## Organising routes across files

There is **no auto-discovery**, on purpose: the shape of the application
stays visible in one file, and a route module stays plain Lua.

```lua
-- routes/users.lua
return function(app)
    app:get("/api/users", list_users)
    app:post("/api/users", create_user)
end
```

```lua
-- app.lua
local app = nitr.app()

app:use(logging)

require("routes.users")(app)
require("routes.notes")(app)

return app
```

> [!NOTE] `require` is sandboxed
>
> It resolves only within the handler script's directory and cannot load
> native modules. `routes.users` means `routes/users.lua` next to
> `app.lua`.

## Static mounts

Registered from Lua, served from Rust:

```lua
app:static("/assets", "public/assets", {
    cache_control = "public, max-age=31536000, immutable",
})

app:static("/", "public", { spa = true })   -- SPA fallback to index.html
```

See [Static files](./static-files).

## Ordering rules

Two rules, both enforced:

1. **`app:use(...)` must come before any route.** Global middleware
   wraps the whole application, and the chain is composed once at load
   time — registering one after a route is an error, not a subtle
   ordering bug at runtime.
2. **Routes are matched by specificity, not registration order.** A
   literal segment beats a `:param`, which beats a `*` catch-all. So
   `/users/me` and `/users/:id` can coexist, in either order, and
   `/users/me` wins for that exact path.

## A complete example

```lua
local app = nitr.app()

-- 1. Global middleware, before any route.
app:use(function(next)
    return function(req)
        local started = nitr.time.monotonic()
        local resp = next(req)
        nitr.log.info("request", {
            path   = req.path,
            status = type(resp) == "table" and resp.status or 200,
            ms     = math.floor((nitr.time.monotonic() - started) * 1000),
        })
        return resp
    end
end)

-- 2. Static files, served in Rust.
app:static("/assets", "public/assets")

-- 3. Route modules.
require("routes.users")(app)

-- 4. Inline routes.
app:get("/health/deep", function(req)
    nitr.db:query_one("SELECT 1")
    return nitr.json({ ok = true })
end)

-- 5. A catch-all, last for readability (specificity decides anyway).
app:get("/*", function(req)
    return nitr.error(404, { code = "NOT_FOUND", path = req.path })
end)

-- 6. The app-wide error response.
app:on_error(function(err, req)
    nitr.log.error("handler failed", { error = err.message, kind = err.kind })
    return nitr.error(500, { code = "INTERNAL" })
end)

return app
```

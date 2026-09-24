# Routing

`app.lua` registers routes once, when it loads. Nitr matches each
request to a route before any Lua runs.

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

The methods are `get`, `post`, `put`, `delete`, `patch`, `head` and
`options`. A handler takes the request and returns a response:

```lua
app:get("/ping", function(req)
    return nitr.text("pong")
end)
```

## Path parameters

`:name` captures one path segment into `req.params`:

```lua
app:get("/orgs/:org/repos/:repo", function(req)
    return nitr.json({
        org  = req.params.org,       -- "/orgs/nitr/repos/docs" → "nitr"
        repo = req.params.repo,      -- → "docs"
    })
end)
```

Parameters are always strings. `tonumber` returns `nil` for anything
that is not a number, which makes a handy 404 check:

```lua
local id = tonumber(req.params.id)
if not id then
    return nitr.error(404, { code = "NOT_FOUND" })
end
```

To have parameters checked and converted for you, declare them in the
route's [`input`](./validation/route-input).

## Catch-all routes

A `*` as the last segment captures the rest of the path, however many
segments. A bare `*` stores it in `req.params.splat`; `*name` stores it
in `req.params.name`:

```lua
app:get("/files/*", function(req)
    -- GET /files/docs/2026/report.pdf
    return nitr.text(req.params.splat)       -- "docs/2026/report.pdf"
end)

app:get("/docs/*page", function(req)
    return nitr.text(req.params.page)
end)
```

For plain static files, use [`app:static`](./static-files) instead: it
handles caching headers, ranges and path safety for you.

## Query strings

`req.query` is parsed and percent-decoded:

```lua
-- GET /search?q=rust+lua&page=2
app:get("/search", function(req)
    local q    = req.query.q                  -- "rust lua"
    local page = tonumber(req.query.page) or 1
    return nitr.json({ q = q, page = page })
end)
```

A repeated key keeps its last value. To get every value, split the raw
string in `req.uri.query` yourself.

## Methods you do not have to write

| Situation                                 | What Nitr answers                                | Runs Lua? |
| ----------------------------------------- | ------------------------------------------------ | --------- |
| No route and no static file matched       | `404`                                            | no        |
| Path exists, method does not              | `405` with `Allow`                               | no        |
| `HEAD` with only a `GET` route registered | the `GET` route, body removed                    | yes       |
| `OPTIONS` on a known path                 | `204` with `Allow`                               | no        |
| A CORS preflight                          | the [`[cors]`](./configuration/file#cors) policy | no        |

Register `head` or `options` only to change that behaviour.

## Route middleware

Every argument between the path and the handler is middleware for that
route only, run left to right:

```lua
app:get("/admin/stats", require_admin, function(req)
    return nitr.json(collect_stats())
end)

app:post("/admin/users", require_admin, audit_log, function(req)
    return nitr.json(create_user(req:json()), 201)
end)
```

See [Middleware](./middleware).

## Route options

Every registration method takes an optional table after the handler.
It accepts four keys; any other key is an error at load time.

| Key          | What it does                                                                          |
| ------------ | ------------------------------------------------------------------------------------- |
| `input`      | What the route accepts. Checked before the handler runs; the result is in `req.valid` |
| `doc`        | How the route appears in the generated [OpenAPI document](./openapi/)                 |
| `on_invalid` | This route's answer to a request that failed its `input`. Overrides `app:on_invalid`  |
| `on_error`   | This route's error handler. Overrides `app:on_error`                                  |

```lua
app:post("/api/notes", function(req)
    return nitr.json(create_note(req.valid.body), 201)
end, {
    input = {
        body    = NoteInput,
        query   = { draft = "boolean|default:false" },
        headers = { ["x-team"] = "string|format:alpha_dash|required" },
    },
    doc = {
        summary   = "Create a note",
        tags      = { "notes" },
        responses = { [201] = { description = "Created", schema = Note } },
    },
    on_invalid = function(err, req)
        return nitr.error(422, { code = err.code, fields = err.fields })
    end,
    on_error = function(err, req)
        nitr.log.error("create failed", { error = err.message })
        return nitr.error(503, { code = "UNAVAILABLE" })
    end,
})
```

Request schemas go in `input` only; `doc` describes responses and
metadata. More detail:

- [Route input validation](./validation/route-input): `input`,
  `req.valid`, the `415` and `422` answers
- [Documenting routes](./openapi/documenting): `doc`, responses,
  security schemes
- [Error handling](./errors): `on_error` and `on_invalid`

> [!NOTE] Validation runs before all middleware
>
> A request that fails `input` is answered `422` before any middleware
> runs, app-wide (`app:use`) or per route. If authorization must be
> decided first, check it in the handler or in `on_invalid`.

## Organising routes across files

There is no auto-discovery. Keep a route module as a function that
takes the app, and call it from `app.lua`:

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

`require` only loads Lua files from the handler script's directory, so
`routes.users` means `routes/users.lua` next to `app.lua`.

## Static mounts

```lua
app:static("/assets", "public/assets", {
    cache_control = "public, max-age=31536000, immutable",
})

app:static("/", "public", { spa = true })   -- SPA fallback to index.html
```

See [Static files](./static-files).

## Ordering rules

1. **`app:use(...)` must come before any route.** Calling it after a
   route is an error at load time.
2. **Routes match by specificity, not registration order.** A literal
   segment beats a `:param`, which beats a `*` catch-all. So
   `/users/me` and `/users/:id` can be registered in either order, and
   `/users/me` wins for that path.

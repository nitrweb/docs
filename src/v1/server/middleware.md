# Middleware

A middleware is a **factory**: a function that receives the next
handler and returns the function that runs for each request.

```lua
function(next)              -- runs once, when app.lua loads
    return function(req)    -- runs for each request
        return next(req)
    end
end
```

## Global middleware

`app:use` adds middleware for every route:

```lua
local app = nitr.app()

app:use(function(next)
    return function(req)
        nitr.log.info("incoming", { path = req.path })
        return next(req)
    end
end)

app:get("/", handler)

return app
```

`app:use` must come before any route; calling it later is an error at
startup.

## Route middleware

Every argument between the path and the handler is middleware for that
route only:

```lua
app:get("/admin/stats", require_admin, function(req)
    return nitr.json(stats())
end)
```

## Group middleware

`g:use` adds middleware for the routes of one
[route group](./routing#route-groups) and its nested groups:

```lua
app:group("/api", function(g)
    g:use(require_auth)
    g:get("/items", list_items)
end)
```

Like `app:use`, it must come before the group's routes and nested
groups.

## Order of execution

Global middleware wraps group middleware, which wraps route middleware.
Then the route's [`input`](./validation/route-input) is checked, and
the handler runs:

```lua
app:use(A)
app:use(B)
app:group("/api", function(g)
    g:use(G)
    g:get("/x", C, handler, { input = { query = { page = "integer" } } })
end)
```

```text
request  →  A  →  B  →  G  →  C  →  input  →  handler
response ←  A  ←  B  ←  G  ←  C  ←  (422 or the handler's response)
```

Code before `next(req)` runs on the way in; code after it runs on the
way out.

> [!NOTE] Middleware runs before a route's `input` is checked
>
> An authentication middleware answers `401` before an unauthenticated
> client can get a `422` that reveals the schema. An invalid request
> never reaches the handler: the `422` (or your
> [`on_invalid`](./errors#on-invalid-when-the-input-was-wrong) answer)
> comes back up through the middleware like any response, and extra
> values a middleware passed to `next` still reach the handler.
> Validation has not run when a middleware is called, so `req.valid` is
> for the handler. Only a `415`, for a body media type the route does
> not accept, is answered before the chain.

## Common patterns

### Short-circuiting

Return a response without calling `next` to stop the request. This is
how authentication works:

```lua
local function require_auth(next)
    return function(req)
        local token = nitr.auth.bearer(req)
        if not token then
            return nitr.error(401, { code = "UNAUTHORIZED" })
        end

        local claims = nitr.crypto.jwt.verify(token, nitr.cfg.jwt_secret, {
            algorithms = { "HS256" },
        })
        if not claims then
            return nitr.error(401, { code = "INVALID_TOKEN" })
        end

        return next(req, claims)       -- pass data down the chain
    end
end

app:get("/me", require_auth, function(req, claims)
    return nitr.json({ user = claims.sub })
end)
```

### Passing data down the chain

`req` is read-only: `req.user = ...` raises an error. Pass values as
extra arguments to `next` instead, as above. The handler receives them
after `req`. A middleware in between must forward them:

```lua
local function audit(next)
    return function(req, ...)
        nitr.log.info("audit", { path = req.path })
        return next(req, ...)
    end
end
```

### Adding response headers

For the same headers on every response, use
[`[headers]`](./configuration/file#headers) in `nitr.toml`. It also
covers static files and the answers Nitr sends itself, which no
middleware sees. Use middleware when the value depends on the request:

```lua
app:use(function(next)
    return function(req)
        local resp = next(req)
        if req.headers.authorization then
            resp.headers = resp.headers or {}
            resp.headers["Cache-Control"] = "private, no-store"
        end
        return resp
    end
end)
```

A response built by hand may have no `headers` table, hence the
`or {}`.

### Timing

Nitr already writes one access-log line per request (see
[Logging](./logging)). Time a request yourself only when you want
extra fields:

```lua
app:use(function(next)
    return function(req)
        local started = nitr.time.monotonic()
        local resp = next(req)
        nitr.log.info("timed", {
            path = req.path,
            ms   = math.floor((nitr.time.monotonic() - started) * 1000),
        })
        return resp
    end
end)
```

### Only for some paths

`app:use` has no path filter. Use a [route group](./routing#route-groups)
or route middleware, or check the path inside:

```lua
app:use(function(next)
    return function(req)
        if req.path:sub(1, 5) == "/api/" then
            -- API-only work here
        end
        return next(req)
    end
end)
```

### Parameterised middleware

Wrap the factory in another function to configure it:

```lua
local function require_role(role)
    return function(next)
        return function(req, user)
            if not user or user.role ~= role then
                return nitr.error(403, { code = "FORBIDDEN" })
            end
            return next(req, user)
        end
    end
end

app:get("/admin", require_session, require_role("admin"), handler)
```

Here `require_session` is assumed to call `next(req, user)`.

### Built-in middleware

`nitr.csrf` returns a factory you can pass to `app:use`:

```lua
app:use(nitr.csrf({ secret = nitr.cfg.csrf_secret }))
```

It passes only `req` on to `next`, so register it before middleware
that passes extra values. See
[CSRF protection](./cookies-sessions#csrf-protection).

## Do expensive work once

The outer function runs once per Lua state, at load. Build schemas,
lookup tables and other setup there or at the top of the file, not per
request:

```lua
local schema = nitr.validate.schema({      -- built once
    email = "string|format:email|required",
})

local function check_email(next)
    return function(req)
        local data, err = schema:check(req:json())
        if not data then
            return nitr.error(422, { code = "VALIDATION_FAILED", fields = err.fields })
        end
        return next(req, data)
    end
end
```

For request bodies, a route [`input`](./validation/route-input) does
this for you.

## Errors in middleware

An error raised in middleware is handled like one in a handler: logged
and passed to [`on_error`](./errors#on-error-handlers). You do not need
`pcall` around `next(req)`; wrapping it usually just hides failures
from your error handler. A timeout cannot be caught with `pcall` at
all, so answer it in `on_error` (`err.kind == "timeout"`).

## What middleware cannot do

- **See requests Nitr answers itself.** Static files, `404`, `405`,
  CORS preflights, health checks and requests rejected by a limit never
  reach Lua. For headers on those answers, use
  [`[headers]`](./configuration/file#headers) (and `cache_control` on a
  static mount).
- **Share state between Lua states.** A counter in a local variable
  only counts what its own state handled. Use [`nitr.cache`](./cache)
  or [`nitr.db`](./database).

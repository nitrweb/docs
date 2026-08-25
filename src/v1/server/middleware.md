# Middleware

Middleware in Nitr is a **factory**: a function that receives the next
handler and returns the function that will actually run per request.

```lua
function(next)              -- ← runs ONCE, at load time
    return function(req)    -- ← runs per request
        return next(req)
    end
end
```

That shape is the whole idea. The chain is composed once, when `app.lua`
loads; a request just calls through it.

## Global middleware

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

> [!WARNING] `app:use` must come before any route
>
> Global middleware wraps the entire application and the chain is
> composed at load time. Calling `app:use` after a route is an error at
> startup, not a subtle ordering bug in production.

## Route middleware

Every argument before the last is middleware for that route only:

```lua
app:get("/admin/stats", require_admin, function(req)
    return nitr.json(stats())
end)
```

## Order of execution

Global middleware wraps route middleware, which wraps the handler:

```lua
app:use(A)
app:use(B)
app:get("/x", C, handler)
```

```
request  →  A  →  B  →  C  →  handler
response ←  A  ←  B  ←  C  ←  handler
```

Code before `next(req)` runs on the way in; code after it runs on the
way out, innermost first.

## The patterns worth knowing

### Timing and logging

```lua
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
```

> [!NOTE] Nitr already logs this
>
> The `request` span emits an access-log line per request on its own.
> Write your own only when you want extra fields. See
> [Logging](./logging).

### Short-circuiting

Not calling `next` ends the request there. This is how authentication
works:

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

        req.user = claims.sub          -- pass data down the chain
        return next(req)
    end
end

app:get("/me", require_auth, function(req)
    return nitr.json({ user = req.user })
end)
```

### Passing data down the chain

Assign a field on `req`. It is a plain Lua table, and it lives only for
this request in this state:

```lua
req.user      = claims.sub
req.tenant_id = tenant.id
```

Prefer a namespaced field (`req.ctx = { … }`) if you worry about
colliding with a future built-in field.

### Adding response headers

```lua
app:use(function(next)
    return function(req)
        local resp = next(req)
        if type(resp) == "table" then
            resp.headers = resp.headers or {}
            resp.headers["X-Frame-Options"] = "DENY"
            resp.headers["X-Content-Type-Options"] = "nosniff"
            resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        end
        return resp
    end
end)
```

### Conditional middleware

There is no path matcher in `app:use` — branch inside instead, or use
route middleware:

```lua
app:use(function(next)
    return function(req)
        if req.path:sub(1, 5) ~= "/api/" then
            return next(req)
        end
        -- API-only work here
        return next(req)
    end
end)
```

### Built-in middleware

Nitr ships two factories you can pass straight to `app:use`:

```lua
app:use(nitr.csrf({ secret = nitr.cfg.csrf_secret }))
```

See [Cookies & sessions](./cookies-sessions#csrf-protection).

## Where to put expensive work

The outer function runs **once**, at load. Everything you can hoist,
hoist:

```lua
-- ✅ compiled once per state
local schema = nitr.validate.schema({
    email = { type = "string", format = "email", required = true },
})

local function validate_body(next)
    return function(req)
        local data, err = schema:check(req:json())
        if not data then
            return nitr.error(422, { code = "VALIDATION_FAILED", fields = err.fields })
        end
        req.data = data
        return next(req)
    end
end
```

```lua
-- ❌ recompiled on every single request
local function validate_body(next)
    return function(req)
        local schema = nitr.validate.schema({ … })
        …
    end
end
```

The factory's own body is also a fine place for per-application setup —
it runs once too, and it can capture configuration:

```lua
local function require_role(role)          -- a parameterised middleware
    return function(next)
        return function(req)
            if req.user_role ~= role then
                return nitr.error(403, { code = "FORBIDDEN" })
            end
            return next(req)
        end
    end
end

app:get("/admin", require_role("admin"), handler)
```

## Errors in middleware

A middleware that raises is handled exactly like a failing handler: the
error is classified, logged, and offered to
[`on_error`](./errors#on-error-handlers). You do not need `pcall` around
`next(req)` — and wrapping it in one usually just hides the failure from
your own error handler.

Use `pcall` only when you genuinely intend to _recover_:

```lua
app:use(function(next)
    return function(req)
        local ok, resp = pcall(next, req)
        if ok then
            return resp
        end
        local err = nitr.errinfo(resp)     -- the structured error
        if err.kind == "timeout" then
            return nitr.error(504, { code = "TIMEOUT" })
        end
        error(resp)                        -- rethrow anything else
    end
end)
```

## What middleware cannot do

- **It cannot see requests answered in Rust.** Static files, `404`,
  `405`, CORS preflights, health probes and rejected-by-limit requests
  never enter Lua. If you need a header on a static file, use
  `[static] cache_control` or a reverse proxy.
- **It cannot be registered after a route** (globally).
- **It cannot share state with other Lua states.** A counter in an
  upvalue counts only what its own state did — use
  [`nitr.cache`](./cache) or [`nitr.db`](./database).

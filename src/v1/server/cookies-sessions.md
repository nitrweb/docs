# Cookies & Sessions

Three related things, from lowest level to highest: raw cookies, signed
cookies, and sessions. Plus CSRF, which is built on the same signing.

## Reading cookies

`req.cookies` is indexed by name:

```lua
app:get("/", function(req)
    local theme = req.cookies.theme or "light"
    return nitr.html(render(theme))
end)
```

## Setting cookies

The response carries a cookie builder:

```lua
app:post("/preferences", function(req)
    local resp = nitr.json({ ok = true })
    resp.cookies:set("theme", "dark", {
        path      = "/",
        max_age   = 31536000,        -- one year, in seconds
        http_only = true,
        secure    = true,
        same_site = "Lax",
    })
    return resp
end)
```

### Cookie options

| Option      | Type                            | Meaning                                                                    |
| ----------- | ------------------------------- | -------------------------------------------------------------------------- |
| `path`      | string                          | Path scope. Almost always `"/"`.                                           |
| `domain`    | string                          | Domain scope. Omit for host-only, which is the safer default.              |
| `max_age`   | integer                         | Lifetime in seconds. Omit for a session cookie that dies with the browser. |
| `http_only` | boolean                         | JavaScript cannot read it. **Set this** for anything security-relevant.    |
| `secure`    | boolean                         | HTTPS only. **Set this** in production.                                    |
| `same_site` | `"Strict"` / `"Lax"` / `"None"` | Cross-site sending policy.                                                 |

> [!TIP] Sensible defaults for an auth cookie
>
> ```lua
> { path = "/", http_only = true, secure = true, same_site = "Lax" }
> ```
>
> `Lax` still sends the cookie on a top-level navigation, so links from
> other sites keep the user logged in. Use `Strict` only when that is
> not wanted, and `None` (which requires `secure`) only for genuine
> cross-site flows.

### Deleting a cookie

Set it to an empty value with `max_age = 0`:

```lua
resp.cookies:set("theme", "", { path = "/", max_age = 0 })
```

## Signed cookies

A plain cookie is client-editable. A signed one carries an HMAC-SHA256
signature that Nitr verifies in constant time — the client can still
read the value, but cannot change it without detection.

```lua
-- write
local resp = nitr.json({ ok = true })
resp.cookies:set_signed("user_id", "42", nitr.cfg.cookie_secret, {
    path = "/", http_only = true, secure = true, same_site = "Lax",
})
return resp
```

```lua
-- read
local user_id = req.cookies:verify("user_id", nitr.cfg.cookie_secret)
if not user_id then
    return nitr.error(401, { code = "UNAUTHORIZED" })   -- missing or tampered
end
```

`:verify` returns `nil` for a missing cookie **and** for a tampered one
— you never have to distinguish those to be safe.

> [!NOTE] The cookie name is part of the signature
>
> A signed value cannot be moved from one cookie name to another, so an
> attacker cannot replay a `user_id` cookie as an `admin_id` one.

> [!DANGER] Signed is not encrypted
>
> The value is readable by the client. For a value that must stay
> secret, encrypt it with
> [`nitr.crypto.seal`](./crypto-auth#authenticated-encryption) and store
> the sealed token.

## Sessions

`nitr.session` gives a **stateless signed-cookie session**: the whole
session lives in the cookie, signed. No server-side store, no shared
state between processes.

```lua
app:post("/login", function(req)
    local form = req:form()
    local user = authenticate(form.username, form.password)
    if not user then
        return nitr.error(401, { code = "INVALID_CREDENTIALS" })
    end

    local session = nitr.session(req, { secret = nitr.cfg.session_secret })
    session.user_id = user.id
    session.role    = user.role

    local resp = nitr.redirect("/dashboard", 303)
    session:save(resp)                     -- ← writes the cookie
    return resp
end)
```

```lua
app:get("/dashboard", function(req)
    local session = nitr.session(req, { secret = nitr.cfg.session_secret })
    if not session.user_id then
        return nitr.redirect("/login")
    end
    return nitr.html(render_dashboard(session.user_id))
end)
```

```lua
app:post("/logout", function(req)
    local session = nitr.session(req, { secret = nitr.cfg.session_secret })
    session:clear()
    local resp = nitr.redirect("/", 303)
    session:save(resp)                     -- an empty session deletes the cookie
    return resp
end)
```

### Session options

| Option    | Default      | Meaning                                               |
| --------- | ------------ | ----------------------------------------------------- |
| `secret`  | **required** | The HMAC key.                                         |
| `name`    | —            | Cookie name.                                          |
| `max_age` | —            | Lifetime in seconds.                                  |
| `cookie`  | —            | Cookie attributes (`path`, `secure`, `same_site`, …). |

### What a stateless session means

|     |                                                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------- |
| ✅  | No store to run, no state to replicate. Any process can validate any session.                                          |
| ✅  | Survives restarts and scales horizontally for free.                                                                    |
| ⚠️  | **Keep it small.** Every request carries it. An id and a role, not a shopping cart.                                    |
| ⚠️  | The client can **read** it. Signed, not encrypted.                                                                     |
| ❌  | **Cannot be invalidated server-side** before the cookie expires. Rotating the secret invalidates _everything_ at once. |

That last row is a real limitation, documented rather than hidden — see
[Known weaknesses](./security#known-weaknesses). If you need
per-session revocation, store a session id in the cookie and the
session's validity in [`nitr.db`](./database).

> [!WARNING] `nitr.cache` is not a session store
>
> It is bounded, per-process and cleared on restart. Two Nitr processes
> have two independent caches. See [Cache](./cache).

## CSRF protection

`nitr.csrf` is middleware implementing the signed double-submit cookie
pattern: constant-time comparison, and only unsafe methods are checked.

```lua
local app = nitr.app()

app:use(nitr.csrf({ secret = nitr.cfg.csrf_secret }))

app:get("/form", function(req)
    return nitr.html(nitr.template:render("form.j2", {
        csrf_token = nitr.csrf.token(req),     -- put it in the form
    }))
end)

app:post("/form", function(req)
    -- only reached when the token checked out
    return nitr.redirect("/done", 303)
end)
```

::: v-pre

```html
<!-- templates/form.j2 -->
<form method="post" action="/form">
  <input type="hidden" name="_csrf" value="{{ csrf_token }}" />
  …
</form>
```

:::

For a JavaScript client, send the token in a header instead:

::: v-pre

```html
<meta name="csrf-token" content="{{ csrf_token }}" />
```

:::

```js
fetch('/api/thing', {
  method: 'POST',
  headers: {
    'X-CSRF-Token': document.querySelector('meta[name=csrf-token]').content
  }
})
```

### CSRF options

| Option        | Default        | Meaning                             |
| ------------- | -------------- | ----------------------------------- |
| `secret`      | **required**   | The HMAC key.                       |
| `cookie`      | —              | Cookie name carrying the token.     |
| `header`      | `X-CSRF-Token` | Header the token may arrive in.     |
| `field`       | `_csrf`        | Form field the token may arrive in. |
| `cookie_opts` | —              | Attributes for the CSRF cookie.     |

### What it checks

- Only **unsafe methods** (`POST`, `PUT`, `PATCH`, `DELETE`). `GET` and
  `HEAD` pass through untouched.
- The request must echo the cookie's token in the header **or** the form
  field.
- Comparison is constant-time.
- `nitr.csrf.token(req)` needs the middleware installed; without it,
  there is no token to hand out.

## Where secrets come from

Never in `nitr.toml` — that is the file you commit. Read them once, in
`config.lua`:

```lua
-- config.lua
return {
    session_secret = nitr.env.get("SESSION_SECRET"),
    csrf_secret    = nitr.env.get("CSRF_SECRET"),
    cookie_secret  = nitr.env.get("COOKIE_SECRET"),
}
```

```toml
[std]
features = ["json", "http", "log", "time", "env"]

[env]
file = ".env"
allow = ["SESSION_SECRET", "CSRF_SECRET", "COOKIE_SECRET"]
```

A missing secret then fails at **startup**, not on the first request
that needs it. See [Environment variables](./configuration/env).

Generate one with:

```sh
head -c 32 /dev/urandom | base64
```

# Cookies & Sessions

Three layers, from lowest to highest: raw cookies, signed cookies, and
sessions. CSRF protection is built on the same signing.

## Reading cookies

`req.cookies` is indexed by name:

```lua
app:get("/", function(req)
    local theme = req.cookies.theme or "light"
    return nitr.html(render(theme))
end)
```

## Setting cookies

Every helper-built response carries a cookie builder:

```lua
app:post("/preferences", function(req)
    local resp = nitr.json({ ok = true })
    resp.cookies:set("theme", "dark", {
        path      = "/",
        max_age   = 31536000,        -- one year, in seconds
        http_only = true,
        same_site = "Lax",
    })
    return resp
end)
```

Leave `secure` out: the [`[cookies] secure`](#secure-comes-from-configuration)
setting decides it for the whole deployment.

### Cookie options

| Option      | Type                            | Meaning                                                               |
| ----------- | ------------------------------- | --------------------------------------------------------------------- |
| `path`      | string                          | Path scope. Almost always `"/"`.                                      |
| `domain`    | string                          | Domain scope. Omit it for a host-only cookie (the safer choice).      |
| `max_age`   | integer                         | Lifetime in seconds. Omit it for a cookie that ends with the browser. |
| `http_only` | boolean                         | Hides the cookie from JavaScript. Set it for anything sensitive.      |
| `secure`    | boolean                         | HTTPS only. Omit it and configuration decides.                        |
| `same_site` | `"Strict"` / `"Lax"` / `"None"` | Cross-site policy. Any other value raises.                            |

Apart from `secure`, an option you leave out is left off the cookie: a
raw `resp.cookies:set` gets no implicit `HttpOnly` or `SameSite`. For an
auth cookie, `{ path = "/", http_only = true, same_site = "Lax" }` is a
good start. `Lax` still sends the cookie when a user follows a link from
another site; use `Strict` only if that is unwanted, and `None` only for
real cross-site flows.

> [!WARNING] The name and value must be legal cookie text
>
> `set` raises on a name that is not an RFC 6265 token, on a value with
> whitespace, control characters, `"`, `,`, `;` or `\`, and on a `path`
> or `domain` containing `;`. This stops request data such as
> `req.query.lang` from adding its own attributes. Encode free-form
> values first, with `nitr.base64.encode` or `:set_signed`.

### Deleting a cookie

Set it to an empty value with `max_age = 0`:

```lua
resp.cookies:set("theme", "", { path = "/", max_age = 0 })
```

## Cookie defaults

| Default                                  | Applies to                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| `Secure`, from `[cookies]`               | Every cookie Nitr builds: `set`, `set_signed`, session and CSRF cookies |
| `HttpOnly`, `SameSite=Lax`, `path = "/"` | Only the session and CSRF cookies                                       |

A `Set-Cookie` header you write yourself (`headers = { ["Set-Cookie"] = "a=1" }`)
is sent as written and gets neither.

### `Secure` comes from configuration

```toml
[cookies]
secure = "auto"     # "auto" | "always" | "never"
```

| Value      | Meaning                                                         |
| ---------- | --------------------------------------------------------------- |
| `"auto"`   | `Secure` when [`[tls] enabled = true`](./tls). The default.     |
| `"always"` | Always `Secure`. Use this when a proxy in front terminates TLS. |
| `"never"`  | Never `Secure`. For plain-HTTP development.                     |

Behind a TLS-terminating proxy, `[tls] enabled = false` is correct for
Nitr but the browser still uses HTTPS, so set `"always"`. Nitr cannot
detect the proxy, so with `"auto"` and TLS off, the **first cookie it
builds without `Secure`** (a session, a CSRF token, or `set` without an
explicit `secure`) logs one warning per process. A service that never
sets a cookie is never warned. `dev_mode = true` and an explicit
`"never"` stay silent. The only startup warning is `"never"` together
with `[tls] enabled = true`. `NITR_COOKIES_SECURE=always` sets the
policy per deployment.

An explicit `secure = true` or `secure = false` in a Lua options table
always wins over the setting, and never triggers the warning.
`nitr test` uses the same setting, so tests see what production does.

### HttpOnly and SameSite on the session and CSRF cookies

The session and CSRF cookies start from `path = "/"`, `SameSite=Lax` and
`HttpOnly`. Your attribute table is merged over these defaults:

```lua
-- Keeps HttpOnly and SameSite=Lax; only `path` changes.
nitr.csrf({
    secret = nitr.cfg.csrf_secret,
    cookie = { path = "/admin" },
})
```

`http_only` cannot be turned off: scripts get the CSRF token from
`nitr.csrf.token(req)`, and session data is read on the server.
`same_site` can be changed, for example to `"None"` for a real
cross-site form.

## Signed cookies

A plain cookie can be edited by the client. A signed one carries an
HMAC-SHA256 signature, so the client can read the value but cannot
change it without Nitr noticing.

```lua
-- write
local resp = nitr.json({ ok = true })
resp.cookies:set_signed("user_id", "42", nitr.cfg.cookie_secret, {
    path = "/", http_only = true, same_site = "Lax",
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

`:verify` returns `nil` for a missing, malformed or tampered cookie. The
cookie name is part of the signature, so a signed `user_id` value cannot
be replayed as an `admin_id` cookie.

> [!WARNING] Signed is not encrypted
>
> The client can read the value. To keep it secret, encrypt it with
> [`nitr.crypto.seal`](./crypto-auth#authenticated-encryption) and store
> the sealed token.

### Signing outside a cookie header

`nitr.cookie.sign` and `nitr.cookie.verify` use the same scheme
directly, for a signed value that travels somewhere else (a query
string, a hidden field) or a test that forges a signed cookie:

```lua
local token = nitr.cookie.sign("user_id", "42", nitr.cfg.cookie_secret)
nitr.cookie.verify("user_id", token, nitr.cfg.cookie_secret)   -- "42"
```

A value signed with `nitr.cookie.sign(name, ...)` is accepted by
`req.cookies:verify(name, ...)`, and the other way round.

## Sessions

`nitr.session` stores the whole session in a signed cookie. There is no
server-side store, and any process with the secret can read it.

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
    session:save(resp)                     -- writes the cookie
    return resp
end)

app:get("/dashboard", function(req)
    local session = nitr.session(req, { secret = nitr.cfg.session_secret })
    if not session.user_id then
        return nitr.redirect("/login")
    end
    return nitr.html(render_dashboard(session.user_id))
end)

app:post("/logout", function(req)
    local session = nitr.session(req, { secret = nitr.cfg.session_secret })
    session:clear()
    local resp = nitr.redirect("/", 303)
    session:save(resp)                     -- an empty session deletes the cookie
    return resp
end)
```

For the password check behind `authenticate`, see
[Passwords](./passwords).

### Session options

| Option    | Default      | Meaning                                                                  |
| --------- | ------------ | ------------------------------------------------------------------------ |
| `secret`  | **required** | The HMAC key. At least 16 bytes, or the call raises.                     |
| `name`    | `session`    | The cookie **name**.                                                     |
| `max_age` | none         | Lifetime in seconds, checked by the server too (see below).              |
| `cookie`  | none         | The cookie **attributes** (`path`, `secure`, `same_site`, …), merged in. |

With `max_age`, `save` also stores the expiry inside the signed value. A
cookie sent after that time loads as an empty session, so a stolen
cookie stops working even if the client ignores `Max-Age`. Set
`max_age` on any session that holds a login. The top-level `max_age`
wins over one inside `cookie`.

### What a session may hold

The session is serialized to JSON on `save`. `save` raises when:

- a value is not JSON-serializable (a function, for example);
- a string is not valid UTF-8 (encode raw bytes with `nitr.base64.encode`);
- the serialized session is over 2800 bytes (the error gives the size);
- tables are nested more than 128 levels deep;
- a field is named `save`, `clear` or `_exp` (reserved).

The 2800-byte limit keeps the signed cookie under the roughly 4 KiB that
browsers accept. For more data, keep an id in the session and the data
in [`nitr.db`](./database). A cookie that verifies but does not decode
as a JSON object loads as an empty session.

### What a stateless session means

- No store to run: sessions survive restarts and work across processes.
- Every request carries the session, so keep it small: an id and a role,
  not a shopping cart.
- The client can read it. It is signed, not encrypted.
- It cannot be revoked early on the server. `max_age` limits how long a
  stolen cookie works; rotating the secret logs everyone out. For
  per-session revocation, store a session id in the cookie and its
  status in [`nitr.db`](./database). See
  [Known weaknesses](./security#known-weaknesses).

[`nitr.cache`](./cache) is not a session store: it is per-process and
cleared on restart.

## CSRF protection

`nitr.csrf` is middleware using the signed double-submit cookie pattern.
It issues a signed token cookie, and every unsafe request must send the
token back.

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

For a JavaScript client, send the token in a header:

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

| Option   | Default        | Meaning                                                 |
| -------- | -------------- | ------------------------------------------------------- |
| `secret` | **required**   | The HMAC key. At least 16 bytes, or the factory raises. |
| `name`   | `_csrf`        | The cookie **name**.                                    |
| `header` | `x-csrf-token` | Header the token may arrive in (matched in any case).   |
| `field`  | `_csrf`        | Form field the token may arrive in.                     |
| `cookie` | none           | The cookie **attributes**, merged over the defaults.    |

`nitr.csrf` and `nitr.session` spell their options the same way: `name`
is the cookie's name and `cookie` its attribute table.

```lua
nitr.csrf({ secret = s, name = "_token", cookie = { path = "/admin" } })
nitr.session(req, { secret = s, name = "my_session", cookie = { path = "/" } })
```

The older CSRF spellings are refused when the factory runs, with an
error naming the new one: `cookie_opts` (now `cookie`), and a string
`cookie` (the name is now `name`).

### What it checks

- `GET`, `HEAD`, `OPTIONS` and `TRACE` pass through. Every other method
  is checked.
- The token must match the cookie, sent in the header or in the form
  field of an `application/x-www-form-urlencoded` body. The comparison
  is constant-time.
- The middleware reads the form with `req:form()`, which is cached, so
  your handler can still read it.
- On failure the answer is `403` with the body
  `Forbidden: missing or invalid CSRF token`. When the request's
  `Accept` header names `application/json`, the body is
  `{"code":"CSRF_INVALID","message":"missing or invalid CSRF token"}`
  instead, like Nitr's [built-in rejections](./errors#built-in-rejections).
- `nitr.csrf.token(req)` raises if the middleware did not run for this
  request.

> [!WARNING] Multipart forms must send the token in the header
>
> Only urlencoded bodies are searched for the field. A hidden `_csrf`
> input in a file-upload form is not found, and the request gets a `403`.

A client without the cookie fails its first unsafe request, because the
token is new. The cookie is set on every response, the `403` included,
so a retry succeeds.

### Cross-site requests are refused before the token

The token alone cannot prove the cookie came from your site: a sibling
subdomain, or plain HTTP, can plant one. So an unsafe request that the
browser marks `Sec-Fetch-Site: cross-site` is refused without checking
the token. Setting `cookie = { same_site = "None" }` turns this off,
for forms that are meant to be posted from other sites:

```lua
app:use(nitr.csrf({
    secret = nitr.cfg.csrf_secret,
    cookie = { same_site = "None" },   -- the token alone is the check
}))
```

Older browsers that do not send `Sec-Fetch-Site` are checked by token
only.

## Where secrets come from

Keep secrets out of `nitr.toml`, the file you commit. Read them once in
`config.lua` with [`nitr.env.secret`](./configuration/env#secrets),
which stops startup when one is unset, empty or shorter than 32 bytes,
instead of failing on the first login:

```lua
-- config.lua
return {
    session_secret = nitr.env.secret("SESSION_SECRET"),
    csrf_secret    = nitr.env.secret("CSRF_SECRET"),
    cookie_secret  = nitr.env.secret("COOKIE_SECRET"),
}
```

```toml
config_script = "config.lua"

[std]
features = ["json", "http", "log", "time", "env"]

[env]
file = ".env"
allow = ["SESSION_SECRET", "CSRF_SECRET", "COOKIE_SECRET"]
```

See [Environment variables](./configuration/env) for the `allow` list.
Generate a secret with:

```sh
head -c 32 /dev/urandom | base64
```

`nitr.session` and `nitr.csrf` refuse a secret shorter than 16 bytes.
`set_signed` and `nitr.cookie.sign` accept any length, so use 32 random
bytes there too.

# Cookies & Sessions

Three related things, from lowest level to highest: raw cookies, signed
cookies, and sessions. Plus CSRF, which is built on the same signing.

All four leave the process through one serializer, which is why the
`Secure` attribute lives in configuration instead of being copied into
every handler — see [Cookie defaults](#cookie-defaults).

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
        same_site = "Lax",
    })
    return resp
end)
```

There is deliberately no `secure` in that table. Omitted, it is decided
by the [`[cookies] secure`](#cookie-defaults) policy, so the handler
does not carry a hard-coded copy of how the deployment terminates TLS.

### Cookie options

| Option      | Type                            | Meaning                                                                                  |
| ----------- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| `path`      | string                          | Path scope. Almost always `"/"`.                                                         |
| `domain`    | string                          | Domain scope. Omit for host-only, which is the safer default.                            |
| `max_age`   | integer                         | Lifetime in seconds. Omit for a session cookie that dies with the browser.               |
| `http_only` | boolean                         | JavaScript cannot read it. **Set this** for anything security-relevant.                  |
| `secure`    | boolean                         | HTTPS only. Omit it and configuration decides; see below.                                |
| `same_site` | `"Strict"` / `"Lax"` / `"None"` | Cross-site sending policy. An unrecognized value raises rather than silently defaulting. |

Anything you leave out is left off the cookie — with the single
exception of `secure`. On a raw `res.cookies:set` there is no implicit
`HttpOnly` and no implicit `SameSite`; those defaults exist only for the
session and CSRF cookies, which Nitr owns end to end.

> [!DANGER] The name and value must be legal cookie text, or `set` raises
>
> `Set-Cookie` is a `;`-separated list of attributes, so a value taken
> from a request would otherwise be able to append its own:
>
> ```lua
> -- ?lang=en;%20Domain=.example.com;%20SameSite=None
> resp.cookies:set("lang", req.query.lang)   -- ❌ raises, and always did
>                                            --    have to be encoded
> ```
>
> RFC 6265's grammar is enforced instead of hoped for. The **name** must
> be a token: printable ASCII without whitespace or
> `()<>@,;:\"/[]?={}`. The **value** may not contain control
> characters, whitespace, `"`, `,`, `;` or `\`. `path` and `domain` may
> not contain `;` either. Anything else raises rather than producing a
> header with attributes you did not write.
>
> Encode anything unconstrained before it goes in —
> `nitr.base64.encode(value)`, or `:set_signed`, whose payload is
> already base64.

> [!TIP] Sensible defaults for an auth cookie
>
> ```lua
> { path = "/", http_only = true, same_site = "Lax" }
> ```
>
> `Lax` still sends the cookie on a top-level navigation, so links from
> other sites keep the user logged in. Use `Strict` only when that is
> not wanted, and `None` (which browsers only honor together with
> `Secure`) only for genuine cross-site flows.

### Deleting a cookie

Set it to an empty value with `max_age = 0`:

```lua
resp.cookies:set("theme", "", { path = "/", max_age = 0 })
```

## Cookie defaults

Two different sets of defaults are at work, with two different scopes.
Getting them straight saves a long afternoon.

| Default                                  | Applies to                                                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `Secure`, from `[cookies]`               | **Every** cookie Nitr builds: `res.cookies:set` / `:set_signed`, the session cookie, the CSRF cookie |
| `HttpOnly`, `SameSite=Lax`, `path = "/"` | **Only** the session and CSRF cookies                                                                |

Both reach only the cookies Nitr _builds_. A handler that writes the
header itself — `headers = { ["Set-Cookie"] = "a=1" }` — is converted
straight through and never passes the serializer, so that cookie's
attributes are entirely the script's own business.

### `Secure` comes from configuration

```toml
[cookies]
secure = "auto"     # "auto" | "always" | "never"
```

| Value      | Meaning                                                      |
| ---------- | ------------------------------------------------------------ |
| `"auto"`   | `Secure` when [`[tls] enabled = true`](./tls). The default.  |
| `"always"` | Always `Secure`: TLS is terminated in front of this process. |
| `"never"`  | Never `Secure`: plain-HTTP development.                      |

It is a tri-state rather than a boolean because a boolean cannot express
the most common Nitr deployment: a loopback bind behind a proxy that
terminates TLS, where `[tls] enabled = false` is the correct setting for
_this_ process **and** the cookies must still be `Secure`. Nothing
inside the process can detect that proxy.

An explicit `secure` in a Lua options table always wins, in **both**
directions. `secure = true` marks a cookie on a plaintext listener;
`secure = false` un-marks one on a TLS server. The escape hatch would
not be an escape hatch if it only worked one way.

> [!WARNING] A configuration that resolves to "not secure" warns at startup
>
> Nitr cannot see the proxy, so instead of guessing it says what it is
> about to do:
>
> | `[cookies] secure` | `[tls] enabled` | Cookies get `Secure` | Warns at startup |
> | ------------------ | --------------- | -------------------- | ---------------- |
> | `"auto"`           | `true`          | yes                  | no               |
> | `"auto"`           | `false`         | no                   | **yes**          |
> | `"always"`         | `true`          | yes                  | no               |
> | `"always"`         | `false`         | yes                  | no               |
> | `"never"`          | `true`          | no                   | **yes**          |
> | `"never"`          | `false`         | no                   | no               |
>
> `"never"` on a plaintext listener is silent: you answered the
> question and the answer matches the transport. `"never"` _with_ TLS
> enabled is the contradiction worth naming — a server that terminates
> TLS and then opts its cookies out of it.

The warning is **not** suppressed by a loopback `listen` address. That
is precisely the terminating-proxy deployment, the one case that most
needs telling. `dev_mode = true` does suppress it, because it is an
explicit "I am developing" switch rather than a deployment shape.

> [!NOTE] Why `Secure` is not forced the way `HttpOnly` is
>
> A `Secure` cookie sent over plain `http` is dropped by the browser
> without a word. Forcing it would break local development with a
> failure mode far worse than a line in the startup log: no cookie, no
> error, no clue. `HttpOnly` has no such downside, so it _is_ forced.

`nitr test` resolves the same policy from the same configuration, so a
test asserting on `Secure` sees what production will do.

### HttpOnly and SameSite on the session and CSRF cookies

The session and CSRF cookies start from `path = "/"`, `SameSite=Lax`
and `HttpOnly`, and your attribute table is merged **over** those
defaults rather than replacing them:

```lua
-- Keeps HttpOnly and SameSite=Lax; only `path` changes.
nitr.csrf({
    secret      = nitr.cfg.csrf_secret,
    cookie_opts = { path = "/admin" },
})
```

`http_only` cannot be un-set. No script has business reading either
cookie: `nitr.csrf.token(req)` is the supported route to the token, and
a session is server state. `same_site` deliberately stays overridable —
a legitimate cross-site form needs `"None"`, and forcing it would repeat
the same mistake in the other direction.

> [!WARNING] This changed in beta.3
>
> `nitr.csrf`'s `cookie_opts` used to **replace** the defaults, so
> `cookie_opts = { path = "/admin" }` issued the token cookie with no
> `HttpOnly` and no `SameSite` — silently, on the more
> security-sensitive of the two modules, while sessions merged
> correctly for the same job. Both now go through one merge, so they
> cannot drift apart again.

## Signed cookies

A plain cookie is client-editable. A signed one carries an HMAC-SHA256
signature that Nitr verifies in constant time — the client can still
read the value, but cannot change it without detection.

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

`:verify` returns `nil` for a missing cookie, a malformed one **and** a
tampered one — you never have to distinguish those to be safe.

> [!NOTE] The cookie name is part of the signature
>
> The name is mixed into the MAC, so a signed value cannot be moved from
> one cookie name to another: an attacker cannot replay a `user_id`
> cookie as an `admin_id` one.

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

This is where a login usually ends — see
[Passwords](./passwords) for the verification half of the flow, and
note that `nitr.crypto.password_verify` is asynchronous, so it belongs
in the handler and never at the top level of a script.

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

| Option    | Default      | Meaning                                                                                 |
| --------- | ------------ | --------------------------------------------------------------------------------------- |
| `secret`  | **required** | The HMAC key. At least 16 bytes, or the call raises.                                    |
| `name`    | `session`    | The cookie **name** (a string).                                                         |
| `max_age` | —            | Lifetime in seconds.                                                                    |
| `cookie`  | —            | The cookie **attributes** (`path`, `secure`, `same_site`, …), merged over the defaults. |

`max_age` is applied _after_ the attribute table, so a top-level
`max_age` wins over one written inside `cookie`. The deletion cookie's
`max_age = 0` is applied the same way, on purpose: a caller's `max_age`
must not be able to keep a cleared session alive.

> [!NOTE] `max_age` is enforced on the server, not only by the browser
>
> With a `max_age`, `save` writes the expiry **inside** the signed
> payload as well. A cookie presented after it has passed starts an
> **empty** session — exactly as if it had not been sent — so a captured
> cookie stops working when the session it carries ages out.
> `Max-Age` on its own is advice to a browser, and a client replaying a
> stolen cookie takes none. This is the closest thing a stateless
> session has to expiry, and it is a reason to set `max_age`.

> [!WARNING] `cookie` means something different here than in `nitr.csrf`
>
> On a session it is the attribute **table**; on `nitr.csrf` the same
> key is the cookie **name**. See
> [The option naming trap](#the-option-naming-trap).

### What a session may hold

Fields are plain Lua assignments, and the table is serialized to JSON
on `save`. That imposes four rules, each of which reports itself rather
than producing a cookie the browser will quietly drop:

| Rule                                          | What happens otherwise                                          |
| --------------------------------------------- | --------------------------------------------------------------- |
| Values must be JSON-serializable              | `save` raises; a function is the usual culprit                  |
| Strings must be UTF-8 text                    | `save` raises; encode raw bytes with `nitr.base64.encode` first |
| Serialized session ≤ 2800 bytes               | `save` raises and names the actual size                         |
| `save`, `clear` and `_exp` are reserved names | `save` raises: the first two are the methods, `_exp` the expiry |
| Tables nested at most 128 levels deep         | `save` raises before the size is even measured                  |

The UTF-8 rule catches a real trap: a field set to
`nitr.crypto.random_bytes(16)` used to come back on the next request as
a table of sixteen integers, with nothing reported at save time.

The 2800-byte ceiling is chosen so the signed, base64-encoded cookie
stays under the ~4 KiB browsers enforce per cookie. If you are near it,
put a key in the session and the data in [`nitr.db`](./database).

A cookie whose signature verifies but whose payload does not decode as
a JSON object — an older secret sharing the name, or tooling — starts an
**empty** session instead of failing the request.

### What a stateless session means

|     |                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------- |
| ✅  | No store to run, no state to replicate. Any process can validate any session.                                         |
| ✅  | Survives restarts and scales horizontally for free.                                                                   |
| ⚠️  | **Keep it small.** Every request carries it. An id and a role, not a shopping cart.                                   |
| ⚠️  | The client can **read** it. Signed, not encrypted.                                                                    |
| ⚠️  | A `max_age` **does** expire it server-side (the expiry rides in the signed payload), but nothing can revoke it early. |
| ❌  | **Cannot be invalidated server-side** before that expiry. Rotating the secret invalidates _everything_ at once.       |

That last row is a real limitation, documented rather than hidden — see
[Known weaknesses](./security#known-weaknesses). Setting `max_age`
bounds how long a stolen cookie is worth stealing; if you need
per-session revocation on demand, store a session id in the cookie and
the session's validity in [`nitr.db`](./database).

> [!WARNING] `nitr.cache` is not a session store
>
> It is bounded, per-process and cleared on restart. Two Nitr processes
> have two independent caches. See [Cache](./cache).

## CSRF protection

`nitr.csrf` is middleware implementing the signed double-submit cookie
pattern: the token lives in a signed cookie the middleware issues, and
every unsafe-method request must echo it back. Verification is
Rust-side and constant-time.

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

| Option        | Default        | Meaning                                                                                                          |
| ------------- | -------------- | ---------------------------------------------------------------------------------------------------------------- |
| `secret`      | **required**   | The HMAC key. At least 16 bytes, or the factory raises.                                                          |
| `cookie`      | `_csrf`        | The cookie **name** (a string, _not_ a table).                                                                   |
| `header`      | `x-csrf-token` | Header the token may arrive in. Request header names are lowercased, so a client sending `X-CSRF-Token` matches. |
| `field`       | `_csrf`        | Form field the token may arrive in.                                                                              |
| `cookie_opts` | —              | The cookie **attributes**, merged over the defaults.                                                             |

### The option naming trap

`nitr.csrf` and `nitr.session` spell the same two ideas differently.
This is the single most likely mistake on this page:

|                       | `nitr.csrf(opts)`          | `nitr.session(req, opts)`  |
| --------------------- | -------------------------- | -------------------------- |
| Cookie **name**       | `cookie` (default `_csrf`) | `name` (default `session`) |
| Cookie **attributes** | `cookie_opts`              | `cookie`                   |

So a caller moving between the two naturally writes:

```lua
-- WRONG: `cookie` is the name here, and a table is not a name.
nitr.csrf({ secret = s, cookie = { path = "/admin" } })

-- Right:
nitr.csrf({ secret = s, cookie_opts = { path = "/admin" } })
```

```lua
-- WRONG: `cookie` is the attribute table here, and a string is not one.
nitr.session(req, { secret = s, cookie = "my_session" })

-- Right:
nitr.session(req, { secret = s, name = "my_session" })
```

> [!TIP] Both mistakes fail loudly
>
> Each one passes a table where a string belongs, or the reverse, so
> you get a Lua conversion error rather than options that are silently
> ignored. The error names neither option, though — which is why the
> mapping is spelled out above.

### What it checks

- Only **unsafe methods** are verified. `GET`, `HEAD`, `OPTIONS` and
  `TRACE` pass through untouched, per RFC 9110's definition of safe;
  everything else — `POST`, `PUT`, `PATCH`, `DELETE` — is checked.
- An unsafe request the browser marked `Sec-Fetch-Site: cross-site` is
  **refused before the token is looked at** — see below.
- The request must echo the cookie's token in the header, **or** in the
  form field of an `application/x-www-form-urlencoded` body.
- Comparison is constant-time.
- The middleware reads the body through `req:form()`, whose parse is
  cached on the request, so your handler can still read the form
  afterwards.
- On failure the response is `403` with the body
  `Forbidden: missing or invalid CSRF token`.
- `nitr.csrf.token(req)` **raises** when the middleware did not run for
  this request, and it is keyed by request id — a token minted for an
  earlier request in the same pooled Lua state can never leak into one
  whose chain skipped the middleware.

> [!WARNING] Multipart bodies are not searched for the token
>
> Only `application/x-www-form-urlencoded` bodies are scanned for the
> field. A `multipart/form-data` upload must send the token in the
> **header** — a hidden `_csrf` input in a file-upload form will not be
> found, and the request gets a `403`.

> [!NOTE] The first unsafe request without a cookie always fails
>
> A freshly issued token cannot match: the client has not seen it yet.
> The cookie is issued on whatever goes out — including the `403` — so
> a client that lost its cookie succeeds on retry.

### Cross-site requests are refused before the token

A double-submit token proves the sender could read _a_ cookie — not that
the cookie was yours. A sibling subdomain, or plain HTTP where the
cookie is not `Secure`, can plant one it obtained itself. Browsers state
the answer to that question directly: a request a third-party site
initiated carries `Sec-Fetch-Site: cross-site`.

So an unsafe request with that header is rejected outright, before the
token comparison. The single exception is `cookie_opts.same_site =
"None"` — the setting whose whole meaning is "accept cross-site posts" —
which turns the check off, because refusing would contradict it:

```lua
-- Refuses browser-flagged cross-site requests (the default).
app:use(nitr.csrf({ secret = nitr.cfg.csrf_secret }))

-- A genuine cross-site form: the token alone is the check.
app:use(nitr.csrf({
    secret      = nitr.cfg.csrf_secret,
    cookie_opts = { same_site = "None" },
}))
```

Clients too old to send `Sec-Fetch-Site` fall back to the token alone,
so this is a defense that has been added, not one anything now depends
on.

## Where secrets come from

Never in `nitr.toml` — that is the file you commit. Read them once, in
`config.lua`:

```lua
-- config.lua
local function secret(name)
    -- `nitr.env.get` answers nil for an unset variable, so assert here:
    -- config.lua runs once during startup, and an error in it stops the
    -- boot instead of surfacing on the first login attempt.
    return assert(nitr.env.get(name), name .. " is not set")
end

return {
    session_secret = secret("SESSION_SECRET"),
    csrf_secret    = secret("CSRF_SECRET"),
    cookie_secret  = secret("COOKIE_SECRET"),
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

See [Environment variables](./configuration/env) for the `allow` policy
— `nitr.env.get` cannot distinguish an unset variable from one the
policy hides, which is deliberate, and another reason to assert.

Generate a secret with:

```sh
head -c 32 /dev/urandom | base64
```

`nitr.session` and `nitr.csrf` refuse a secret shorter than 16 bytes at
the point of the call rather than signing with it.
`res.cookies:set_signed` enforces no minimum — HMAC accepts a key of any
length — so for that one the 32 bytes above is a floor you impose on
yourself.

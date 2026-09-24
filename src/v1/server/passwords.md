# Passwords & Basic Auth

Store passwords with `nitr.crypto.password_hash`, check them with
`nitr.crypto.password_verify`, and read Basic credentials with
`nitr.auth.basic`. All three come with the `crypto` std feature:

```toml
[std]
features = ["json", "http", "log", "crypto"]   # ← "crypto"
```

Working code:
[`examples/basic-auth`](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/basic-auth).
Other primitives (digests, random bytes, encryption) are on
[Crypto & Auth](./crypto-auth).

## Signing up

```lua
local register = nitr.validate.schema({
    email    = { type = "string", required = true, format = "email" },
    password = { type = "string", required = true, min_len = 12 },
})

app:post("/register", function(req)
    local data, err = register:check(req:json())
    if not data then
        return nitr.error(422, { code = "VALIDATION_FAILED", fields = err.fields })
    end
    if #data.password > nitr.crypto.max_password_bytes then
        return nitr.error(400, { code = "PASSWORD_TOO_LONG" })
    end

    nitr.db:execute(
        "insert into users (email, password_hash) values (?, ?)",
        { data.email, nitr.crypto.password_hash(data.password) }
    )
    return nitr.status(201)
end)
```

`password_hash` returns a single string that holds the algorithm, its
settings and a random salt, so you store one column:

```text
$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>
```

That is argon2id, a password hash designed to be slow and memory-hungry
so stolen hashes are expensive to guess. The settings (19 MiB of memory,
2 passes, 1 lane) follow
[OWASP's recommendation](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
and cannot be changed. The schema needs `validate` in `[std] features`;
see [Validation](./validation/).

### The length cap

Passwords are limited to **1024 bytes**
(`nitr.crypto.max_password_bytes`) and never truncated. Above it,
`password_hash` raises, so check the length first, as above, to answer
`400` instead of `500`. `password_verify` simply returns `false` for an
over-long password, so a login handler needs no length check.

> [!TIP] `#` counts bytes; `max_len` counts characters
>
> A schema's `max_len = 1024` still lets a multi-byte password over 1024
> bytes through. Keep the `#password` check against
> `max_password_bytes`.

## Logging in without leaking your user list

```lua
local function authenticate(email, password)
    local row = nitr.db:query_row(
        "select password_hash from users where email = ?",
        { email }
    )

    local ok, problem
    if row then
        ok, problem = nitr.crypto.password_verify(password, row.password_hash)
    else
        -- No such user: spend the same time anyway.
        ok = nitr.crypto.password_verify_dummy(password)
    end

    if problem then
        nitr.log.error("a stored credential cannot be verified", {
            email = email,
            problem = problem,
        })
    end
    return ok
end
```

Checking a password takes about 26 ms. If an unknown email returned at
once, an attacker could time the responses and learn which addresses
have accounts. `password_verify_dummy(password)` runs the same argon2
work against a random decoy and always returns `false`, so both branches
take the same time.

For this to work:

- **Answer both failures the same way**: same status, same body. Do the
  same on registration and password reset ("that email is taken" leaks
  the same fact).
- **Keep stored hashes at Nitr's settings.** Hashes made elsewhere with
  heavier settings cost more to verify than the decoy, and the timing
  gap comes back. Re-hash them on the next login.
- **Rate-limit login and registration** (below).

## Verifying: two return values

```lua
local ok, problem = nitr.crypto.password_verify(password, stored)
```

| `ok`    | `problem` | Meaning                                                         |
| ------- | --------- | --------------------------------------------------------------- |
| `true`  | `nil`     | The password matches.                                           |
| `false` | `nil`     | Wrong password.                                                 |
| `false` | a string  | The **stored hash** is unusable: this account can never log in. |

Log `problem`; do not show it to the client. It is one of:

| Reason                         | Cause                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| `unsupported hash format`      | Not a PHC string: bcrypt (`$2b$`), md5crypt, sha512crypt, plain text, empty.       |
| `incomplete hash`              | Truncated: no salt or no hash part.                                                |
| `unsupported hash algorithm`   | A valid PHC string for another algorithm, such as `$scrypt$` or `$pbkdf2-sha256$`. |
| `hash parameters out of range` | argon2 settings above what Nitr will run: memory over 256 MiB, `t` or `p` over 8.  |
| `unusable hash`                | Looks like argon2 but still cannot be used (unknown version or parameter).         |

Nitr also logs a warning for each of these, naming the reason and the
hash's algorithm, never the hash itself.

> [!WARNING] Only argon2 hashes verify
>
> bcrypt and other formats are rejected. When migrating, re-hash on the
> next successful login against the old scheme, or force a password
> reset.

## Not at a script's top level

`password_hash`, `password_verify` and `password_verify_dummy` are
**async**: the argon2 work runs off the request thread so the server
stays responsive. Call them inside a handler or middleware. At a
script's top level, which runs once at startup, they fail with an error
that names the line:

```text
`password_hash` is asynchronous and cannot be called here. ...
```

If you need a hash at load time, create it ahead of time with
`nitr hash-password` and paste it in:

```lua
local users = {
    ada = "$argon2id$v=19$m=19456,t=2,p=1$...",   -- from nitr hash-password
}
```

## Creating a hash with `nitr hash-password`

```sh
nitr hash-password                               # prompts twice, no echo
printf %s "$NEW_PASSWORD" | nitr hash-password   # for scripts
```

It prints only the hash, so `HASH=$(nitr hash-password)` works. It needs
no `nitr.toml` and no application, and uses the same function as
`password_hash`. There is no `--password` flag, because a password on the
command line shows up in `ps` and shell history. See
[CLI → `hash-password`](./cli#hash-password).

## Rate limiting

Every login attempt costs one argon2 hash (about 19 MiB and 26 ms), for
known and unknown users alike. Without a limit, one client can keep your
server busy hashing and brute-force passwords at the same time. Turn on
the limiter:

```toml
[rate_limit]
enabled  = true
requests = 100
window   = 60
```

It counts per client IP and answers `429` over the budget. Behind a
proxy, also set `trust_forwarded_for = true`. See
[Configuration → `[rate_limit]`](./configuration/file#rate-limit).

## HTTP Basic authentication

```lua
local user, pass = nitr.auth.basic(req)
```

`nitr.auth.basic` decodes the header and returns the username and
password, or nothing at all. It is stricter than RFC 7617:

| `Authorization` header                       | Returns                                     |
| -------------------------------------------- | ------------------------------------------- |
| `Basic YWRhOmxvdmVsYWNl`                     | `"ada", "lovelace"`                         |
| the same, spelled `basic` or `BASIC`         | the same: the scheme is case-insensitive    |
| the same, with extra spaces around the value | the same: extra spaces are trimmed          |
| a tab instead of the space                   | nothing: only a space separates the scheme  |
| `Basicx …`, `Bearer …`                       | nothing: the scheme must match exactly      |
| credentials that are not UTF-8               | nothing                                     |
| a decoded value with no `:`                  | nothing                                     |
| two `Authorization` headers                  | never reaches Lua: the request gets a `400` |

You never get a user without a password. The username ends at the
**first** colon, so a password may contain colons but a username may
not. `basic` also accepts the raw header string, which helps in
[tests](./testing).

### A route guard

Wrap the handlers that need a login, and pass the user in as an
argument (`req` itself cannot hold extra fields):

```lua
local function challenge(status, body)
    local res = nitr.json(body, status)
    res.headers["WWW-Authenticate"] = 'Basic realm="example", charset="UTF-8"'
    return res
end

local function require_login(handler)
    return function(req)
        local user, pass = nitr.auth.basic(req)
        -- `authenticate` is the function from "Logging in" above.
        if not user or not authenticate(user, pass) then
            nitr.log.warn("login failed", { path = req.path })
            return challenge(401, { error = "unauthorized" })
        end
        return handler(req, user)
    end
end

app:get("/private", require_login(function(req, user)
    return nitr.json({ user = user })
end))
```

The `WWW-Authenticate` header is what tells a browser to ask for Basic
credentials; without it the `401` is not Basic auth.

> [!DANGER] Basic auth is not encryption
>
> The credentials are only base64-encoded and are sent with every
> request. Serve it over [TLS](./tls) or behind a proxy that terminates
> TLS.

## Checklist

- Hashes come from `password_hash` or `nitr hash-password`, never plain
  text.
- Nothing hashes at a script's top level.
- The no-such-user branch calls `password_verify_dummy`, and every
  failure returns the same status and body.
- Registration checks `#password` against `max_password_bytes`.
- The second value of `password_verify` is logged.
- `[rate_limit]` is on in front of login and registration.
- Credentials only travel over TLS.

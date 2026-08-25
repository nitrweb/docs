# Crypto & Auth

`nitr.crypto` exposes vetted primitives from the
[RustCrypto](https://github.com/RustCrypto) project. The rule for this
page is simple: **compose these; never reimplement them in Lua.**

## Enabling it

```toml
[std]
features = ["json", "http", "log", "crypto"]   # ← "crypto"
```

`nitr.crypto` and `nitr.auth` both come with it.

## Passwords

argon2id, the current recommendation for password storage. Hashing is
deliberately slow; that is the feature.

```lua
-- Registration
local hash = nitr.crypto.password_hash(password)
nitr.db:execute("INSERT INTO users (email, password_hash) VALUES (?, ?)", { email, hash })

-- Login
local user = nitr.db:query_row("SELECT * FROM users WHERE email = ?", { email })
if not user or not nitr.crypto.password_verify(password, user.password_hash) then
    return nitr.error(401, { code = "INVALID_CREDENTIALS" })
end
```

The salt and the parameters are inside the returned hash string — you
store one column, and verification reads what it needs from it.

> [!TIP] Do not reveal which half was wrong
>
> Checking the user and the password separately, with different
> responses, turns your login form into an account-enumeration oracle.
> One check, one message, as above.

> [!WARNING] Hashing costs real time
>
> argon2id is intentionally expensive, and it holds a Lua state while it
> runs. Rate-limit your login endpoint (`[rate_limit]`) so it cannot be
> used to exhaust the pool.

## Hashing and HMAC

```lua
local digest = nitr.crypto.sha256("data")                    -- lowercase hex
local mac    = nitr.crypto.hmac_sha256(key, "message")       -- lowercase hex
```

> [!DANGER] SHA-256 is not for passwords
>
> It is fast, which is exactly wrong for password storage. Use
> `password_hash`. SHA-256 is for content addressing, checksums and
> building MACs.

## Constant-time comparison

```lua
if nitr.crypto.constant_time_eq(provided_token, expected_token) then
    -- ok
end
```

`==` on secrets leaks information through timing: it returns as soon as
two bytes differ, so an attacker can discover a secret one byte at a
time. Use this for **any** comparison of secret material — tokens, MACs,
API keys.

## Random bytes

```lua
local raw   = nitr.crypto.random_bytes(32)                        -- 1..=65536 bytes
local token = nitr.base64.encode(raw, { url = true })             -- URL-safe token
```

From the operating system's CSPRNG. Use it for tokens, session ids,
nonces, generated filenames — never `math.random`, which is predictable.

## Authenticated encryption

`seal` / `open` is XChaCha20-Poly1305: encrypted **and** tamper-evident,
producing a printable token.

```lua
local key = nitr.cfg.encryption_key        -- 32 bytes, kept out of the repo

local sealed = nitr.crypto.seal(key, "sensitive data", "context")
local opened = nitr.crypto.open(key, sealed, "context")   -- nil on ANY tampering
if not opened then
    return nitr.error(400, { code = "INVALID_TOKEN" })
end
```

The third argument is **associated data**: not encrypted, but bound into
the authentication tag. Use it to pin a token to its context, so a token
minted for one purpose cannot be replayed as another:

```lua
local reset = nitr.crypto.seal(key, tostring(user.id), "password-reset")
-- A token sealed as "password-reset" will not open as "email-change".
```

`open` returns `nil` for a wrong key, a modified ciphertext or mismatched
associated data. There is no way to get a partially-valid result.

## JWT

HMAC JWTs — HS256, HS384, HS512.

```lua
local token = nitr.crypto.jwt.sign(
    { sub = tostring(user.id), role = user.role },
    nitr.cfg.jwt_secret,
    { algorithm = "HS256", expires_in = 3600 }
)
```

```lua
local claims, err = nitr.crypto.jwt.verify(token, nitr.cfg.jwt_secret, {
    algorithms = { "HS256" },        -- ← required, always
})
if not claims then
    return nitr.error(401, { code = "INVALID_TOKEN", reason = err })
end
```

Two properties worth knowing:

- **`algorithms` is required.** Verification demands an explicit
  allow-list, and structurally cannot accept `alg: none` — the classic
  JWT bypass is not reachable here.
- **`exp` and `nbf` are checked by default.** An expired token fails
  verification without you writing the check.

> [!TIP] Do you actually need JWTs?
>
> For your own web application, a [signed-cookie
> session](./cookies-sessions#sessions) is simpler, smaller, and
> `http_only`-protected. JWTs earn their complexity when a _different_
> service has to validate the token without calling you.

## Parsing `Authorization`

```lua
local token = nitr.auth.bearer(req)              -- "Bearer xyz" → "xyz", else nil
local user, pass = nitr.auth.basic(req)          -- Basic credentials, else nil
```

A complete bearer-token middleware:

```lua
local function require_auth(next)
    return function(req)
        local token = nitr.auth.bearer(req)
        if not token then
            return nitr.error(401, { code = "MISSING_TOKEN" })
        end

        local claims = nitr.crypto.jwt.verify(token, nitr.cfg.jwt_secret, {
            algorithms = { "HS256" },
        })
        if not claims then
            return nitr.error(401, { code = "INVALID_TOKEN" })
        end

        req.user = claims.sub
        req.role = claims.role
        return next(req)
    end
end
```

And Basic auth over an API key:

```lua
app:use(function(next)
    return function(req)
        local user, pass = nitr.auth.basic(req)
        if not user or not nitr.crypto.constant_time_eq(pass or "", nitr.cfg.api_key) then
            local resp = nitr.error(401, { code = "UNAUTHORIZED" })
            resp.headers = resp.headers or {}
            resp.headers["WWW-Authenticate"] = 'Basic realm="api"'
            return resp
        end
        return next(req)
    end
end)
```

## Managing secrets

Never in `nitr.toml`. Read them once, in `config.lua`, so a missing one
fails at **startup**:

```lua
-- config.lua
return {
    jwt_secret     = nitr.env.get("JWT_SECRET"),
    session_secret = nitr.env.get("SESSION_SECRET"),
    encryption_key = nitr.base64.decode(nitr.env.get("ENCRYPTION_KEY")),
}
```

```toml
[std]
features = ["json", "http", "log", "crypto", "base64", "env"]

[env]
file = ".env"
allow = ["JWT_SECRET", "SESSION_SECRET", "ENCRYPTION_KEY"]
```

Generate them with:

```sh
head -c 32 /dev/urandom | base64
```

### Rotation

Rotating a signing secret invalidates every token and session signed
with the old one, all at once. Plan for it: either accept the mass
logout at a quiet hour, or verify against both the old and the new
secret during a transition window and sign only with the new one.

## What not to do

| ❌                                          | ✅                                        |
| ------------------------------------------- | ----------------------------------------- |
| `math.random` for tokens                    | `nitr.crypto.random_bytes`                |
| `sha256(password)`                          | `nitr.crypto.password_hash`               |
| `token == expected`                         | `nitr.crypto.constant_time_eq`            |
| Hand-rolled HMAC in Lua                     | `nitr.crypto.hmac_sha256`                 |
| Signing your own cookie format              | `resp.cookies:set_signed`                 |
| `jwt.verify(t, k, {})` with no `algorithms` | it is required, and that is the point     |
| Secrets in `nitr.toml`                      | `nitr.env` + `.env`, read in `config.lua` |

## Quick reference

| Function                                      | Description                                 |
| --------------------------------------------- | ------------------------------------------- |
| `nitr.crypto.sha256(data)`                    | SHA-256 digest, lowercase hex               |
| `nitr.crypto.hmac_sha256(key, data)`          | HMAC-SHA256, lowercase hex                  |
| `nitr.crypto.random_bytes(n)`                 | `n` random bytes from the OS (1..=65536)    |
| `nitr.crypto.constant_time_eq(a, b)`          | Timing-safe comparison                      |
| `nitr.crypto.password_hash(password)`         | argon2id hash for storage                   |
| `nitr.crypto.password_verify(password, hash)` | Verify against a stored hash                |
| `nitr.crypto.seal(key, plaintext, aad?)`      | XChaCha20-Poly1305 AEAD; printable token    |
| `nitr.crypto.open(key, sealed, aad?)`         | Open a sealed token; `nil` on any tampering |
| `nitr.crypto.jwt.sign(claims, key, opts?)`    | Sign an HMAC JWT                            |
| `nitr.crypto.jwt.verify(token, key, opts)`    | Verify; `algorithms` required               |
| `nitr.auth.bearer(req)`                       | The bearer token, or `nil`                  |
| `nitr.auth.basic(req)`                        | Basic credentials, or `nil`                 |

# Crypto & Auth

`nitr.crypto` gives you hashing, HMAC, random bytes, timing-safe
comparison and encryption, all implemented in Rust
([RustCrypto](https://github.com/RustCrypto)). `nitr.auth` reads the
`Authorization` header. Use these; never write your own crypto in Lua.

Two topics have their own pages: [Passwords & Basic Auth](./passwords)
and [JWT](./jwt).

## Enabling it

```toml
[std]
features = ["json", "http", "log", "crypto"]   # ← "crypto"
```

`"crypto"` turns on both `nitr.crypto` and `nitr.auth`. The released
`nitr` binary includes it; a custom build without the `crypto` Cargo
feature fails at startup and says so.

## Hashing and HMAC

```lua
local digest = nitr.crypto.sha256("data")                -- lowercase hex
local mac    = nitr.crypto.hmac_sha256(key, "message")   -- lowercase hex
```

Both return a lowercase hex string. HMAC is a hash keyed with a secret,
so only someone with the key can produce a matching value.

> [!DANGER] SHA-256 is not for passwords
>
> It is fast, which makes guessing cheap for anyone who steals your
> table. Use [`nitr.crypto.password_hash`](./passwords) instead.

## Random bytes

```lua
local raw   = nitr.crypto.random_bytes(32)              -- 1 to 65536 bytes
local token = nitr.base64.encode(raw, { url = true })   -- needs "base64"
```

The bytes come from the operating system's secure random source. Use
them for tokens, ids and keys, never `math.random`, which is
predictable. The result is a binary string, so encode it before putting
it in a header, URL, cookie or JSON. A size outside `1..65536` raises.

## Constant-time comparison

```lua
if nitr.crypto.constant_time_eq(provided_token, expected_token) then
    -- ok
end
```

`==` stops at the first differing byte, so the time it takes can tell an
attacker how much of a secret they guessed. Use `constant_time_eq` for
every comparison of secret material: tokens, MACs, API keys.

It hides the contents, not the length: strings of different length
return `false` at once. That is fine for fixed-size tokens. If the
secret's length varies, compare digests, which always have the same
length:

```lua
nitr.crypto.constant_time_eq(nitr.crypto.sha256(provided), nitr.crypto.sha256(expected))
```

## Authenticated encryption

`seal` and `open` use XChaCha20-Poly1305, an AEAD cipher: the data is
encrypted and any change to it is detected.

```lua
local key = nitr.cfg.encryption_key   -- exactly 32 bytes

local sealed = nitr.crypto.seal(key, "sensitive data", "context")
local opened = nitr.crypto.open(key, sealed, "context")
if not opened then
    return nitr.error(400, { code = "INVALID_TOKEN" })
end
```

- The key must be **exactly 32 bytes**, for example from
  `nitr.crypto.random_bytes(32)`. Any other length raises; a passphrase
  is not a key.
- `seal` returns URL-safe base64 with a fresh random nonce each call, so
  the same input gives a different token every time, and the token can
  go in a URL, cookie or JSON field as is.
- The optional third argument (associated data) is not encrypted but
  must match on `open`. Use it to tie a token to one purpose: a token
  sealed with `"password-reset"` will not open with `"email-change"`.
- `open` returns `nil` for a wrong key, a changed or truncated token,
  bad base64 or different associated data. There is no partial result.

## Parsing `Authorization`

```lua
local token      = nitr.auth.bearer(req)   -- "Bearer xyz" → "xyz", else nil
local user, pass = nitr.auth.basic(req)    -- both strings, or nothing
```

Both also accept the raw header string (`nitr.auth.bearer("Bearer xyz")`),
which is handy in [tests](./testing). For what `basic` accepts, see
[HTTP Basic authentication](./passwords#http-basic-authentication).

### Bearer tokens

A shared API token needs no JWT: a long random string compared on
arrival is enough. Compare it with `constant_time_eq`:

```lua
-- scripts/app.lua
local app = nitr.app()
local API_TOKEN = nitr.cfg.api_token   -- nitr.cfg is readable at load time

app:use(function(next)
    return function(req)
        local token = nitr.auth.bearer(req)
        if not token or not nitr.crypto.constant_time_eq(token, API_TOKEN) then
            -- One status and body for every failure.
            local res = nitr.error(401, { code = "UNAUTHORIZED" })
            res.headers["WWW-Authenticate"] = 'Bearer realm="api"'
            return res
        end
        return next(req)
    end
end)

return app
```

> [!DANGER] Never compare a secret with `==`
>
> Use `constant_time_eq`, and compare `sha256` digests if the secret's
> length can vary.

Full example:
[`examples/bearer-auth`](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/bearer-auth).

## Passwords and JWT

- **Passwords**: `password_hash`, `password_verify` and
  `password_verify_dummy` use argon2id, a deliberately slow password
  hash. They are async, so call them from a handler, not a script's top
  level. See [Passwords & Basic Auth](./passwords).
- **JWT**: `nitr.crypto.jwt` signs and verifies HMAC tokens (HS256,
  HS384, HS512). `verify` requires an `algorithms` list and does not
  check `iss` or `aud`. See [JWT](./jwt). For your own web app, a
  [session cookie](./cookies-sessions#sessions) is usually simpler.

## Managing secrets

Keep secrets out of `nitr.toml`. Read them from the environment in
`config.lua`, so a missing one stops startup instead of failing on the
first request:

```lua
-- scripts/config.lua
local function required(name)
    local value = nitr.env.get(name)
    if not value or value == "" then
        error(name .. " is not set")
    end
    return value
end

-- nitr.base64.decode returns nil plus a reason instead of raising.
local key, why = nitr.base64.decode(required("ENCRYPTION_KEY"))
if not key or #key ~= 32 then
    error("ENCRYPTION_KEY must decode to 32 bytes: " .. (why or "wrong length"))
end

return {
    jwt_secret     = required("JWT_SECRET"),
    encryption_key = key,
    api_token      = required("API_TOKEN"),
}
```

```toml
config_script = "scripts/config.lua"

[std]
features = ["json", "http", "log", "crypto", "base64", "env"]

[env]
file = ".env"
allow = ["JWT_SECRET", "ENCRYPTION_KEY", "API_TOKEN"]
```

Generate a value with `head -c 32 /dev/urandom | base64`. See
[Environment variables](./configuration/env) for `[env] allow`.

### Rotation

Changing a signing secret invalidates every token and session signed
with the old one at once. Either accept that mass logout, or for a
while verify with both the old and new secret and sign only with the new
one. [JWT → Rotation](./jwt#rotation) shows the pattern.

## Quick reference

| Entry                                         | Description                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| `nitr.crypto.sha256(data)`                    | SHA-256 digest, lowercase hex                                                     |
| `nitr.crypto.hmac_sha256(key, data)`          | HMAC-SHA256, lowercase hex                                                        |
| `nitr.crypto.random_bytes(n)`                 | `n` random bytes from the OS (`1..65536`)                                         |
| `nitr.crypto.constant_time_eq(a, b)`          | Timing-safe comparison; length is not hidden                                      |
| `nitr.crypto.seal(key, plaintext, aad?)`      | XChaCha20-Poly1305 encryption; 32-byte key; printable token                       |
| `nitr.crypto.open(key, sealed, aad?)`         | Opens a sealed token; `nil` on any tampering                                      |
| `nitr.crypto.password_hash(password)`         | argon2id hash. Raises above the cap. **Async**                                    |
| `nitr.crypto.password_verify(password, hash)` | `boolean, string\|nil`: the answer, plus why a stored hash is unusable. **Async** |
| `nitr.crypto.password_verify_dummy(password)` | One argon2 hash against a decoy; always `false`. **Async**                        |
| `nitr.crypto.max_password_bytes`              | The password cap, `1024` bytes                                                    |
| `nitr.crypto.jwt.sign(claims, key, opts?)`    | Signs an HMAC JWT (`{ alg = "HS256" }`)                                           |
| `nitr.crypto.jwt.verify(token, key, opts)`    | `table\|nil, string\|nil`; `algorithms` required                                  |
| `nitr.auth.basic(req)`                        | `user, pass`, or nothing                                                          |
| `nitr.auth.bearer(req)`                       | The bearer token, or `nil`                                                        |

Full signatures are in the [API reference](../api/#nitr-crypto). See
also [Cookies & Sessions](./cookies-sessions) for signed cookies and
sessions, and [Security](./security) for what the sandbox does and does
not protect.

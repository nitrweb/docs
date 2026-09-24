# JWT

`nitr.crypto.jwt` signs and verifies JSON Web Tokens with HMAC (a hash
keyed with a shared secret): `HS256`, `HS384` and `HS512` only. There
are no public-key algorithms, and `alg: none` is never accepted.

> [!TIP] Do you need a JWT?
>
> For your own web app, a [session cookie](./cookies-sessions#sessions)
> is simpler and safer: `http_only`, `SameSite=Lax` by default, and
> revocable by rotating one secret. Use a JWT when a **different**
> service must check the token without calling you.

## Enabling it

```toml
[std]
features = ["json", "http", "log", "time", "crypto"]   # ← "crypto"
```

`crypto` provides `nitr.crypto.jwt` and `nitr.auth`; `time` gives you
`nitr.time.now()` to build an `exp`.

## Issuing and checking a token

```lua
-- Issue
local token = nitr.crypto.jwt.sign({
    sub = tostring(user.id),
    iss = "https://auth.example.com",
    aud = "billing-api",
    iat = nitr.time.now(),
    exp = nitr.time.now() + 900,        -- 15 minutes
}, nitr.cfg.jwt_secret, { alg = "HS256" })

-- Check
local claims, reason = nitr.crypto.jwt.verify(token, nitr.cfg.jwt_secret, {
    algorithms = { "HS256" },   -- required
})
if not claims then
    nitr.log.warn("token rejected", { reason = reason })
    return nitr.status(401)
end
```

`verify` only proves the token was signed with your key and is within
its `exp`/`nbf` window. You still have to check who issued it and who it
is for; see [Writing the checks yourself](#writing-the-checks-yourself).

## Signing

```lua
nitr.crypto.jwt.sign(claims, key, opts?) -> string
```

- `claims` is a table, serialized to JSON.
- `key` is the secret as raw bytes; see [Keys](#keys).
- `opts.alg` picks the algorithm (default `HS256`). It is the only
  option.

The header is always `{"alg":"HS256","typ":"JWT"}` (with your `alg`).
`sign` raises for an unknown algorithm or claims that are not valid JSON.

> [!WARNING] `sign` adds no claims and ignores unknown options
>
> There is no `expires_in` or automatic `iat`. `{ expires_in = 3600 }` is
> silently ignored and gives a token that **never expires**. Put `exp`
> in the claims yourself.

## Verifying

```lua
nitr.crypto.jwt.verify(token, key, opts) -> table|nil, string|nil
```

It returns the claims, or `nil` and a reason.

| Option       | Type       | Notes                                                                 |
| ------------ | ---------- | --------------------------------------------------------------------- |
| `algorithms` | `string[]` | **Required.** The algorithms you accept.                              |
| `leeway`     | `number?`  | Seconds of clock difference allowed for `exp` and `nbf`. Default `0`. |

The reason is one of:

| Reason                  | Meaning                                                                    |
| ----------------------- | -------------------------------------------------------------------------- |
| `malformed token`       | Not three dot-separated parts.                                             |
| `malformed header`      | The header is not base64url-encoded JSON.                                  |
| `algorithm not allowed` | The header's `alg` is not in `algorithms`.                                 |
| `invalid signature`     | Wrong key, or the token was changed.                                       |
| `malformed claims`      | The claims are not base64url-encoded JSON, or `exp`/`nbf` is not a number. |
| `token expired`         | `exp` is in the past, beyond `leeway`.                                     |
| `token not yet valid`   | `nbf` is in the future, beyond `leeway`.                                   |

Log the reason, but answer every failure with the same `401`: telling a
caller whether a token was expired or forged helps an attacker.

`verify` never raises because of the token itself, so garbage input is
a `401`, not a `500`, and you need no `pcall`. It does raise for a
mistake in your call: no `algorithms`, a name it does not support, or a
`leeway` that is negative or not finite.

### The `algorithms` list

`algorithms` is required so the token cannot choose how it is checked,
the classic JWT attack. Names are exact (`hs256` is not `HS256`), and an
unknown name raises instead of being skipped, so a typo cannot turn
verification off. List only the algorithms you actually sign with.

### What `verify` does not check

It checks the signature, the `alg`, and `exp`/`nbf` **when present**.
It never reads `iss`, `aud`, `sub`, `jti` or `typ`. So:

- A token from any issuer, or for any audience, verifies if the key
  matches.
- **A token with no `exp` never expires.** If yours must expire, reject
  tokens without one.

## Writing the checks yourself

Wrap `verify` with your policy:

```lua
local EXPECTED_ISS = "https://auth.example.com"
local EXPECTED_AUD = "billing-api"

-- `aud` may be a string or an array (RFC 7519).
local function audience_matches(aud, expected)
    if type(aud) == "string" then
        return aud == expected
    end
    if type(aud) == "table" then
        for _, value in ipairs(aud) do
            if value == expected then
                return true
            end
        end
    end
    return false
end

--- Returns the claims, or nil plus a reason (for the log, not the body).
local function authenticate(token, key)
    local claims, reason = nitr.crypto.jwt.verify(token, key, {
        algorithms = { "HS256" },
        leeway = 30,
    })
    if not claims then
        return nil, reason
    end
    if claims.exp == nil then
        return nil, "no expiry"
    end
    if claims.iss ~= EXPECTED_ISS then
        return nil, "wrong issuer"
    end
    if not audience_matches(claims.aud, EXPECTED_AUD) then
        return nil, "wrong audience"
    end
    return claims
end
```

## A bearer-token middleware

```lua
-- scripts/app.lua
local app = nitr.app()

local function unauthorized()
    local res = nitr.error(401, { code = "UNAUTHORIZED" })
    res.headers["WWW-Authenticate"] = 'Bearer realm="api"'
    return res
end

local function require_token(next)
    return function(req)
        local token = nitr.auth.bearer(req)
        if not token then
            return unauthorized()
        end
        local claims, reason = authenticate(token, nitr.cfg.jwt_secret)
        if not claims then
            nitr.log.warn("auth failed", { reason = reason, path = req.path })
            return unauthorized()
        end
        return next(req, claims)   -- pass the claims on as an argument
    end
end

app:get("/me", require_token, function(req, claims)
    return nitr.json({ user = claims.sub })
end)

return app
```

> [!WARNING] You cannot add fields to `req`
>
> `req.user = claims.sub` raises. Pass values as extra arguments to
> `next`, as above; any middleware in between must forward them.

Put a [rate limit](./configuration/file#rate-limit) in front of routes
that accept tokens. For a single shared API token, you do not need a
JWT: see [Bearer tokens](./crypto-auth#bearer-tokens).

## Keys

HMAC accepts a key of any length, even one far too short. Use **at
least 32 random bytes** (`head -c 32 /dev/urandom | base64`), keep it out
of `nitr.toml`, and load it from the environment in `config.lua`; see
[Managing secrets](./crypto-auth#managing-secrets). Signer and verifier
must use the identical bytes: if one side base64-decodes the secret and
the other does not, every token fails with `invalid signature`.

### Rotation

Tokens carry no key id, so during a rotation try each key in turn: sign
with the new key, and accept either.

```lua
local function verify_rotating(token)
    local claims, reason = authenticate(token, nitr.cfg.jwt_key_current)
    if claims then
        return claims
    end
    if nitr.cfg.jwt_key_previous then
        local older = authenticate(token, nitr.cfg.jwt_key_previous)
        if older then
            return older
        end
    end
    return nil, reason
end
```

Keep the old key for at least your longest token lifetime, then drop
it. Rotating with no overlap logs everyone out at once.

## Revocation

A JWT stays valid until it expires. Logging out only makes the client
forget it; a copied token still works. Your options:

| Approach                     | Cost                 | Effect                                                                              |
| ---------------------------- | -------------------- | ----------------------------------------------------------------------------------- |
| Short `exp` (minutes)        | None                 | Limits how long a stolen token works.                                               |
| Rotate the signing key       | One secret           | Revokes every token at once.                                                        |
| `jti` + a denylist you check | A lookup per request | Per-token revocation, stored in [`nitr.db`](./database) or [`nitr.cache`](./cache). |

If you need the denylist, a [session cookie](./cookies-sessions#sessions)
may be the better fit.

## Testing expiry

`exp` and `nbf` are checked against the standard library's clock, which
tests can move with [`t.clock`](./testing#clock) instead of waiting.

## Checklist

- `algorithms` names only the algorithms you sign with.
- Every token has an `exp`, and your check rejects tokens without one.
- `iss` and `aud` are compared explicitly, with `aud` arrays handled.
- The rejection reason is logged, never returned; every failure is the
  same `401`.
- The key is at least 32 random bytes from the environment.
- A rate limit sits in front of routes that accept tokens.

Signatures: [API reference → `nitr.crypto.jwt`](../api/#nitr-crypto-jwt).

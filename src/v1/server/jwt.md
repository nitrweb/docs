# JWT

`nitr.crypto.jwt` signs and verifies HMAC JSON Web Tokens: `sign` mints
one, `verify` authenticates one. `HS256`, `HS384` and `HS512` — nothing
else.

Asymmetric algorithms are deliberately absent (a format needs a
key-management story before RS256 helps anyone), and so is `alg: none`,
which is not merely rejected here but structurally unrepresentable.

What you get is a **primitive, not an authentication framework**. It
answers one question — "was this token signed with this key, and is it
inside its validity window?" — and leaves every policy question to you.
Most of this page is about the questions it leaves open.

## Before you reach for one

> [!TIP] For your own application, a session cookie is the smaller tool
>
> A [signed-cookie session](./cookies-sessions#sessions) is simpler than
> a JWT, is `http_only` so page scripts cannot read it, gets
> `SameSite=Lax` by default, and can be invalidated by rotating one
> secret. A JWT stored in `localStorage` has none of those properties
> and buys nothing back.

JWTs earn their complexity when a **different** service must validate
the credential without calling you: a mobile client talking to three
backends, a service mesh, an identity provider you do not own. If the
same process that mints the token is the one that checks it, you are
paying for statelessness you are not using.

## Enabling it

```toml
[std]
features = ["json", "http", "log", "time", "crypto"]   # ← "crypto"
```

`nitr.crypto`, `nitr.crypto.jwt` and `nitr.auth` all arrive with
`crypto`. `time` is what you will use to build an `exp`.

A `[std]` feature must also be compiled into the binary. The released
`nitr` includes all of them; a `--no-default-features` build that omits
`crypto` fails at startup with an error naming the Cargo feature to
enable — see [Cargo features](../library/cargo-features).

## Signing

```lua
nitr.crypto.jwt.sign(claims, key, opts) -> string
```

| Argument | Type     | Notes                                                             |
| -------- | -------- | ----------------------------------------------------------------- |
| `claims` | `table`  | Serialized to JSON. Anything JSON cannot represent is an error.   |
| `key`    | `string` | Raw bytes. HMAC takes a key of any length — see [Keys](#keys).    |
| `opts`   | `table?` | Optional. The **only** key read is `alg`; the default is `HS256`. |

```lua
local token = nitr.crypto.jwt.sign({
    sub = tostring(user.id),
    iss = "https://auth.example.com",
    aud = "billing-api",
    iat = nitr.time.now(),
    exp = nitr.time.now() + 900,        -- 15 minutes
}, nitr.cfg.jwt_secret, { alg = "HS256" })
```

The result is the RFC 7515 compact serialization —
`base64url(header).base64url(claims).base64url(mac)` — with a header of
exactly:

```text
{"alg":"HS256","typ":"JWT"}
```

> [!WARNING] `sign` adds no claims, and ignores options it does not know
>
> There is no `expires_in`, no `ttl`, no automatic `iat`. `sign` reads
> `alg` from `opts` and nothing else, so a mistyped option is silently
> dropped — write `{ expires_in = 3600 }` and you get a token that
> **never expires**. Every claim, `exp` included, is a key you put in
> the claims table yourself.

`sign` raises (rather than returning an error value) when the algorithm
is not one of the three, when the claims are not JSON-serializable, or
when the claims table is pathologically large or deeply nested — the
same JSON bounds `nitr.json` enforces.

## Verifying

```lua
nitr.crypto.jwt.verify(token, key, opts) -> table|nil, string|nil
```

Two return values, and they are exclusive: **claims and no reason**, or
**`nil` and a reason**.

| Option       | Type       | Notes                                                                                                              |
| ------------ | ---------- | ------------------------------------------------------------------------------------------------------------------ |
| `algorithms` | `string[]` | **Required.** The allow-list. Omitting it is an error.                                                             |
| `leeway`     | `number?`  | Clock skew in seconds, applied to `exp` and `nbf`. Default 0. Must be a **finite number ≥ 0**, or `verify` raises. |

```lua
local claims, reason = nitr.crypto.jwt.verify(token, nitr.cfg.jwt_secret, {
    algorithms = { "HS256" },   -- mandatory, and an allow-list, not a hint
    leeway = 30,                -- optional clock skew, in seconds
})
if not claims then
    nitr.log.warn("token rejected", { reason = reason })
    return nitr.status(401)
end
```

The reason is one of exactly seven strings:

| Reason                  | Meaning                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `malformed token`       | Not three dot-separated segments.                                                                     |
| `malformed header`      | The first segment is not base64url-encoded JSON.                                                      |
| `algorithm not allowed` | The header's `alg` is not in your allow-list.                                                         |
| `invalid signature`     | Wrong key, or a changed byte in the payload or signature.                                             |
| `malformed claims`      | The second segment is not base64url-encoded JSON — or it carries an `exp`/`nbf` that is not a number. |
| `token expired`         | `exp` is in the past, beyond `leeway`.                                                                |
| `token not yet valid`   | `nbf` is in the future, beyond `leeway`.                                                              |

> [!NOTE] A non-numeric `exp` is malformed, not absent
>
> RFC 7519 requires a NumericDate, so `"exp": "soon"` is rejected rather
> than read as "this token has no expiry" — which would verify a token
> its issuer meant to expire.

> [!WARNING] The reason belongs in your log, not in the response
>
> Telling a caller whether their token was expired or forged answers a
> question they should have to guess. Log the reason; answer the same
> `401` either way.

> [!NOTE] `verify` does not raise on hostile input
>
> Given well-formed options — an `algorithms` allow-list and, if you
> pass one, a finite `leeway` ≥ 0 — no sequence of bytes in `token` makes
> `verify` throw — garbage, an empty string, a truncated token and an
> `alg: none` header all come back as `nil` plus a reason. That property
> is fuzzed (`jwt-verify`, one of the repository's fuzz targets),
> because a raised error would become a `500` where a `401` was meant.
> You do not need `pcall` around it.
>
> It _does_ raise for a broken **call**: a missing `algorithms` list, a
> list naming an algorithm it does not implement, or a `leeway` that is
> negative or not finite — `math.huge` would make both time comparisons
> vacuous and silently switch expiry off, so it is refused instead.

## The allow-list is the point

`algorithms` is mandatory because the alternative is letting the token's
own header choose the algorithm used to check it — the classic JWT
failure, and the reason `alg: none` has a CVE history.

Three properties are worth knowing:

- **`alg: none` cannot be expressed.** It is not a rejected value; it is
  not a value. `{ algorithms = { "none" } }` is an error at the call,
  and a token whose header says `none` is rejected by the allow-list
  check before its signature is ever computed.
- **An unsupported name in the list raises, it is not skipped.** A typo
  such as `{ algorithms = { "HS266" } }` is an error, so a typo cannot
  quietly turn verification off.
- **The comparison is exact.** `hs256` is not `HS256`, in the list or in
  a token header. Case folding is exactly the kind of leniency
  algorithm-confusion attacks live in.

Keep the list as narrow as the tokens you actually mint. Listing
`{ "HS256", "HS512" }` when you only ever sign `HS256` means a forger
gets to choose between two attack surfaces instead of none.

## What `verify` checks — and what it does not

It checks three things: the signature (with a constant-time comparison),
the header's `alg` against your allow-list, and `exp`/`nbf` **when the
token carries them**. Everything else is data.

| Claim                                | Status                                                        |
| ------------------------------------ | ------------------------------------------------------------- |
| `iss` (issuer)                       | **Never read.** A token from any issuer verifies.             |
| `aud` (audience)                     | **Never read.** A token minted for another audience verifies. |
| `sub`, `jti`, `iat`, anything custom | Never read.                                                   |
| `typ` (header)                       | **Written by `sign`, never verified.**                        |
| `exp` / `nbf`                        | Checked **only if present**, and only if numeric.             |

Two of those hide behind the shape of the API:

### `typ` is write-only

`sign` puts `typ: "JWT"` in the header and `verify` ignores it. The
field being there suggests a check that does not happen.

### A token with no `exp` never expires

Nothing in the format requires the claim, so "this signature is valid"
and "this token is still good" are different questions. If your tokens
must expire, **refuse the ones that do not say when** — `verify` will
not do it for you.

The same applies to an `exp` that is not a number. The check reads it as
a number, and a non-numeric one (a string `"1893456000"`, a JSON `null`)
is treated exactly like an absent one: no expiry check at all. Test the
type, not the presence.

## Writing the checks yourself

`verify` hands you the claims; compare them before you trust them. This
wrapper is copy-pasteable — it is the missing half of the API:

```lua
local EXPECTED_ISS = "https://auth.example.com"
local EXPECTED_AUD = "billing-api"

--- True when `aud` names `expected`, in either RFC 7519 encoding.
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
    -- Absent, or some other type: not a match.
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

    -- `exp` is optional in the format, so require it explicitly — and
    -- require it to be a number, because a string `exp` is not checked.
    if type(claims.exp) ~= "number" then
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

> [!NOTE] `aud` is a string _or_ an array
>
> RFC 7519 §4.1.3 allows either, and real issuers use both. A comparison
> written as `claims.aud == EXPECTED_AUD` silently rejects every
> multi-audience token; one written only for the array case rejects every
> single-audience one. Hence `audience_matches` above.

## A bearer-token middleware

The complete guard, from the `Authorization` header to the claims the
handler needs:

```lua
-- scripts/app.lua
local app = nitr.app()

local function unauthorized()
    -- One status, one body, for every failure: no header, wrong scheme,
    -- forged token, expired token, wrong audience.
    local res = nitr.error(401, { code = "UNAUTHORIZED" })
    res.headers["WWW-Authenticate"] = 'Bearer realm="api"'
    return res
end

--- Middleware factory: the outer function runs once, at load.
--- `authenticate` is the wrapper from the section above.
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

        -- Hand the claims to the next link as a second argument.
        return next(req, claims)
    end
end

app:get("/me", require_token, function(req, claims)
    return nitr.json({ user = claims.sub })
end)

return app
```

`nitr.auth.bearer(req)` returns the token after the scheme match, or
`nil` for anything unparseable — there is no string parsing here to get
wrong. See [Middleware](./middleware) for how the chain is composed.

> [!WARNING] `req` is a request handle, not a table you can decorate
>
> `req.user = claims.sub` is not a way to pass data down the chain: the
> request is backed by Rust and assigning an unknown field to it raises.
> Pass extra values as extra arguments to `next`, as above, and every
> middleware between you and the handler must forward them.

> [!TIP] Put a rate limit in front of it
>
> Verifying a JWT is cheap, but an authentication endpoint is still a
> guessing surface, and the limiter is configuration rather than code:
> `[rate_limit] enabled = true`. See
> [Configuration → the `nitr.toml` file](./configuration/file).

## When the token is a shared secret

A machine-to-machine API often does not need a JWT at all — a single
long random string, compared on arrival, is smaller and has no claim
policy to get wrong. It does have one sharp edge:

```lua
local token = nitr.auth.bearer(req)
if not token or not nitr.crypto.constant_time_eq(token, nitr.cfg.api_token) then
    return unauthorized()
end
```

> [!DANGER] Never compare a secret with `==`
>
> `==` returns as soon as two bytes differ, so the time it takes leaks
> how much of the secret the caller guessed — one byte at a time. Use
> `nitr.crypto.constant_time_eq` for tokens, MACs and API keys.

`constant_time_eq` hides the _contents_ of the two strings, not their
**lengths**: it returns `false` immediately when the lengths differ. For
a fixed-length token that is fine — every candidate is the same size. If
the secret's length varies (or is itself sensitive), compare digests
instead, which are always the same size:

```lua
if not nitr.crypto.constant_time_eq(
    nitr.crypto.sha256(token),
    nitr.crypto.sha256(nitr.cfg.api_token)
) then
    return unauthorized()
end
```

Working code for the whole pattern:
[`examples/bearer-auth`](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/bearer-auth).

## Keys

The key is raw bytes, and HMAC accepts any length — including lengths
that are far too short. Nothing here will stop you:

- Use **at least 32 bytes** from a real source:
  `nitr.crypto.random_bytes(32)`, `head -c 32 /dev/urandom | base64`, or
  your secret manager.
- Keep it out of the repository and out of `nitr.toml`. Read it once in
  `config.lua`, where a missing secret fails at **startup** instead of
  on the first request:

```lua
-- scripts/config.lua
-- `nitr.env.get` answers nil for an unset variable rather than raising,
-- so assert here: config.lua runs once during startup, and an error in
-- it stops the boot instead of surfacing on the first request that signs.
local function required(name)
    return assert(nitr.env.get(name), name .. " is not set")
end

return {
    jwt_secret = required("JWT_SECRET"),
}
```

```toml
config_script = "scripts/config.lua"   # ← without this, nitr.cfg is nil

[std]
features = ["json", "http", "log", "time", "crypto", "env"]

[env]
allow = ["JWT_SECRET"]
```

Whatever the string is — raw bytes, hex, base64 — signer and verifier
must use the identical bytes. Decoding on one side and not the other
produces "invalid signature" and a long afternoon.

### Rotation

`sign` writes a fixed header, so there is no `kid` for a verifier to
look up. Rotation is therefore a **trial**, not a lookup: sign with the
new key, and accept either during the overlap.

```lua
--- Verifies against the current key, then the previous one.
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

Keep the old key accepted for at least the lifetime of your longest-lived
token — after that every token signed with it has expired on its own, and
you can drop it. Rotating with no overlap at all invalidates every
outstanding token at once, which is sometimes exactly what you want: it
is the only mass revocation a stateless format offers.

## Revocation is the thing you do not get

A signed token is valid until it expires. There is no server-side list
to remove it from, so **logging out does not invalidate a JWT** — it
only makes the client forget it. Someone who copied the token still has
a working credential.

Three answers, in order of how much state they cost:

| Approach                     | Cost                | What it actually buys                                                |
| ---------------------------- | ------------------- | -------------------------------------------------------------------- |
| Short `exp` (minutes)        | None                | Bounds the damage window; re-issue from a session or a refresh flow. |
| Rotate the signing key       | One secret          | Revokes **everything**, at once, for everyone.                       |
| `jti` + a denylist you check | State on every read | Real per-token revocation — and you are no longer stateless.         |

The third one is worth naming plainly: put a unique `jti` in the claims
and check it against [`nitr.db`](./database) or
[`nitr.cache`](./cache) on every request. That works, and it costs you
the property you adopted JWTs for. If you find yourself building it,
re-read [Before you reach for one](#before-you-reach-for-one) — a
session cookie may have been the answer.

## What not to do

| ❌                                           | ✅                                                     |
| -------------------------------------------- | ------------------------------------------------------ |
| `jwt.verify(t, k, {})` with no `algorithms`  | it is required, and that is the point                  |
| `{ expires_in = 3600 }` on `sign`            | `exp = nitr.time.now() + 3600` in the claims           |
| Trusting `sub` straight out of `verify`      | check `iss` and `aud` first                            |
| `if claims.exp then` as an expiry policy     | `type(claims.exp) ~= "number"` → reject                |
| `claims.aud == "my-api"`                     | a helper that handles the array encoding               |
| `token == expected` for a shared secret      | `nitr.crypto.constant_time_eq`                         |
| Returning the rejection reason to the caller | log it; answer one `401`                               |
| A JWT in `localStorage` for your own app     | a [signed-cookie session](./cookies-sessions#sessions) |
| Treating logout as revocation                | short `exp`, or a `jti` denylist                       |
| The secret in `nitr.toml`                    | `nitr.env` + `config.lua`                              |

## Checklist

- Every allow-list names only the algorithms you actually sign with.
- Every token carries an `exp`, and every verifier requires one.
- `iss` and `aud` are compared explicitly, with the array case handled.
- The rejection reason is logged and never returned.
- Failures answer one status with one body.
- The signing key is at least 32 random bytes, read from the
  environment in `config.lua`.
- Shared secrets are compared with `constant_time_eq` — as digests when
  their length varies.
- There is a rate limit in front of any route that accepts a token.

## Quick reference

| Entry                                      | Description                                                         |
| ------------------------------------------ | ------------------------------------------------------------------- |
| `nitr.crypto.jwt.sign(claims, key, opts?)` | Signs a token. `opts.alg` is the only option; default `HS256`.      |
| `nitr.crypto.jwt.verify(token, key, opts)` | `table\|nil, string\|nil` — claims, or `nil` plus a reason.         |
| `opts.algorithms`                          | Required allow-list; `HS256`, `HS384`, `HS512`, compared exactly.   |
| `opts.leeway`                              | Clock skew in seconds for `exp`/`nbf`. Default `0`; finite and ≥ 0. |
| `nitr.auth.bearer(req)`                    | The bearer token, or `nil`.                                         |
| `nitr.crypto.constant_time_eq(a, b)`       | Timing-safe comparison; returns early on a length mismatch.         |
| `nitr.time.now()`                          | Unix seconds, for building an `exp`.                                |

## Related

- [API reference → `nitr.crypto.jwt`](../api/#nitr-crypto-jwt) — the
  generated signatures.
- [Crypto & Auth](./crypto-auth) — digests, random bytes, constant-time
  comparison, sealed tokens.
- [Passwords & Basic Auth](./passwords) — how a user proves who they
  are before a token is minted.
- [Cookies & Sessions](./cookies-sessions) — the smaller tool, for your
  own application.
- [Middleware](./middleware) — how the guard above is composed.
- [Security & the Sandbox](./security) — what the sandbox does and does
  not defend against.

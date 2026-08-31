# Crypto & Auth

`nitr.crypto` exposes vetted primitives from the
[RustCrypto](https://github.com/RustCrypto) project, and `nitr.auth`
parses the `Authorization` header. The rule for this page is simple:
**compose these; never reimplement them in Lua.**

What lives here is the primitive layer — digests and MACs, random bytes,
constant-time comparison, sealed tokens, and header parsing. Two
subjects grew large enough to have pages of their own,
[Passwords & Basic Auth](./passwords) and [JWT](./jwt); this page points
at them instead of repeating them.

## Enabling it

```toml
[std]
features = ["json", "http", "log", "crypto"]   # ← "crypto"
```

`nitr.crypto` and `nitr.auth` both arrive with that one name. The
feature must also be compiled into the binary: the released `nitr` has
all of them, a `--no-default-features` build may not, and asking for one
the binary lacks is a startup error naming the Cargo feature to enable.

## Hashing and HMAC

```lua
local digest = nitr.crypto.sha256("data")                    -- lowercase hex
local mac    = nitr.crypto.hmac_sha256(key, "message")       -- lowercase hex
```

Both hand back a lowercase hex string rather than raw bytes: printable,
safe to log, and what most wire formats already expect. `hmac_sha256`
takes the key as its first argument — a MAC, not a digest of a
concatenation, so length-extension is not a question you have to think
about.

> [!DANGER] SHA-256 is not for passwords
>
> It is fast, and speed is exactly the wrong property here: the same
> cheapness that makes a digest free for you makes guessing free for
> whoever steals the table. Use `nitr.crypto.password_hash`, which is
> deliberately slow — see [Passwords](./passwords). SHA-256 is for
> content addressing, checksums, and building MACs.

Comparing a MAC you received against one you computed is a comparison of
secret material, so it goes through
[`constant_time_eq`](#constant-time-comparison), never `==`.

## Random bytes

```lua
local raw   = nitr.crypto.random_bytes(32)                        -- 1..=65536 bytes
local token = nitr.base64.encode(raw, { url = true })             -- URL-safe token
```

Straight from the operating system's entropy source. Use it for tokens,
session ids, nonces and generated filenames — never `math.random`, which
is a deterministic sequence from a seed and can be predicted forwards
and backwards once an attacker sees a few outputs.

`n` is bounded to `1..=65536`: large enough for any key, nonce or token,
small enough that a script cannot use it as an allocation amplifier.
Anything outside that range raises rather than being clamped, so an
off-by-one in a caller cannot quietly hand back one byte of "entropy".

> [!NOTE] `nitr.base64` is its own std feature
>
> The encode above needs `"base64"` in `[std] features`. `random_bytes`
> itself returns a **binary** Lua string — arbitrary bytes, `NUL`
> included — so encode it before it goes anywhere text is expected: a
> header, a URL, a cookie, a JSON field.

## Constant-time comparison

```lua
if nitr.crypto.constant_time_eq(provided_token, expected_token) then
    -- ok
end
```

`==` is the wrong tool for secret material: a byte-wise comparison
returns as soon as two bytes differ, so how long the answer takes leaks
how much of the secret the caller guessed.

Be precise about the mechanism, though — Lua interns short strings, so
`==` between two of them is often a pointer comparison today and the
practical leak is small. That is exactly why the habit matters rather
than the arithmetic: the moment the secret stops being a short interned
literal — read from `nitr.env`, loaded from the database, assembled at
runtime — the comparison becomes byte-wise and the leak becomes real,
without a line of your code changing. Use `constant_time_eq` for **any**
comparison of secret material: tokens, MACs, API keys, signatures.

### It hides contents, not length

`constant_time_eq` returns `false` immediately when the two strings have
different lengths. For a fixed-size token that is not a leak, because
every candidate is the same size. When the secret's length varies — or
the length is itself sensitive — compare digests instead, which are
always the same size:

```lua
if nitr.crypto.constant_time_eq(
    nitr.crypto.sha256(provided),
    nitr.crypto.sha256(expected)
) then
    -- ok
end
```

## Authenticated encryption

`seal` / `open` is XChaCha20-Poly1305: encrypted **and** tamper-evident,
producing a printable token.

```lua
local key = nitr.cfg.encryption_key        -- exactly 32 bytes, kept out of the repo

local sealed = nitr.crypto.seal(key, "sensitive data", "context")
local opened = nitr.crypto.open(key, sealed, "context")   -- nil on ANY tampering
if not opened then
    return nitr.error(400, { code = "INVALID_TOKEN" })
end
```

The key must be **exactly 32 bytes**. A shorter one raises instead of
being stretched into a key: deriving silently would hide the mistake,
and the point of the error is that whoever passed a passphrase finds out
at the call site. `nitr.crypto.random_bytes(32)` is the intended source.

`seal` generates a fresh 24-byte nonce per call and returns URL-safe
base64 of nonce-plus-ciphertext, so sealing the same plaintext twice
gives two different tokens and either one travels unescaped in a query
string, a cookie or a JSON field.

The third argument is **associated data**: not encrypted, but bound into
the authentication tag. Use it to pin a token to its context, so a token
minted for one purpose cannot be replayed as another:

```lua
local reset = nitr.crypto.seal(key, tostring(user.id), "password-reset")
-- A token sealed as "password-reset" will not open as "email-change".
```

`open` returns `nil` for a wrong key, a modified ciphertext, a truncated
token, a value that is not base64 at all, or mismatched associated data.
There is no way to get a partially-valid result: you get the plaintext
or you get nothing.

## Passwords

argon2id lives in `nitr.crypto` too, but the shape of a login is more
than a primitive, so it has its own page:
**[Passwords & Basic Auth](./passwords)**.

```lua
local hash        = nitr.crypto.password_hash(password)           -- async
local ok, problem = nitr.crypto.password_verify(pw, stored)       -- async, TWO values
local decoyed     = nitr.crypto.password_verify_dummy(pw)         -- async, always false
```

> [!WARNING] All three password calls are asynchronous
>
> Their argon2 work runs on the blocking thread pool, so they **yield**.
> Call them from a handler or a middleware — never from the **top level
> of a handler script**, which is evaluated once at startup, outside the
> async executor, where a yield fails with an explanatory error. Mint
> credentials you need at boot with `nitr hash-password` and store the
> hash instead of hashing on the way up.

Three things the old single-function habit gets wrong:

- `password_verify` returns **two** values. The second is `nil` for an
  ordinary wrong password and a string when the **stored hash** can
  never verify anything — a bcrypt row a migration left behind, a
  truncated column. Log it; dropping it turns one account into a
  permanent, unexplained "wrong password".
- `password_verify_dummy(password)` spends one argon2 hash against a
  process-private decoy and always returns `false`. It belongs on the
  **no-such-user** branch of a login: returning early there answers an
  unknown address in microseconds and a known one in ~26 ms, which turns
  the login form into a query interface over your user list.
- `nitr.crypto.max_password_bytes` is the cap (1024 bytes), published as
  data so a registration form can size its field with
  `#password > nitr.crypto.max_password_bytes` instead of copying a
  constant that will drift.

## JWT

`nitr.crypto.jwt` signs and verifies HMAC JSON Web Tokens — HS256,
HS384, HS512, and nothing else. Full treatment on **[JWT](./jwt)**.

```lua
local claims, reason = nitr.crypto.jwt.verify(token, nitr.cfg.jwt_secret, {
    algorithms = { "HS256" },        -- ← required: an allow-list, not a hint
})
if not claims then
    return nitr.error(401, { code = "INVALID_TOKEN" })
end
```

Three properties decide whether your use of it is safe:

- **`algorithms` is mandatory.** Without it the token's own header would
  choose the algorithm used to check the token, which is the classic JWT
  failure. `alg: none` is not merely rejected here — it is
  unrepresentable.
- **`verify` checks the signature, the `alg`, and `exp`/`nbf` when the
  token carries them. It checks nothing else.** Not `iss`, not `aud`,
  not `typ` — `sign` writes `typ` and `verify` never reads it. Compare
  those claims yourself, and remember `aud` may be a string _or_ an
  array.
- **A token with no `exp` never expires.** Nothing in the format
  requires the claim, so "this signature is valid" and "this token is
  still good" are different questions. If yours must expire, reject the
  ones that do not say when.

> [!TIP] Do you actually need a JWT?
>
> For your own web application a [signed-cookie
> session](./cookies-sessions#sessions) is simpler, smaller, and
> `http_only`-protected. JWTs earn their complexity when a _different_
> service has to validate the token without calling you.

## Parsing `Authorization`

```lua
local token      = nitr.auth.bearer(req)         -- "Bearer xyz" → "xyz", else nil
local user, pass = nitr.auth.basic(req)          -- credentials, or nothing at all
```

Both also accept a raw header string —
`nitr.auth.bearer("Bearer xyz")` — which is what makes the parsing easy
to exercise from a [test](./testing) without building a request.

### Basic credentials

`nitr.auth.basic` does the scheme match, the base64 decode, the UTF-8
check and the split at the first colon. It is deliberately **stricter
than RFC 7617 and fails closed**:

| `Authorization`                              | `nitr.auth.basic` returns                                  |
| -------------------------------------------- | ---------------------------------------------------------- |
| `Basic YWRhOmxvdmVsYWNl`                     | `"ada", "lovelace"`                                        |
| the same, spelled `basic` or `BASIC`         | the same — the scheme matches whole, case-insensitively    |
| the same, with extra spaces around the value | the same — the extra spaces are trimmed                    |
| a tab in place of the separating space       | nothing — at least one **space** is required; a tab is not |
| `Bearer …`, `Basicx …`                       | nothing — the scheme is never a prefix match               |
| credentials that are not UTF-8               | nothing — latin-1 credentials decode to `nil`              |
| a decoded value with no `:` in it            | nothing                                                    |

Two properties worth relying on:

- **All or nothing.** Anything unparseable reads as _no credentials_,
  never as a partial one, so `local user, pass = nitr.auth.basic(req)`
  can never hand you a user with a `nil` password.
- The username stops at the **first** colon, so a password may contain
  colons; a username may not.

The challenge header, the equal-cost login flow and the rate limit that
has to sit in front of it are on [Passwords & Basic
Auth](./passwords).

### Bearer tokens

`nitr.auth.bearer` returns the token after the scheme match, or `nil`
for anything unparseable — a missing header, the wrong scheme, or an
empty value. There is no string parsing left for you to get wrong. The
part that _is_ easy to get wrong is the comparison:

```lua
-- scripts/app.lua
local app = nitr.app()

local API_TOKEN = nitr.cfg.api_token      -- read once, at load

app:use(function(next)
    return function(req)
        local token = nitr.auth.bearer(req)
        if not token or not nitr.crypto.constant_time_eq(token, API_TOKEN) then
            -- One status, one body, for every failure: no header, wrong
            -- scheme, wrong token.
            local res = nitr.error(401, { code = "UNAUTHORIZED" })
            res.headers["WWW-Authenticate"] = 'Bearer realm="api"'
            return res
        end
        return next(req)
    end
end)

return app
```

> [!DANGER] `token == expected` is the bug this whole section exists for
>
> Use `nitr.crypto.constant_time_eq`. If the shared secret's length can
> vary, compare `sha256` digests as shown in [It hides contents, not
> length](#it-hides-contents-not-length) — `constant_time_eq` still
> returns early on a length mismatch.

Working code for the whole pattern, including why the habit is right
even when Lua's string interning would have hidden the leak:
[`examples/bearer-auth`](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/bearer-auth).

> [!NOTE] `nitr.cfg` is readable at a script's top level
>
> The configuration snapshot is attached to every state before the
> handler script is loaded, so hoisting a secret into a local — as above
> — works, and the middleware factory closes over it once instead of
> indexing `nitr.cfg` on every request.

## Managing secrets

Never in `nitr.toml`. Read them once, in `config.lua`, so a missing or
malformed one fails at **startup** rather than on the first request that
needs it:

```lua
-- scripts/config.lua
local function required(name)
    local value = nitr.env.get(name)
    if not value or value == "" then
        error(name .. " is not set")
    end
    return value
end

-- `nitr.base64.decode` answers nil plus a reason rather than raising, so
-- an unchecked call would leave `encryption_key = nil` and fail later,
-- inside a handler, as a confusing "seal/open take a 32-byte key".
local key, why = nitr.base64.decode(required("ENCRYPTION_KEY"))
if not key or #key ~= 32 then
    error("ENCRYPTION_KEY must decode to 32 bytes: " .. (why or "wrong length"))
end

return {
    jwt_secret     = required("JWT_SECRET"),
    session_secret = required("SESSION_SECRET"),
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
allow = ["JWT_SECRET", "SESSION_SECRET", "ENCRYPTION_KEY", "API_TOKEN"]
```

`[env] allow` takes exact names or prefixes ending in `_`, and `NITR_*`
internals are never visible to a script. Generate the values with:

```sh
head -c 32 /dev/urandom | base64
```

### Rotation

Rotating a signing secret invalidates every token and session signed
with the old one, all at once — which for a stateless format is the only
revocation on offer, since there is no server-side list to remove a
token from. Plan for it: either accept the mass logout at a quiet hour,
or verify against both the old and the new secret during a transition
window and sign only with the new one.

## What not to do

| ❌                                             | ✅                                             |
| ---------------------------------------------- | ---------------------------------------------- |
| `math.random` for tokens                       | `nitr.crypto.random_bytes`                     |
| `sha256(password)`                             | `nitr.crypto.password_hash`                    |
| `token == expected`                            | `nitr.crypto.constant_time_eq`                 |
| Comparing a variable-length secret directly    | compare `sha256` digests of both               |
| Hand-rolled HMAC in Lua                        | `nitr.crypto.hmac_sha256`                      |
| Signing your own cookie format                 | `res.cookies:set_signed`                       |
| A passphrase as the `seal` key                 | exactly 32 bytes, from `random_bytes(32)`      |
| Hashing a password at a script's top level     | `nitr hash-password`, or hash inside a handler |
| Dropping `password_verify`'s second value      | log it — it is the unusable-row alarm          |
| Returning early on the no-such-user branch     | `nitr.crypto.password_verify_dummy`            |
| `jwt.verify(t, k, {})` with no `algorithms`    | it is required, and that is the point          |
| Trusting `iss`/`aud`/`typ` because it verified | compare them yourself; `verify` does not       |
| Secrets in `nitr.toml`                         | `nitr.env` + `.env`, read in `config.lua`      |

## Quick reference

| Entry                                         | Description                                                                 |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| `nitr.crypto.sha256(data)`                    | SHA-256 digest, lowercase hex                                               |
| `nitr.crypto.hmac_sha256(key, data)`          | HMAC-SHA256, lowercase hex                                                  |
| `nitr.crypto.random_bytes(n)`                 | `n` random bytes from the OS (`1..=65536`)                                  |
| `nitr.crypto.constant_time_eq(a, b)`          | Timing-safe comparison; length is not hidden                                |
| `nitr.crypto.seal(key, plaintext, aad?)`      | XChaCha20-Poly1305 AEAD; 32-byte key; printable token                       |
| `nitr.crypto.open(key, sealed, aad?)`         | Opens a sealed token; `nil` on any tampering                                |
| `nitr.crypto.password_hash(password)`         | argon2id (m=19456, t=2, p=1). Raises above the cap. **Async**               |
| `nitr.crypto.password_verify(password, hash)` | `boolean, string\|nil` — the answer, plus an unusable-row reason. **Async** |
| `nitr.crypto.password_verify_dummy(password)` | One argon2 hash against a decoy; always `false`. **Async**                  |
| `nitr.crypto.max_password_bytes`              | The password cap, `1024` bytes                                              |
| `nitr.crypto.jwt.sign(claims, key, opts?)`    | Signs an HMAC JWT (`{ alg = "HS256" }`)                                     |
| `nitr.crypto.jwt.verify(token, key, opts)`    | `table\|nil, string\|nil`; `algorithms` required                            |
| `nitr.auth.basic(req)`                        | `user, pass`, or nothing at all                                             |
| `nitr.auth.bearer(req)`                       | The bearer token, or `nil`                                                  |

## Related

- [Passwords & Basic Auth](./passwords) — argon2id, the length cap, the
  two return values, and the enumeration oracle no primitive can close
  for you.
- [JWT](./jwt) — the allow-list, the claims `verify` ignores, and the
  checks you have to write.
- [Cookies & Sessions](./cookies-sessions) — signed cookies, stateless
  sessions and CSRF, all built on the primitives above.
- [TLS](./tls) — none of this helps if the credential crosses the
  network in clear text.
- [Security & the Sandbox](./security) — what the sandbox does and does
  not defend against.
- [Configuration → the `nitr.toml` file](./configuration/file) —
  `[std] features`, `[env]`, `[rate_limit]`.

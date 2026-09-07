# Passwords & Basic Auth

Storing a password, checking one, and the mistake that lives in none of
the primitives but in how they are put together.

`nitr.crypto` gives you argon2id, `nitr.auth` parses the `Authorization`
header, and `nitr hash-password` mints a credential with no server
running. The rest of `nitr.crypto` — digests, random bytes,
constant-time comparison, sealed tokens — is on
[Crypto & Auth](./crypto-auth); tokens for _other_ services are on
[JWT](./jwt).

Working code for everything below:
[`examples/basic-auth`](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/basic-auth).

## Enabling it

```toml
[std]
features = ["json", "http", "log", "crypto"]   # ← "crypto"
```

`nitr.crypto` and `nitr.auth` both arrive with it.

`nitr hash-password` needs the same thing one level down, at the Cargo
feature: `cargo install nitr-cli` builds the binary with every feature
on, but a `--no-default-features` build without `crypto` refuses the
command with an error naming what to enable.

## Hashing

`nitr.crypto.password_hash(password) -> string` returns a PHC string:

```text
$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>
```

Those are argon2id with 19 MiB of memory, two passes, one lane and a
32-byte output —
[OWASP's second recommended configuration](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
— plus a fresh 16-byte salt from the OS entropy source on every call.

There is deliberately **no parameter knob**. One configuration a
reviewer can check against a published recommendation is worth more than
a dial nobody tunes correctly. The salt and the parameters live inside
the string, so you store one column — and verification uses the
parameters recorded _in that stored hash_, so old rows keep verifying if
the default ever moves.

## These functions are asynchronous

`password_hash`, `password_verify` and `password_verify_dummy` run their
argon2 work on the blocking thread pool, not on the async worker that is
serving the request. That matters: 19 MiB and tens of milliseconds of
uninterruptible synchronous Rust on a worker thread means the executor
cannot answer _anything_ — a health probe included — while it runs.

From a handler or a middleware you call them normally. The one place the
difference shows is the handler script's **top level**, which is
evaluated once at startup, outside the async executor:

```lua
-- app.lua — does NOT work at the top level: there is no coroutine to
-- suspend into.
local users = { ada = nitr.crypto.password_hash("lovelace") }
```

Nitr explains that plainly rather than passing the VM's bare `attempt to
yield from outside a coroutine` through: the startup error says
`password_hash` is asynchronous and cannot be called there, names the
script and line, and prints the offending source line with the rest of
the diagnostic.

The fix is not to move the call — it is to not hash at boot at all. Mint
the hash ahead of time and compare against it at request time:

```lua
local users = {
    ada = "$argon2id$v=19$m=19456,t=2,p=1$...",   -- nitr hash-password
}
```

A deployment that hashes per boot is paying argon2's cost for something
a migration should have done once.

> [!NOTE] The rule is not specific to hashing
>
> Every builtin that awaits behaves this way: `nitr.fetch`, the
> `nitr.db` methods, `req:text()`, `req:json()`, `req:multipart()`. A
> coroutine your own code resumes with `coroutine.resume` or
> `coroutine.wrap` is not driven by the executor either, so the same
> error appears there.

## Minting a hash with `nitr hash-password`

```sh
$ nitr hash-password
Password:
Confirm password:
$argon2id$v=19$m=19456,t=2,p=1$m9z1df0eQ2iTUMTMdNG9Lg$orLEhw5SZE3dVnKDfo0npcOXvrw/pBGD2eHhFVLFwMo
```

Echo is off, the value is confirmed (a typo here becomes a credential
nobody can ever use, and the only symptom is a login that always fails),
the prompts go to stderr, and **only the hash goes to stdout** — so both
of these give exactly the storable string:

```sh
nitr hash-password > cred.txt
HASH=$(nitr hash-password)
```

For scripts, pipe the password in instead of being prompted:

```sh
printf %s "$NEW_PASSWORD" | nitr hash-password
```

Exactly one trailing line ending is stripped from piped input (`\n` or
`\r\n`) and nothing else — a password may legitimately end in a space or
a tab, and trimming those would mint a hash that never verifies. The
read is capped at the same 1024 bytes the server enforces, so
`nitr hash-password < /dev/zero` is a clear error rather than an OOM,
and an empty password is refused outright.

> [!WARNING] There is deliberately no `--password` flag
>
> A password in `argv` is readable by every process on the machine
> through `/proc/<pid>/cmdline`, shows up in `ps`, and is written to the
> shell history file afterwards. Let the command prompt you, or pipe
> from a variable your shell did not record.

The command hashes by calling the very same
`nitr.crypto.password_hash` a handler calls, so an operator-minted
credential can never disagree with what the running server verifies.

> [!TIP] It runs with no application and no configuration
>
> `hash-password` returns before the config file is even loaded, exactly
> like [`nitr init`](./cli#init). It is the one command an operator runs
> _before_ there is a working `nitr.toml`, and a broken one must not
> stand between them and a credential. See
> [CLI → `hash-password`](./cli#hash-password).

Store the result like any other column:

```lua
nitr.db:execute(
    "update users set password_hash = ? where email = ?",
    { hash, email }
)
```

## Verifying: two values, not one

```lua
local ok, problem = nitr.crypto.password_verify(password, stored)
```

`nitr.crypto.password_verify(password, hash) -> boolean, string|nil`
compares in constant time, using the parameters recorded in the stored
hash. The boolean is what you branch on; the second value is a
diagnostic:

| `ok`    | `problem` | Meaning                                                           |
| ------- | --------- | ----------------------------------------------------------------- |
| `true`  | `nil`     | The password matches.                                             |
| `false` | `nil`     | Ordinary wrong password. The stored hash was fine.                |
| `false` | a string  | The **stored hash** is unusable. This account can _never_ log in. |

The second row and the third look identical to a user and identical in a
naive log. They are completely different problems, and the third is the
one that wastes a day: a bcrypt row copied over during a migration fails
every login for exactly one account, forever, with the message a typo
produces.

`problem` comes from a closed set:

| Reason                         | Cause                                                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unsupported hash format`      | Not a PHC string Nitr can parse — bcrypt (`$2b$`, `$2y$`), md5crypt (`$1$`), sha512crypt (`$6$`), plaintext, an empty column.                                                         |
| `incomplete hash`              | A truncated PHC string with no salt or no output segment.                                                                                                                             |
| `unsupported hash algorithm`   | Valid PHC naming something else: `$scrypt$`, `$pbkdf2-sha256$`.                                                                                                                       |
| `hash parameters out of range` | An argon2 hash whose cost exceeds what Nitr will run: m > 256 MiB, t > 8, or p > 8. A PHC string may legally name 4 TiB, and those parameters come from the row, not from the server. |
| `unusable hash`                | Valid-looking argon2 that still cannot be used — an unknown parameter name, an unknown version, an out-of-range output length.                                                        |

Every one of them also emits a `tracing` warning naming the reason and
the hash's algorithm identifier (`2b`, `scrypt`, …) — never the hash
itself. So even a handler that drops the second value leaves a trail.

> [!WARNING] Nitr verifies argon2 only
>
> bcrypt is not "truncated at 72 bytes" here; it does not parse at all.
> If you are migrating, re-hash on the next successful login against the
> old scheme, or force a reset — and the reason above is how you find
> the rows that still need it.

## The length cap

Passwords are capped at **1024 bytes**
(`nitr.crypto.max_password_bytes`), and never truncated.

Argon2 hashes its whole input. Without a cap, a login form is a remote
amplifier: a few megabytes in a POST body buys an attacker a worker
thread pinned at 19 MiB of scratch memory plus a full pass over those
megabytes, and nothing about the request looks like an attack. The check
happens before any argon2 work, so an oversized password costs a length
comparison. 1 KiB is generous on purpose — NIST SP 800-63B asks that
verifiers accept at least 64 characters.

The two sides of the cap answer differently, on purpose:

- **`password_verify` and `password_verify_dummy` answer a plain
  `false`**, with no reason attached, because no stored hash was ever
  minted from a password that long. Your login handler needs **no length
  check at all**: an oversized POST is an ordinary `401`, not a `500`.
  (No reason, because the reason channel means "the stored row is at
  fault, log it" — and an oversized password is attacker input, so a
  reason there would turn the natural `if problem then log` handler into
  a free log-spam primitive. A `debug` trace records the length for the
  rare legitimate case.)
- **`password_hash` raises.** A credential that cannot be stored must
  fail loudly at registration, where the user is present to be told. To
  answer `400` instead of `500`, size the field first — against the cap
  Nitr publishes, never a copied constant.

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

(The schema needs `validate` in `[std] features` — see
[Validation](./validation/).)

> [!TIP] `#` counts bytes; `max_len` counts characters
>
> The cap is in bytes, and so is Lua's `#`. A `nitr.validate` schema's
> `max_len` rule counts _characters_, so `max_len = 1024` still lets a
> multi-byte passphrase past 1024 bytes reach `password_hash` and raise.
> Use a schema for the user-facing message if you like, and keep
> `#password > nitr.crypto.max_password_bytes` as the guard.

## Logging in without leaking your user list

Consider the obvious login handler:

```lua
-- WRONG. Do not copy this.
local row = nitr.db:query_row(
    "select password_hash from users where email = ?",
    { email }
)
if not row then
    return unauthorized()                     -- microseconds
end
if not nitr.crypto.password_verify(password, row.password_hash) then
    return unauthorized()                     -- ~26 ms
end
```

Every primitive in it is correct. The composition is not.

An email nobody registered is refused in microseconds; one that exists
is refused in ~26 ms, because only that branch runs argon2. A
thousandfold difference is trivially measurable over a network by a
client with no account at all, so the login form quietly becomes a query
interface over your user list: submit an address, time the `401`, learn
whether it is a customer. That is the whole attack — no credentials, no
rate-limit trigger beyond ordinary login traffic, and nothing in the
logs that looks different from a failed login.

The fix is to spend the same work on both branches:

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
        -- No such user. Hash anyway, against a decoy, so this branch
        -- costs what the other one costs.
        ok = nitr.crypto.password_verify_dummy(password)
    end

    if problem then
        -- Not the client's business: "your hash is the wrong format" is
        -- a fact about the database, not about whoever is knocking.
        nitr.log.error("a stored credential cannot be verified", {
            email   = email,
            problem = problem,
        })
    end
    return ok
end
```

`nitr.crypto.password_verify_dummy(password) -> boolean` hashes the
submitted password against a decoy built once per process from 32 bytes
of OS entropy, and always returns `false`. It hashes the _submitted_
password rather than a fixed placeholder because argon2's cost grows
with the input — hashing anything else would leave a smaller version of
the same difference behind. Nothing that never leaves the process can be
guessed, so it is structurally incapable of returning `true`.

The decoy is built lazily, so the first unknown-user request in a
process pays for two hashes instead of one. That is one sample of noise,
not an oracle.

Three things it does not fix, and none of them is Nitr's to fix:

- **The response body must match too.** "No such user" and "wrong
  password" have to be the same `401` with the same body, or the timing
  work was pointless.
- **Registration and password reset leak the same fact** if they answer
  "that address is already taken". Same care, same answer.
- **The decoy costs Nitr's own parameters** (m=19456, t=2, p=1). If your
  stored hashes were minted elsewhere with heavier ones, the known-user
  path costs more than the decoy path and a smaller version of the gap
  comes back. Re-hash on next login, or keep stored parameters at Nitr's
  defaults.

### Rate limiting is required here, not suggested

The equal-cost fix has a price, and it is paid somewhere else: because
**both** branches now cost one argon2 (~19 MiB, ~26 ms), every request
an account-less client sends buys that much of your server. The 1 KiB
input cap bounds one request's cost; nothing in the crypto primitives
bounds the request _rate_.

Unthrottled, a single anonymous client keeps every pooled Lua state busy
hashing for accounts that do not exist — real logins queue behind it and
are shed with a `503` past `pool_wait_ms` — and the same stream is a
credential brute-force.

```toml
[rate_limit]
enabled  = true
requests = 100
window   = 60
```

That is per client IP and per fixed window, answering `429` with
`Retry-After` beyond the budget. Behind a proxy, set
`trust_forwarded_for = true` so the key is the real client rather than
the proxy — and only there. See
[Configuration → \[rate_limit\]](./configuration/file#rate-limit).

It belongs in front of registration too, which reaches `password_hash`
with no credentials at all.

## HTTP Basic authentication

```lua
local user, pass = nitr.auth.basic(req)
```

`nitr.auth.basic(req) -> string|nil, string|nil` does the scheme match,
the base64 decode, the UTF-8 check and the split at the first colon.
There is no string parsing left for you to get wrong — and the parser is
stricter than RFC 7617 and fails closed.

### What the parser accepts

| `Authorization` header                       | `nitr.auth.basic` returns                                  |
| -------------------------------------------- | ---------------------------------------------------------- |
| `Basic YWRhOmxvdmVsYWNl`                     | `"ada", "lovelace"`                                        |
| the same, spelled `basic` or `BASIC`         | the same — the scheme is matched whole, case-insensitively |
| the same, with extra spaces around the value | the same — the extra spaces are trimmed away               |
| the same, with a tab in place of the space   | nothing — a tab is not a separator; only a space is        |
| `Basicx …`, `Bearer …`                       | nothing — the scheme is never a prefix match               |
| credentials that are not UTF-8               | nothing — latin-1 credentials decode to `nil`              |
| a decoded value with no `:` in it            | nothing                                                    |
| two `Authorization` headers                  | never reaches Lua: the request is refused with a `400`     |

Two properties worth relying on:

- **All or nothing.** Anything unparseable reads as _no credentials_,
  never as a partial one, so `local user, pass = nitr.auth.basic(req)`
  can never hand you a user with a `nil` password. This is
  property-tested and fuzzed over arbitrary header bytes.
- **The credentials really are the header's own base64.** The username
  stops at the _first_ colon, so a password may contain colons; a
  username may not.

The duplicate-header case is decided before Lua runs, in Rust: the Lua
header table keeps one value per name, so a handler would see one
credential while a proxy in front may have authenticated on the other.
Refusal is the only answer that cannot diverge from what the proxy saw.

> [!TIP] It also takes a raw header string
>
> `nitr.auth.basic("Basic YWRhOmxvdmVsYWNl")` works, which is what makes
> the parsing easy to exercise from a [test](./testing) without building
> a request.

### The challenge

A `401` with no `WWW-Authenticate` is a bespoke `401`, not Basic auth:
the header is what tells the client which scheme and realm to answer
with.

```lua
local function challenge(status, body)
    local res = nitr.json(body, status)
    res.headers["WWW-Authenticate"] = 'Basic realm="example", charset="UTF-8"'
    return res
end
```

### A route guard

Wrap the handlers that must not forget the check, and pass the
authenticated user in as an argument:

```lua
local function require_login(handler)
    return function(req)
        local user, pass = nitr.auth.basic(req)
        local ok = false
        if user then
            -- The equal-cost function above; here the user name is the
            -- email it looks up.
            ok = authenticate(user, pass)
        end
        if not ok then
            -- Every failure answers the same 401 with the same body.
            -- "unknown user", "wrong password" and "absurdly long
            -- password" are the same thing to the client, in the body
            -- *and* in the time it took.
            nitr.log.warn("login failed", { path = req.path })
            return challenge(401, { error = "unauthorized" })
        end
        return handler(req, user)
    end
end

app:get(
    "/private",
    require_login(function(req, user)
        return nitr.json({ user = user, secret = "the pool is warm" })
    end)
)
```

A plain wrapper rather than a [middleware](./middleware) factory, because
the authenticated user has to reach the handler somehow and `req` is
Rust-side userdata with read-only fields — there is nowhere on it to
stash application state. Middleware is the right shape when the check
grants no identity, such as a single shared API key.

> [!DANGER] Basic auth is base64, not encryption
>
> The credentials travel in every request, recoverable by anyone on the
> path. Serve it over [TLS](./tls), or behind a proxy that terminates
> TLS. If the login leads to a session cookie, the `[cookies] secure`
> policy decides whether that cookie is marked Secure — see
> [Cookies & Sessions](./cookies-sessions).

## What not to do

| ❌                                          | ✅                                                 |
| ------------------------------------------- | -------------------------------------------------- |
| `sha256(password)`                          | `nitr.crypto.password_hash`                        |
| `stored == computed`                        | `password_verify` (constant-time, inside)          |
| Hashing at the top level of `app.lua`       | `nitr hash-password`, or hash inside a handler     |
| Returning early when the user is unknown    | `nitr.crypto.password_verify_dummy` on that branch |
| Different `401` bodies for the two failures | one status, one body, one cost                     |
| Dropping `password_verify`'s second value   | log it — it is the unusable-row alarm              |
| A copied `1024` in the handler              | `nitr.crypto.max_password_bytes`                   |
| A password on the command line              | the prompt, or a pipe from a variable              |
| A login route with no `[rate_limit]`        | `enabled = true`, on login _and_ registration      |
| Basic auth over plain HTTP                  | TLS, always                                        |

## Checklist

- Hashes come from `nitr.crypto.password_hash` or `nitr hash-password`
  — never from a plaintext column "just for now".
- Nothing hashes at the top level of a script.
- The no-such-user branch calls `nitr.crypto.password_verify_dummy`.
- Every authentication failure answers the same status and body.
- Registration checks `#password` against
  `nitr.crypto.max_password_bytes` before hashing.
- The second return value of `password_verify` is logged, not dropped.
- `401` responses carry `WWW-Authenticate: Basic realm="…"`.
- Credentials only travel over TLS.
- `[rate_limit] enabled = true` is on in front of the login route, and
  in front of registration.

## Quick reference

| Entry                                         | Description                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------- |
| `nitr.crypto.password_hash(password)`         | argon2id hash for storage (m=19456, t=2, p=1). Raises above the cap. Async.     |
| `nitr.crypto.password_verify(password, hash)` | `boolean, string\|nil` — the answer, plus why a stored hash is unusable. Async. |
| `nitr.crypto.password_verify_dummy(password)` | Spends one argon2 hash against a process-private decoy; always `false`. Async.  |
| `nitr.crypto.max_password_bytes`              | The cap, `1024` bytes.                                                          |
| `nitr.auth.basic(req)`                        | `user, pass`, or nothing at all.                                                |
| `nitr.auth.bearer(req)`                       | The bearer token, or `nil`. Compare with `constant_time_eq`.                    |

## Related

- [Crypto & Auth](./crypto-auth) — the other primitives: digests,
  random bytes, constant-time comparison, sealed tokens.
- [JWT](./jwt) — when a _different_ service must validate the credential
  without calling you.
- [Cookies & Sessions](./cookies-sessions) — where a login usually ends
  up once the password check has passed.
- [CLI → `hash-password`](./cli#hash-password) — the command's own
  reference.
- [Configuration → the `nitr.toml` file](./configuration/file) —
  `[rate_limit]`, `[std] features`.
- [Security & the Sandbox](./security) — what the sandbox does and does
  not defend against.

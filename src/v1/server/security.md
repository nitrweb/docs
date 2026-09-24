# Security & the Sandbox

Nitr assumes your Lua code may be **buggy, not hostile**, and the
sandbox is built so that most hostile scripts fail anyway. Most
protections are on by default. A few depend on your configuration, and
the [production checklist](#a-production-checklist) lists them.

## What is protected by default

### The Lua sandbox

| Risk                     | What Nitr does                                                                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Infinite loops, slow I/O | Every request has an execution budget (`[lua] exec_timeout_ms`, 30 s). `pcall`, `xpcall` and `coroutine.resume` cannot catch and ignore it.                                  |
| Memory exhaustion        | Each Lua state has a memory limit (`[lua] memory_limit`, 8 MiB). A state that hits it is thrown away and rebuilt.                                                            |
| File and process access  | `io`, `os`, `dofile`, `loadfile` and `collectgarbage` are not available. Native modules can never be loaded. `require` only loads files from the handler script's directory. |
| Hand-crafted bytecode    | All code is compiled from source text. `load` only accepts text and `string.dump` is removed.                                                                                |
| Writing files            | The only write is `part:save` for uploads, confined to `[multipart] upload_dir`. See [below](#uploads-are-the-one-thing-lua-can-write).                                      |
| Leaks between states     | Pooled states share no Lua values. The shared cache and `nitr.cfg` hold plain data only.                                                                                     |
| Runaway data structures  | Converting a Lua value to JSON, a session, a cache entry, a template context and so on stops at 128 levels deep and 1,000,000 nodes, with a normal Lua error.                |
| Crashes                  | A panic fails only the current request. A damaged state is replaced, never reused.                                                                                           |

### Requests, responses and outbound calls

| Risk                         | What Nitr does                                                                                                                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Oversized requests           | URI, header, body, form and file sizes and the connection count are capped in Rust before Lua runs (`[limits]`). The body is counted as it arrives, not trusted from `Content-Length`.                                 |
| Unchecked or extra input     | A route's [`input`](./validation/route-input) is checked in Rust first. Undeclared fields are removed, and a failure is a `422` the handler never sees. A misspelt rule is a load-time error.                          |
| Disguised uploads            | A `file` rule detects the type from the bytes, not the declared `Content-Type`. Executables are refused unless `allow_executables` is set. `max_pixels` limits decompression bombs.                                    |
| Path traversal               | Static files and upload paths are resolved and checked to stay inside their root, symlinks included.                                                                                                                   |
| Files served by accident     | Static mounts hide `.`-prefixed paths (`.env`, `.git/`), except `.well-known/`.                                                                                                                                        |
| SSRF through `nitr.fetch`    | Private, loopback, link-local and other internal addresses are refused, including IPv6 forms that embed an IPv4 address. The check happens when the name is resolved and again on every redirect.                      |
| Header and log injection     | Cookie names and values must be valid, so request data cannot add attributes to `Set-Cookie`. SSE data is split on every line break. `nitr.log` escapes control characters.                                            |
| Forged cookies and tokens    | Signed cookies and sessions use HMAC-SHA256 with constant-time checks. A session's `max_age` is enforced from inside the signed data. JWT verification requires an algorithm allow-list and never accepts `alg: none`. |
| Cross-site request forgery   | The CSRF middleware refuses an unsafe request a browser marks `Sec-Fetch-Site: cross-site` before it compares tokens.                                                                                                  |
| Cookies read by scripts      | Session and CSRF cookies are always `HttpOnly` and default to `SameSite=Lax`. `Secure` follows [`[cookies] secure`](./cookies-sessions#secure-comes-from-configuration).                                               |
| Password hashing as a DoS    | Passwords over 1 KiB are refused before hashing, and a stored hash with an excessive cost is refused. Hashing runs off the request threads, so `/healthz` keeps answering.                                             |
| Traffic sent to a dying node | `/readyz` reports `503` as soon as a shutdown starts, and handlers cannot change it.                                                                                                                                   |

### Unsafe configuration refuses to start

- `[cors] origins = ["*"]` together with `credentials = true`.
- A `[static] dir` that contains the scripts or the templates.
- A `[multipart] upload_dir` inside the handler script's directory,
  `[templating] dir` or `[testing] dir`. Inside `[static] dir` it only
  warns, since serving uploads back can be intended.
- A `[fetch]` proxy without `allowed_hosts` or
  `allow_private_networks = true`, because a proxy bypasses the address
  check.
- `"debug"` in `[lua] stdlib`.

Nitr also **warns** at startup when cookies will not be `Secure` and
when the `[tls] key` file is readable by other users.

## What it does not defend against

- **Rust extension modules.** Code added with `ServerBuilder::module` is
  not sandboxed; it is part of your process.
- **OS-level exhaustion** such as file descriptors, disk space and
  kernel memory. Run Nitr under a supervisor with OS limits, like the
  [systemd unit](./deployment/systemd).
- **What you enable or configure.** Adding `io` or `os` to
  `[lua] stdlib` gives scripts full file and process access. Routes,
  mounts and fetch targets are trusted configuration:
  `app:static("/", "/")` serves your whole filesystem.
- **Timing leaks in your own logic**, such as a login that only hashes
  when the user exists. See
  [The timing branch in a login](#the-timing-branch-in-a-login).
- **Distributed denial of service.** The rate limiter counts per client
  (IPv4 by address, IPv6 by /64). Many addresses, or many users behind
  one NAT, are bounded only by the connection and pool limits.
- **Bugs in Lua 5.4 or mlua.** The sandbox reduces what a script can
  reach; it does not patch the VM.
- **Certificates and client identity.** `[tls]` does not obtain or renew
  certificates, and there is no client-certificate (mTLS)
  authentication.

## Known weaknesses

- **The rate limiter uses fixed windows**, so a burst across a window
  boundary can briefly reach twice the limit.
- **Sessions cannot be revoked early.** They expire at `max_age`;
  rotating the secret ends all of them at once. See
  [Sessions](./cookies-sessions#what-a-stateless-session-means).
- **There is no metrics endpoint.** Abuse shows up in the logs only.
- **Health probes skip request checks.** On the main listener,
  `/healthz` and `/readyz` bypass rate limiting and the URI length cap,
  so a probe URL may carry a long query string. Use `[health] bind` to
  move them to their own listener, or `[health] enabled = false`.
- **The separate probe listener is plaintext**, even with `[tls]` on.
- **A reload does not re-read `nitr.toml`.** Limits, rate limits, CORS
  and other settings change only on restart. See
  [Zero-downtime reload](./deployment/#zero-downtime-reload).
- **A published OpenAPI document maps your API** for anyone probing it.
  That is why `[openapi]` and `[swagger]` are off by default; see
  [Should `/docs` be public?](./openapi/swagger-ui#should-docs-be-public).
- **Response schemas are not enforced.** Test what your handlers return.

## The sandbox settings

```toml
[lua]
stdlib = ["math", "table", "string", "utf8", "coroutine", "package"]
memory_limit = 8388608          # bytes, per state
exec_timeout_ms = 30000         # 0 disables the execution budget
```

> [!DANGER] Adding `io` or `os` turns off file and process protection
>
> `os` brings `os.execute` and `os.remove`; `io` brings file access and
> restores `dofile`/`loadfile`. Nothing in `nitr.*` needs them:
> `nitr.time` covers dates, `nitr.env` covers environment variables.

> [!WARNING] `exec_timeout_ms = 0` removes the loop protection
>
> One infinite loop then holds a Lua state forever, and a few of them
> stop the server.

`"debug"` cannot be enabled: it is refused at startup because
`debug.sethook` would disable the execution budget.

## Uploads are the one thing Lua can write

```toml
[multipart]
upload_dir = "/var/lib/myapp/uploads"
```

- Paths given to `part:save` are **relative to that directory**.
  Absolute paths and paths that climb out with `..` are refused.
- Without `upload_dir`, `part:save` is unavailable.
- The directory must exist and be writable at startup.
- It may not sit inside the scripts, templates or tests directory (an
  uploaded `.lua` file or template could then be run).

Build the file name from `part.safe_filename`, never the raw
`part.filename`. `part:save(part.safe_filename)` is safe on its own. See
[Requests](./requests#part-filename-and-part-safe-filename).

## Authentication pitfalls

Each primitive is safe on its own. These are the ways they go wrong
when combined.

### The timing branch in a login

If you only hash when the user exists, an unknown email answers in
microseconds and a known one in about 26 ms. Anyone can measure that
and learn which accounts exist. Call
`nitr.crypto.password_verify_dummy` in the no-such-user branch so both
branches cost the same:

```lua
local row = nitr.db:query_row(
    "select password_hash from users where email = ?", { email })
local ok, problem
if row then
    ok, problem = nitr.crypto.password_verify(pass, row.password_hash)
else
    ok = nitr.crypto.password_verify_dummy(pass) -- always false
end

if not ok then
    -- `problem` means the stored hash is unusable, not a wrong password.
    if problem then
        nitr.log.error("a stored credential cannot be verified", {
            email = email, problem = problem,
        })
    end
    return unauthorized() -- the same answer either way
end
```

> [!WARNING] Rate-limit every route that hashes passwords
>
> Each attempt now costs one argon2 hash (about 19 MiB and 26 ms). Turn
> on `[rate_limit]` for login and registration.

More in [Passwords](./passwords#logging-in-without-leaking-your-user-list).

### Comparing secrets

Compare tokens with `nitr.crypto.constant_time_eq`, never `==`:

```lua
local token = nitr.auth.bearer(req)
if not token or not nitr.crypto.constant_time_eq(token, SECRET) then
    return challenge()
end
```

`constant_time_eq` does not hide the length. If the secret's length can
vary, compare `nitr.crypto.sha256(token)` with
`nitr.crypto.sha256(secret)` instead.

### JWT checks the signature, not your policy

`nitr.crypto.jwt.verify` checks the signature, the `alg` against your
allow-list, and `exp`/`nbf` **only when present**. It never checks
`iss`, `aud` or `typ`, and a token with no `exp` never expires. Check
those claims yourself; see [JWT](./jwt#verifying).

## Fuzzing

The parsers that read untrusted input (cookies, headers, ranges,
multipart bodies, JSON, paths, JWTs, validators, the upload type
detector and TLS PEM files) are fuzzed with
[cargo-fuzz](https://github.com/rust-fuzz/cargo-fuzz) on every pull
request and nightly. The targets check behaviour, such as "a served
path is always inside its mount", not just the absence of crashes. Run
them with `make fuzz` in the Nitr repository.

## A production checklist

### Configuration

- [ ] `dev_mode = false`. Dev mode shows file paths and tracebacks to
      clients. `nitr build` forces it off.
- [ ] `[lua] stdlib` without `io` or `os`, and `exec_timeout_ms` not
      `0`.
- [ ] `[limits] max_body_bytes` sized for what you accept.
- [ ] `[rate_limit] enabled = true`, especially for login and
      registration.
- [ ] `trust_request_id` and `[rate_limit] trust_forwarded_for` on
      **only** behind a proxy you control.
- [ ] `[cors] origins` listed explicitly.
- [ ] `[fetch] allowed_hosts` set when a URL can come from user input.
- [ ] `[static] dir` holding public files only, with `dotfiles` off
      and no backups or exports inside.
- [ ] `[std] features` listing only the builtins you use.
- [ ] `[openapi]` and `[swagger]` enabled only if you want the API map
      public. `NITR_OPENAPI_ENABLED=false` turns it off in production.

### Transport

- [ ] TLS terminated by Nitr ([TLS](./tls)) or by a
      [proxy in front](./deployment/#terminating-at-a-proxy-in-front).
- [ ] No startup warning about the `Secure` attribute. Behind a proxy,
      that means `[cookies] secure = "always"`.
- [ ] The TLS key file at mode `0600`, and never inside a `nitr build`
      artifact or an image layer.
- [ ] `Strict-Transport-Security` sent by a handler or the proxy. There
      is no `[tls] hsts` setting; see [TLS](./tls#hsts).

### Secrets

- [ ] Not in `nitr.toml`. Read them in `config.lua` with `nitr.env`, so
      a missing one fails at startup.
- [ ] `[env] allow` limited to the names you need.
- [ ] Generated randomly, for example `head -c 32 /dev/urandom | base64`.

### Application code

- [ ] SQL always uses bound parameters, never string concatenation.
- [ ] Every body, query string and path parameter declared in a route
      [`input`](./validation/route-input).
- [ ] Upload rules list the accepted types, keep `allow_executables`
      off and set `max_pixels` for images.
- [ ] Upload names built from `part.safe_filename` or generated.
- [ ] Your own cookies set with `http_only`, and request data in a
      cookie value base64-encoded.
- [ ] `nitr.session` given a `max_age`.
- [ ] Secrets compared with `nitr.crypto.constant_time_eq`.
- [ ] Passwords hashed with `nitr.crypto.password_hash` (or
      `nitr hash-password`), and the no-such-user login branch calling
      `password_verify_dummy`, with the same answer for every failure.
- [ ] `nitr.crypto.jwt.verify` given `algorithms`, with `iss`, `aud`
      and `exp` checked by you.
- [ ] [CSRF middleware](./cookies-sessions#csrf-protection) on
      cookie-authenticated forms.
- [ ] `| safe` in templates only for markup you generated, and no HTML
      template with a plain-text extension (`.txt.j2`, `.md.j2`), which
      turns auto-escaping off.
- [ ] `on_error` returning a fixed shape, never `err.message`.

### Operations

- [ ] Health probes on a separate `[health] bind` if the main listener
      is public.
- [ ] `[log] format = "json"`, shipped somewhere, with alerts on `5xx`
      and `503`.
- [ ] systemd hardening or a read-only container; see
      [Deployment](./deployment/).
- [ ] Certificate renewal followed by `nitr reload` or `kill -HUP`.

## Reporting a vulnerability

Open a [private security
advisory](https://github.com/nitrweb/nitr/security/advisories/new)
rather than a public issue. See [Report Security
Issues](../report-security-issues) for what makes a report actionable.

# Security & the Sandbox

Nitr's pitch is _semi-trusted logic with explicit boundaries_:
application Lua is assumed to be **buggy, not hostile** — but the
sandbox is built so that most classes of hostile script fail anyway.

This page states where those boundaries actually are. The honest version
is more useful than a reassuring one.

## What the sandbox defends against

| Threat                                                   | Defense                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CPU exhaustion** (`while true do end`)                 | A per-request execution budget enforced by an instruction-count hook installed globally on the state — user coroutines inherit it — plus an async timeout for slow I/O. Both cover Lua execution and awaited I/O only: a long _synchronous_ Rust call made on a script's behalf executes no Lua instruction and never yields, so those calls carry their own bounds instead — argon2's cost parameters are capped before any hashing starts, and the serializer pre-walk is bounded by node count as well as depth.                                                                             |
| **Memory exhaustion**                                    | A per-state Lua memory limit (8 MiB by default). A state that hits it is poisoned, dropped and rebuilt; it never serves another request.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Filesystem / process access from Lua**                 | `io` and `os` are excluded from the stdlib by default, and `dofile`/`loadfile` are removed with them — they gate the same ambient authority. Nothing in `nitr.*` needs either: `nitr.time` covers dates, `nitr.path` is lexical only. Native modules cannot be loaded in _any_ configuration — `package.loadlib` is removed and `package.cpath` emptied in every state that has `package` at all — and `require`'s search path is pinned to the handler script's directory. `collectgarbage` is removed too: it is a heap oracle, and the memory limit is the allocator's, not the collector's. |
| **A filesystem _write_ from Lua**                        | There is exactly one, `part:save(path)` for multipart uploads, and it is confined to `[multipart] upload_dir`. Unset, `part:save` is unavailable rather than unconstrained. See [Uploads are the one thing Lua can write](#uploads-are-the-one-thing-lua-can-write).                                                                                                                                                                                                                                                                                                                            |
| **Request-smuggling-sized inputs**                       | Rust-enforced limits _before_ Lua runs: URI, headers, body (counted as it arrives, not trusted from `Content-Length`), form parts, field and file sizes, connection cap, per-IP rate limit.                                                                                                                                                                                                                                                                                                                                                                                                     |
| **SSRF from `nitr.fetch`**                               | Private, loopback, link-local and CGNAT ranges refused by default. The filtering happens **inside the resolver the connector uses**, so DNS rebinding does not bypass it; every redirect hop is re-checked; a per-request outbound budget caps the blast radius.                                                                                                                                                                                                                                                                                                                                |
| **Path traversal out of static mounts and upload roots** | Percent-decode → component whitelist → canonicalize-prefix check, symlinks included. Uploads run the same lexical rule against `[multipart] upload_dir` — one shared implementation, not two that drift — differing only where they must: no percent-decoding (a Lua string is not a URL), and the _parent_ is canonicalized because the target file does not exist yet. `nitr.path.normalize` cannot be climbed with `..`. All three are fuzzed.                                                                                                                                               |
| **Cross-state data leakage**                             | Pooled states share nothing Lua-visible. The shared cache and the config snapshot carry plain serialized data only — never live Lua values.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Serializer blow-ups from script-built values**         | One guard ahead of every Lua-value-to-serializer site (`nitr.json`, JSON responses, cache, sessions, JWT claims, SSE data, `nitr.etag`, error bodies, `fetch` bodies, template contexts, log fields): at most 128 levels deep and 1,000,000 node visits. Depth stops a stack overflow; the node budget stops a shared-subtree DAG that is shallow but exponential to walk, which neither execution budget could interrupt. Both are ordinary catchable Lua errors.                                                                                                                              |
| **Forged cookies, sessions and tokens**                  | HMAC-SHA256 signatures with constant-time verification, and the cookie name bound into the MAC. JWT verification requires an explicit algorithm allow-list and structurally cannot accept `alg: none`.                                                                                                                                                                                                                                                                                                                                                                                          |
| **Cookies read by page scripts, or sent in the clear**   | `HttpOnly` and `SameSite=Lax` are defaults on the session and CSRF cookies, and a caller's options table **extends** them rather than replacing them — `http_only` cannot be un-set. `Secure` follows [`[cookies] secure`](./cookies-sessions#secure-comes-from-configuration) for every cookie Nitr builds, and a configuration resolving to _not_ secure warns at startup. A handler that writes the `Set-Cookie` header itself bypasses all of it.                                                                                                                                           |
| **Traffic readable or modifiable on the wire**           | `[tls]` terminates TLS in this process — rustls over the `ring` provider, TLS 1.2 as the floor, ALPN pinned to what the server speaks — or a proxy terminates it in front. See [TLS](./tls).                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Password hashing turned into a CPU/memory amplifier**  | Argon2 hashes its whole input, so `password_hash`/`password_verify` cap the password at 1 KiB _before_ any work, and refuse a **stored** hash whose recorded cost exceeds 256 MiB / t=8 / p=8 — those parameters come from the row, not from the server. All three argon2 entry points offload to the blocking pool, so the executor keeps answering (`/healthz` included) while every pooled state hashes.                                                                                                                                                                                     |
| **A stored credential that can never verify**            | `password_verify` returns a reason alongside the boolean and logs a warning naming it, so a bcrypt row left behind by a migration is diagnosable instead of an unexplained permanent "wrong password".                                                                                                                                                                                                                                                                                                                                                                                          |
| **A wedged or draining instance receiving traffic**      | Rust-owned `/readyz` flips _before_ requests can fail. An application cannot report itself healthy through a broken handler.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Damaged states after a panic or memory hit**           | Per-request `catch_unwind`. Poisoned states are recycled, not reused. This catches _panics_ — an **abort** is not a panic and is not contained by it, which is why a stack overflow has to be prevented (the serializer bounds above) rather than caught.                                                                                                                                                                                                                                                                                                                                       |

## What it does not defend against

Stated plainly, because a boundary you do not know about is not a
boundary.

- **A malicious Rust extension module.** `ServerBuilder::module` code is
  unsandboxed by design — it _is_ your process. The sandbox is for Lua.
- **OS-level resource exhaustion**: file descriptors, disk space, kernel
  memory. Run Nitr under a supervisor with OS limits — see the
  [systemd unit](./deployment/systemd) for hardened settings.
- **Side channels between states** — timing, cache effects, and
  inference from shared-cache hit patterns.
- **A handler that leaks through its own control flow.** The primitives
  are constant-time; a login that only calls `password_verify` when the
  user exists still answers an unknown account a thousand times faster
  than a known one, and that gap _is_ your user list. Nitr supplies the
  equal-cost branch; calling it is the application's job. See
  [The timing branch in a login](#the-timing-branch-in-a-login).
- **A Lua VM escape** through a vulnerability in Lua 5.4 or mlua. The
  sandbox narrows the attack surface (no `io`/`os` by default, no native
  loading in any configuration); it does not patch the VM.
- **What `[lua] stdlib` re-enables.** It is an operator escape hatch:
  `"io"` and `"os"` restore ambient filesystem and process access, and
  `"io"` additionally restores `dofile`/`loadfile`. Enabling either
  forfeits the _filesystem / process access_ row above.
- **Which directory a script mounts.** The traversal defenses bound
  requests _within_ a mount; nothing bounds the mount itself.
  `app:static("/", "/")` serves the filesystem. Route patterns,
  `nitr.fetch` targets and `ServerBuilder::module` are the same kind of
  authority: configuration written by the application is trusted, and is
  not part of the sandbox.
- **Denial of service by a legitimate key.** The rate limiter is
  per-client-IP and fixed-window; a distributed attacker, or one behind
  a shared NAT, is bounded only by the connection and pool limits.
- **Certificate lifecycle.** `[tls]` terminates TLS; it does not obtain,
  renew or rotate anything. Protecting the key file stays the operator's
  job — though on Unix a key readable beyond its owner (mode bits
  `0o077`) warns at startup and boots anyway, because a security check
  whose failure mode is "the deployment does not come up" gets disabled.
  In memory, the key PEM buffer and the CLI's password buffers are wiped
  on drop; the DER copy rustls keeps for the life of the acceptor, and
  any password that reached the Lua heap, are **not** wipeable. That
  narrows the window in which a core dump yields a secret; it does not
  close it.
- **Client authentication.** The handshake is server-authenticated only.
  There is no mTLS, so "who is connecting" remains an application
  question.

## Known weaknesses

Tracked deliberately rather than glossed over:

- **The rate limiter is a fixed window**, so bursts straddling a window
  boundary can briefly reach twice the intended rate. A sliding-window
  revisit is parked, not forgotten.
- **Sessions cannot be invalidated server-side** before their cookie
  expires. That is the documented cost of stateless sessions; rotating
  the secret invalidates everything at once. See
  [Sessions](./cookies-sessions#what-a-stateless-session-means).
- **There is no metrics endpoint yet**, so abuse is visible in logs but
  not on a dashboard.
- **Probes on the main listener are unmetered, by design.** With
  `[health]` on the main listener (the default), `/healthz` and
  `/readyz` are answered before anything request-shaped happens — no
  rate limiting, no URI cap, no request id, no pool checkout — because a
  liveness check that queued behind a saturated pool would cause the
  restart it exists to prevent. The exemption is exact-path and
  `GET`/`HEAD` only, but it compares only the _path_: a probe URL can
  carry an arbitrarily long query string (bounded only by
  `[limits] max_header_bytes`) past the URI cap. `[rate_limit]` is off
  by default, so under stock defaults nothing that was on is bypassed —
  this matters exactly to the operator who enabled rate limiting and
  reasonably assumed it covered every path. `[health] enabled = false`
  removes the paths; `[health] bind` moves them to a separate,
  connection-capped listener.
- **A `SIGHUP` reload refreshes the Lua pool and the TLS material, and
  deliberately nothing else.** `nitr.toml` is never re-read, so every
  compiled policy — limits, rate limit, CORS, compression, cache
  capacity, listen address, worker count — keeps its boot-time value
  until a restart.
- **The `[health] bind` probe listener is plaintext, even under
  `[tls]`.** A separate probe bind is normally loopback or
  cluster-internal, and a prober that must complete a TLS handshake is a
  prober that fails during exactly the certificate trouble liveness has
  to survive. The port serves nothing but the two fixed probe paths, and
  the startup line says `plaintext` rather than implying it. An operator
  who cannot accept a cleartext probe port sets `[health] enabled =
false` and probes the main listener over TLS.

## The sandbox settings

```toml
[lua]
stdlib = ["math", "table", "string", "utf8", "coroutine", "package"]
memory_limit = 8388608          # bytes, per state
exec_timeout_ms = 30000         # 0 disables the execution budget
```

> [!DANGER] Adding `io` or `os` is a deliberate reduction of the sandbox
>
> With `os` come `os.execute`, `os.remove` and `os.getenv`. With `io`
> comes arbitrary file access — and `dofile`/`loadfile` come back with
> it, which read and execute any file the process can reach. Nothing in
> `nitr.*` needs either: `nitr.time` covers dates and clocks, `nitr.env`
> covers (filtered, read-only) environment access. If you add them, you
> have decided that your Lua is fully trusted.

> [!NOTE] `"debug"` is refused at startup, not merely discouraged
>
> The Lua state is built with mlua's safe constructor, which cannot load
> the debug library at all. Nitr rejects the name where the libraries
> are mapped, with an error that says so, rather than letting mlua fail
> the boot with a message about an internal Rust constructor. The reason
> it stays refused is the CPU budget: `debug.sethook` would replace the
> instruction-count hook that stops CPU-bound loops.

> [!WARNING] `exec_timeout_ms = 0` removes the CPU-exhaustion defense
>
> A single infinite loop then holds one of your `workers` states
> forever, and enough of them stop the server entirely.

## Uploads are the one thing Lua can write

`part:save(path)` is the only filesystem write a script can reach, and
it is contained by configuration rather than by convention:

```toml
[multipart]
upload_dir = "/var/lib/myapp/uploads"
```

- Paths passed to `part:save` are **relative to that root**. Absolute
  paths, and anything climbing out with `..`, are **refused rather than
  re-rooted** — where a file lands always follows from the source.
- **Unset, `part:save` is unavailable.** There is no safe directory to
  guess, the same call `[templating] dir` makes.
- The directory must exist and be writable at startup; Nitr write-probes
  it rather than discovering the problem on the first upload.

> [!DANGER] An upload root inside the script directory refuses to boot
>
> `require`'s search path is pinned to the handler script's directory,
> so an uploaded `.lua` file sitting there would be a loadable module —
> the upload-to-RCE chain written in configuration. Nitr refuses to
> start on that combination. An upload root inside `[static] dir` only
> **warns**, since serving uploads back is a real choice — just one to
> make deliberately.

Build the destination from `part.safe_filename`, not `part.filename`.
The raw field is exactly what the client sent; `safe_filename` is that
name reduced to something that can only ever name a file directly inside
the root — no separators, no control characters, no leading or trailing
dots, never empty. `part:save(part.safe_filename)` is safe on its own,
which makes the upload root a backstop rather than the only defense.
Full rules and the worked example are in
[Requests](./requests#part-filename-and-part-safe-filename).

## Authentication has edges the sandbox cannot round off

Every primitive below is correct in isolation. What goes wrong is how
they are put together, which is why they are named here rather than left
to the API reference.

### The timing branch in a login

Looking a user up and only hashing when the row exists answers an
unknown address in microseconds and a known one in ~26 ms. That
thousandfold gap is measurable over a network by a client with no
account, so the login form becomes a query interface over your user
list.

`nitr.crypto.password_verify_dummy(password)` is the equal-cost branch:
it spends one argon2 hash against a process-private decoy and always
returns `false`.

```lua
local row = nitr.db:query_row(
    "select password_hash from users where email = ?", { email })
local ok, problem
if row then
    ok, problem = nitr.crypto.password_verify(pass, row.password_hash)
else
    -- No such user. Hash anyway, so this branch costs what the other
    -- one costs.
    ok = nitr.crypto.password_verify_dummy(pass)
end

if not ok then
    -- A non-nil `problem` means the *stored* hash is unusable, not that
    -- the password was wrong. Log it; answer the same 401 either way.
    if problem then
        nitr.log.error("a stored credential cannot be verified", {
            email = email, problem = problem,
        })
    end
    return unauthorized()
end
```

> [!WARNING] The equal-cost branch has to be paid for with a rate limit
>
> Both branches now cost one argon2 (~19 MiB, ~26 ms), so every request
> an account-less client sends buys that much of your server. Nothing in
> the crypto primitives bounds the request _rate_. `[rate_limit]` is
> **required**, not suggested, in front of any route that reaches
> argon2 — login, dummy-verify, and registration's `password_hash`
> alike.

The whole story, including the two leaks this does not fix, is in
[Passwords](./passwords#logging-in-without-leaking-your-user-list).

### Comparing a bearer token

`nitr.auth.bearer(req)` returns the token, or `nil` for anything
unparseable. Compare it with `nitr.crypto.constant_time_eq`, never with
`==`:

```lua
local token = nitr.auth.bearer(req)
if not token or not nitr.crypto.constant_time_eq(token, SECRET) then
    return challenge()
end
```

`==` on two short interned Lua strings is a pointer compare, so the
practical leak today is small — the reason to use `constant_time_eq`
anyway is that the shape stays correct when the token stops being a
short literal (read from a file, concatenated, crossing FFI), and a
reader copying the file copies the safe version.

> [!TIP] A variable-length secret is compared as a digest
>
> `constant_time_eq` returns early on a length mismatch: length is not
> hidden. When the secret's length can vary, compare
> `nitr.crypto.sha256(token)` against `nitr.crypto.sha256(secret)`
> instead, so both sides are always the same size.

### JWT verifies a signature, not a policy

`nitr.crypto.jwt.verify` checks the signature, the header's `alg`
against the allow-list you pass, and `exp`/`nbf` **when the token
carries them**. It checks nothing else:

| Claim            | Status                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| `iss` (issuer)   | **Never read.** A token from any issuer verifies.                                                  |
| `aud` (audience) | **Never read.** A token minted for another audience verifies. `aud` may be a string _or_ an array. |
| `typ` (header)   | Written by `sign`, never verified.                                                                 |
| `exp` / `nbf`    | Checked **only if present**. A token with neither never expires.                                   |

So "this signature is valid" and "this token is still good" are
different questions, and the second one is yours. See
[JWT](./jwt#verifying).

## Fuzzing

The parsers an attacker fully controls are fuzzed with
[cargo-fuzz](https://github.com/rust-fuzz/cargo-fuzz): signed cookies
and the `Cookie` header, `Accept` and `Accept-Encoding` negotiation,
conditional-request headers, `Range` headers, multipart bodies, the
JSON–Lua boundary and its depth guard, lexical paths, static path
resolution and upload path resolution (the traversal defenses), URL and
query splitting, JWT verification, Basic credentials, the declarative
validators, and the TLS certificate/key PEM the server loads at startup
from whatever an ACME client or a mounted secret wrote — sixteen targets
in all.

What makes them worth trusting is what they assert. Targets check
**behavior**, not merely the absence of crashes: round-trips,
idempotence, tamper rejection, and the bounds a caller depends on — a
served static path is always inside its mount, an accepted byte range
always lies inside the representation.

```sh
make fuzz               # every target, bounded time, seeded like CI
make fuzz FUZZ_TIME=300 # longer
```

Every pull request runs 90 seconds per target; a nightly job runs an
hour per target, which is where the depth actually comes from. Seeds are
committed under
[`fuzz/seeds`](https://github.com/nitrweb/nitr/tree/master/fuzz/seeds).

> [!NOTE] Fuzzing is not part of `make all`
>
> It needs a nightly toolchain and `cargo install cargo-fuzz`, so
> `make all` (lint plus test) stays runnable on the stable toolchain
> everything else uses.

## Terminating TLS

Nitr can terminate TLS in-process, and it is equally correct to let
something in front do it. Pick one deliberately; the two arrangements
need different configuration.

### In this process, with `[tls]`

```toml
listen = "0.0.0.0:443"

[tls]
enabled = true
cert = "/etc/nitr/tls/fullchain.pem"
key = "/etc/nitr/tls/privkey.pem"
```

rustls over the `ring` provider, TLS 1.2 as the floor (1.0 and 1.1
cannot be selected under any spelling — RFC 8996), ALPN pinned to what
the server actually speaks. Both files are read **at startup**, so a
half-configured or mismatched pair refuses to boot instead of failing
every handshake on a port traffic already points at. A renewed
certificate takes effect on `SIGHUP` (or `nitr reload`), and swaps in
only when the new pair validates.

This is the right shape when Nitr is the edge: a single binary on a VM
or a small box, no proxy you would otherwise have to run, operate and
patch. The full section reference, the renewal recipe and the HSTS and
redirect patterns are in [TLS](./tls).

> [!WARNING] `enabled = true` converts the listener, it does not add one
>
> The address in `listen` speaks HTTPS and nothing anywhere answers
> plaintext. There is no dual-listener mode and nothing redirects for
> you, so a deployment moved from `:80` to `:443` silently breaks every
> client, bookmark and health check that still says `http://`.

### At a proxy in front

```toml
listen = "127.0.0.1:3000"

[cookies]
secure = "always"
```

Let nginx, Caddy, HAProxy or your cloud load balancer own certificates,
renewal and protocol configuration, and bind Nitr to a private address.
That is one fewer thing in the process that runs your application code,
and it is the right shape when the proxy already exists — for
termination, for routing across several services, or because certificate
automation lives there.

Two settings replace `[tls]` in that arrangement:

- `[cookies] secure = "always"`. The `"auto"` default follows
  `[tls] enabled`, which is exactly what a terminating proxy makes
  wrong. Nothing here can detect that proxy, so Nitr warns at startup
  instead of guessing — [that warning is the
  check](./tls#when-not-to-use-it).
- `[rate_limit] trust_forwarded_for = true`, but **only** if the proxy
  overwrites `X-Forwarded-For` rather than appending to whatever the
  client sent.

HSTS, in this arrangement, belongs to the proxy.

## A production checklist

### Configuration

- [ ] `dev_mode = false` — it leaks source paths, line numbers and
      tracebacks to anyone who can cause an error. `nitr build` forces
      it off.
- [ ] `[lua] stdlib` without `io` or `os`. (`"debug"` cannot be there —
      it is refused at startup.)
- [ ] `[lua] exec_timeout_ms` and `memory_limit` left at sane values.
- [ ] `[limits] max_body_bytes` sized for what you actually accept.
- [ ] `[rate_limit] enabled = true`, and specifically in front of every
      route that reaches argon2: login, dummy-verify and registration.
- [ ] `trust_request_id` and `[rate_limit] trust_forwarded_for` on
      **only** behind a proxy that sanitizes those headers.
- [ ] `[cors] origins` explicit — never `["*"]` together with
      `credentials` (the server refuses to start on that combination
      anyway).
- [ ] `[fetch] allowed_hosts` set when any URL derives from user input.
- [ ] `[multipart] upload_dir` outside the handler script's directory
      (Nitr refuses to boot otherwise) and outside `[static] dir` unless
      serving uploads back is the intent.
- [ ] `[std] features` listing only what you use — a builtin you do not
      enable is one a compromised script cannot reach.

### Transport

- [ ] TLS terminated somewhere: `[tls] enabled = true` here, or a proxy
      in front. Credentials over plain HTTP are credentials in public.
- [ ] `[cookies] secure` resolving to Secure — `"auto"` when `[tls]` is
      on in this process, `"always"` when a proxy terminates in front.
      The startup warning is the check; do not silence it by reasoning.
- [ ] `[tls] min_version` at `"1.2"` or raised to `"1.3"`, and the key
      file mode `0600` (Nitr warns and boots anyway).
- [ ] `Strict-Transport-Security` emitted by a handler, or by the proxy
      — there is deliberately no `[tls] hsts` key, because a `max-age`
      mistake is cached by browsers and cannot be retracted.
- [ ] The plaintext port closed, or answering a redirect instance whose
      target host comes from configuration and **never** from the
      request's `Host` header.

### Secrets

- [ ] Not in `nitr.toml`, which is the file you commit.
- [ ] Read once in `config.lua` via `nitr.env`, so a missing one fails
      at startup.
- [ ] `[env] allow` scoped to the names your application needs.
- [ ] Generated from a CSPRNG (`head -c 32 /dev/urandom | base64`).
- [ ] The TLS private key left outside any `nitr build` artifact — its
      path is deliberately not re-anchored, because a key inside a
      copyable one-file bundle leaks with it.

### Application code

- [ ] All SQL parameterised — never string concatenation.
- [ ] Every request body [validated](./validation); `check` strips
      undeclared fields, which is what prevents mass assignment.
- [ ] `res.cookies:set` given `http_only` explicitly — only the session
      and CSRF cookies carry it by default.
- [ ] Secret comparisons via `nitr.crypto.constant_time_eq`, never `==`
      — bearer tokens included, and a variable-length secret compared as
      a digest.
- [ ] Passwords through `nitr.crypto.password_hash` (or minted with
      `nitr hash-password`), never a bare hash.
- [ ] The no-such-user branch of a login calling
      `nitr.crypto.password_verify_dummy`, and every failure answering
      the same status and body.
- [ ] `nitr.crypto.jwt.verify` always given an `algorithms` allow-list,
      with `iss`, `aud` and `typ` compared by you and `exp` required —
      a token without one never expires.
- [ ] [CSRF middleware](./cookies-sessions#csrf-protection) on
      cookie-authenticated form endpoints.
- [ ] `| safe` in templates used only for markup you generated.
- [ ] Upload destinations built from `part.safe_filename`, or from
      generated names — never from the raw `part.filename`.
- [ ] `on_error` returning a stable shape, never `err.message`.

### Operations

- [ ] The static directory contains no `.env`, `.git` or backups — it is
      all public.
- [ ] Health probes on a separate `[health] bind` if the main listener
      is public, remembering that the probe listener is plaintext by
      design.
- [ ] `[log] format = "json"`, shipped somewhere, with alerts on `5xx`
      and `pool_checkout` sheds.
- [ ] systemd hardening or a container with a read-only filesystem — see
      [Deployment](./deployment/).
- [ ] Certificate renewal signalling the process (`nitr reload` or
      `kill -HUP`) after replacing both files.

## Reporting a vulnerability

Open a [private security
advisory](https://github.com/nitrweb/nitr/security/advisories/new)
rather than a public issue. See [Report Security
Issues](../report-security-issues) for what makes a report actionable.

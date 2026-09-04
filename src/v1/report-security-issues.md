# Report Security Issues

## How to report

Please **do not open a public issue** for a security vulnerability.

Open a [private security
advisory](https://github.com/nitrweb/nitr/security/advisories/new) on
the repository instead. That gives us a private channel to confirm the
issue, prepare a fix and coordinate disclosure.

## What makes a report actionable

- **Which boundary it crosses.** Nitr's [threat
  model](./server/security#what-it-does-not-defend-against) is explicit
  about what the sandbox does and does not defend against — a report on
  the far side of a documented boundary (a malicious Rust extension
  module, for example) is a design question rather than a vulnerability.
- **A reproducer.** The smallest `nitr.toml` plus Lua script that shows
  the behaviour. `nitr check --print-config` output helps whenever
  configuration layering is involved, since it prints the values that
  actually won.
- **The version and how it was built.** `nitr --version`, plus whether
  it came from `cargo install nitr-cli`, a clone, or a distro package,
  and which Cargo features were enabled — `tls`, `crypto`, `multipart`
  and `fetch` each add surface a minimal build does not have.
- **The structured log line**, if the issue produces one — `[log] format
= "json"` gives fields rather than prose.

## In scope

Anything that breaks a boundary the [security page](./server/security)
claims.

### The Lua sandbox

- Escaping it: filesystem, process or network access that the configured
  policy should have denied — including loading a native module, which
  is meant to be impossible in _any_ configuration, or `require`
  reaching outside the handler script's directory it is pinned to.
- Bypassing the per-request execution budget or the per-state memory
  limit.
- Data leaking between pooled Lua states.
- A Lua value reaching a recursive serializer past the depth and node
  guards. Depth stops a stack overflow, which is an **abort**, not a
  panic — the per-request `catch_unwind` cannot contain it, so the guard
  ahead of the serializer is the whole defense.
- A request that can crash the process rather than being contained at
  the request boundary.

A `kind = "panic"` error is always worth reporting, even when it looks
harmless: panic containment is a last-resort safety net for genuine
bugs, not something an application should be able to trigger.

### Requests, paths and uploads

- Path traversal out of a static mount or out of `nitr.path.normalize`.
- An upload landing outside `[multipart] upload_dir`: `part:save`
  honouring an absolute path, climbing out with `..`, or following a
  symlinked parent out of the root. Absolute and climbing paths are
  meant to be **refused, not re-rooted**.
- `part.safe_filename` returning something that is not a plain file
  name — a path separator, a control character, or an empty string.
- An `upload_dir` inside the `require` directory that boots. That
  combination makes an uploaded `.lua` a loadable module, so it is
  supposed to be a startup refusal.
- SSRF past the `nitr.fetch` policy, including via DNS rebinding or a
  redirect hop.
- A limit that is configured but not enforced: URI, header, body
  (counted as it arrives, never trusted from `Content-Length`),
  multipart part/field/file sizes, the connection cap.

### Cookies, tokens and credentials

- Forging a signed cookie, session or JWT; a verifier accepting an
  algorithm outside the caller's allow-list, or `alg: none` under any
  spelling.
- Timing oracles in verification — the primitives are meant to be
  constant-time.
- A cookie Nitr builds shipping **without** `Secure` when
  `[cookies] secure` resolves to secure, or without `HttpOnly`, which a
  caller's option table is not allowed to un-set.
- `nitr.auth.basic` returning a _partial_ credential from an unparseable
  header instead of none at all.
- Argon2 accepting a password past `nitr.crypto.max_password_bytes`, or
  a stored hash whose recorded cost parameters exceed the ceiling the
  verifier applies to them — those parameters come from the row, not
  from the server.

### TLS

`[tls]` arrived in `0.0.0-beta.3`, and the whole path is in scope:

- The certificate and key PEM the server reads **at startup, and again
  on every reload**, from whatever an ACME client or a mounted secret
  wrote: a crash, a hang, or a mismatched pair that is accepted instead
  of refused — including a half-written pair a `SIGHUP` picks up
  mid-renewal. That file is what the `tls-pem` fuzz target drives, so an
  input which defeats it is exactly the kind of report we want.
- A handshake that escapes its `handshake_ms` deadline, or one that can
  stall the accept loop rather than costing the single connection it
  runs in.
- Negotiating below the configured `min_version`, or reaching TLS
  1.0/1.1, which no spelling is supposed to select (RFC 8996).
- A `SIGHUP` reload installing a certificate/key pair that does **not**
  validate, instead of keeping the old material and warning.
- The key PEM buffer, or a CLI password buffer, surviving a drop that is
  supposed to wipe it.

> [!NOTE] Already documented, so not a finding
>
> The DER copy rustls retains for the life of the acceptor, and any
> password that reached the Lua heap, are **not** wipeable — the
> zeroizing narrows the window in which a core dump yields a secret, it
> does not close it. There is no mTLS: the handshake is
> server-authenticated only. And `[tls]` terminates TLS; it does not
> obtain, renew or rotate anything.

## Out of scope

### Documented boundaries

Design decisions written down in the [threat
model](./server/security#what-it-does-not-defend-against), not bugs:

- **A malicious Rust extension module.** `ServerBuilder::module` code is
  unsandboxed by design — it is your process. The boundary is for Lua.
- **Which directory a script mounts.** The traversal defenses bound
  requests _within_ a mount; nothing bounds the mount itself.
  `app:static("/", "/")` serves the filesystem. Route patterns,
  `nitr.fetch` targets and `ServerBuilder::module` are the same kind of
  authority: configuration written by the application is trusted, and is
  not part of the sandbox.
- **What `[lua] stdlib` re-enables.** `"io"` and `"os"` restore ambient
  filesystem and process access, and `"io"` additionally restores
  `dofile`/`loadfile`. Enabling either forfeits the sandbox's
  filesystem row on purpose.
- **A handler that leaks through its own control flow.** A login that
  calls `password_verify` only when the user exists still answers an
  unknown account far faster than a known one, and that gap is the user
  list. `nitr.crypto.password_verify_dummy` exists for the equal-cost
  branch, but calling it is the application's job — see
  [Passwords](./server/passwords).
- **A Lua VM escape** through a vulnerability in Lua 5.4 or mlua. Report
  those upstream; we pick up the fix. The sandbox narrows the attack
  surface; it does not patch the VM.
- **OS-level resource exhaustion**: file descriptors, disk space,
  kernel memory. Run Nitr under a supervisor with OS limits — the
  [systemd unit](./server/deployment/systemd) is hardened for exactly
  this.
- **Side channels between states** (timing, cache effects) and inference
  from shared-cache hit patterns.

### Denial of service within the configured limits

That is what `[limits]` and `[rate_limit]` are for — tune them. Worth
knowing before writing the report: `[rate_limit]` is **off by default**,
so "an anonymous client can hammer this route" describes a
configuration, not a defect. It is also per-client-IP and fixed-window,
so a distributed attacker, or one behind a shared NAT, is bounded only
by the connection and pool limits.

### The known weaknesses Nitr writes down rather than hides

See [Known weaknesses](./server/security#known-weaknesses) for the full
list with its reasoning — the fixed-window rate limiter's boundary
burst, the inability to invalidate a stateless session server-side, the
absence of a metrics endpoint, the deliberately unmetered probe paths on
the main listener, a `SIGHUP` reload that refreshes the Lua pool and the
TLS material and nothing else, and the plaintext `[health] bind` probe
listener even under `[tls]`.

If you think one of them is worse than the page claims, that _is_ worth
a report — say which part of the reasoning does not hold.

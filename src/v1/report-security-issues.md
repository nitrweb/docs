# Report Security Issues

## How to report

Please **do not open a public issue** for a security vulnerability.

Open a [private security
advisory](https://github.com/nitrweb/nitr/security/advisories/new) on
the repository instead. That lets us confirm the issue, prepare a fix
and coordinate disclosure in private.

## What to include

- **Which boundary it breaks.** Check it against [what the sandbox does
  not defend against](./server/security#what-it-does-not-defend-against).
  A report about something outside a documented boundary (a malicious
  Rust extension module, for example) is a design question, not a
  vulnerability.
- **A reproducer.** The smallest `nitr.toml` and Lua script that show
  the problem. Include `nitr check --print-config` output when
  configuration is involved.
- **The version and build.** `nitr --version`, how you installed it
  (`cargo install`, a clone, a package), and which Cargo features were
  enabled.
- **The log line**, if there is one. `[log] format = "json"` gives
  structured fields.

## In scope

Anything that breaks a promise made on the [security
page](./server/security), for example:

### The Lua sandbox

- Filesystem, process or network access the configuration should deny,
  loading a native module, or `require` reaching outside the scripts
  directory.
- Getting around the per-request time limit or the per-state memory
  limit.
- Data leaking between Lua states.
- A request that crashes the whole process instead of failing on its
  own. Any error with `kind = "panic"` is worth reporting.

### Requests, paths and uploads

- Path traversal out of a static mount or out of `nitr.path.normalize`.
- An upload saved outside `[multipart] upload_dir`, or
  `part.safe_filename` returning something other than a plain file name.
- SSRF past the `nitr.fetch` policy, including through DNS rebinding or
  a redirect.
- A configured limit (URI, headers, body, multipart sizes, connections)
  that is not enforced.

### Cookies, tokens and credentials

- Forging a signed cookie, session or JWT, or a JWT verifier accepting
  an algorithm outside the allow-list, including `alg: none`.
- Timing differences in verification functions that are meant to be
  constant-time.
- A cookie Nitr builds missing `Secure` when `[cookies] secure` says it
  should have it, or missing `HttpOnly`.
- Argon2 accepting a password longer than
  `nitr.crypto.max_password_bytes`.

### TLS

- A certificate or key file that crashes or hangs the server, or a
  mismatched pair that is accepted, at startup or on reload.
- A handshake that outlives `[tls] handshake_ms` or blocks other
  connections.
- Negotiating below `min_version`, or TLS 1.0/1.1 at all.

## Out of scope

These are documented design decisions, not bugs. See [What it does not
defend against](./server/security#what-it-does-not-defend-against):

- **Rust extension modules.** Code mounted with `ServerBuilder::module`
  runs unsandboxed; it is your process.
- **What the application configures.** `app:static("/", "/")` serves
  the whole filesystem, and enabling `"io"` or `"os"` in `[lua] stdlib`
  gives scripts filesystem and process access. Configuration is trusted.
- **Timing leaks in your own code.** A login that skips password
  checking for unknown users reveals which users exist; use
  `nitr.crypto.password_verify_dummy`. See [Passwords](./server/passwords).
- **Bugs in Lua 5.4 or mlua.** Report those upstream; we pick up the
  fix.
- **OS-level exhaustion** (file descriptors, disk, kernel memory). Use
  OS limits, as the [systemd unit](./server/deployment/systemd) does.
- **Side channels between states**, such as timing or shared-cache
  effects.
- **Denial of service within the configured limits.** Tune `[limits]`
  and `[rate_limit]`. Note that `[rate_limit]` is off by default.
- **The [known weaknesses](./server/security#known-weaknesses)** listed
  on the security page. If you think one is worse than the page says,
  that _is_ worth a report.

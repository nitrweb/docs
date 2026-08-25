# Security & the Sandbox

Nitr's pitch is _semi-trusted logic with explicit boundaries_:
application Lua is assumed to be **buggy, not hostile** — but the
sandbox is built so that most classes of hostile script fail anyway.

This page states where those boundaries actually are. The honest version
is more useful than a reassuring one.

## What the sandbox defends against

| Threat                                              | Defense                                                                                                                                                                                                                                                          |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CPU exhaustion** (`while true do end`)            | A per-request execution budget enforced by an instruction-count hook installed globally on the state — user coroutines inherit it — plus an async timeout for slow I/O.                                                                                          |
| **Memory exhaustion**                               | A per-state Lua memory limit (8 MiB by default). A state that hits it is poisoned, dropped and rebuilt; it never serves another request.                                                                                                                         |
| **Filesystem / process access from Lua**            | `io` and `os` are excluded from the stdlib by default, and nothing in `nitr.*` needs them (`nitr.time` covers dates, `nitr.path` is lexical only). Native Lua modules cannot be loaded, and `require` is confined to the handler script's directory.             |
| **Request-smuggling-sized inputs**                  | Rust-enforced limits _before_ Lua runs: URI, headers, body (counted as it arrives, not trusted from `Content-Length`), form parts, field and file sizes, connection cap, per-IP rate limit.                                                                      |
| **SSRF from `nitr.fetch`**                          | Private, loopback, link-local and CGNAT ranges refused by default. The filtering happens **inside the resolver the connector uses**, so DNS rebinding does not bypass it; every redirect hop is re-checked; a per-request outbound budget caps the blast radius. |
| **Path traversal out of static mounts**             | Percent-decode → component whitelist → canonicalize-prefix check, symlinks included. `nitr.path.normalize` cannot be climbed with `..`. Both are fuzzed.                                                                                                         |
| **Cross-state data leakage**                        | Pooled states share nothing Lua-visible. The shared cache and the config snapshot carry plain serialized data only — never live Lua values.                                                                                                                      |
| **Forged cookies, sessions and tokens**             | HMAC-SHA256 signatures with constant-time verification, and the cookie name bound into the MAC. JWT verification requires an explicit algorithm allow-list and structurally cannot accept `alg: none`.                                                           |
| **A wedged or draining instance receiving traffic** | Rust-owned `/readyz` flips _before_ requests can fail. An application cannot report itself healthy through a broken handler.                                                                                                                                     |
| **Damaged states after a panic or memory hit**      | Per-request `catch_unwind`. Poisoned states are recycled, not reused.                                                                                                                                                                                            |

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
- **A Lua VM escape** through a vulnerability in Lua 5.4 or mlua. The
  sandbox narrows the attack surface (no `io`/`os`, no native loading);
  it does not patch the VM.
- **Denial of service by a legitimate key.** The rate limiter is
  per-client-IP and fixed-window; a distributed attacker, or one behind
  a shared NAT, is bounded only by the connection and pool limits.

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
> comes arbitrary file access. Nothing in `nitr.*` needs either —
> `nitr.time` covers dates and clocks, `nitr.env` covers (filtered,
> read-only) environment access. If you add them, you have decided that
> your Lua is fully trusted.

> [!WARNING] `exec_timeout_ms = 0` removes the CPU-exhaustion defense
>
> A single infinite loop then holds one of your `workers` states
> forever, and enough of them stop the server entirely.

## A production checklist

### Configuration

- [ ] `dev_mode = false` — it leaks source paths, line numbers and
      tracebacks to anyone who can cause an error. `nitr build` forces
      it off.
- [ ] `[lua] exec_timeout_ms` and `memory_limit` left at sane values.
- [ ] `[limits] max_body_bytes` sized for what you actually accept.
- [ ] `[rate_limit] enabled = true`, especially in front of login and
      password-hashing endpoints.
- [ ] `trust_request_id` and `[rate_limit] trust_forwarded_for` on
      **only** behind a proxy that sanitizes those headers.
- [ ] `[cors] origins` explicit — never `["*"]` together with
      `credentials` (the server refuses to start on that combination
      anyway).
- [ ] `[fetch] allowed_hosts` set when any URL derives from user input.
- [ ] `[std] features` listing only what you use — a builtin you do not
      enable is one a compromised script cannot reach.

### Secrets

- [ ] Not in `nitr.toml`, which is the file you commit.
- [ ] Read once in `config.lua` via `nitr.env`, so a missing one fails
      at startup.
- [ ] `[env] allow` scoped to the names your application needs.
- [ ] Generated from a CSPRNG (`head -c 32 /dev/urandom | base64`).

### Application code

- [ ] All SQL parameterised — never string concatenation.
- [ ] Every request body [validated](./validation); `check` strips
      undeclared fields, which is what prevents mass assignment.
- [ ] Cookies `http_only`, `secure`, `same_site` set explicitly.
- [ ] Secret comparisons via `nitr.crypto.constant_time_eq`.
- [ ] Passwords through `nitr.crypto.password_hash`, never a bare hash.
- [ ] `nitr.crypto.jwt.verify` always given an `algorithms` allow-list.
- [ ] [CSRF middleware](./cookies-sessions#csrf-protection) on
      cookie-authenticated form endpoints.
- [ ] `| safe` in templates used only for markup you generated.
- [ ] Upload filenames run through `nitr.path.basename`, or replaced
      with generated ones.
- [ ] `on_error` returning a stable shape, never `err.message`.

### Operations

- [ ] The static directory contains no `.env`, `.git` or backups — it is
      all public.
- [ ] TLS terminated in front of Nitr (a proxy, a load balancer). Nitr
      does not terminate TLS itself.
- [ ] Health probes on a separate `[health] bind` if the main listener
      is public.
- [ ] `[log] format = "json"`, shipped somewhere, with alerts on `5xx`
      and `pool_checkout` sheds.
- [ ] systemd hardening or a container with a read-only filesystem — see
      [Deployment](./deployment/).

## TLS

Nitr does not terminate TLS. Put a reverse proxy or a load balancer in
front of it — nginx, Caddy, HAProxy, or your cloud provider's — and let
it own certificates, renewal and protocol configuration. That is one
fewer thing in the process that runs your application code.

Behind such a proxy, remember to bind Nitr to a private address:

```toml
listen = "127.0.0.1:3000"
```

## Reporting a vulnerability

Open a [private security
advisory](https://github.com/joseluisq/nitr/security/advisories/new)
rather than a public issue. See [Report Security
Issues](../report-security-issues) for what makes a report actionable.

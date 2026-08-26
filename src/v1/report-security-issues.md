# Report Security Issues

## How to report

Please **do not open a public issue** for a security vulnerability.

Open a [private security
advisory](https://github.com/nitrweb/nitr/security/advisories/new) on
the repository instead. That gives us a private channel to confirm the
issue, prepare a fix and coordinate disclosure.

## What makes a report actionable

- **What the boundary is.** Nitr's [threat
  model](./server/security#what-the-sandbox-does-not-defend-against) is
  explicit about what the sandbox does and does not defend against — a
  report that crosses a documented boundary (a malicious Rust extension
  module, for example) is a design question rather than a vulnerability.
- **A reproducer.** The smallest `nitr.toml` + Lua script that shows the
  behaviour. `nitr check --print-config` output helps when configuration
  layering is involved.
- **The version and how it was built.** `nitr --version`, plus whether
  it came from `cargo install`, a clone, or a distro package, and which
  Cargo features were enabled.
- **The structured log line**, if the issue produces one — `[log] format
= "json"` gives fields rather than prose.

## In scope

Anything that breaks a boundary the [security
page](./server/security) claims:

- escaping the Lua sandbox — filesystem, process or network access that
  the configured policy should have denied;
- bypassing the execution budget or the per-state memory limit;
- SSRF past the `nitr.fetch` policy, including via DNS rebinding or a
  redirect hop;
- path traversal out of a static mount or out of `nitr.path.normalize`;
- forging a signed cookie, session or JWT; timing oracles in
  verification;
- data leaking between pooled Lua states;
- a request that can crash the process rather than being contained at
  the request boundary.

A `kind = "panic"` error is always worth reporting, even when it looks
harmless: panic containment is a last-resort safety net for genuine
bugs, not something an application should be able to trigger.

## Out of scope

- Denial of service by a legitimate client within the configured limits
  — that is what `[limits]` and `[rate_limit]` are for. Tune them.
- The known-weaker items Nitr documents rather than hides: the
  fixed-window rate limiter's boundary burst, the inability to invalidate
  a stateless session server-side, and the absence of a metrics
  endpoint. See [Known weaknesses](./server/security#known-weaknesses).
- Vulnerabilities in Lua 5.4 or mlua themselves — report those upstream;
  we will pick up the fix.

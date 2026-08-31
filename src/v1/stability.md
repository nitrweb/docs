# Stability & Versioning

What Nitr promises about each of its surfaces, from strongest to
weakest. One version number covers the whole workspace; the `nitr.*` Lua
API does not get its own — instead the table below states how each
surface is allowed to change.

> [!WARNING] Pre-1.0
>
> Nitr is at `0.0.0-beta.3`. While the version is `0.x`, **a minor bump
> may break anything below**. The rules on this page describe the
> _shape_ of the promise that hardens at 1.0, so you can tell which
> parts are meant to be depended on and which are meant to move.

## The promise per surface

| Surface                                    | Promise                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The `nitr.*` Lua API**                   | The strongest promise: this is what users depend on most and can least easily migrate. Breaking changes need a major version and a migration note in the changelog. The [API reference](./api/) is the authoritative inventory — a test fails if a registered entry is undocumented, so the promised surface is always enumerable. `nitr.ext.*` is reserved for user modules and will never be occupied by a builtin. |
| **`nitr.toml`**                            | Unknown keys are rejected at startup, so a removed key is a loud error, never silence. A renamed key ships with the old name still accepted (and warned about) for one minor cycle before removal.                                                                                                                                                                                                                    |
| **The `nitr` crate (facade)**              | Standard semver. This is the supported Rust entry point for applications and embedders.                                                                                                                                                                                                                                                                                                                               |
| **`nitr-core` / `nitr-std` / `nitr-http`** | Published and usable directly, but **explicitly unstable pre-1.0**: they move as fast as the phases need. Depend on the `nitr` facade unless you are writing an extension crate. The [extension contract](./library/extension-modules) (`ServerBuilder::module`, `nitr_table`, `mount`, `ModuleFn`) is the part expected to settle first.                                                                             |
| **`nitr-cli` flags and output**            | Flags follow the `nitr.toml` policy — deprecate for one minor cycle, then remove. Human-readable _output text_ is not an API; `[log] format = "json"` and process exit codes are.                                                                                                                                                                                                                                     |
| **Generated type definitions**             | `resources/nitr-types.lua` is regenerated from the API description each release. It versions with the crate and carries no independent promise of its own.                                                                                                                                                                                                                                                            |

## Deprecation policy

Deprecations warn for **one minor version** before removal, and the
warning names the replacement (`use nitr.time.format instead of ...`).
Removals and renames are recorded in `CHANGELOG.md` starting with the
first release.

## Breaking changes before the first release

`CHANGELOG.md` starts at the first release, so until then the breaking
changes to the `nitr.*` Lua API are recorded here. Each one names what
broke, what you see when you hit it, and what to write instead.

### The three argon2 entry points are asynchronous

**What changed.** `nitr.crypto.password_hash`, `password_verify` and
`password_verify_dummy` run their hashing on the blocking thread pool
instead of inline, so all three are now asynchronous Lua functions.

**Why.** Argon2 is ~19 MiB and tens of milliseconds of uninterruptible
synchronous Rust. Run inline it holds a Tokio _worker_ for its whole
duration — neither the instruction hook nor the async timeout can
interrupt it, because no Lua executes and nothing yields — so a handful
of concurrent logins could stop the server answering anything at all,
health probes included.

**What breaks.** Nothing in a handler or a middleware: the call site is
unchanged. The one shape that stops working is calling them from a
script's **top level**, which runs once at startup, outside the async
executor:

```lua
-- No longer works: evaluated at load time, nothing to suspend into.
local users = { ada = nitr.crypto.password_hash("lovelace") }
```

**What you see.** Not the VM's `attempt to yield from outside a
coroutine`, which names neither the call nor the fix, but:

```text
script error: `password_hash` is asynchronous and cannot be called here.
A script's top level runs once at startup, outside the async executor, …
Call it from inside a handler or a middleware instead. … `nitr
hash-password` mints a password hash to paste into a table, for instance
  --> app.lua:3
```

**What to write instead.** Store a hash rather than computing one at
boot — which is what a deployment should do anyway, since hashing per
start burns argon2 for something a migration does once:

```sh
printf %s "$PASSWORD" | nitr hash-password
```

```lua
local users = { ada = "$argon2id$v=19$m=19456,t=2,p=1$..." }
```

The same explanation covers every asynchronous builtin — `nitr.fetch`,
the `nitr.db` methods, the request-body readers — because it lives in
error classification rather than in any one of them. Those were always
asynchronous; the argon2 change is simply what made an author likely to
meet the rule. See [Passwords](./server/passwords).

### Cookies Nitr builds carry `Secure` on a TLS server

**What changed.** `[cookies] secure` (default `"auto"`) decides the
attribute for the session and CSRF cookies and for `res.cookies:set` /
`:set_signed`. `"auto"` follows `[tls] enabled`.

**What breaks.** A cookie that previously shipped without `Secure` on a
TLS-terminating server now carries it, which browsers will not return
over plain `http`. An explicit `secure` in the caller's own options
table still wins in both directions, so a script that set it sees no
change.

**Behind a proxy.** `"auto"` cannot see a terminating proxy in front of
a loopback bind, so a configuration resolving to _not_ secure warns at
boot and names the lever: `[cookies] secure = "always"`. See [Cookies &
sessions](./server/cookies-sessions).

### `nitr.csrf`'s `cookie_opts` extends the defaults instead of replacing them

**What changed.** A partial `cookie_opts` used to _replace_ the module
defaults, so `cookie_opts = { path = "/admin" }` silently issued the
token cookie with no `HttpOnly` and no `SameSite`. It now merges,
matching what `nitr.session` always did, and `http_only` can no longer
be un-set.

**What breaks.** Only a caller who was relying on the attributes being
dropped. `same_site` stays overridable, because a legitimate cross-site
form needs `None`.

### Database errors no longer contain the statement

**What changed.** A failing query's error is now
`execute failed (stmt a1b2c3d4): no such table: users` — the statement
text is gone, replaced by a per-process correlator that groups repeated
failures of the same query.

**What breaks.** A handler that parsed the SQL back out of an error
message (via `nitr.errinfo` or `on_error`) no longer can. That was the
point: the message reaches the operator's log, and statements embed
secrets.

## Minimum supported Rust version

The MSRV is declared as `rust-version` in the workspace manifest and
checked by a pinned CI matrix entry. **Bumping the MSRV is a minor
change, not a breaking one**, and is called out in the changelog.

The current MSRV is **1.88.0**.

## Publishing order

The five crates version together and publish in dependency order:

```text
nitr-core → nitr-std → nitr-http → nitr → nitr-cli
```

## What is deliberately not promised

- The internal module layout of any crate — `pub(crate)` boundaries move
  freely.
- The `#[doc(hidden)]` fuzzing seams (`nitr_std::fuzzing`,
  `nitr_http::fuzzing`) and the items they re-export, which are `pub`
  only so the fuzz targets can reach them.
- Benchmark names and numbers, the test framework's failure text, and
  the dev-mode `500` page's markup.
- Behavior reachable only through `Server::builder().setup()` — the
  documented low-level escape hatch is sharp by design.

## How to depend on Nitr safely today

- **Pin a version.** The crates are published on crates.io, so an
  ordinary version requirement is enough:

  ```sh
  cargo install nitr-cli --version 0.0.0-beta.3
  ```

  ```toml
  # Cargo.toml
  nitr = { version = "0.0.0-beta.3", features = ["db"] }
  ```

  That requirement is a caret, so it will also accept a later
  `0.0.0-beta.N`. Write `"=0.0.0-beta.3"` for an exact pin, and commit
  `Cargo.lock` in an application either way — the lockfile, not the
  requirement, is what makes two builds identical.

- **Or pin a git revision** — the option for tracking work that is not
  released yet. Released betas lag the default branch:

  ```toml
  nitr = { git = "https://github.com/nitrweb/nitr", rev = "…", features = ["db"] }
  ```

- **Run `nitr check` in CI.** Unknown or removed configuration keys fail
  loudly there rather than on a deploy. `nitr check --print-config`
  prints the effective configuration after file, environment and flag
  layering, which is the answer to "which value actually won?".
- **Run `nitr test` in CI.** Requests dispatch through the real router,
  so a behavioural change in routing or middleware shows up as a test
  failure.
- **Branch on `err.kind`, never on message text.** [Error
  kinds](./server/errors#the-error-value) are a closed set; messages are
  not an API — as the database-error change above demonstrates.

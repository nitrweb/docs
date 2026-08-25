# Stability & Versioning

What Nitr promises about each of its surfaces, from strongest to
weakest. One version number covers the whole workspace; the `nitr.*` Lua
API does not get its own — instead the table below states how each
surface is allowed to change.

> [!WARNING] Pre-1.0
>
> Nitr is at `0.0.0-beta.1`. While the version is `0.x`, **a minor bump
> may break anything below**. The rules on this page describe the
> _shape_ of the promise that hardens at 1.0, so you can tell which
> parts are meant to be depended on and which are meant to move.

## The promise per surface

| Surface                                    | Promise                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The `nitr.*` Lua API**                   | The strongest promise: this is what users depend on most and can least easily migrate. Breaking changes need a major version and a migration note in the changelog. The [API reference](./api/) is the authoritative inventory — a test fails if a registered builtin is undocumented, so the promised surface is always enumerable. `nitr.ext.*` is reserved for user modules and will never be occupied by a builtin. |
| **`nitr.toml`**                            | Unknown keys are rejected at startup, so a removed key is a loud error, never silence. A renamed key ships with the old name still accepted (and warned about) for one minor cycle before removal.                                                                                                                                                                                                                      |
| **The `nitr` crate (facade)**              | Standard semver. This is the supported Rust entry point for applications and embedders.                                                                                                                                                                                                                                                                                                                                 |
| **`nitr-core` / `nitr-std` / `nitr-http`** | Published and usable directly, but **explicitly unstable pre-1.0**: they move as fast as the phases need. Depend on the `nitr` facade unless you are writing an extension crate. The [extension contract](./library/extension-modules) (`ServerBuilder::module`, `nitr_table`, `mount`, `ModuleFn`) is the part expected to settle first.                                                                               |
| **CLI flags and output**                   | Flags follow the `nitr.toml` policy — deprecate for one minor cycle, then remove. Human-readable _output text_ is not an API; `[log] format = "json"` and process exit codes are.                                                                                                                                                                                                                                       |
| **`nitr-types.lua`**                       | Regenerated from the API description each release; versions with the crate and carries no independent promise.                                                                                                                                                                                                                                                                                                          |

## Deprecation policy

Deprecations warn for **one minor version** before removal, and the
warning names the replacement (`use nitr.time.format instead of ...`).
Removals and renames are recorded in `CHANGELOG.md` starting with the
first release.

## Minimum supported Rust version

The MSRV is declared as `rust-version` in the workspace manifest and
checked by a pinned CI matrix entry. **Bumping the MSRV is a minor
change, not a breaking one**, and is called out in the changelog.

The current MSRV is **1.88.0**.

## Publishing order

The five crates version together and publish in dependency order:

```
nitr-core → nitr-std → nitr-http → nitr → nitr-cli
```

## What is deliberately not promised

- The internal module layout of any crate — `pub(crate)` boundaries move
  freely.
- The `#[doc(hidden)]` fuzzing seams (`nitr_std::fuzzing`).
- Benchmark names and numbers, the test framework's failure text, and
  the dev-mode `500` page's markup.
- Behavior reachable only through `Server::builder().setup()` — the
  documented low-level escape hatch is sharp by design.

## How to depend on Nitr safely today

- **Pin a revision.** `cargo install --git … --rev <sha>` and
  `nitr = { git = "…", rev = "…" }` while there is no crates.io release.
- **Run `nitr check` in CI.** Unknown or removed configuration keys fail
  loudly there rather than on a deploy.
- **Run `nitr test` in CI.** Requests dispatch through the real router,
  so a behavioural change in routing or middleware shows up as a test
  failure.
- **Branch on `err.kind`, never on message text.** [Error
  kinds](./server/errors#the-error-value) are a closed set; messages are
  not an API.

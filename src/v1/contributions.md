# Contributions

Contributions are welcome. Nitr is in early development, so the most
valuable thing you can do is **use it and report what breaks**.

## Ways to help

|                            |                                                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **File an issue**          | [github.com/nitrweb/nitr/issues](https://github.com/nitrweb/nitr/issues) — bugs, rough edges, confusing errors |
| **Open a pull request**    | [github.com/nitrweb/nitr/pulls](https://github.com/nitrweb/nitr/pulls)                                         |
| **Improve these docs**     | Every page has an _Edit this page on GitHub_ link at the bottom                                                |
| **Report a vulnerability** | Privately, please — see [Report Security Issues](./report-security-issues)                                     |

## Before opening a pull request

The `Makefile` at the repository root is the local mirror of what CI
runs, so you can reproduce a red check without reading the workflows.
One command covers the common case:

```sh
make all      # = lint + test
```

| Target            | What it does                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `make fmt`        | `cargo fmt --all` — applies formatting. Run it before committing; CI only _checks_.                                                                                            |
| `make lint`       | `make fuzz-check`, then `cargo fmt --all -- --check`, then Clippy over every target in **both** feature configurations with `-D warnings`.                                     |
| `make test`       | `cargo test --features all`, `cargo test --no-default-features`, and the resilience suite under the shipped release profile, where overflow checks and full optimization live. |
| `make fuzz`       | Every fuzz target for a bounded time, seeded like CI. `make fuzz FUZZ_TIME=300` runs longer.                                                                                   |
| `make fuzz-check` | Checks that the fuzz target list agrees across `fuzz/Cargo.toml`, the `Makefile` and `fuzz.yml`, and that no generated corpus input landed in `fuzz/seeds/`.                   |
| `make all`        | `lint` then `test`.                                                                                                                                                            |

> [!NOTE] Two feature configurations, not one
>
> `lint` and `test` both run `--features all` **and**
> `--no-default-features`. Optional builtins are [Cargo
> features](./library/cargo-features), and the minimal build is a
> configuration people really ship — so code that compiles only because
> a neighbouring feature's dependency happened to be in the graph has to
> fail somewhere, and the second run is where.

The workspace treats **any warning as a hard error**, in tests and
benches too, and `unsafe_code` is `forbid`. `missing_docs`, `dead_code`,
`dbg_macro`, `todo!`, `unimplemented!` and `unreachable!` are denied at
the workspace level, so anything that builds cleanly locally builds
cleanly in CI.

`make fuzz` is deliberately **not** part of `make all`: a full pass is
minutes of CPU per target and `all` has to stay cheap enough to run
before every commit. It needs a nightly toolchain and
`cargo install cargo-fuzz`. `make fuzz-check` is pure text comparison —
no nightly, instant — which is why it rides along with `lint` instead,
where every contributor catches drift rather than a silently missing CI
leg.

## Conventions that save a review round

### Every new source file carries an SPDX header

Four lines, in the file's own comment syntax, above everything else:

```rust
// SPDX-License-Identifier: MIT OR Apache-2.0
// This file is part of Nitr.
// See https://nitrweb.com/ for more information
// Copyright (C) 2024-present Jose Quintana <joseluisq.net>
```

Lua sources use `--`, the `Makefile` and shell scripts use `#`. The
identifier is the dual license the workspace declares — see
[License](./license).

### A new `nitr.*` builtin must be documented

`crates/nitr-cli/src/nitr-api.toml` is the single source for the
[API reference](./api/), for the generated `resources/nitr-api.md`, and
for the `resources/nitr-types.lua` editor completions. Two tests guard
it: one walks the registered `nitr` namespace and fails when an entry
has no description, the other fails when the checked-in generated files
have drifted from the description. Regenerate them with:

```sh
NITR_API_REGEN=1 cargo test -p nitr-cli --test api
```

### A new parser needs a fuzz target

If an attacker fully controls the bytes a parser reads, it gets a
[libFuzzer](https://github.com/rust-fuzz/cargo-fuzz) target. There are
sixteen today: signed cookies and the `Cookie` header, `Accept` and
`Accept-Encoding` negotiation, conditional-request headers, `Range`
headers, multipart bodies, the JSON-Lua boundary, lexical paths, static
and upload path resolution, URL and query splitting, JWT verification,
the Basic-auth credential path, the declarative validators, and the TLS
certificate/key PEM the server reads at startup.

The expectation is stricter than "does not crash": **targets assert
behaviour** — round-trips, idempotence, tamper rejection, and the bounds
a caller depends on. `static-resolve` and `upload-resolve` assert that
every path returned lies inside the canonicalized root; `range-header`
asserts an accepted byte range lies inside the representation. A target
that only checks for panics leaves the invariant untested.

Three practical rules:

- **Register the target in all three places** — `fuzz/Cargo.toml`,
  `FUZZ_TARGETS` in the `Makefile`, and the matrix in
  `.github/workflows/fuzz.yml`. `make fuzz-check` fails on drift, which
  is why it runs as part of `make lint`.
- **Commit seeds** under `fuzz/seeds/<target>/`, written in the format
  the target actually decodes — see `fuzz/seeds/README.md`, which
  documents the mistake that made fourteen of sixteen seeds dead on
  arrival before the format was made explicit.
- **Never** run `cargo fuzz run <target> fuzz/seeds/<target>`. libFuzzer
  writes generated inputs into its first corpus directory, burying the
  curated seeds in thousands of SHA-1-named files. `make fuzz` copies
  seeds into `fuzz/corpus/` first, precisely to avoid that.

CI runs 90 seconds per target on every pull request and an hour per
target nightly, where the depth actually comes from.

### New configuration keys are rejected unless declared

Unknown keys in `nitr.toml` are a startup error by design — that is what
makes a removed key a loud failure instead of silence. Add yours to the
config types **and** to [the file
reference](./server/configuration/file), with its default and the reason
the default is what it is.

### Log fields are a closed vocabulary

No SQL text, no bind values, no full URLs, no header, cookie or session
material. See [Logging → Redaction
rules](./server/logging#redaction-rules) before adding a span field.
Database errors carry a statement _correlator_ rather than the statement
for exactly this reason.

### Behaviour changes need a test through the real router

The in-process test client exists precisely so nothing has to be mocked:
a test dispatches through the same router, middleware chain and error
boundary a request does. See [Testing](./server/testing).

## Documentation contributions

These docs live in a separate repository:
[joseluisq/nitr-docs](https://github.com/joseluisq/nitr-docs).

```sh
git clone https://github.com/joseluisq/nitr-docs
cd nitr-docs
yarn install
yarn docs:dev
```

| Command             | What it does                                                |
| ------------------- | ----------------------------------------------------------- |
| `yarn docs:dev`     | live-reloading dev server                                   |
| `yarn docs:build`   | production build — **fails on a dead link**                 |
| `yarn docs:preview` | serve the production build locally                          |
| `yarn run check`    | typecheck, markdownlint and the Prettier check              |
| `yarn format:fix`   | apply Prettier formatting                                   |
| `make typos`        | spell-check with [typos](https://github.com/crate-ci/typos) |

A word that `typos` does not know goes in
`.github/workflows/config/typos.toml` rather than being reworded around.

## Licensing of contributions

Unless you explicitly state otherwise, any contribution you
intentionally submit for inclusion in the work, as defined in the
Apache-2.0 license, shall be dual licensed as described in
[License](./license), without any additional terms or conditions.

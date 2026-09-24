# Contributions

Contributions are welcome. Nitr is in early development, so the most
useful thing you can do is **use it and report what breaks**.

## Ways to help

|                            |                                                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **File an issue**          | [github.com/nitrweb/nitr/issues](https://github.com/nitrweb/nitr/issues) — bugs, rough edges, confusing errors |
| **Open a pull request**    | [github.com/nitrweb/nitr/pulls](https://github.com/nitrweb/nitr/pulls)                                         |
| **Improve these docs**     | Every page has an _Edit this page on GitHub_ link at the bottom                                                |
| **Report a vulnerability** | Privately, please — see [Report Security Issues](./report-security-issues)                                     |

## Before opening a pull request

Run what CI runs:

```sh
make fmt      # apply formatting
make all      # lint + test, in both feature configurations
```

Any warning fails the build, so a clean local run means a clean CI run.
[Building from source](./building-from-source#running-the-checks)
explains each `make` target.

## Conventions that save a review round

### Every new source file carries an SPDX header

Four lines, in the file's own comment syntax, above everything else:

```rust
// SPDX-License-Identifier: MIT OR Apache-2.0
// This file is part of Nitr.
// See https://nitrweb.com/ for more information
// Copyright (C) 2024-present Jose Quintana <joseluisq.net>
```

Lua uses `--`; the `Makefile` and shell scripts use `#`. See
[License](./license).

### A new `nitr.*` builtin must be documented

`crates/nitr-cli/src/nitr-api.toml` is the single source for the [API
reference](./api/), `resources/nitr-api.md` and the
`resources/nitr-types.lua` editor completions. A test fails when a
registered builtin has no description, or when the generated files are
out of date. Regenerate them with:

```sh
NITR_API_REGEN=1 cargo test -p nitr-cli --test api
```

### A new parser needs a fuzz target

If an attacker controls the bytes a parser reads, add a fuzz target that
checks behaviour, not only crashes (for example, that a resolved path
stays inside its root). Register it in `fuzz/Cargo.toml`, in
`FUZZ_TARGETS` in the `Makefile`, and in `.github/workflows/fuzz.yml`,
and commit seeds under `fuzz/seeds/<target>/` in the format described by
`fuzz/seeds/README.md`. See [Fuzzing](./building-from-source#fuzzing).

### New configuration keys must be declared

Unknown keys in `nitr.toml` are a startup error. Add a new key to the
config types **and** to [the file reference](./server/configuration/file),
with its default.

### Log fields never carry secrets

No SQL text, bind values, full URLs, headers, cookies or session data.
See [Logging → Redaction rules](./server/logging#redaction-rules).

### Behaviour changes need a test through the real router

The in-process test client sends requests through the same router,
middleware and error handling as a real server, so nothing needs to be
mocked. See [Testing](./server/testing).

## Documentation contributions

These docs live in
[nitrweb/nitr-docs](https://github.com/nitrweb/nitr-docs).

```sh
git clone https://github.com/nitrweb/nitr-docs
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

Add a word `typos` does not know to
`.github/workflows/config/typos.toml`.

## Licensing of contributions

Unless you explicitly state otherwise, any contribution you
intentionally submit for inclusion in the work, as defined in the
Apache-2.0 license, shall be dual licensed as described in
[License](./license), without any additional terms or conditions.

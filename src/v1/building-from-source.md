# Building from Source

Nitr is a Cargo workspace of five crates. Building it needs nothing but
a Rust toolchain — SQLite is bundled, not linked from the system.

## Requirements

| Requirement    | Version                                                                    |
| -------------- | -------------------------------------------------------------------------- |
| Rust toolchain | **1.88.0** or newer (the workspace MSRV)                                   |
| Edition        | 2024                                                                       |
| C toolchain    | only for the bundled SQLite (`cc` is already required by most Rust setups) |

Install Rust from [rustup.rs](https://rustup.rs/), then:

```sh
git clone https://github.com/joseluisq/nitr
cd nitr
cargo build --release
```

The binary lands at `target/release/nitr`.

## The workspace

| Crate       | What it is                                                                             |
| ----------- | -------------------------------------------------------------------------------------- |
| `nitr-core` | the sandboxed Lua runtime, the state pool, diagnostics, the error type                 |
| `nitr-std`  | the `nitr.*` standard library (`json`, `fetch`, `db`, `crypto`, …)                     |
| `nitr-http` | the hyper server, configuration, the HTTP↔Lua bridge                                   |
| `nitr`      | the **facade** crate — the supported entry point for embedding                         |
| `nitr-cli`  | the `nitr` binary: `run`, `dev`, `check`, `test`, `migrate`, `init`, `build`, `reload` |

Depend on `nitr`, not on the inner crates. They are published and
usable, but explicitly unstable pre-1.0 — see
[Stability](./stability).

## A smaller binary

The `nitr` binary enables the `all` feature by default. If you know
which builtins your application uses, build only those:

```sh
# Just JSON, HTTP helpers and templates — no SQLite, no reqwest, no argon2
cargo build --release -p nitr-cli --no-default-features --features template
```

Each feature and its heaviest dependency is listed in [Cargo
features](./library/cargo-features).

> [!TIP] Startup, not runtime, tells you if you got it wrong
>
> Configuring a builtin that was not compiled in is a **startup error
> naming the Cargo feature to enable** — not a mysterious "unknown std
> feature" at the first request that touches it.

## Running the checks

```sh
cargo test --workspace --features all     # the full test suite
cargo clippy --workspace --all-targets    # lints are deny-level in CI
cargo fmt --check
```

The workspace denies all warnings, `rust-2018-idioms`, `missing_docs`
and `dead_code`, and forbids `unsafe_code` outright. A warning is a
build failure, so a green local build is a green CI build.

## Running the examples

The repository carries a runnable example per subject. Each is a small
`main.rs` plus the Lua it serves:

```sh
cargo run --example hello         # the smallest possible server
cargo run --example router        # routing and middleware
cargo run --example stdlib        # a tour of nitr.*
cargo run --example data-io       # SQLite and migrations
cargo run --example streaming     # streaming response bodies
cargo run --example sse           # Server-Sent Events
cargo run --example extension     # your own Rust module at nitr.ext.*
```

The full list, with what each one demonstrates, is in [Library →
Examples](./library/examples).

## Benchmarks

Benchmarks use [divan](https://github.com/nvzqz/divan) through the
CodSpeed compatibility layer, and dispatch through the same in-process
client `nitr test` uses:

```sh
cargo bench --features all                    # everything, wall-clock
cargo bench --features all --bench dispatch   # one target
```

| Target     | What it measures                                                                            |
| ---------- | ------------------------------------------------------------------------------------------- |
| `runtime`  | sandboxed state creation, script compilation, one call into Lua, server startup             |
| `dispatch` | route matching, path parameters, middleware, 404/405, JSON in and out, compression          |
| `stdlib`   | the builtins: json, base64, url, path, time, validate, cache, cookies, crypto, template, db |

Every push and pull request runs them on
[CodSpeed](https://app.codspeed.io/joseluisq/nitr) under CPU simulation,
so a regression shows up as a diff on the pull request.

## Fuzzing

The parsers that touch untrusted input are fuzzed with `cargo-fuzz`
(nightly):

```sh
cargo +nightly fuzz list
cargo +nightly fuzz run <target> -- -max_total_time=90
```

## Cross-compiling

Release builds use [`cross`](https://github.com/cross-rs/cross) for the
non-native targets listed in [Download &
Install](./download-install#planned-release-channels):

```sh
cargo install cross
cross build --release --target aarch64-unknown-linux-musl -p nitr-cli
```

`Cross.toml` in the repository root carries the one workaround needed
for the NetBSD target.

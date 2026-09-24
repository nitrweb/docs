# Building from Source

Nitr is a Cargo workspace of five crates. You need a Rust toolchain and
a C compiler. Lua and SQLite are compiled from bundled sources, and TLS
uses rustls, so there is no system library such as OpenSSL to install.

## Requirements

| Requirement    | Detail                                                  |
| -------------- | ------------------------------------------------------- |
| Rust toolchain | **1.88.0** or newer (the workspace MSRV), edition 2024  |
| C compiler     | always: Lua 5.4 and SQLite are built from bundled C     |
| Nightly Rust   | only for [fuzzing](#fuzzing); `make all` never needs it |

Install Rust from [rustup.rs](https://rustup.rs/), then:

```sh
git clone https://github.com/nitrweb/nitr
cd nitr
cargo build --release
```

The binary lands at `target/release/nitr`.

## The workspace

| Crate       | What it is                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------ |
| `nitr-core` | the Lua runtime: sandboxed states, limits, the state pool                                                          |
| `nitr-std`  | the `nitr.*` standard library (`json`, `fetch`, `db`, `crypto`, `template`, …)                                     |
| `nitr-http` | the HTTP server, configuration, and the request/response bridge to Lua                                             |
| `nitr`      | the **facade** crate — the supported entry point for embedding                                                     |
| `nitr-cli`  | the `nitr` binary: `run`, `dev`, `check`, `test`, `openapi`, `migrate`, `init`, `build`, `reload`, `hash-password` |

All five are on crates.io, but depend on `nitr` only: the inner crates
can change without notice before 1.0. See [Stability](./stability).
`fuzz/` is a separate crate outside the workspace.

## A smaller binary

The `nitr` binary enables every optional feature by default. To build
only what your application uses:

```sh
# JSON, HTTP helpers and templates only: no SQLite, HTTP client or argon2
cargo build --release -p nitr-cli --no-default-features --features template
```

Use the `nitr-cli` feature names (they match the library's). Configuring
a builtin that was not compiled in is a startup error that names the
feature to enable, so `nitr check` catches it before a deploy. See
[Cargo features](./library/cargo-features).

## Running the checks

The `Makefile` runs what CI runs:

```sh
make all    # lint + test — run this before a commit
make fmt    # apply formatting (CI only checks it)
make lint   # fuzz-check, rustfmt --check, clippy with all and with no features
make test   # tests with all and with no features, plus the release-mode resilience suite
```

Both feature sets are checked because a `cfg` mistake usually shows up
at one extreme: code that only builds with everything on, or with
everything off.

> [!TIP] A warning is a build failure
>
> The workspace denies all warnings, `missing_docs` and `dead_code`, and
> forbids `unsafe_code`, in tests and benches too. Leftover `dbg!`,
> `todo!`, `unimplemented!`, `unreachable!` and `mem::forget` are denied.
> A clean local build is a clean CI build.

### Supply-chain checks

Dependency policy lives in `deny.toml`. CI runs it nightly and whenever
`Cargo.toml`, `Cargo.lock` or `deny.toml` changes:

```sh
cargo install cargo-deny
cargo deny check
```

## Running the examples

The runnable examples live in
[`crates/nitr/examples/`](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples).
Run them from the repository root:

```sh
cargo run --example hello
cargo run --features all --example data-io
```

[Examples](./examples) lists each one, with the Cargo features it needs
and the requests to try.

## Benchmarks

Benchmarks live in `crates/nitr/benches`, written with
[divan](https://github.com/nvzqz/divan). They send requests through the
same in-process client `nitr test` uses.

```sh
cargo bench --features all                    # everything
cargo bench --features all --bench dispatch   # one target
```

| Target     | What it measures                                                                            |
| ---------- | ------------------------------------------------------------------------------------------- |
| `runtime`  | sandboxed state creation, script compilation, one call into Lua, server startup             |
| `dispatch` | route matching, path parameters, middleware, 404/405, JSON in and out, response compression |
| `stdlib`   | the builtins: json, base64, url, path, time, validate, cache, cookies, crypto, template, db |

Every push and pull request also runs them on
[CodSpeed](https://app.codspeed.io/nitrweb/nitr), so a slowdown shows up
on the pull request.

## Fuzzing

Parsers that read attacker-controlled bytes are fuzzed with
[cargo-fuzz](https://github.com/rust-fuzz/cargo-fuzz). There are
**19 targets**:

| Area            | Targets                                                                        |
| --------------- | ------------------------------------------------------------------------------ |
| Cookies         | `cookie-verify`, `cookie-header`                                               |
| Negotiation     | `accept-negotiation`, `accept-encoding`, `conditional-headers`, `range-header` |
| Paths and URLs  | `path-lexical`, `static-resolve`, `upload-resolve`, `url-lexical`              |
| Bodies          | `multipart`, `json-lua`, `sse-parse`                                           |
| Auth and crypto | `basic-auth`, `jwt-verify`, `tls-pem`                                          |
| Validation      | `validate-formats`, `validate-coerce`, `sniff-file`                            |

```sh
cargo install cargo-fuzz          # plus a nightly toolchain
make fuzz                         # every target, for a bounded time, seeded like CI
make fuzz FUZZ_TIME=300           # longer
```

`make fuzz` is not part of `make all`, because it takes minutes per
target. Run it when you change a parser. CI runs 90 seconds per target
on every pull request and an hour per target nightly.

Targets check behaviour, not only crashes: for example, a served static
path must stay inside its mount. Seed inputs are committed under
`fuzz/seeds/<target>/`; `fuzz/seeds/README.md` describes their format.

> [!DANGER] Never pass a seed directory on the command line
>
> `cargo fuzz run <target> fuzz/seeds/<target>` fills the seed directory
> with thousands of generated files. `make fuzz` copies the seeds into
> `fuzz/corpus/` first. To run one target by hand, use
> `cargo +nightly fuzz run <target> -- -max_total_time=60`.

`make fuzz-check`, part of `make lint`, fails if the target list differs
between `fuzz/Cargo.toml`, the `Makefile` and
`.github/workflows/fuzz.yml`, or if a generated input was committed
under `fuzz/seeds/`.

## Cross-compiling

Release builds use [`cross`](https://github.com/cross-rs/cross) for the
targets listed in [Download &
Install](./download-install#planned-release-channels):

```sh
cargo install cross
cross build --release --target aarch64-unknown-linux-musl -p nitr-cli
```

`Cross.toml` holds the one workaround needed for NetBSD: it fetches
`libexecinfo` from a NetBSD base set, which the cross image lacks.

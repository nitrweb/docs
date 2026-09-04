# Building from Source

Nitr is a Cargo workspace of five crates. Building it needs nothing but
a Rust toolchain and a C compiler: both Lua and SQLite are vendored and
compiled from source, and TLS is rustls, so there is no system library
to hunt down and no `libssl` to match against a target sysroot.

## Requirements

| Requirement    | Detail                                                             |
| -------------- | ------------------------------------------------------------------ |
| Rust toolchain | **1.88.0** or newer (the workspace MSRV)                           |
| Edition        | 2024                                                               |
| C toolchain    | always: mlua vendors Lua 5.4 and `rusqlite` bundles SQLite, both C |
| Nightly Rust   | only for [fuzzing](#fuzzing) — `make all` never needs it           |

Install Rust from [rustup.rs](https://rustup.rs/), then:

```sh
git clone https://github.com/nitrweb/nitr
cd nitr
cargo build --release
```

The binary lands at `target/release/nitr`.

> [!NOTE] Why no OpenSSL anywhere
>
> The outbound client (`reqwest`) and the inbound TLS listener both use
> **rustls over the `ring` provider**, chosen deliberately over the
> defaults. `native-tls` is OpenSSL on every Unix but macOS, and
> `openssl-sys` needs a prebuilt `libssl` for the _target_ — the
> illumos and BSD cross images ship none, so the build aborts. rustls
> needs nothing from the sysroot. rustls 0.23 would otherwise default
> to `aws-lc-rs`, whose build wants a C toolchain and NASM on Windows;
> `ring` builds from prebuilt assembly on every target in the release
> matrix.

## The workspace

| Crate       | What it is                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| `nitr-core` | the resource-controlled Lua runtime: sandboxed states, limits, the runtime pool                         |
| `nitr-std`  | the `nitr.*` standard library (`json`, `fetch`, `db`, `crypto`, `template`, …)                          |
| `nitr-http` | the hyper server, configuration, the request/response Lua bridge                                        |
| `nitr`      | the **facade** crate — the supported entry point for embedding                                          |
| `nitr-cli`  | the `nitr` binary: `run`, `dev`, `check`, `test`, `migrate`, `init`, `build`, `reload`, `hash-password` |

All five are published on crates.io, but depend on `nitr` alone: the
inner crates are usable and explicitly unstable pre-1.0, and their
surface moves without notice. See [Stability](./stability).

`fuzz/` is a sixth crate, deliberately **excluded** from the workspace —
cargo-fuzz builds it on nightly, and it inherits none of the workspace
lint policy because a fuzz harness aborts by design.

## A smaller binary

The `nitr` binary enables the `all` feature by default, which is every
optional one: `compression`, `crypto`, `db`, `fetch`, `multipart`,
`template` and `tls`. If you know which builtins your application uses,
build only those:

```sh
# Just JSON, HTTP helpers and templates — no SQLite, no reqwest, no argon2
cargo build --release -p nitr-cli --no-default-features --features template
```

The CLI's feature names must be used, not the library's: `nitr migrate`
is gated on `nitr-cli`'s own `db` feature, which forwards to
`nitr/db`. Each feature and its heaviest dependency is listed in [Cargo
features](./library/cargo-features).

> [!TIP] Startup, not runtime, tells you if you got it wrong
>
> Configuring a builtin that was not compiled in is a **startup error
> naming the Cargo feature to enable** — not a mysterious "unknown std
> feature" at the first request that touches it. `nitr check` finds it
> before a deploy does.

## Running the checks

The `Makefile` is the contributor-facing entry point, and it exists so
you can reproduce a red CI check without reading the workflows:

```sh
make all    # lint + test — what to run before a commit
make fmt    # apply formatting (CI only checks it)
make lint   # fuzz-check, rustfmt --check, then clippy in both feature sets
make test   # the test suite in both feature sets, plus resilience in release
```

What the two composite targets actually run:

| Target      | Runs                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `make lint` | `make fuzz-check`, `cargo fmt --all -- --check`, `cargo clippy --workspace --features all --all-targets -- -D warnings`, then the same clippy pass with `--no-default-features` |
| `make test` | `cargo test --features all`, `cargo test --no-default-features`, and `cargo test -p nitr --release --features=all --test resilience`                                            |

Both feature configurations are checked because the two extremes are
where a `cfg` mistake hides: code that only compiles with everything on,
and code that only compiles with everything off.

The resilience suite runs under the **release** profile on purpose. That
profile is where `overflow-checks = true` and full optimization actually
apply, and where the request panic boundary has to hold — `panic` stays
at `unwind` in release precisely so a panic in request-reachable Rust is
contained by that boundary instead of killing every in-flight
connection. Asserting it under any other profile would assert nothing.

> [!TIP] A warning is a build failure
>
> The workspace denies `warnings`, `rust-2018-idioms`, `missing_docs`
> and `dead_code`, and **forbids** `unsafe_code` — in tests and benches
> too. `dbg!`, `todo!`, `unimplemented!`, `mem::forget` and
> `unreachable!` are denied as leftover markers that should not survive
> review. So a green local build is a green CI build.

### Supply-chain checks

Dependency policy lives in `deny.toml` and runs in the `audit` workflow
on every `Cargo.toml`/`Cargo.lock` change and nightly:

```sh
cargo install cargo-deny
cargo deny check
```

It enforces a permissive-only license allow-list, denies yanked crates
in the lockfile (a red flag even without an advisory), denies unknown
registries and git sources, and warns — rather than denies — on
duplicate versions, because the `windows-sys`/`syn` churn makes a hard
failure unlivable while keeping the count visible.

## Running the examples

The repository carries a runnable example per subject, each a small
`main.rs` plus the Lua it serves. They live in
[`crates/nitr/examples/`](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples);
a root `examples/` symlink makes the shorter path work locally.

Run them from the repository root:

```sh
cargo run --example hello          # minimal embedding, one custom Rust module
cargo run --example router         # routing, middleware, signed cookies
cargo run --example stdlib         # a tour of nitr.*
cargo run --example extension      # your own Rust module at nitr.ext.*
cargo run --example sse            # Server-Sent Events
cargo run --example streaming      # streaming response bodies
cargo run --example static-site    # static files alongside Lua routes
cargo run --example standards      # ranges, compression, CORS, multipart
cargo run --example observability  # logging, request ids, rate limits
cargo run --example data-io        # SQLite, migrations, cache, fetch
cargo run --example aggregate      # nitr.await_all + db transactions

cargo run --features crypto --example basic-auth   # argon2 login, timing-safe
cargo run --features crypto --example bearer-auth  # shared-token API
cargo run --example tls --features tls             # HTTPS, self-signed at run time
```

> [!NOTE] Why some carry a feature flag
>
> Seven examples declare `required-features` — `aggregate`,
> `basic-auth`, `bearer-auth`, `data-io`, `standards`, `stdlib` and
> `tls`. That gate is what makes `cargo build --examples` **skip**
> whatever the selected feature set cannot build instead of failing on
> it. The commands above are spelled the way each example's own header
> spells them; in a narrower build, name the feature the example needs.

`app-package` is not a Rust example but a reference application layout,
driven through the CLI:

```sh
cargo run -p nitr-cli -- -c crates/nitr/examples/app-package/nitr.toml check
cargo run -p nitr-cli -- -c crates/nitr/examples/app-package/nitr.toml test
cargo run -p nitr-cli -- -c crates/nitr/examples/app-package/nitr.toml run
```

> [!NOTE] `data-io` needs its migrations first
>
> The server refuses to start with a pending migration — applying them
> at boot would mean a rolling deploy has two instances racing to change
> the same schema. Run them explicitly:
>
> ```sh
> cargo run -- migrate --status -c crates/nitr/examples/data-io/nitr.toml
> cargo run -- migrate          -c crates/nitr/examples/data-io/nitr.toml
> ```

The full list, with what each one demonstrates, is in [Library →
Examples](./examples).

## Benchmarks

Benchmarks live in `crates/nitr/benches` and are written with
[divan](https://github.com/nvzqz/divan) through the CodSpeed
compatibility layer. All three dispatch through the same in-process
client `nitr test` uses, so they measure the path a request really
takes:

```sh
cargo bench --features all                    # everything, wall-clock
cargo bench --features all --bench dispatch   # one target
```

| Target     | What it measures                                                                            |
| ---------- | ------------------------------------------------------------------------------------------- |
| `runtime`  | sandboxed state creation, script compilation, one call into Lua, server startup             |
| `dispatch` | route matching, path parameters, middleware, 404/405, JSON in and out, response compression |
| `stdlib`   | the builtins: json, base64, url, path, time, validate, cache, cookies, crypto, template, db |

No benchmark declares `required-features`: the feature-gated groups
inside `stdlib.rs` and `dispatch.rs` are `cfg`-ed out instead, so the
rest stays measurable on a minimal build.

Every push and pull request runs them on
[CodSpeed](https://app.codspeed.io/nitrweb/nitr) under CPU simulation,
so a regression shows up as a diff on the pull request instead of as a
surprise in production.

## Fuzzing

The parsers an attacker fully controls are fuzzed with
[cargo-fuzz](https://github.com/rust-fuzz/cargo-fuzz). There are
**16 targets**:

| Area            | Targets                                                                        |
| --------------- | ------------------------------------------------------------------------------ |
| Cookies         | `cookie-verify`, `cookie-header`                                               |
| Negotiation     | `accept-negotiation`, `accept-encoding`, `conditional-headers`, `range-header` |
| Paths and URLs  | `path-lexical`, `static-resolve`, `upload-resolve`, `url-lexical`              |
| Bodies          | `multipart`, `json-lua`                                                        |
| Auth and crypto | `basic-auth`, `jwt-verify`, `tls-pem`                                          |
| Validation      | `validate-formats`                                                             |

```sh
cargo install cargo-fuzz          # plus a nightly toolchain
make fuzz                         # every target, bounded time, seeded like CI
make fuzz FUZZ_TIME=300           # longer
```

Fuzzing is **deliberately not part of `make all`**: a full pass is
minutes of CPU per target, and `all` has to stay cheap enough to run
before every commit. Run it before touching a parser and let CI run it
per pull request.

> [!TIP] The targets assert behaviour, not just "it did not crash"
>
> Round-trips, idempotence, tamper rejection, and the bounds a caller
> depends on: a served static path is always inside its mount, an
> accepted byte range always lies inside the representation. A target
> that only checked for panics would pass while silently serving the
> wrong file.

Seed corpora are committed under `fuzz/seeds`, one directory per target,
so a cold start — a first run, or an evicted CI cache — never begins at
zero coverage. Each target decodes a flat, explicit format documented in
its own module doc; the seeds' `README.md` explains why (an earlier
`Arbitrary`-based encoding read string lengths from the _tail_ of the
buffer, which quietly made fourteen of sixteen seeds land in the wrong
field).

> [!DANGER] Never pass a seed directory on the command line
>
> `cargo fuzz run <target> fuzz/seeds/<target>` makes the curated seed
> directory libFuzzer's **working corpus**, and it fills with thousands
> of SHA-1-named generated inputs that are indistinguishable from the
> good seeds by eye. `make fuzz` copies seeds into `fuzz/corpus/` first;
> the manual form is
> `cargo +nightly fuzz run <target> -- -max_total_time=60`.

`make fuzz-check` is the guard against both mistakes. It runs as part of
`make lint` — pure text comparison, no nightly, instant — and fails if
the target list drifts between `fuzz/Cargo.toml`, the `Makefile` and
`.github/workflows/fuzz.yml`, or if a generated corpus input has been
committed under `fuzz/seeds/`. The three lists had already drifted once.

CI runs two cadences: **90 seconds per target on every pull request**,
fast enough to gate a merge, and **an hour per target nightly**, which
is where depth actually comes from — the per-PR corpus cache is
branch-scoped, so accumulated depth on the PR path is weaker than a
cache alone suggests.

## Cross-compiling

Release builds use [`cross`](https://github.com/cross-rs/cross) for the
non-native targets listed in [Download &
Install](./download-install#planned-release-channels):

```sh
cargo install cross
cross build --release --target aarch64-unknown-linux-musl -p nitr-cli
```

`Cross.toml` in the repository root carries the one workaround needed
for the NetBSD target: it fetches `libexecinfo` from a NetBSD 9.4 base
set, which the cross image does not ship.

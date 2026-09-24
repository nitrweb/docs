# Download & Install

Nitr is at `0.0.0-beta.5`. Install it from crates.io with Cargo.
Pre-built binaries are not published yet.

## Install with Cargo <Badge type="tip" text="recommended" />

You need Rust **1.88.0** or newer. Get it from
[rustup.rs](https://rustup.rs/).

```sh
cargo install nitr-cli --version 0.0.0-beta.5
```

The crate is `nitr-cli`; the binary it installs into `~/.cargo/bin` is
`nitr`. Check it:

```sh
nitr --version
# nitr 0.0.0-beta.5
```

> [!WARNING] Keep the `--version` flag
>
> Every published version is a pre-release, and a bare
> `cargo install nitr-cli` only looks for stable versions, so it fails
> with an error saying it could not find `nitr-cli` with version `*`. Use
> `--version '^0.0.0-beta.5'` to accept later betas too.

The binary includes every optional feature: SQLite, templates, the HTTP
client, crypto, compression, multipart uploads, TLS, OpenAPI and
Swagger UI.

### A smaller binary

To leave out what you do not use, pick the features yourself:

```sh
cargo install nitr-cli --version 0.0.0-beta.5 \
  --no-default-features --features template
```

If your configuration uses a feature that was not compiled in, Nitr
refuses to start and names the feature to enable, so `nitr check`
catches it. The feature list is in [Cargo
features](./library/cargo-features).

### From git

Released betas lag behind the default branch. To install unreleased
work, or pin an exact tag or commit:

```sh
cargo install --git https://github.com/nitrweb/nitr nitr-cli
cargo install --git https://github.com/nitrweb/nitr --tag v0.0.0-beta.5 nitr-cli
cargo install --git https://github.com/nitrweb/nitr --rev <commit-sha> nitr-cli
```

### Uninstall

```sh
cargo uninstall nitr-cli
```

## Using Nitr as a library

To embed Nitr in your own Rust program, add the `nitr` crate. It enables
no optional features by default:

```sh
cargo add nitr                          # minimal
cargo add nitr --features db,template   # plus SQLite and templates
cargo add nitr --features all           # everything
```

See [Library → Getting started](./library/getting-started).

## Build from a clone

```sh
git clone https://github.com/nitrweb/nitr
cd nitr
cargo build --release
./target/release/nitr --version
```

See [Building from source](./building-from-source) for tests, examples
and benchmarks.

## First run

```sh
nitr init my-app && cd my-app
nitr migrate
nitr dev
```

The server listens on `http://127.0.0.1:3000`. The [Quick
Start](./quick-start) walks through each step. Without any `nitr.toml`,
`nitr` still starts and serves `scripts/handler.lua` — see [Server
defaults](./server/defaults).

## Docker

There is no published image yet. The repository's reference
[`Dockerfile`](https://github.com/nitrweb/nitr/blob/master/deploy/docker/Dockerfile)
builds one from your application directory. It runs `nitr` as a
non-root user, keeps the SQLite database on a `/app/data` volume, and
checks `/healthz`.

> [!WARNING] Add the version flag to the Dockerfile
>
> Its build stage runs a bare `cargo install nitr-cli`, which fails for
> the reason above. Change it to
> `cargo install nitr-cli --version 0.0.0-beta.5`.

See [Docker deployment](./server/deployment/docker) for signals and stop
timeouts.

## Planned release channels

The release workflow already builds binaries for the targets below and
attaches them to a **draft** GitHub release. Published releases and an
install script are still to come.

| Platform          | Targets                                                             |
| ----------------- | ------------------------------------------------------------------- |
| **Linux (glibc)** | `x86_64`, `i686`, `aarch64`, `armv7`, `arm`, `powerpc64le`, `s390x` |
| **Linux (musl)**  | `x86_64`, `i686`, `aarch64`, `armv7`, `arm`                         |
| **macOS**         | `x86_64` (Intel), `aarch64` (Apple silicon)                         |
| **Windows**       | `x86_64` MSVC, `i686` MSVC, `aarch64` MSVC, `x86_64` GNU            |
| **FreeBSD**       | `x86_64`, `i686`                                                    |
| **NetBSD**        | `x86_64`                                                            |
| **illumos**       | `x86_64`                                                            |
| **Android**       | `aarch64`                                                           |

> [!NOTE] Windows
>
> `nitr reload` uses Unix signals, so it does not work on Windows.
> Restart the process instead.

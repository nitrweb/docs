# Download & Install

> [!WARNING] Pre-release
>
> Nitr is at `0.0.0-beta.1`. There is **no published crates.io release
> and no pre-built binary channel yet** — install from source for now.
> The [planned release channels](#planned-release-channels) are listed
> at the bottom of this page.

## Install with Cargo <Badge type="tip" text="recommended" />

You need a Rust toolchain at or above the project's MSRV (**1.88.0**).
Get one from [rustup.rs](https://rustup.rs/) if you do not have it.

```sh
cargo install --git https://github.com/joseluisq/nitr nitr-cli
```

This installs the `nitr` binary into `~/.cargo/bin`. Verify it:

```sh
nitr --version
# nitr 0.0.0-beta.1
```

> [!TIP] What you get
>
> The `nitr` **binary** is built with the `all` Cargo feature: every
> builtin (`nitr.db`, `nitr.fetch`, `nitr.template`, `nitr.crypto`,
> compression, multipart) is compiled in. Someone installing a server
> expects the whole standard library to be there. The **library crate**
> is the opposite — nothing is enabled by default. See [Cargo
> features](./library/cargo-features).

### Pinning a revision

`cargo install --git` tracks the default branch. For a reproducible
install, pin a commit or tag:

```sh
cargo install --git https://github.com/joseluisq/nitr --rev <commit-sha> nitr-cli
cargo install --git https://github.com/joseluisq/nitr --tag v0.0.0-beta.1 nitr-cli
```

### Uninstalling

```sh
cargo uninstall nitr-cli
```

## Build from a clone

Useful when you want to run the tests, the examples or the benchmarks
alongside the binary:

```sh
git clone https://github.com/joseluisq/nitr
cd nitr
cargo build --release
./target/release/nitr --version
```

Full details, including how to build a smaller binary by dropping
features you do not use, are in [Building from
source](./building-from-source).

## First run

Nitr needs no configuration to start. In an empty directory:

```sh
nitr init
nitr migrate
nitr dev
```

It listens on `127.0.0.1:3000`. Without any `nitr.toml` at all, `nitr`
still runs, serving `scripts/handler.lua` on the same address — see
[Server defaults](./server/defaults).

## Docker

There is no published image yet. Until there is, the reference
[`Dockerfile`](https://github.com/joseluisq/nitr/blob/master/deploy/docker/Dockerfile)
in the repository builds one, and [Docker
deployment](./server/deployment/docker) explains the two settings that
actually matter (exec-form `ENTRYPOINT`, and a stop timeout longer than
the drain).

## Planned release channels

The release workflow already cross-compiles the binary for the targets
below; the download channel and an install script are what is still
missing.

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

> [!NOTE] Platform caveats
>
> `nitr reload` needs Unix signals and is therefore unavailable on
> Windows; use a process restart there. Everything else — including the
> SQLite builtin, which bundles SQLite rather than linking a system copy
> — is portable across the whole list.

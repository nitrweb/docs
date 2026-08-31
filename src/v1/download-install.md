# Download & Install

> [!WARNING] Pre-release
>
> Nitr is at `0.0.0-beta.3`. The crates **are published on crates.io**,
> so installing is one `cargo install` — but **pre-built binaries are
> not published yet**. The [planned release
> channels](#planned-release-channels) are listed at the bottom of this
> page.

## Install with Cargo <Badge type="tip" text="recommended" />

You need a Rust toolchain at or above the project's MSRV (**1.88.0**).
Get one from [rustup.rs](https://rustup.rs/) if you do not have it.

```sh
cargo install nitr-cli --version 0.0.0-beta.3
```

The crate is `nitr-cli`; the binary it installs into `~/.cargo/bin` is
called `nitr`. Verify it:

```sh
nitr --version
# nitr 0.0.0-beta.3
```

> [!WARNING] `--version` is not optional yet
>
> A bare `cargo install <crate>` resolves against the version
> requirement `*`, and by semver rules `*` never matches a pre-release.
> Every published `nitr-cli` version is one, so omitting the flag fails
> before anything is downloaded:
>
> ```text
> error: could not find `nitr-cli` in registry `crates-io` with version `*`
> ```
>
> That is a property of pre-1.0 versioning, not of Nitr — the flag stops
> being necessary the day a non-pre-release version ships.
> `--version '^0.0.0-beta.3'` works too and follows later betas in the
> same series.
>
> `cargo add` does not have this problem: it picks the newest version
> including pre-releases, so `cargo add nitr` writes
> `nitr = "0.0.0-beta.3"` for you.

> [!TIP] What you get
>
> The `nitr` **binary** is built with the `all` Cargo feature —
> `compression`, `crypto`, `db`, `fetch`, `multipart`, `template` and
> `tls` — so every builtin (`nitr.db`, `nitr.fetch`, `nitr.template`,
> `nitr.crypto`, compression, multipart, TLS termination) is compiled
> in. Someone installing a server expects the whole standard library to
> be there. The **library crate** is the opposite: nothing is enabled by
> default. See [Cargo features](./library/cargo-features).

### A smaller binary

If you know which builtins your application uses, drop the rest. The
CLI's own feature names mirror the library's:

```sh
cargo install nitr-cli --version 0.0.0-beta.3 \
  --no-default-features --features template
```

Configuring a builtin that was not compiled in is a **startup error
naming the Cargo feature to enable**, so a wrong guess surfaces at
`nitr check` time, not at the first request. [Building from
source](./building-from-source#a-smaller-binary) has the details.

### From a git revision

Released betas lag the default branch. To install unreleased work:

```sh
cargo install --git https://github.com/nitrweb/nitr nitr-cli
```

`--git` tracks the default branch, which moves. Pin it when you want the
same binary twice:

```sh
cargo install --git https://github.com/nitrweb/nitr --tag v0.0.0-beta.3 nitr-cli
cargo install --git https://github.com/nitrweb/nitr --rev <commit-sha> nitr-cli
```

### Uninstalling

```sh
cargo uninstall nitr-cli
```

## Using Nitr as a library

The server binary is one way to run Nitr; the other is embedding it in
your own Rust program. That crate is `nitr`, and it enables nothing by
default:

```sh
cargo add nitr                          # minimal
cargo add nitr --features db,template   # plus SQLite and templates
cargo add nitr --features all           # everything
```

See [Library → Getting started](./library/getting-started).

## Build from a clone

Useful when you want to run the tests, the examples or the benchmarks
alongside the binary:

```sh
git clone https://github.com/nitrweb/nitr
cd nitr
cargo build --release
./target/release/nitr --version
```

Full details — the workspace layout, the `make` entry points CI
mirrors, the examples, the benchmarks and the fuzzers — are in
[Building from source](./building-from-source).

## First run

Nitr needs no configuration to start. In an empty directory:

```sh
nitr init
nitr migrate
nitr dev
```

`nitr init` scaffolds the full documented layout: `nitr.toml`,
`config.lua`, `app.lua`, `routes/notes.lua`, `migrations/001_init.sql`,
`templates/hello.j2`, `public/index.html`, `tests/notes_test.lua`, a
`.gitignore` and a `data/` directory. `nitr init --minimal` writes only
`nitr.toml`, `app.lua`, `public/index.html` and one test. Both also
emit `nitr-types.lua`, the generated LuaCATS definitions that give your
editor completion over the whole `nitr.*` surface. Either way, the
command refuses to overwrite a file that already exists.

The server listens on `127.0.0.1:3000`. Without any `nitr.toml` at all,
`nitr` still runs, serving `scripts/handler.lua` on the same address —
see [Server defaults](./server/defaults).

## Docker

There is no published image yet. Until there is, the reference
[`Dockerfile`](https://github.com/nitrweb/nitr/blob/master/deploy/docker/Dockerfile)
in the repository builds one: a `rust:1-slim` stage that installs
`nitr-cli` from crates.io, then a `debian:stable-slim` runtime image
carrying just the binary and your application files, running as a
dedicated non-root user with `/app/data` declared as a volume for the
SQLite database and a `HEALTHCHECK` wired to `/healthz`.

> [!WARNING] The reference Dockerfile needs the version flag too
>
> Its build stage runs a bare `cargo install nitr-cli`, which hits the
> pre-release resolution rule described above. While every release is a
> pre-release, change that line to
> `cargo install nitr-cli --version 0.0.0-beta.3`.

[Docker deployment](./server/deployment/docker) explains the two
settings that actually matter: an exec-form `ENTRYPOINT`, so `nitr` is
PID 1 and sees the `SIGTERM` `docker stop` sends, and a stop timeout
longer than the drain (`docker stop --time 40`, above the default
`[shutdown] grace` of 30s plus `stream_grace` of 5s).

## Planned release channels

The release workflow already cross-compiles the binary for the targets
below and attaches the archives to a **draft** GitHub release. What is
missing is a published release, a download channel and an install
script.

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
> `nitr reload` shells out to `kill -HUP`, so it needs Unix signals and
> fails on Windows with an explicit message rather than pretending to
> work; restart the process there instead. It also needs a `pidfile` set
> in `nitr.toml` — that is how it finds the running server. Everything
> else, including the SQLite builtin (SQLite is bundled and compiled in,
> never linked against a system copy), is portable across the whole
> list.

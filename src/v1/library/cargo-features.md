# Cargo Features

Optional builtins are Cargo features, so a build only carries the
dependencies it actually uses.

|                                | Default features                                          |
| ------------------------------ | --------------------------------------------------------- |
| The **library** (`nitr` crate) | **none** — you opt in                                     |
| The **binary** (`nitr`)        | `all` — someone installing a server expects every builtin |

## The features

| Feature       | Enables                               | Heaviest dependency         |
| ------------- | ------------------------------------- | --------------------------- |
| `fetch`       | `nitr.fetch`, `nitr.await_all`        | `reqwest`                   |
| `db`          | `nitr.db`, migrations, `nitr migrate` | `rusqlite` (bundles SQLite) |
| `template`    | `nitr.template`                       | `minijinja`                 |
| `crypto`      | `nitr.crypto`, `nitr.auth`            | `argon2`                    |
| `compression` | on-the-fly brotli/gzip responses      | `brotli`, `flate2`          |
| `multipart`   | `req:multipart(fn)` file uploads      | `multer`                    |
| `all`         | every feature above                   | —                           |

```sh
cargo add nitr                              # minimal
cargo add nitr --features db,template       # plus SQLite and templates
cargo add nitr --features all               # everything
```

```toml
# From the repository, until a crates.io release exists:
nitr = { git = "https://github.com/nitrweb/nitr", features = ["db", "template"] }
```

## Always compiled in

These need nothing the server does not already depend on, so gating them
would save nothing:

`json` · `http` · `log` · `cache` · `dbg` · `time` · `validate` ·
`base64` · `path` · `url` · `env`

Precompressed `.br` / `.gz` sidecars are also served **without** the
`compression` feature — serving an already-compressed file needs no
encoder.

## Two layers, not one

This is the part that confuses people. A builtin must be **compiled in**
_and_ **enabled at runtime**:

```toml
# Cargo.toml — compiled in
nitr = { git = "…", features = ["db"] }
```

```toml
# nitr.toml — enabled at runtime
[std]
features = ["json", "http", "log", "db"]

[database]
path = "data/app.db"
```

Or, from the builder:

```rust
Server::builder()
    .builtins(Builtins::JSON | Builtins::HTTP | Builtins::LOG | Builtins::DATABASE)
    .database("data/app.db")
```

> [!TIP] Getting it wrong is loud, not mysterious
>
> Configuring a builtin that was not compiled in is a **startup error
> naming the Cargo feature to enable** — not an "unknown std feature"
> puzzle, and not a `nil` value at the first request that touches it.

## The `Builtins` flags

`Builtins` is a bitflags type. Combine with `|`:

```rust
use nitr::Builtins;

Builtins::JSON | Builtins::HTTP | Builtins::LOG
Builtins::minimal()      // json, http, log, time, validate, base64, path, url
Builtins::all()          // everything compiled into this build
```

| Flag                 | `[std] features` name |
| -------------------- | --------------------- |
| `Builtins::DEBUG`    | `dbg`                 |
| `Builtins::FETCH`    | `fetch`               |
| `Builtins::TEMPLATE` | `template`            |
| `Builtins::JSON`     | `json`                |
| `Builtins::DATABASE` | `db`                  |
| `Builtins::HTTP`     | `http`                |
| `Builtins::LOG`      | `log`                 |
| `Builtins::CRYPTO`   | `crypto`              |
| `Builtins::CACHE`    | `cache`               |
| `Builtins::TIME`     | `time`                |
| `Builtins::VALIDATE` | `validate`            |
| `Builtins::BASE64`   | `base64`              |
| `Builtins::PATH`     | `path`                |
| `Builtins::URL`      | `url`                 |
| `Builtins::ENV`      | `env`                 |

`.builtins(...)` on the builder **overrides** the `[std] features` list
from a loaded configuration. Omit both and the minimal set applies.

## Sizing a build

Pick features by what your Lua actually calls:

```toml
# A JSON API over SQLite — no outbound HTTP, no templates, no argon2
nitr = { git = "…", features = ["db"] }
```

```toml
# A server-rendered site with sessions
nitr = { git = "…", features = ["db", "template", "crypto", "compression"] }
```

```toml
# A pure aggregator: fan out to upstreams, return JSON
nitr = { git = "…", features = ["fetch"] }
```

The heavy ones are `db` (bundles SQLite, so it also needs a C toolchain
and lengthens the build), `fetch` (reqwest and its TLS stack) and
`crypto` (argon2).

For the binary:

```sh
cargo build --release -p nitr-cli --no-default-features --features template
```

## A feature checklist

| Your Lua calls                 | You need      |
| ------------------------------ | ------------- |
| `nitr.db:*`                    | `db`          |
| `nitr.fetch`, `nitr.await_all` | `fetch`       |
| `nitr.template:render`         | `template`    |
| `nitr.crypto.*`, `nitr.auth.*` | `crypto`      |
| `req:multipart(...)`           | `multipart`   |
| `[compression] enabled = true` | `compression` |
| everything else                | already there |

# Cargo Features

Optional builtins are Cargo features, so a build only includes the
dependencies it uses.

|                                | Default features |
| ------------------------------ | ---------------- |
| The **library** (`nitr` crate) | none; you opt in |
| The **binary** (`nitr-cli`)    | `all`            |

## The features

| Feature       | Enables                                              | Main dependency                  |
| ------------- | ---------------------------------------------------- | -------------------------------- |
| `fetch`       | `nitr.fetch`, `nitr.await_all`                       | `reqwest` (with `rustls`/`ring`) |
| `db`          | `nitr.db`, migrations, `nitr migrate`                | `rusqlite` (bundles SQLite)      |
| `template`    | `nitr.template`                                      | `minijinja`                      |
| `crypto`      | `nitr.crypto`, `nitr.auth`                           | `argon2`                         |
| `compression` | on-the-fly brotli/gzip responses                     | `brotli`, `flate2`               |
| `multipart`   | `req:multipart(fn)` and `file` validation rules      | `multer`                         |
| `tls`         | HTTPS on the listener (`[tls]`)                      | `rustls` (the `ring` provider)   |
| `openapi`     | the OpenAPI document (`[openapi]`, `nitr openapi`)   | none                             |
| `swagger`     | the Swagger UI page (`[swagger]`); implies `openapi` | none (about 1.7 MiB of assets)   |
| `all`         | all of the above                                     |                                  |

```sh
cargo add nitr                              # minimal
cargo add nitr --features db,template       # plus SQLite and templates
cargo add nitr --features all               # everything
```

```toml
nitr = { version = "0.0.0-beta.7", features = ["db", "template"] }
```

`fetch` is by far the largest (reqwest is over half of the full
dependency tree). `db` compiles SQLite from source, so it needs a C
compiler. `tls` adds little when `fetch` is already on, since both use
the same rustls.

## Always compiled in

These modules need no extra dependency, so they are always available:

`json` · `http` · `log` · `cache` · `dbg` · `time` · `validate` ·
`base64` · `path` · `url` · `env`

`http` includes `nitr.csrf`, `nitr.session` and `nitr.cookie`, so signed
cookies and sessions work without `crypto`. Precompressed `.br` and
`.gz` files are served without the `compression` feature.

## Compiled in and enabled

A builtin must be **compiled in** (Cargo feature) **and enabled** at
runtime (`[std] features`, or `.builtins(...)`):

```toml
# Cargo.toml
nitr = { version = "0.0.0-beta.7", features = ["db"] }
```

```toml
# nitr.toml
[std]
features = ["json", "http", "log", "db"]

[database]
path = "data/app.db"
```

Or from the builder:

```rust
Server::builder()
    .builtins(Builtins::JSON | Builtins::HTTP | Builtins::LOG | Builtins::DATABASE)
    .database("data/app.db")
```

The two lists use different names. `db` is both a Cargo feature and a
`[std] features` name, `json` is only a `[std] features` name, and `tls`
is only a Cargo feature. Enabling something that was not compiled in
stops the server at startup with an error naming the Cargo feature to
add.

## The `Builtins` flags

`Builtins` is a bitflags type. Combine flags with `|`:

```rust
use nitr::Builtins;

Builtins::JSON | Builtins::HTTP | Builtins::LOG
Builtins::minimal()      // json, http, log, time, validate, base64, path, url
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

`.builtins(...)` replaces the `[std] features` list from a loaded
configuration. With neither, `Builtins::minimal()` applies.

> [!WARNING] `Builtins::all()` needs every Cargo feature
>
> It includes `FETCH`, `DATABASE`, `TEMPLATE` and `CRYPTO`, so on a build
> without those features the server fails at startup. Use it only with
> `features = ["all"]`.

## What you need for what

| Your Lua or config uses                         | You need                                   |
| ----------------------------------------------- | ------------------------------------------ |
| `nitr.db:*`                                     | `db`                                       |
| `nitr.fetch`, `nitr.await_all`                  | `fetch`                                    |
| `nitr.template:render`                          | `template`, plus `[templating] dir`        |
| `nitr.crypto.*`, `nitr.auth.*`                  | `crypto`                                   |
| `req:multipart(...)`                            | `multipart`                                |
| `part:save(...)`                                | `multipart`, plus `[multipart] upload_dir` |
| A `file` rule in a schema                       | `multipart`, plus `[multipart] upload_dir` |
| `[compression] enabled = true`                  | `compression`                              |
| `[tls] enabled = true`                          | `tls`                                      |
| `[openapi] enabled = true`, `nitr openapi`      | `openapi`                                  |
| `[swagger] enabled = true`, `nitr openapi --ui` | `swagger`                                  |
| Anything else                                   | nothing extra                              |

To build the binary with fewer features:

```sh
cargo install nitr-cli --version 0.0.0-beta.7 \
  --no-default-features --features db,template
```

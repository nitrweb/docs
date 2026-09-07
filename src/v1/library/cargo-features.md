# Cargo Features

Optional builtins are Cargo features, so a build only carries the
dependencies it actually uses.

|                                | Default features                                          |
| ------------------------------ | --------------------------------------------------------- |
| The **library** (`nitr` crate) | **none** — you opt in                                     |
| The **binary** (`nitr`)        | `all` — someone installing a server expects every builtin |

## The features

| Feature       | Enables                                              | Heaviest dependency              |
| ------------- | ---------------------------------------------------- | -------------------------------- |
| `fetch`       | `nitr.fetch`, `nitr.await_all`                       | `reqwest` (over `rustls`/`ring`) |
| `db`          | `nitr.db`, migrations, `nitr migrate`                | `rusqlite` (bundles SQLite)      |
| `template`    | `nitr.template`                                      | `minijinja`                      |
| `crypto`      | `nitr.crypto`, `nitr.auth`                           | `argon2`                         |
| `compression` | on-the-fly brotli/gzip responses                     | `brotli`, `flate2`               |
| `multipart`   | `req:multipart(fn)` file uploads                     | `multer`                         |
| `tls`         | inbound TLS termination (`[tls]`)                    | `rustls` (the `ring` provider)   |
| `openapi`     | the OpenAPI document (`[openapi]`, `nitr openapi`)   | — (pure `cfg`)                   |
| `swagger`     | the Swagger UI page (`[swagger]`); implies `openapi` | — (≈1.7 MiB of vendored assets)  |
| `all`         | every feature above                                  | —                                |

`all` is exactly those nine. There is no `default` set: a plain
`cargo add nitr` compiles the minimal server.

`openapi` costs nothing but compiled code — there is no new dependency,
only the generator. `swagger` embeds the Swagger UI bundle, so it is the
one feature with real size; a build that wants the document but not the
page takes `openapi` alone.

```sh
cargo add nitr                              # minimal
cargo add nitr --features db,template       # plus SQLite and templates
cargo add nitr --features all               # everything
```

```toml
# Cargo.toml
nitr = { version = "0.0.0-beta.5", features = ["db", "template"] }
```

To track unreleased work, swap the version for a pinned git revision —
same feature list:

```toml
nitr = { git = "https://github.com/nitrweb/nitr", rev = "…", features = ["db"] }
```

## Always compiled in

These need nothing the server does not already depend on, so gating them
would save nothing:

`json` · `http` · `log` · `cache` · `dbg` · `time` · `validate` ·
`base64` · `path` · `url` · `env`

`nitr.csrf` and `nitr.session` come with `http`, not with `crypto`: their
signing key work is not the argon2 dependency, so a build with no
`crypto` feature still has signed cookies and sessions. Precompressed
`.br` / `.gz` sidecars are likewise served **without** the `compression`
feature — serving an already-compressed file needs no encoder, only a
`stat`.

## Two layers, not one

This is the part that confuses people. A builtin must be **compiled in**
_and_ **enabled at runtime**:

```toml
# Cargo.toml — compiled in
nitr = { version = "0.0.0-beta.5", features = ["db"] }
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

The two lists deliberately do not share a vocabulary. `db` is a Cargo
feature _and_ a `[std] features` name; `json` is only the latter, and
`tls` is only the former — it turns on a server capability, not a `nitr.*`
table, so nothing in `[std] features` names it.

> [!TIP] Getting it wrong is loud, not mysterious
>
> Configuring a builtin that was not compiled in is a **startup error
> naming the Cargo feature to enable** — not an "unknown std feature"
> puzzle, and not a `nil` value at the first request that touches it.
> `[tls] enabled = true` on a binary built without `tls` refuses to boot
> the same way, telling you to rebuild with `--features tls` (or `all`).

## The `Builtins` flags

`Builtins` is a bitflags type. Combine with `|`:

```rust
use nitr::Builtins;

Builtins::JSON | Builtins::HTTP | Builtins::LOG
Builtins::minimal()      // json, http, log, time, validate, base64, path, url
Builtins::all()          // every flag below — see the warning
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

> [!WARNING] `Builtins::all()` demands every Cargo feature
>
> It is the bitflags "all defined flags" constructor, not "everything
> this build has". On a binary compiled without `fetch`, asking for
> `Builtins::all()` includes `Builtins::FETCH` and the build fails at
> startup with the not-compiled-in error. Use it only alongside
> `features = ["all"]`; otherwise name the flags you want, or let a
> `[std] features` list do it.

`.builtins(...)` on the builder **overrides** the `[std] features` list
from a loaded configuration. Omit both and `Builtins::minimal()` applies.

## Sizing a build

Pick features by what your Lua actually calls:

```toml
# A JSON API over SQLite — no outbound HTTP, no templates, no argon2
nitr = { version = "0.0.0-beta.5", features = ["db"] }
```

```toml
# A server-rendered site with sessions
nitr = { version = "0.0.0-beta.5", features = ["db", "template", "crypto", "compression"] }
```

```toml
# A pure aggregator: fan out to upstreams, return JSON
nitr = { version = "0.0.0-beta.5", features = ["fetch"] }
```

```toml
# The same aggregator, terminating HTTPS itself instead of behind a proxy
nitr = { version = "0.0.0-beta.5", features = ["fetch", "tls"] }
```

The heavy ones are `fetch` (reqwest is over half of the full dependency
graph), `db` (bundles SQLite, so it also needs a C toolchain and
lengthens the build), `tls` (rustls and `tokio-rustls`) and `crypto`
(argon2). `tls` is cheaper than it looks in a build that already has
`fetch`: reqwest brings rustls in anyway, and Nitr picks the same `ring`
provider on purpose so the two share one copy.

For the binary, drop the defaults and name what you want:

```sh
cargo install nitr-cli --no-default-features --features db,template
```

## A feature checklist

| Your Lua or config does                         | You need                                   |
| ----------------------------------------------- | ------------------------------------------ |
| `nitr.db:*`                                     | `db`                                       |
| `nitr.fetch`, `nitr.await_all`                  | `fetch`                                    |
| `nitr.template:render`                          | `template`, plus `[templating] dir`        |
| `nitr.crypto.*`, `nitr.auth.*`                  | `crypto`                                   |
| `req:multipart(...)`                            | `multipart`                                |
| `part:save(...)` inside it                      | `multipart`, plus `[multipart] upload_dir` |
| `[compression] enabled = true`                  | `compression`                              |
| `[tls] enabled = true`                          | `tls`                                      |
| `[openapi] enabled = true`, `nitr openapi`      | `openapi`                                  |
| `[swagger] enabled = true`, `nitr openapi --ui` | `swagger`                                  |
| A `file` rule in a schema                       | `multipart`, plus `[multipart] upload_dir` |
| `nitr.csrf`, `nitr.session`                     | nothing extra — they ride with `http`      |
| everything else                                 | already there                              |

The two "plus a setting" rows are the same rule twice: Nitr will not
invent a directory for you. Without `[templating] dir` the `template`
builtin has nowhere to load from, and without `[multipart] upload_dir`
`part:save` is unavailable rather than writing an uploaded file somewhere
nobody chose.

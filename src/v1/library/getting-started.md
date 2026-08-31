# Getting Started (Library)

Embedding Nitr in a Rust program, from an empty directory to a running
server with your own Rust module in it.

## 1. The dependency

`nitr` is on crates.io:

```sh
cargo add nitr
cargo add nitr --features db,template     # plus SQLite and templates
cargo add nitr --features all             # everything
```

```toml
# Cargo.toml
[dependencies]
nitr = "0.0.0-beta.3"
tokio = { version = "1", features = ["full"] }

# Optional, but you will want logs:
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
```

The rendered API reference is at [docs.rs/nitr](https://docs.rs/nitr),
built with every feature enabled, so items that need one are labelled
with it.

> [!WARNING] Nothing is enabled by default
>
> The **library** ships no optional builtin unless you ask for it, so a
> build carries only the dependencies it uses. (The `nitr` **binary** is
> the opposite: it enables `all`, because someone installing a server
> expects the whole standard library.) A plain `nitr = "0.0.0-beta.3"`
> still gives you routing, static files, and the builtins with no
> exclusive dependency — `json`, `http`, `log`, `cache`, `time`,
> `validate`, `base64`, `path`, `url`, `env`, `dbg`. See [Cargo
> features](./cargo-features).

> [!NOTE] Two feature lists, different names
>
> Cargo features (`db`, `template`, `crypto`, `fetch`, `compression`,
> `multipart`, `tls`) decide what is **compiled in**. The runtime
> `[std] features` list — `json`, `http`, `log`, `db`, … — decides what
> is **exposed to Lua**. Writing `features = ["json"]` in `Cargo.toml`
> is an error: there is no such Cargo feature.

To track unreleased work instead of a release, depend on the repository
and pin a revision so the build stays reproducible:

```toml
nitr = { git = "https://github.com/nitrweb/nitr", rev = "…", features = ["db"] }
```

## 2. The server

```rust
// src/main.rs
use nitr::{Builtins, Server};

#[tokio::main]
async fn main() -> nitr::Result {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    Server::builder()
        .listen(([127, 0, 0, 1], 3000).into())
        .handler_script("app.lua")
        .builtins(Builtins::JSON | Builtins::HTTP | Builtins::LOG)
        .workers(4)
        .build()
        .await?
        .serve()
        .await
}
```

## 3. The Lua application

```lua
-- app.lua
local app = nitr.app()

app:get("/", function(req)
    return nitr.json({ ok = true })
end)

app:get("/hello/:name", function(req)
    return nitr.text("Hello, " .. req.params.name)
end)

app:on_error(function(err, req)
    nitr.log.error("handler failed", { error = err.message, kind = err.kind })
    return nitr.error(500, { code = "INTERNAL" })
end)

return app
```

```sh
cargo run
curl http://127.0.0.1:3000/hello/world
```

Everything about writing that Lua — routing, requests, responses,
middleware — is the [Server](../server/) section. It is identical
whether the process is `nitr` or your own binary.

## 4. Your own Rust, in Lua

This is the reason to embed at all:

```rust
use nitr::{Builtins, Server};

#[tokio::main]
async fn main() -> nitr::Result {
    Server::builder()
        .listen(([127, 0, 0, 1], 3000).into())
        .handler_script("app.lua")
        .builtins(Builtins::JSON | Builtins::HTTP)
        .module("slug", |lua| {
            let t = lua.create_table()?;
            t.set("slugify", lua.create_function(|_, input: String| {
                Ok(input.to_lowercase().replace(' ', "-"))
            })?)?;
            Ok(t)
        })
        .build()
        .await?
        .serve()
        .await
}
```

```lua
app:get("/slug", function(req)
    return nitr.text(nitr.ext.slug.slugify(req.query.title))
end)
```

Modules mount at `nitr.ext.<name>` — one level below the standard
library, so no future builtin can ever collide with yours. See
[Extension modules](./extension-modules).

## 5. Using a configuration file instead

The builder and `nitr.toml` are not alternatives; they compose:

```rust
use std::path::Path;

let cfg = nitr::Config::from_file(Path::new("nitr.toml"))?;

Server::builder()
    .config(cfg)                       // bulk-apply the file
    .module("slug", slug_module)       // add what the file cannot express
    .build()
    .await?
    .serve()
    .await
```

Setters called **after** `.config(...)` override it. This is usually the
right shape for a real application: operators tune `nitr.toml`, and your
Rust adds the modules. It is also the only way to reach the settings that
have no builder setter — `[tls]`, `[limits]`, `[cors]`, `[rate_limit]`,
`[multipart]`, `[cookies]` and the rest are public fields on `Config`.

To include the environment layering the binary does:

```rust
let mut cfg = nitr::Config::from_file(Path::new("nitr.toml"))?;
cfg.load_env_file(Path::new("."))?;   // the dotenv file
cfg.apply_env()?;                     // NITR_* overrides
```

Order matters and is the order the binary uses: the dotenv file loads
first so `apply_env` can see its values, and the real process environment
still wins, because loading never overwrites a variable that is already
set. See [Environment variables](../server/configuration/env).

## Project shape

```
my-server/
├── Cargo.toml
├── src/
│   └── main.rs        the server, and your modules
├── nitr.toml          optional: configuration
├── app.lua            routes and middleware
├── config.lua         optional: startup script
├── templates/
├── public/
└── tests/
```

Paths resolve against the **process working directory** — those passed to
the builder and those written in `nitr.toml` alike. The file does not
re-root them, so `cargo run` from the project root is what makes the tree
above line up.

The one exception is the dotenv file, and only because you choose it:
`load_env_file(base)` resolves a relative `[env] file` — and the implicit
`.env` — against the `base` you hand it. The binary passes the directory
holding `nitr.toml`; the snippet above passes the working directory.

`require` is a separate rule again: it is pinned to the directory
containing the handler script, and nothing outside it is loadable.

## Graceful shutdown

`serve()` already drains on `SIGTERM` and `ctrl-c`. To drain on your own
signal instead:

```rust
let server = Server::builder().config(cfg).build().await?;

server.serve_with_shutdown(async {
    my_shutdown_signal().await;
}).await
```

A drain that runs out of time returns `Error::ShutdownTimeout` rather
than succeeding quietly — a cut request is not a clean shutdown. See
[Errors](./errors).

## Next

- [Cargo features](./cargo-features) — sizing the dependency tree
- [`ServerBuilder`](./server-builder) — every method
- [Extension modules](./extension-modules) — stateful and async modules
- [Testing](./testing) — the in-process client
- [Examples](./examples) — runnable code for each subject

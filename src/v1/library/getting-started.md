# Getting Started (Library)

From an empty directory to a running server with your own Rust module
in it.

## The dependency

```sh
cargo add nitr
cargo add nitr --features db,template     # plus SQLite and templates
cargo add nitr --features all             # everything
```

```toml
# Cargo.toml
[dependencies]
nitr = "0.0.0-beta.7"
tokio = { version = "1", features = ["full"] }
tracing-subscriber = { version = "0.3", features = ["env-filter"] } # for logs
```

The library enables **no** optional feature by default, unlike the
`nitr` binary. Without features you still get routing, static files and
the `json`, `http`, `log`, `cache`, `time`, `validate`, `base64`, `path`,
`url`, `env` and `dbg` modules. See [Cargo features](./cargo-features).

To use unreleased code, depend on the repository at a fixed revision:

```toml
nitr = { git = "https://github.com/nitrweb/nitr", rev = "…", features = ["db"] }
```

## The server

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

## The Lua application

```lua
-- app.lua
local app = nitr.app()

app:get("/", function(req)
    return nitr.json({ ok = true })
end)

app:get("/hello/:name", function(req)
    return nitr.text("Hello, " .. req.params.name)
end)

return app
```

```sh
cargo run
curl http://127.0.0.1:3000/hello/world
```

Writing the Lua side (routing, requests, responses, middleware) works
the same as with the `nitr` binary. See the [Server](../server/)
section.

## Your own Rust in Lua

Register a module with `.module(name, closure)`. The table it returns is
available to Lua as `nitr.ext.<name>`:

```rust
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
```

```lua
app:get("/slug", function(req)
    return nitr.text(nitr.ext.slug.slugify(req.query.title))
end)
```

The closure uses [`mlua`](./extension-modules#depending-on-mlua), which
you add as a dependency. See [Extension modules](./extension-modules)
for shared state, async functions and errors.

## Using a configuration file

The builder and `nitr.toml` work together:

```rust
use std::path::Path;

let mut cfg = nitr::Config::from_file(Path::new("nitr.toml"))?;
cfg.load_env_file(Path::new("."))?;  // optional: the .env file
cfg.apply_env()?;                    // optional: NITR_* overrides

Server::builder()
    .config(cfg)                     // apply the file
    .module("slug", slug_module)     // add what the file cannot express
    .build()
    .await?
    .serve()
    .await
```

Setters called **after** `.config(...)` override the file. Settings
without a builder method (`[tls]`, `[limits]`, `[cors]` and the rest)
are public fields on `Config`. Load the `.env` file before `apply_env`,
as shown; variables already set in the process environment always win.
See [Environment variables](../server/configuration/env).

## Project layout

```
my-server/
├── Cargo.toml
├── src/
│   └── main.rs        the server and your modules
├── nitr.toml          optional: configuration
├── app.lua            routes and middleware
├── config.lua         optional: startup script
├── templates/
├── public/
└── tests/           optional: nitr test files
```

Relative paths, in the builder and in `nitr.toml`, resolve against the
**current working directory**, so run `cargo run` from the project root.
`load_env_file(base)` resolves the `.env` file against `base`. `require`
can only load files from the handler script's directory.

## Next

- [Cargo features](./cargo-features): choose what gets compiled in
- [`ServerBuilder`](./server-builder): every method, and graceful shutdown
- [Extension modules](./extension-modules): stateful and async modules
- [Testing](./testing): the in-process test client
- [Examples](./examples): runnable code

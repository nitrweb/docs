# Getting Started (Library)

Embedding Nitr in a Rust program, from an empty directory to a running
server with your own Rust module in it.

## 1. The dependency

There is no crates.io release yet, so depend on the repository:

```toml
# Cargo.toml
[dependencies]
nitr = { git = "https://github.com/nitrweb/nitr", features = ["json", "http", "log"] }
tokio = { version = "1", features = ["full"] }

# Optional, but you will want logs:
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
```

> [!WARNING] Nothing is enabled by default
>
> The **library** ships no builtins unless you ask for them, so a build
> carries only the dependencies it uses. (The `nitr` **binary** is the
> opposite: it enables `all`, because someone installing a server
> expects the whole standard library.) See [Cargo
> features](./cargo-features).

Pin a revision for reproducibility:

```toml
nitr = { git = "https://github.com/nitrweb/nitr", rev = "…", features = ["json"] }
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
let cfg = nitr::Config::from_file("nitr.toml")?;

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
Rust adds the modules.

To include the environment layering the binary does:

```rust
let mut cfg = nitr::Config::from_file("nitr.toml")?;
cfg.load_env_file(std::path::Path::new("."))?;   // the dotenv file
cfg.apply_env()?;                                // NITR_* overrides
```

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

Paths passed to the builder resolve against the **process working
directory**; paths inside a `nitr.toml` resolve against that file's
directory.

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

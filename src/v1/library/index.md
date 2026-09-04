# Library Overview

This section covers the `nitr` **crate**: embedding the server in your
own Rust program, and exposing your own Rust code to Lua.

If you just want to build a backend, you want the
[Server](../server/) section instead — the binary does everything below
except the last item.

## Why embed

| Reason                          | What it looks like                                                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Expose your own Rust to Lua** | [`ServerBuilder::module`](./extension-modules) mounts a table at `nitr.ext.<name>` in every state — the one thing the binary cannot do |
| **Own the process**             | Your `main` runs; Nitr is a component, not the entry point                                                                             |
| **Own the socket**              | Hand over an already-bound `TcpListener` — for the traffic port, the probe port, or both                                               |
| **Own the shutdown**            | `serve_with_shutdown()` drains on your signal, not just `SIGTERM`                                                                      |
| **Build a distributable**       | Ship one Rust binary that contains the server and your domain code                                                                     |
| **Use the Lua runtime alone**   | [`nitr::Runtime`](./runtime) — sandboxed Lua with no HTTP at all                                                                       |

## The smallest possible server

```toml
# Cargo.toml
[dependencies]
nitr = "0.0.0-beta.4"
tokio = { version = "1", features = ["full"] }
```

```rust
use nitr::{Builtins, Server};

#[tokio::main]
async fn main() -> nitr::Result {
    Server::builder()
        .listen(([127, 0, 0, 1], 3000).into())
        .handler_script("app.lua")
        .builtins(Builtins::JSON)
        .build()
        .await?
        .serve()          // SIGTERM/ctrl-c drains gracefully
        .await
}
```

```lua
-- app.lua
local app = nitr.app()
app:get("/", function(req) return nitr.json({ ok = true }) end)
return app
```

`cargo run`. That is the whole thing.

No Cargo feature is needed for that example: `nitr.json` is one of the
builtins compiled in unconditionally. Anything with a heavy dependency of
its own — SQLite, minijinja, reqwest, argon2, rustls — is opt-in. See
[Cargo features](./cargo-features).

## Adding your own Rust

The point of embedding:

```rust
Server::builder()
    .handler_script("app.lua")
    .builtins(Builtins::JSON | Builtins::HTTP | Builtins::LOG)
    .module("greet", |lua| {
        let t = lua.create_table()?;
        t.set("hello", lua.create_function(|_, name: String| {
            Ok(format!("Hello, {name}!"))
        })?)?;
        Ok(t)
    })
    .build()
    .await?
    .serve()
    .await
```

```lua
app:get("/greet/:name", function(req)
    return nitr.text(nitr.ext.greet.hello(req.params.name))
end)
```

The closure runs **once per pooled state** (and again on every reload).
Rust owns what happens inside — shared state, I/O, native speed, no
sandbox limits. Lua only composes it, still under its own memory and
execution budget. See [Extension modules](./extension-modules).

## The workspace

| Crate       | What it is                                             | Stability                      |
| ----------- | ------------------------------------------------------ | ------------------------------ |
| **`nitr`**  | The **facade** — the supported entry point             | Standard semver                |
| `nitr-core` | Sandboxed Lua runtime, state pool, diagnostics, errors | Unstable pre-1.0               |
| `nitr-std`  | The `nitr.*` standard library                          | Unstable pre-1.0               |
| `nitr-http` | hyper server, configuration, HTTP↔Lua bridge           | Unstable pre-1.0               |
| `nitr-cli`  | The `nitr` binary                                      | Flags follow the config policy |

All five are published on crates.io at **0.0.0-beta.4**, and each has a
rendered API reference on docs.rs — [`nitr`](https://docs.rs/nitr) is the
one to read.

**Depend on `nitr`.** The inner crates are published and usable, but
explicitly move as fast as development needs. The [extension
contract](./extension-modules) (`ServerBuilder::module`, `nitr_table`,
`mount`, `ModuleFn`) is the part expected to settle first. See
[Stability](../stability).

## Reading order

| Page                                     | What is in it                                            |
| ---------------------------------------- | -------------------------------------------------------- |
| [Getting started](./getting-started)     | Dependency, first server, project shape                  |
| [Cargo features](./cargo-features)       | Which feature brings which builtin, and which dependency |
| [`ServerBuilder`](./server-builder)      | Every builder method, `serve` vs `serve_with_shutdown`   |
| [Extension modules](./extension-modules) | `nitr.ext.*`: stateless, stateful, async                 |
| [`Runtime`](./runtime)                   | The low-level Lua runtime, with no HTTP                  |
| [Errors](./errors)                       | `nitr::Error`, `ErrorInfo`, panic containment            |
| [Testing](./testing)                     | `TestClient`, and binding port 0                         |
| [Examples](./examples)                   | The runnable examples in the repository                  |

## What the library shares with the binary

Everything except the extension modules: the same sandbox, the same
`nitr.*` standard library, the same router, the same
[configuration](../server/configuration/) types. A `Config` loaded from
`nitr.toml` can be handed to the builder directly:

```rust
use std::path::Path;

let cfg = nitr::Config::from_file(Path::new("nitr.toml"))?;
Server::builder().config(cfg).build().await?.serve().await
```

Setters called after `.config(...)` override what it loaded. That is also
how the settings with no builder setter of their own reach the server —
`[tls]`, `[limits]`, `[cors]`, `[rate_limit]` and the rest are fields on
`Config`, set on the struct rather than through a method. See
[`ServerBuilder`](./server-builder).

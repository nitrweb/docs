# Library Overview

This section covers the `nitr` **crate**: running the server inside your
own Rust program, and calling your own Rust code from Lua.

If you only want to build a backend, use the [Server](../server/)
section instead. The `nitr` binary does everything below except run your
own Rust code.

## Why embed

| Reason                          | What it looks like                                                               |
| ------------------------------- | -------------------------------------------------------------------------------- |
| **Call your own Rust from Lua** | [`ServerBuilder::module`](./extension-modules) adds a table at `nitr.ext.<name>` |
| **Own the process**             | Your `main` runs; Nitr is a component, not the entry point                       |
| **Own the socket**              | Pass an already-bound `TcpListener` for the main port, the health port, or both  |
| **Own the shutdown**            | `serve_with_shutdown()` stops on your own signal, not only `SIGTERM`             |
| **Ship one binary**             | One Rust binary with the server and your domain code                             |
| **Use the Lua runtime alone**   | [`nitr::Runtime`](./runtime): sandboxed Lua without HTTP                         |

## The smallest server

```toml
# Cargo.toml
[dependencies]
nitr = "0.0.0-beta.6"
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
        .serve() // stops gracefully on SIGTERM or ctrl-c
        .await
}
```

```lua
-- app.lua
local app = nitr.app()
app:get("/", function(req) return nitr.json({ ok = true }) end)
return app
```

Run it with `cargo run`. This needs no Cargo feature; modules with large
dependencies (SQLite, templates, outbound HTTP, argon2, TLS) are opt-in.
See [Cargo features](./cargo-features). To add your own Rust module,
continue with [Getting started](./getting-started#your-own-rust-in-lua).

## The crates

| Crate       | What it is                                             | Stability                      |
| ----------- | ------------------------------------------------------ | ------------------------------ |
| **`nitr`**  | The main crate; depend on this one                     | Standard semver                |
| `nitr-core` | Sandboxed Lua runtime, state pool, diagnostics, errors | Unstable before 1.0            |
| `nitr-std`  | The `nitr.*` standard library                          | Unstable before 1.0            |
| `nitr-http` | HTTP server, configuration, HTTP↔Lua bridge            | Unstable before 1.0            |
| `nitr-cli`  | The `nitr` binary                                      | Flags follow the config policy |

All five are on crates.io at **0.0.0-beta.6**. The API reference is on
[docs.rs/nitr](https://docs.rs/nitr). The `nitr` crate re-exports what
you need from the others. The [extension
API](./extension-modules) (`ServerBuilder::module`, `nitr_table`,
`mount`, `ModuleFn`) is expected to stabilize first. See
[Stability](../stability).

## Pages in this section

| Page                                     | What is in it                                        |
| ---------------------------------------- | ---------------------------------------------------- |
| [Getting started](./getting-started)     | Dependency, first server, your first module          |
| [Cargo features](./cargo-features)       | Which feature enables which builtin                  |
| [`ServerBuilder`](./server-builder)      | Every builder method, TLS, `Server` methods, signals |
| [Extension modules](./extension-modules) | `nitr.ext.*`: stateless, stateful and async modules  |
| [`Runtime`](./runtime)                   | The Lua runtime without HTTP                         |
| [Errors](./errors)                       | `nitr::Error`, `ErrorInfo`, panics                   |
| [Testing](./testing)                     | `TestClient`, and binding port 0                     |
| [Examples](./examples)                   | The runnable examples in the repository              |

Everything else is shared with the binary: the same sandbox, the same
`nitr.*` library, the same router and the same
[configuration](../server/configuration/). A `Config` loaded from
`nitr.toml` can be passed to the builder; see
[Getting started](./getting-started#using-a-configuration-file).

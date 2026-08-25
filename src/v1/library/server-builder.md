# `ServerBuilder`

The builder is the Rust equivalent of `nitr.toml`, plus the one thing a
configuration file cannot express: [extension
modules](./extension-modules).

```rust
use nitr::{Builtins, Server};

#[tokio::main]
async fn main() -> nitr::Result {
    Server::builder()
        .listen(([127, 0, 0, 1], 3000).into())
        .handler_script("app.lua")
        .config_script("config.lua")
        .database("data/app.db")
        .templates_dir("templates")
        .builtins(Builtins::all())
        .workers(4)
        .module("greet", greet_module)
        .build()
        .await?
        .serve()
        .await
}
```

## Methods

### `config(cfg: Config) -> Self`

Bulk-applies a loaded configuration — typically from `nitr.toml`.
**Setters called afterwards override it.**

```rust
let cfg = nitr::Config::from_file("nitr.toml")?;
Server::builder()
    .config(cfg)
    .workers(8)         // wins over whatever the file said
```

This is usually the right shape for a real application: operators tune
the file, your Rust adds what only Rust can.

### `listen(addr: SocketAddr) -> Self`

The address to bind.

```rust
.listen(([127, 0, 0, 1], 3000).into())
.listen("0.0.0.0:8080".parse().unwrap())
```

### `listener(listener: TcpListener) -> Self`

Serve on an **already-bound** listener instead of binding `listen`.

This closes the window between choosing a port and binding it: bind port
`0`, let the OS pick, read the real address, and hand the listener over
— nothing can take the port in between. That makes it the right tool for
tests and for socket-activation setups where a supervisor owns the
socket.

```rust
let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
let addr = listener.local_addr()?;         // the real port, before serving

let server = Server::builder()
    .listener(listener)
    .handler_script("app.lua")
    .build()
    .await?;
```

### `handler_script(path) -> Self`

The Lua script that returns `nitr.app()`. Runs once per pooled state.

### `config_script(path) -> Self`

The script executed **exactly once** at startup; its returned table is
snapshotted into every state as `nitr.cfg`. Optional.

### `database(path) -> Self`

The SQLite file for the `nitr.db` builtin. Needs the `db` [Cargo
feature](./cargo-features) and `Builtins::DATABASE`.

### `templates_dir(path) -> Self`

Where `nitr.template` loads minijinja templates from.

### `builtins(builtins: Builtins) -> Self`

Which `nitr.*` modules to expose. **Overrides** the `[std] features`
list from a loaded configuration; without either, the minimal set
applies.

```rust
.builtins(Builtins::JSON | Builtins::HTTP | Builtins::LOG)
.builtins(Builtins::minimal())
.builtins(Builtins::all())
```

See [Cargo features](./cargo-features#the-builtins-flags).

### `workers(n: usize) -> Self`

The number of pooled Lua states — the maximum number of handlers
executing at once. Defaults to the CPU core count.

### `dev_mode(on: bool) -> Self`

Hot-reload the handler script on change, and include error details in
responses.

> [!DANGER] Never in production
>
> It leaks source paths, line numbers and tracebacks to whoever can
> cause an error.

### `module(name, f) -> Self`

Registers a Rust extension module. The closure runs once per pooled
state (and again on every reload), and the table it returns is mounted
at `nitr.ext.<name>`.

```rust
.module("greet", |lua| {
    let t = lua.create_table()?;
    t.set("hello", lua.create_function(|_, name: String| {
        Ok(format!("Hello, {name}!"))
    })?)?;
    Ok(t)
})
```

```lua
nitr.ext.greet.hello("world")
```

**Registering two modules under the same name fails at build time** —
extensions cannot silently shadow each other. Mounting under `nitr.ext`
rather than `nitr` is what guarantees no future builtin can collide with
yours. See [Extension modules](./extension-modules).

### `setup(f) -> Self`

The low-level escape hatch behind `module()`: a closure that customizes
each pooled Lua state, running once per state before the config script
and handler are loaded.

```rust
.setup(|lua| {
    lua.globals().set("APP_VERSION", env!("CARGO_PKG_VERSION"))?;
    Ok(())
})
```

> [!WARNING] Not covered by any stability promise
>
> `setup` can register globals outside the `nitr` namespace and
> otherwise reshape the state. Behaviour reachable only through it is
> [explicitly not promised](../stability#what-is-deliberately-not-promised)
> — it is sharp by design. Prefer `module()`.

### `build() -> Result<Server>`

Creates the runtime pool, runs the configuration script exactly once,
snapshots its result into every state, and validates the whole
configuration.

Everything that can fail, fails here — a missing script, an unknown
configuration key, a builtin that was not compiled in, a pending
migration — rather than at the first request.

## `Server`

| Method                               | Description                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| `serve() -> Result`                  | Serves until a shutdown signal arrives, then drains gracefully                |
| `serve_with_shutdown(fut) -> Result` | Serves until `fut` resolves, then drains                                      |
| `test_client() -> TestClient`        | An in-process client through the real dispatch path. See [Testing](./testing) |
| `pool() -> Arc<RuntimePool>`         | The Lua state pool                                                            |
| `is_ready() -> bool`                 | What `/readyz` reports                                                        |

### The signal contract

| Signal    | Meaning                                              |
| --------- | ---------------------------------------------------- |
| `SIGTERM` | Graceful shutdown — what containers and systemd send |
| `SIGINT`  | Graceful shutdown (ctrl-c)                           |
| `SIGHUP`  | Reload the runtime pool, keeping connections alive   |

On Windows only ctrl-c is available; the others are not wired.

### Your own shutdown signal

```rust
let server = Server::builder().config(cfg).build().await?;

server.serve_with_shutdown(async {
    tokio::signal::ctrl_c().await.ok();
    tracing::info!("draining");
}).await
```

A drain that runs out of time returns `Error::ShutdownTimeout` instead
of succeeding quietly — surface it, do not swallow it. See
[Errors](./errors).

## A complete program

```rust
use nitr::{Builtins, Server};

#[tokio::main]
async fn main() -> nitr::Result {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    // The file carries the operational knobs; the builder carries the code.
    let mut cfg = nitr::Config::from_file("nitr.toml")?;
    cfg.load_env_file(std::path::Path::new("."))?;
    cfg.apply_env()?;

    Server::builder()
        .config(cfg)
        .module("slug", slug_module)
        .module("kv", kv_module(Kv::default()))
        .build()
        .await?
        .serve()
        .await
}
```

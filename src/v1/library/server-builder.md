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
        .builtins(Builtins::JSON | Builtins::HTTP | Builtins::LOG)
        .workers(4)
        .module("greet", greet_module)
        .build()
        .await?
        .serve()
        .await
}
```

There are fourteen methods, and they are a deliberately small slice of
`nitr.toml`: the ones an embedder sets in code. Everything else —
`[limits]`, `[cors]`, `[rate_limit]`, `[tls]`, `[multipart]`,
`[cookies]`, `[health]`, `[log]` — is a public field on `Config`, set on
the struct and handed over with [`config()`](#config-cfg-config-self).
A setter per key would be a second, drifting copy of the configuration
schema.

## Methods

### `config(cfg: Config) -> Self`

Bulk-applies a loaded configuration — typically from `nitr.toml`.
**Setters called afterwards override it.**

```rust
use std::path::Path;

let cfg = nitr::Config::from_file(Path::new("nitr.toml"))?;
Server::builder()
    .config(cfg)
    .workers(8)         // wins over whatever the file said
```

This is usually the right shape for a real application: operators tune
the file, your Rust adds what only Rust can. It is also how you set
anything without a setter — build the `Config` value yourself:

```rust
let cfg = nitr::Config {
    handler_script: "app.lua".into(),
    listen: ([127, 0, 0, 1], 3000).into(),
    ..nitr::Config::default()
};
Server::builder().config(cfg)
```

### `listen(addr: SocketAddr) -> Self`

The address to bind.

```rust
.listen(([127, 0, 0, 1], 3000).into())
.listen("0.0.0.0:8080".parse().unwrap())
```

### `listener(listener: TcpListener) -> Self`

Serve on an **already-bound** `std::net::TcpListener` instead of binding
`listen`.

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

### `health_listener(listener: TcpListener) -> Self`

The same trick for the probe port: serve `/healthz` and `/readyz` on an
already-bound listener instead of binding `[health] bind`. Ignored when
`[health] enabled` is off, and irrelevant when the probes answer on the
main listener — which is what they do when `[health] bind` is unset.

### `handler_script(path) -> Self`

The Lua script that returns `nitr.app()`. Loaded **once per pooled
state**, at build and on every reload — not per request. Routes and
middleware are therefore composed once.

### `config_script(path) -> Self`

The script executed **exactly once** at startup, in a bootstrap state;
the table it returns is snapshotted into every other state and exposed as
`nitr.cfg`. Optional.

Exactly once is the point: the other states get the snapshot rather than
re-running the script, so its side effects — creating a schema, seeding a
row — happen a single time no matter how many workers there are. A state
recycled after a panic gets the snapshot too, never a second execution.

### `templates_dir(path) -> Self`

Where `nitr.template` loads minijinja templates from — the same setting
as `[templating] dir`.

### `database(path) -> Self`

The SQLite file for the `nitr.db` builtin. Needs the `db` [Cargo
feature](./cargo-features) and `Builtins::DATABASE`. When a `[database]`
section already came from a loaded configuration this replaces only the
path; the pragmas stay as configured.

### `builtins(builtins: Builtins) -> Self`

Which `nitr.*` modules to expose. **Overrides** the `[std] features`
list from a loaded configuration; without either,
`Builtins::minimal()` applies.

```rust
.builtins(Builtins::JSON | Builtins::HTTP | Builtins::LOG)
.builtins(Builtins::minimal())
```

See [Cargo features](./cargo-features#the-builtins-flags), including why
`Builtins::all()` is only safe on a build with every Cargo feature.

### `workers(n: usize) -> Self`

The number of pooled Lua states — the maximum number of handlers
executing at once. Defaults to the CPU core count.

### `dev_mode(on: bool) -> Self`

Hot-reload on change, and include error details in responses.

The watcher covers what a rebuild actually reads: the handler script's
directory tree (so `require`d modules and `routes/` count), the
configuration script, and the templates directory. Nothing else — above
all not the SQLite file and its WAL sidecars, which live in that same
tree and which the configuration script may write _during_ the rebuild.
Reacting to those would turn one save into an endless reload loop. Static
files need no watching either; they are read from disk per request.

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
each pooled Lua state. It runs once per state, after the builtins and
extension modules are registered and before the configuration script and
handler are loaded.

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

An `async fn`. It validates the whole configuration, resolves the
builtins, creates the runtime pool, runs the configuration script exactly
once, snapshots its result into every state, and compiles the handler.

Everything that can fail, fails here rather than at the first request:

| Checked at build                             | Why not later                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Configuration validity                       | A contradictory policy would otherwise surface as a header combination a browser quietly ignores |
| Unknown or removed keys                      | A stale deployment manifest should be an error, not a setting that does nothing                  |
| A builtin not compiled in                    | Naming the Cargo feature beats a `nil` at the first request that touches it                      |
| Pending migrations                           | Applying them at boot is how two instances of a rolling deploy race to change one schema         |
| Missing scripts, templates, upload directory | A path typo is cheaper to find now                                                               |
| The TLS certificate and key                  | Read once, before a port exists — see below                                                      |

## TLS

There is **no TLS setter on the builder**. `[tls]` is a `TlsConfig` field
on `Config`, and reaches the server through `.config(...)`:

```rust
let cfg = nitr::Config {
    handler_script: "app.lua".into(),
    listen: ([0, 0, 0, 0], 443).into(),
    tls: nitr::TlsConfig {
        enabled: true,
        cert: Some("/etc/nitr/tls/fullchain.pem".into()),  // leaf, then intermediates
        key: Some("/etc/nitr/tls/privkey.pem".into()),     // PKCS#8, PKCS#1 or SEC1
        min_version: Some("1.2".into()),                   // the default and the floor
        handshake_ms: None,                                // min(header_read_ms, 10s)
    },
    ..nitr::Config::default()
};

Server::builder().config(cfg).build().await?.serve().await
```

Requires the `tls` [Cargo feature](./cargo-features); `enabled = true`
without it is a startup error that says so.

`build()` is where both PEM files are read — once, before a port exists —
so a mismatched or half-written pair fails the build instead of producing
a listener that accepts TCP and then fails every handshake, which from
the outside is indistinguishable from a network fault. Every connection
afterwards clones an `Arc` rather than touching the filesystem.

> [!WARNING] `enabled = true` converts the listener, it does not add one
>
> The address in `listen` speaks HTTPS and nothing answers plaintext
> there. There is no dual-listener mode and nothing redirects for you.
> See [TLS](../server/tls) for the redirect pattern and for why HSTS is
> the handler's job.

## `Server`

| Method                               | Description                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| `serve() -> Result`                  | Serves until a shutdown signal arrives, then drains gracefully                |
| `serve_with_shutdown(fut) -> Result` | Serves until `fut` resolves, then drains                                      |
| `test_client() -> TestClient`        | An in-process client through the real dispatch path. See [Testing](./testing) |
| `pool() -> Arc<RuntimePool>`         | The Lua state pool currently serving requests                                 |
| `is_ready() -> bool`                 | What `/readyz` reports; cleared the moment a drain starts                     |

Both `serve` methods take `self`, so the server is consumed by running
it. Read `pool()`, `is_ready()` or `test_client()` before that.

### The signal contract

| Signal    | Meaning                                              |
| --------- | ---------------------------------------------------- |
| `SIGTERM` | Graceful shutdown — what containers and systemd send |
| `SIGINT`  | Graceful shutdown (ctrl-c)                           |
| `SIGHUP`  | Reload the runtime pool, keeping connections alive   |

On Windows only ctrl-c is available; the others are not wired.

### What a reload does, and does not, refresh

`SIGHUP` builds a complete replacement pool — re-running the
configuration script — and swaps it in atomically. In-flight requests
finish on the old pool, which is dropped when its last guard returns. On
any error the old pool stays.

With `[tls]` enabled the certificate and key are re-read too, and the two
halves are independent: a failed TLS re-read keeps the old acceptor while
the pool still reloads, and vice versa. The acceptor is swapped only when
the new pair validates — a server that stops terminating TLS because
certbot wrote a half-file is strictly worse than a stale certificate.
Connections already established keep the acceptor they negotiated with.

Everything else needs a restart, and the boundary is deliberate rather
than incidental: **`nitr.toml` itself is never re-read.** The listen
address, the worker count, the limits, the rate limit, the request-id
trust setting, the CORS and compression policies, the cache and its
capacity — all are compiled at build and fixed for the process's life. A
reload re-runs the configuration _script_ and re-reads the certificate
_files_; that is the whole list.

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
use std::path::Path;

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
    let mut cfg = nitr::Config::from_file(Path::new("nitr.toml"))?;
    cfg.load_env_file(Path::new("."))?;
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

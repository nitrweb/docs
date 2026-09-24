# `ServerBuilder`

The builder sets up a server in Rust. It covers the settings you usually
set in code, plus [extension modules](./extension-modules), which a
configuration file cannot express.

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

Every other setting (`[limits]`, `[cors]`, `[rate_limit]`, `[tls]`,
`[multipart]`, `[cookies]`, `[health]`, `[log]` and so on) is a public
field on `Config`, passed in with [`config()`](#config).

## Methods

| Method                                            | What it does                                                                                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [`config(cfg: Config)`](#config)                  | Applies a whole configuration. Setters called afterwards override it.                                                                         |
| `listen(addr: SocketAddr)`                        | The address to bind.                                                                                                                          |
| [`listener(l: std::net::TcpListener)`](#listener) | Serve on an already-bound listener instead of binding `listen`.                                                                               |
| `health_listener(l: std::net::TcpListener)`       | The same for the `/healthz` and `/readyz` port (`[health] bind`). Ignored when `[health] enabled` is off.                                     |
| `handler_script(path)`                            | The Lua script that returns `nitr.app()`. Loaded once per Lua state, at build and on reload.                                                  |
| `config_script(path)`                             | Optional script run **once** at startup; the table it returns becomes `nitr.cfg` in every state.                                              |
| `templates_dir(path)`                             | Where `nitr.template` loads templates from (`[templating] dir`).                                                                              |
| `database(path)`                                  | The SQLite file for `nitr.db` (`[database] path`). Needs the `db` feature and `Builtins::DATABASE`.                                           |
| `builtins(b: Builtins)`                           | Which `nitr.*` modules to enable. Replaces `[std] features`; default `Builtins::minimal()`. See [flags](./cargo-features#the-builtins-flags). |
| `workers(n: usize)`                               | Number of Lua states, which is the maximum number of handlers running at once. Default: CPU core count.                                       |
| [`cache(c: nitr::stdlib::Cache)`](#cache)         | Use this cache for `nitr.cache` instead of a new one.                                                                                         |
| [`dev_mode(on: bool)`](#dev-mode)                 | Reload on file changes and show error details in responses.                                                                                   |
| [`module(name, f)`](#module)                      | Adds a Rust module at `nitr.ext.<name>`.                                                                                                      |
| [`setup(f)`](#setup)                              | Runs a closure on each Lua state. Low-level; prefer `module`.                                                                                 |
| [`build()`](#build)                               | `async`. Validates everything and returns a `Server`.                                                                                         |

### `config`

Pass a `Config` loaded from `nitr.toml`, or build one in code:

```rust
use std::path::Path;

let cfg = nitr::Config::from_file(Path::new("nitr.toml"))?;
let builder = Server::builder()
    .config(cfg)
    .workers(8); // overrides the file
```

```rust
let cfg = nitr::Config {
    handler_script: "app.lua".into(),
    listen: ([127, 0, 0, 1], 3000).into(),
    ..nitr::Config::default()
};
let builder = Server::builder().config(cfg);
```

### `listener`

Bind port `0`, read the port the OS picked, then hand the listener over.
No other process can take the port in between, which makes this useful
for tests and for supervisors that own the socket.

```rust
let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
let addr = listener.local_addr()?; // the real port

let server = Server::builder()
    .listener(listener)
    .handler_script("app.lua")
    .build()
    .await?;
```

### `cache`

Share one cache with code outside the server, for example a test that
checks what a handler stored. Ignored when the `cache` builtin is off.

```rust
use nitr::stdlib::{Cache, CacheOptions};

let cache = Cache::new(CacheOptions::default());
let server = Server::builder()
    .handler_script("app.lua")
    .cache(cache.clone())
    .build()
    .await?;
```

### `dev_mode`

Reloads when the handler script's directory, the configuration script
or the templates change. The SQLite files are not watched.

> [!DANGER] Never in production
>
> Error responses then include source paths, line numbers and tracebacks.

### `module`

The closure runs once per Lua state (and again on every reload). The
table it returns is available as `nitr.ext.<name>`. Two modules with the
same name fail at build time.

```rust
.module("greet", |lua| {
    let t = lua.create_table()?;
    t.set("hello", lua.create_function(|_, name: String| {
        Ok(format!("Hello, {name}!"))
    })?)?;
    Ok(t)
})
```

See [Extension modules](./extension-modules).

### `setup`

A closure that runs once per Lua state, after the builtins and modules
are registered and before the scripts load. It can change anything in
the state, including globals outside `nitr`.

```rust
.setup(|lua| {
    lua.globals().set("APP_VERSION", env!("CARGO_PKG_VERSION"))?;
    Ok(())
})
```

What you do through `setup` is [not covered by the stability
policy](../stability#what-is-deliberately-not-promised). Prefer
`module()`.

### `build`

Validates the configuration, creates the Lua states, runs the
configuration script once and loads the handler. Problems are reported
here, before any port is bound:

- invalid or unknown configuration keys;
- a builtin that was not compiled in (the error names the Cargo feature);
- pending database migrations (run `nitr migrate` first);
- missing scripts, templates or upload directory;
- an invalid TLS certificate or key.

## TLS

The builder has no TLS method. Set `tls` on `Config` and pass it with
`.config(...)`. This needs the `tls` [Cargo feature](./cargo-features).

```rust
let cfg = nitr::Config {
    handler_script: "app.lua".into(),
    listen: ([0, 0, 0, 0], 443).into(),
    tls: nitr::TlsConfig {
        enabled: true,
        cert: Some("/etc/nitr/tls/fullchain.pem".into()), // leaf, then intermediates
        key: Some("/etc/nitr/tls/privkey.pem".into()),    // PKCS#8, PKCS#1 or SEC1
        min_version: None,                                // "1.2" (default) or "1.3"
        handshake_ms: None,                               // default: min(header_read_ms, 10 s)
    },
    ..nitr::Config::default()
};

Server::builder().config(cfg).build().await?.serve().await
```

With TLS enabled, the `listen` address serves HTTPS only. There is no
plain-HTTP listener or redirect alongside it. See [TLS](../server/tls).

## `Server`

| Method                                           | Description                                                                                           |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `serve() -> Result`                              | Serves until `SIGTERM` or ctrl-c, then drains gracefully.                                             |
| `serve_with_shutdown(fut) -> Result`             | Serves until `fut` completes, then drains.                                                            |
| `test_client() -> TestClient`                    | An in-process client. See [Testing](./testing).                                                       |
| `pool() -> Arc<RuntimePool>`                     | The pool of Lua states currently serving requests.                                                    |
| `is_ready() -> bool`                             | What `/readyz` reports; turns `false` when shutdown starts.                                           |
| `cfg_snapshot() -> Option<&serde_json::Value>`   | The table the configuration script returned (`nitr.cfg`), or `None` without one.                      |
| `openapi_json() -> Option<Bytes>`                | The [OpenAPI document](../server/openapi/), as `nitr openapi` prints it. Needs the `openapi` feature. |
| `openapi_site() -> Option<Vec<(String, Bytes)>>` | The Swagger UI page, the document and its assets, as file names and contents. Needs `swagger`.        |

Both `serve` methods consume the server, so call the other methods
first. The OpenAPI methods work even when `[openapi] enabled` is off.

```rust
let server = Server::builder().config(cfg).build().await?;
if let Some(spec) = server.openapi_json() {
    std::fs::write("openapi.json", &spec)?;
}
```

### Signals

| Signal    | Effect                                                     |
| --------- | ---------------------------------------------------------- |
| `SIGTERM` | Graceful shutdown                                          |
| `SIGINT`  | Graceful shutdown (ctrl-c)                                 |
| `SIGHUP`  | Reload the Lua states and TLS files; connections stay open |

On Windows only ctrl-c works.

A reload re-runs the configuration script and handler and re-reads the
TLS certificate and key. If something fails, the old version keeps
running. It does **not** re-read `nitr.toml`; configuration changes need
a restart. See [Deployment](../server/deployment/).

### Your own shutdown signal

```rust
let server = Server::builder().config(cfg).build().await?;

server.serve_with_shutdown(async {
    tokio::signal::ctrl_c().await.ok();
    tracing::info!("draining");
}).await
```

If the drain runs out of time (`[shutdown]`), `serve` returns
`Error::ShutdownTimeout`: some requests were cut off. Exit with a
non-zero code in that case. See [Errors](./errors).

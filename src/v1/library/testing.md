# Testing (Library)

Two ways to test an embedded Nitr server, depending on what you are
actually testing.

| You want to test                       | Use                                                         |
| -------------------------------------- | ----------------------------------------------------------- |
| Your Lua application's behaviour       | [`nitr test`](../server/testing) — the Lua framework        |
| Your Rust modules, or Rust-side wiring | `TestClient` — the in-process client, from `#[tokio::test]` |
| The whole thing over a real socket     | [`.listener(...)`](#binding-port-0) with port 0             |

## `TestClient`

`Server::test_client()` gives an in-process client that dispatches
through the **real** path — protection checks, router, middleware,
handler, streaming bodies collected — without binding a port. The types
live in `nitr::testing`.

```rust
use nitr::{Builtins, Server};

#[tokio::test]
async fn greets_by_name() -> nitr::Result {
    let server = Server::builder()
        .handler_script("app.lua")
        .builtins(Builtins::JSON | Builtins::HTTP)
        .workers(1)
        .build()
        .await?;

    let client = server.test_client();
    let resp = client.request("GET", "/hello/world", &[], None).await?;

    assert_eq!(resp.status, 200);
    assert_eq!(resp.body, "Hello, world".as_bytes());
    Ok(())
}
```

`TestClient` is `Clone`, so a concurrency test can hand one to several
tasks.

### `request(method, path_and_query, headers, body)`

| Parameter        | Type                            |
| ---------------- | ------------------------------- |
| `method`         | `&str` — case-insensitive       |
| `path_and_query` | `&str` — path plus query string |
| `headers`        | `&[(String, String)]`           |
| `body`           | `Option<Bytes>`                 |

An unparseable method or path is an `Error::Config`, not a panic — so a
malformed test request fails the assertion rather than the process.

Returns a `TestResponse`:

| Field / method                   | Description                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `status: u16`                    | HTTP status code                                                                                        |
| `headers: Vec<(String, String)>` | Header pairs **in response order** — repeated names appear repeatedly, so `Set-Cookie` is fully visible |
| `body: Bytes`                    | The collected body, streaming responses included                                                        |
| `.header(name) -> Option<&str>`  | The first value of a case-insensitive header                                                            |

> [!NOTE] What the in-process path does and does not simulate
>
> Everything above the socket runs for real: the rate limiter, the
> request-id policy, CORS and response compression all apply, and every
> response carries `X-Request-ID`. What is not real is the peer: every
> test request arrives from `127.0.0.1:0`, so a configured
> `[rate_limit]` counts your whole test as one client.

### Posting JSON

```rust
use bytes::Bytes;

let resp = client.request(
    "POST",
    "/api/notes",
    &[("content-type".into(), "application/json".into())],
    Some(Bytes::from(r#"{"text":"hello"}"#)),
).await?;

assert_eq!(resp.status, 201);
assert_eq!(resp.header("content-type"), Some("application/json"));
```

`Bytes` comes from the `bytes` crate, which the `nitr` facade does not
re-export — add `bytes = "1"` to your `[dev-dependencies]`.

### Testing an extension module end to end

The reason to use `TestClient` rather than `nitr test`: your Rust is in
the loop.

```rust
#[tokio::test]
async fn kv_module_counts_across_requests() -> nitr::Result {
    let server = Server::builder()
        .handler_script("tests/fixtures/kv.lua")
        .builtins(Builtins::JSON | Builtins::HTTP)
        .module("kv", kv_module(Kv::default()))
        .workers(2)                        // two states, one shared Rust handle
        .build()
        .await?;

    let client = server.test_client();

    for _ in 0..5 {
        client.request("PUT", "/inventory/widgets", &[], None).await?;
    }

    let resp = client.request("GET", "/inventory/widgets", &[], None).await?;
    assert_eq!(resp.body, br#"{"count":5}"#.as_slice());
    Ok(())
}
```

`workers(2)` is deliberate here: it proves the count is shared on the
Rust side rather than living in one state's Lua table.

## Binding port 0

For a test that must go over a real socket, `.listener(...)` closes the
window between choosing a port and binding it:

```rust
#[tokio::test]
async fn serves_over_tcp() -> nitr::Result {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
    let addr = listener.local_addr()?;      // the real port, before serving

    let server = Server::builder()
        .listener(listener)
        .handler_script("app.lua")
        .builtins(Builtins::JSON)
        .build()
        .await?;

    let (tx, rx) = tokio::sync::oneshot::channel();
    let handle = tokio::spawn(async move {
        server.serve_with_shutdown(async { rx.await.ok(); }).await
    });

    let body = reqwest::get(format!("http://{addr}/")).await.unwrap()
        .text().await.unwrap();
    assert_eq!(body, r#"{"ok":true}"#);

    tx.send(()).ok();
    handle.await.unwrap()
}
```

The OS picks the port and nothing else can take it in between, so
parallel tests never collide. `.health_listener(...)` does the same for
the probe port when a test needs both.

## Testing configuration

`build()` is where configuration errors surface, which makes them easy
to assert on:

```rust
use std::path::Path;

#[test]
fn rejects_an_unknown_key() {
    let err = nitr::Config::from_file(Path::new("tests/fixtures/bad.toml"))
        .unwrap_err();
    assert!(err.to_string().contains("hander_script"));
}
```

`Config::from_file` takes a `&Path`, and returns `Error::Config` with a
message naming the key. The same holds for a script that cannot load: it
never reaches a request, so the assertion belongs on `build()`.

```rust
let err = Server::builder()
    .handler_script("tests/fixtures/broken.lua")
    .build()
    .await
    .expect_err("a broken script must not build");
assert!(err.to_string().contains("broken.lua"));
```

## Isolating state

**The database.** Point each test at its own file, or a temporary
directory:

```rust
let dir = tempfile::tempdir()?;
Server::builder()
    .database(dir.path().join("test.db"))
```

**The cache.** `nitr.cache` is per-process, so tests in one binary share
it. Build a fresh `Server` per test, or clear the cache in a fixture.

**Workers.** `workers(1)` makes behaviour deterministic when you are
testing one request at a time; use more only when concurrency is the
thing under test.

## In CI

```yaml
- run: cargo test --all-features
- run: cargo clippy --all-targets --all-features
- run: cargo fmt --check
```

`--all-features` matters more than usual here: Nitr's optional builtins
are Cargo features, and configuring one that was not compiled in is a
startup error — so a test touching `nitr.db` or `nitr.fetch` fails at
`build()` rather than passing on a smaller build. If your project also
ships Lua tests, run both:

```yaml
- run: cargo test --all-features
- run: nitr test # next to nitr.toml
```

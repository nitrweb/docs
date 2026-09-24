# Testing (Library)

| You want to test                    | Use                                                        |
| ----------------------------------- | ---------------------------------------------------------- |
| Your Lua application                | [`nitr test`](../server/testing), the Lua test framework   |
| Your Rust modules or Rust setup     | `TestClient`, the in-process client, from `#[tokio::test]` |
| The whole server over a real socket | [`.listener(...)`](#binding-port-0) with port 0            |

## `TestClient`

`Server::test_client()` returns a client that sends requests through the
full server path (protection checks, router, middleware, handler)
without opening a port. The types are in `nitr::testing`.

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

`TestClient` is `Clone`, so several tasks can share one.

### `request(method, path_and_query, headers, body)`

| Parameter        | Type                                   |
| ---------------- | -------------------------------------- |
| `method`         | `&str`, any case                       |
| `path_and_query` | `&str`, the path plus any query string |
| `headers`        | `&[(String, String)]`                  |
| `body`           | `Option<Bytes>`                        |

An invalid method or path returns `Error::Config` instead of panicking.
It returns a `TestResponse`:

| Field / method                   | Description                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `status: u16`                    | HTTP status code                                                                    |
| `headers: Vec<(String, String)>` | Headers in response order; repeated names (like `Set-Cookie`) appear once per value |
| `body: Bytes`                    | The whole body, streaming responses included                                        |
| `error: Option<HandlerFailure>`  | Why the handler failed, when it did. See [below](#why-a-request-failed)             |
| `.header(name) -> Option<&str>`  | The first value of a header (case-insensitive)                                      |

The rate limiter, request ids, CORS and compression all apply. Every
request comes from `127.0.0.1:0` unless you set `remote_addr` with
[`send`](#send-testrequest), so `[rate_limit]` sees a single client.

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

`Bytes` comes from the `bytes` crate; add `bytes = "1"` to your
`[dev-dependencies]`.

### `send(TestRequest)`

`send` takes a `TestRequest`, which also sets the client address and a
timeout for the whole exchange:

```rust
use std::time::Duration;
use nitr::testing::TestRequest;

let resp = client.send(TestRequest {
    method: "GET".into(),
    path: "/api/notes".into(),
    remote_addr: Some("10.0.0.7:4000".parse().unwrap()), // what [rate_limit] sees
    timeout: Some(Duration::from_secs(2)),               // fails a stream that never ends
    ..TestRequest::default()
}).await?;
```

| Field         | Type                    | Default                       |
| ------------- | ----------------------- | ----------------------------- |
| `method`      | `String`                | required                      |
| `path`        | `String`                | required; may include a query |
| `headers`     | `Vec<(String, String)>` | none                          |
| `body`        | `Option<Bytes>`         | none                          |
| `remote_addr` | `Option<SocketAddr>`    | `127.0.0.1:0`                 |
| `timeout`     | `Option<Duration>`      | none                          |

### Why a request failed

When a handler raises an error, `resp.error` holds a `HandlerFailure`,
even without dev mode. Real clients never receive it.

```rust
let resp = client.request("GET", "/boom", &[], None).await?;
assert_eq!(resp.status, 500);

let failure = resp.error.expect("the handler raised");
assert_eq!(failure.info.kind, "lua");
assert!(failure.info.message.contains("nil value"));
assert!(failure.handled); // the app's on_error answered
```

`failure.info` is a [`nitr::ErrorInfo`](./errors#errorinfo), with the same
fields `on_error` receives in Lua.

### Server-Sent Events

`nitr::testing::parse_sse(&resp.body)` splits an event-stream body into
`SseEvent { event, data, id, retry }` values, in order.

### Testing an extension module

`TestClient` runs your Rust modules too:

```rust
#[tokio::test]
async fn kv_module_counts_across_requests() -> nitr::Result {
    let server = Server::builder()
        .handler_script("tests/fixtures/kv.lua")
        .builtins(Builtins::JSON | Builtins::HTTP)
        .module("kv", kv_module(Kv::default()))
        .workers(2) // two Lua states, one shared Rust counter
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

## Binding port 0

To test over a real socket, bind port 0 and pass the listener in. The OS
picks a free port, so parallel tests never collide:

```rust
#[tokio::test]
async fn serves_over_tcp() -> nitr::Result {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
    let addr = listener.local_addr()?;

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

`.health_listener(...)` does the same for the health-check port.

## Testing configuration

Configuration and script errors happen at load or `build()` time, so
test them there:

```rust
use std::path::Path;

#[test]
fn rejects_an_unknown_key() {
    let err = nitr::Config::from_file(Path::new("tests/fixtures/bad.toml"))
        .unwrap_err();
    assert!(err.to_string().contains("hander_script"));
}

#[tokio::test]
async fn rejects_a_broken_script() {
    let err = Server::builder()
        .handler_script("tests/fixtures/broken.lua")
        .build()
        .await
        .expect_err("a broken script must not build");
    assert!(err.to_string().contains("broken.lua"));
}
```

## Isolating state

- **Database:** give each test its own file:

  ```rust
  let dir = tempfile::tempdir()?;
  Server::builder().database(dir.path().join("test.db"))
  ```

- **Cache:** each `Server` has its own `nitr.cache`, unless you share one
  with [`.cache(...)`](./server-builder#cache).
- **Workers:** `workers(1)` keeps single-request tests predictable.

## In CI

```yaml
- run: cargo test --all-features
- run: nitr test # if you also have Lua tests, next to nitr.toml
```

Use `--all-features` (or your production feature list): a test that
needs `nitr.db` or `nitr.fetch` fails at `build()` when the feature is
not compiled in.

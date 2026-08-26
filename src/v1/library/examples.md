# Examples

The Nitr repository carries a runnable example per subject, each a small
`main.rs` plus the Lua it serves. Clone the repository and run them from
its root:

```sh
git clone https://github.com/nitrweb/nitr
cd nitr
cargo run --example hello
```

They live in
[`crates/nitr/examples/`](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples).

## `hello`

Minimal embedding: a Lua-scripted backend with a custom Rust extension
module mounted at `nitr.ext.hello`.

```sh
cargo run --example hello
curl 'http://127.0.0.1:3000/?name=Nitr'
```

**Start here** if you are embedding Nitr for the first time.

## `router`

`nitr.app()` routes with path parameters, global and per-route
middleware, response helpers, signed cookies and content negotiation.

```sh
cargo run --example router

curl 'http://127.0.0.1:3000/users/42'
curl -X POST 'http://127.0.0.1:3000/users' -d '{"name":"ada"}'
curl 'http://127.0.0.1:3000/admin' -H 'authorization: secret'
curl -c - 'http://127.0.0.1:3000/login'
```

Pairs with [Routing](../server/routing) and
[Middleware](../server/middleware).

## `stdlib`

A tour of `nitr.*`: response helpers, JSON, logging, and the crypto/auth
primitives — everything on the single namespace table, with no other
globals.

```sh
cargo run --example stdlib

curl 'http://127.0.0.1:3000/token'
curl -X POST 'http://127.0.0.1:3000/password' -d 'hunter2'
curl 'http://127.0.0.1:3000/secure'               # 401
```

Pairs with the [Lua API reference](../api/).

## `extension`

Rust extension modules: a **stateful** `kv` module sharing one handle
across every Lua state, and a **stateless** `slug` module. This is the
boundary that lets you build _Nitr + your own domain functions_ without
forking Nitr.

```sh
cargo run --example extension

curl 'http://127.0.0.1:3000/inventory/widgets'
curl -X PUT 'http://127.0.0.1:3000/inventory/widgets' -d '7'
curl 'http://127.0.0.1:3000/slugify?title=Hello%20World'
```

Pairs with [Extension modules](./extension-modules).

## `data-io`

SQLite that behaves under concurrency, SQL migrations, the shared
`nitr.cache`, and a `fetch` that retries, is bounded per request, and
cannot be tricked into a private address.

```sh
# Migrations are an explicit step: the server refuses to start with a
# pending one.
cargo run -- migrate --status -c crates/nitr/examples/data-io/nitr.toml
cargo run -- migrate          -c crates/nitr/examples/data-io/nitr.toml

cargo run --example data-io
```

Pairs with [Database](../server/database) and
[Outbound HTTP](../server/fetch).

## `aggregate`

API aggregation and transactions: `nitr.await_all` fans out concurrent
`nitr.fetch` requests, and `nitr.db:transaction` groups SQLite
statements atomically.

```sh
cargo run --example aggregate
curl 'http://127.0.0.1:3000/dashboard'
```

> [!NOTE] It opts into private-network fetches
>
> The fetch policy refuses loopback targets by default — this example
> aggregates _itself_ over loopback, so it explicitly allows them. Do
> not copy that setting into an application that fetches user-supplied
> URLs.

## `streaming`

Streaming response bodies: a writer-callback CSV download and a
coroutine-iterator body. Chunks reach the client as they are produced,
with backpressure when the client reads slowly.

```sh
cargo run --example streaming

curl 'http://127.0.0.1:3000/report.csv'                    # writer callback
curl 'http://127.0.0.1:3000/chunks'                        # coroutine iterator
curl --limit-rate 1K 'http://127.0.0.1:3000/report.csv'    # backpressure
```

Pairs with [Streaming & SSE](../server/streaming).

## `sse`

Server-Sent Events: a live ticker paced by a custom Rust `time` module
mounted through the `module()` extension point — the async-sleep pattern
that makes pacing free.

```sh
cargo run --example sse
curl -N 'http://127.0.0.1:3000/events'
```

## `standards`

HTTP standards completeness: range requests, response compression, CORS,
form and multipart bodies, and conditional dynamic responses. Everything
is enforced in Rust; the Lua side only declares intent.

```sh
cargo run --example standards

curl -i -H 'Range: bytes=0-15' 'http://127.0.0.1:3000/media/alphabet.txt'
curl -i -H 'Range: bytes=9999-' 'http://127.0.0.1:3000/media/alphabet.txt'  # 416
```

## `static-site`

Static and dynamic in one process: files under `public/` served entirely
in Rust (ETag/304, content types, traversal protection), `/api/*` routes
in Lua, and a second mount showing per-mount options.

```sh
cargo run --example static-site

curl -i 'http://127.0.0.1:3000/'                    # index.html
curl -i 'http://127.0.0.1:3000/assets/style.css'    # cache-control mount
curl -i 'http://127.0.0.1:3000/api/time'            # Lua route
curl -i 'http://127.0.0.1:3000/../etc/passwd'       # 404, not a leak
```

Pairs with [Static files](../server/static-files).

## `observability`

Structured logging from Lua, request ids on every response, per-client
rate limiting and request-size limits — the last three enforced in Rust
before Lua runs.

```sh
RUST_LOG=info,lua=debug cargo run --example observability

curl -i 'http://127.0.0.1:3000/'         # note the X-Request-ID header
for i in $(seq 1 6); do
  curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:3000/'
done                                     # 5 pass, then 429
```

Pairs with [Logging](../server/logging).

## `app-package`

Not an embedding example — the **conventional application layout** the
`nitr` CLI works with:

```
app-package/
├── nitr.toml       server + app configuration
├── app.lua         routes and middleware
├── config.lua      runs once at startup → nitr.cfg
├── public/         static files
└── tests/          *.lua for `nitr test`
```

```sh
cargo run -p nitr-cli -- -c crates/nitr/examples/app-package/nitr.toml check
cargo run -p nitr-cli -- -c crates/nitr/examples/app-package/nitr.toml test
cargo run -p nitr-cli -- -c crates/nitr/examples/app-package/nitr.toml run
```

In your own project you would simply run `nitr check` / `nitr test` /
`nitr dev` next to `nitr.toml`. Pairs with [Project
layout](../server/project-layout).

## Suggested path

| If you want to…      | Run                                                       |
| -------------------- | --------------------------------------------------------- |
| Embed Nitr at all    | `hello`                                                   |
| Write handlers       | `router`, then `stdlib`                                   |
| Add your own Rust    | `extension`                                               |
| Use a database       | `data-io`                                                 |
| Serve a site         | `static-site`, `standards`                                |
| Stream               | `streaming`, `sse`                                        |
| Run it in production | `observability`, then [Deployment](../server/deployment/) |

# Examples

Nitr ships **15 runnable examples**, one per subject. Each is a small
`main.rs` plus the Lua it serves, and every one runs with a single
command against a real server you can `curl`.

Browse them on GitHub:
**[crates/nitr/examples](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples)**

> [!TIP] `examples/` at the repo root is a symlink
>
> The files live in `crates/nitr/examples/`. The root `examples/` entry
> is a convenience symlink, which GitHub shows as a link rather than a
> browsable folder — so the URL above is the one to follow. Locally
> either path works.

## Run them

```sh
git clone https://github.com/nitrweb/nitr
cd nitr
cargo run --example hello
```

Every command below runs **from the repository root**. Every path inside
an example — `handler_script`, a static directory, a migrations folder —
is written relative to that root, so the working directory matters.

> [!NOTE] Some examples need a Cargo feature
>
> The `nitr` crate ships with `default = []`: nothing optional is
> compiled in unless you ask. An example that needs a feature declares
> it, and Cargo refuses to run it otherwise, naming what is missing. The
> commands below carry the right flag; `--features all` works for every
> one of them.

| Example                     | Needs                      |
| --------------------------- | -------------------------- |
| `basic-auth`, `bearer-auth` | `crypto`                   |
| `stdlib`                    | `crypto`, `fetch`          |
| `data-io`, `aggregate`      | `db`, `fetch`              |
| `standards`                 | `compression`, `multipart` |
| `tls`                       | `tls`                      |

Everything else — `hello`, `router`, `extension`, `streaming`, `sse`,
`static-site` and `observability` — builds on a plain `cargo run`.
`app-package` is not a Cargo example at all; it runs through the CLI.

## Where to start

| If you want to…             | Run                         |
| --------------------------- | --------------------------- |
| See the smallest embedding  | `hello`                     |
| Write routes and middleware | `router`, then `stdlib`     |
| Add your own Rust           | `extension`                 |
| Use a database              | `data-io`                   |
| Serve a website             | `static-site`, `standards`  |
| Stream a response           | `streaming`, `sse`          |
| Protect an endpoint         | `basic-auth`, `bearer-auth` |
| Terminate HTTPS             | `tls`                       |
| Run it in production        | `observability`             |
| Use the CLI, not the crate  | `app-package`               |

---

## `hello`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/hello)
· the minimal embedding

A Lua-scripted backend with a custom Rust extension module mounted at
`nitr.ext.hello`. **Start here** if you are embedding Nitr for the first
time.

```sh
cargo run --example hello
curl 'http://127.0.0.1:3000/?name=Nitr'
```

## `router`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/router)
· routing and middleware

`nitr.app()` routes with path parameters, global and per-route
middleware, response helpers, signed cookies and content negotiation —
plus streaming and SSE endpoints in the same app.

```sh
cargo run --example router

curl 'http://127.0.0.1:3000/users/42'
curl -X POST 'http://127.0.0.1:3000/users' -d '{"name":"ada"}'
curl 'http://127.0.0.1:3000/admin' -H 'authorization: secret'
curl -c - 'http://127.0.0.1:3000/login'
curl 'http://127.0.0.1:3000/data' -H 'accept: text/html'
curl -N 'http://127.0.0.1:3000/events'         # Server-Sent Events
```

Pairs with [Routing](./server/routing) and
[Middleware](./server/middleware).

## `stdlib`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/stdlib)
· a tour of `nitr.*`

Everything Nitr offers Lua lives on the single `nitr` namespace table —
response helpers, JSON, logging, and the crypto/auth primitives. There
are no other globals, so scripts never collide with the Lua standard
library.

```sh
cargo run --features crypto,fetch --example stdlib

curl 'http://127.0.0.1:3000/token'
curl -X POST 'http://127.0.0.1:3000/password' -d 'hunter2'
curl 'http://127.0.0.1:3000/secure'                      # 401
curl 'http://127.0.0.1:3000/secure' -H 'authorization: Bearer s3cret'
curl 'http://127.0.0.1:3000/whoami' -u 'ada:lovelace'
curl -X POST 'http://127.0.0.1:3000/jwt'
curl -c /tmp/jar -X POST 'http://127.0.0.1:3000/login'
curl -b /tmp/jar 'http://127.0.0.1:3000/profile'
```

Pairs with the [Lua API reference](./api/).

## `extension`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/extension)
· your own Rust at `nitr.ext.*`

The boundary that lets you build _Nitr plus your own domain functions_
without forking Nitr. A **stateful** `kv` module shares one handle across
every Lua state; a **stateless** `slug` module does string work that
would be slow in Lua. A third-party extension crate is nothing more than
a public function shaped like `kv_module`.

```sh
cargo run --example extension

curl 'http://127.0.0.1:3000/inventory/widgets'
curl -X PUT 'http://127.0.0.1:3000/inventory/widgets' -d '7'
curl 'http://127.0.0.1:3000/slugify?title=Hello%20World'
```

Pairs with [Extension modules](./library/extension-modules).

## `data-io`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/data-io)
· SQLite, migrations, cache, resilient fetch

SQLite that behaves under concurrency, SQL migrations, the shared
`nitr.cache`, and a `fetch` that retries, is bounded per request, and
cannot be tricked into a private address. It runs its own flaky upstream
that fails one request in three, so the retry path is visible rather
than theoretical.

```sh
# Migrations are an explicit step: the server refuses to start with a
# pending one.
cargo run -- migrate --status -c crates/nitr/examples/data-io/nitr.toml
cargo run -- migrate          -c crates/nitr/examples/data-io/nitr.toml

cargo run --features db,fetch --example data-io

curl -s 'http://127.0.0.1:3000/db/pragmas'   # wal, 5000, 1, 1
curl -s 'http://127.0.0.1:3000/rates'        # cached for 30s
curl -s 'http://127.0.0.1:3000/upstream'     # retried if flaky
curl -s 'http://127.0.0.1:3000/ssrf'         # metadata endpoint refused
```

Pairs with [Database](./server/database), [Cache](./server/cache) and
[Outbound HTTP](./server/fetch).

## `aggregate`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/aggregate)
· concurrency and transactions

`nitr.await_all` fans out concurrent `nitr.fetch` requests, and
`nitr.db:transaction` groups SQLite statements atomically — including a
transfer that rolls back when the balance will not cover it.

```sh
cargo run --features db,fetch --example aggregate

curl 'http://127.0.0.1:3000/dashboard'      # nitr.await_all over /api/*
curl -X POST 'http://127.0.0.1:3000/transfer?from=alice&to=bob&amount=30'
curl -X POST 'http://127.0.0.1:3000/transfer?from=alice&to=bob&amount=9999'
```

> [!WARNING] It opts into private-network fetches
>
> The fetch policy refuses loopback targets by default. This example
> aggregates _itself_ over loopback, so it explicitly allows them. Do not
> copy that setting into an application that fetches user-supplied URLs —
> see [Outbound HTTP](./server/fetch).

## `streaming`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/streaming)
· streaming response bodies

A writer-callback CSV download and a coroutine-iterator body. Chunks
reach the client as they are produced, with real backpressure when the
client reads slowly.

```sh
cargo run --example streaming

curl 'http://127.0.0.1:3000/report.csv'                  # writer callback
curl 'http://127.0.0.1:3000/chunks'                      # coroutine iterator
curl --limit-rate 1K 'http://127.0.0.1:3000/report.csv'  # backpressure
```

Pairs with [Streaming & SSE](./server/streaming).

## `sse`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/sse)
· Server-Sent Events

A live ticker paced by a custom Rust `time` module mounted through the
`module()` extension point — the async-sleep pattern that makes pacing
cost no execution budget.

```sh
cargo run --example sse
curl -N 'http://127.0.0.1:3000/events'
```

## `basic-auth`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/basic-auth)
· HTTP Basic auth, done right

`nitr.auth.basic` for the header, `nitr.crypto.password_verify` for the
stored argon2id hash, and `nitr.crypto.password_verify_dummy` for the
unknown-user branch that would otherwise leak the account list through
response time. The credentials in `app.lua` came from
`nitr hash-password`.

```sh
cargo run --features crypto --example basic-auth

curl -u 'ada:lovelace' 'http://127.0.0.1:3000/private'   # 200
curl -u 'ada:wrong'    'http://127.0.0.1:3000/private'   # 401
curl -u 'nobody:wrong' 'http://127.0.0.1:3000/private'   # 401, same cost
curl -i 'http://127.0.0.1:3000/private'                  # 401 + WWW-Authenticate

# The two paths that must cost the same. A naive handler answers the
# second in microseconds, and that gap is the user list.
curl -s -o /dev/null -w '%{time_total}\n' -u 'ada:wrong'    'http://127.0.0.1:3000/private'
curl -s -o /dev/null -w '%{time_total}\n' -u 'nobody:wrong' 'http://127.0.0.1:3000/private'
```

Pairs with [Passwords & Basic Auth](./server/passwords).

## `bearer-auth`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/bearer-auth)
· shared-token auth

`nitr.auth.bearer` for the header and `nitr.crypto.constant_time_eq` for
the comparison — the two-line pattern for protecting an internal API.

```sh
cargo run --features crypto --example bearer-auth

TOKEN=1f8e4c0a6b5d92e37a41c8f0d3b6a95c1e2d4f6a8b0c3e5d7f9a1b3c5d7e9f01
curl -H "Authorization: Bearer $TOKEN" 'http://127.0.0.1:3000/private'  # 200
curl -H "Authorization: Bearer wrong"  'http://127.0.0.1:3000/private'  # 401
curl -i 'http://127.0.0.1:3000/private'                # 401 + WWW-Authenticate
```

Pairs with [JWT](./server/jwt) and
[Crypto & Auth](./server/crypto-auth).

## `tls`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/tls)
· HTTPS in-process

The same server, one `[tls]` section away from speaking HTTPS. The
example mints a throwaway self-signed certificate on every run, so there
is nothing to install and no key material in the repository — that is
the _only_ example-specific part. A real deployment points `[tls] cert`
and `key` at files an ACME client produced and changes nothing else.

```sh
cargo run --example tls --features tls

# `-k` because the certificate is self-signed and trusted by nobody.
curl -k 'https://127.0.0.1:3000/'
curl -k 'https://127.0.0.1:3000/whoami'

# …and the failure that matters: plaintext to a TLS port is refused,
# never quietly served in the clear.
curl 'http://127.0.0.1:3000/'
```

Pairs with [TLS](./server/tls).

## `standards`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/standards)
· the rest of HTTP, in Rust

Range requests, response compression, CORS, form and multipart bodies,
and conditional dynamic responses. Everything is enforced in Rust; the
Lua side only declares intent — which resource identity, where an upload
goes.

```sh
cargo run --features compression,multipart --example standards

# Range: a media player seeking into a file.
curl -i -H 'Range: bytes=0-15' 'http://127.0.0.1:3000/media/alphabet.txt'
curl -i -H 'Range: bytes=9999-' 'http://127.0.0.1:3000/media/alphabet.txt'  # 416

# Precompressed sidecar: app.js.gz served as-is, no runtime CPU.
curl -i --compressed 'http://127.0.0.1:3000/media/app.js'

# CORS: a preflight answered in Rust, without a Lua state.
curl -i -X OPTIONS 'http://127.0.0.1:3000/api/notes' \
     -H 'Origin: https://app.example' \
     -H 'Access-Control-Request-Method: POST' \
     -H 'Access-Control-Request-Headers: content-type'
```

Pairs with [Responses](./server/responses) and
[Requests](./server/requests).

## `static-site`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/static-site)
· static and dynamic in one process

Files under `public/` are served entirely in Rust — ETag/304, content
types, traversal protection — while `/api/*` routes run in Lua. A second
mount shows per-mount options.

```sh
cargo run --example static-site

curl -i 'http://127.0.0.1:3000/'                  # index.html
curl -i 'http://127.0.0.1:3000/assets/style.css'  # cache-control mount
curl -i 'http://127.0.0.1:3000/api/time'          # Lua route
curl -i 'http://127.0.0.1:3000/../etc/passwd'     # 404, not a leak
```

Pairs with [Static files](./server/static-files).

## `observability`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/observability)
· logs, request ids, limits

Structured logging from Lua (`nitr.log.*`), request ids on every
response, per-client rate limiting and request-size limits — the last
three enforced in Rust before Lua runs.

```sh
RUST_LOG=info,lua=debug cargo run --example observability

curl -i 'http://127.0.0.1:3000/'         # note the X-Request-ID header
for i in $(seq 1 6); do
  curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:3000/'
done                                     # 5 pass, then 429
```

Pairs with [Logging](./server/logging).

## `app-package`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/app-package)
· the CLI layout, not an embedding

The conventional layout the `nitr` CLI works with — no `main.rs` at all:

```
app-package/
├── nitr.toml       server + app configuration
├── app.lua         routes and middleware (returns nitr.app())
├── config.lua      runs once at startup; result → nitr.cfg
├── public/         static files, served by Rust
└── tests/          *.lua files for `nitr test`
```

```sh
cargo run -p nitr-cli -- -c crates/nitr/examples/app-package/nitr.toml check
cargo run -p nitr-cli -- -c crates/nitr/examples/app-package/nitr.toml test
cargo run -p nitr-cli -- -c crates/nitr/examples/app-package/nitr.toml run
```

In your own project you would simply run `nitr check` / `nitr test` /
`nitr dev` next to `nitr.toml` — scaffold one with
[`nitr init`](./server/cli#init).

Pairs with [Project layout](./server/project-layout).

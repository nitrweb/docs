# Examples

Nitr ships **17 runnable examples**, one per topic. Each is a small
`main.rs` plus the Lua it serves, and runs with one command against a
real server you can `curl`.

Browse them on GitHub:
**[crates/nitr/examples](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples)**
(the root `examples/` folder is a symlink to it).

## Run them

```sh
git clone https://github.com/nitrweb/nitr
cd nitr
cargo run --example hello
```

Run every command **from the repository root**: the paths inside each
example are relative to it.

Some examples need a Cargo feature, and Cargo names the missing one if
you forget it. The commands below include the right flag, and
`--features all` works for all of them.

| Example                     | Needs                          |
| --------------------------- | ------------------------------ |
| `basic-auth`, `bearer-auth` | `crypto`                       |
| `stdlib`                    | `crypto`, `fetch`              |
| `data-io`, `aggregate`      | `db`, `fetch`                  |
| `standards`                 | `compression`, `multipart`     |
| `tls`                       | `tls`                          |
| `validation`                | `multipart` (the upload route) |
| `openapi`                   | `swagger`                      |

The rest need no flag. `app-package` runs through the CLI instead.

## Where to start

| If you want to…               | Run                         |
| ----------------------------- | --------------------------- |
| See the smallest embedding    | `hello`                     |
| Write routes and middleware   | `router`, then `stdlib`     |
| Validate what a route accepts | `validation`                |
| Publish an API document       | `openapi`                   |
| Add your own Rust             | `extension`                 |
| Use a database                | `data-io`                   |
| Serve a website               | `static-site`, `standards`  |
| Stream a response             | `streaming`, `sse`          |
| Protect an endpoint           | `basic-auth`, `bearer-auth` |
| Terminate HTTPS               | `tls`                       |
| Run it in production          | `observability`             |
| Use the CLI, not the crate    | `app-package`               |

---

## `hello`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/hello)
· the minimal embedding

A Lua backend with one custom Rust module at `nitr.ext.hello`. **Start
here** if you are embedding Nitr.

```sh
cargo run --example hello
curl 'http://127.0.0.1:3000/?name=Nitr'
```

## `router`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/router)
· routing and middleware

Path parameters, global and per-route middleware, response helpers,
signed cookies, content negotiation, and streaming and SSE endpoints.

```sh
cargo run --example router

curl 'http://127.0.0.1:3000/users/42'
curl -X POST 'http://127.0.0.1:3000/users' -d '{"name":"ada"}'
curl 'http://127.0.0.1:3000/admin' -H 'authorization: Bearer router-example-token'
curl -c - 'http://127.0.0.1:3000/login'
curl 'http://127.0.0.1:3000/data' -H 'accept: text/html'
curl -N 'http://127.0.0.1:3000/events'         # Server-Sent Events
```

See [Routing](./server/routing) and [Middleware](./server/middleware).

## `stdlib`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/stdlib)
· a tour of `nitr.*`

Response helpers, JSON, logging, and the crypto and auth functions. Its
secrets are made in `config.lua` and read from `nitr.cfg`, never written
as literals in the handler script.

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

See the [Lua API reference](./api/).

## `validation`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/validation)
· route input, checked before the handler

A notes API whose routes declare what they accept, so the handlers read
`req.valid` and contain no validation code. Also shows a custom format,
an app-wide `on_invalid`, and an HTML form with an image upload.

```sh
cargo run --example validation --features all

curl -s 'http://127.0.0.1:3000/api/notes?limit=500' -H 'x-team: core'
#  422  query.limit: must be at most 100

curl -si -X POST 'http://127.0.0.1:3000/api/notes' -H 'x-team: core' \
     -H 'content-type: application/json' -d '{"text":"  "}'
#  422  body.text: is required

curl -s -X POST 'http://127.0.0.1:3000/profile' \
     -F name='Ada' -F email='ADA@EXAMPLE.COM' -F avatar=@photo.png
```

See [Validation](./server/validation/).

## `openapi`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/openapi)
· the same API, documented

The `validation` example plus `app:doc` and per-route `doc` tables: an
OpenAPI 3.1 document at `/openapi.json` and Swagger UI at `/docs`.

```sh
cargo run --example openapi --features swagger

curl -s 'http://127.0.0.1:3000/openapi.json' | jq .info
xdg-open 'http://127.0.0.1:3000/docs'
```

See [OpenAPI](./server/openapi/).

## `extension`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/extension)
· your own Rust at `nitr.ext.*`

Add your own Rust functions without forking Nitr. A `kv` module shares
one handle across every Lua state; a `slug` module does string work
that would be slow in Lua.

```sh
cargo run --example extension

curl 'http://127.0.0.1:3000/inventory/widgets'
curl -X PUT 'http://127.0.0.1:3000/inventory/widgets' -d '7'
curl 'http://127.0.0.1:3000/slugify?title=Hello%20World'
```

See [Extension modules](./library/extension-modules).

## `data-io`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/data-io)
· SQLite, migrations, cache, fetch

SQLite with migrations, the shared `nitr.cache`, and a `fetch` that
retries and refuses private addresses. It runs its own flaky upstream so
you can see the retries.

```sh
# Apply the migrations first: the server will not start with one pending.
cargo run -- migrate --status -c crates/nitr/examples/data-io/nitr.toml
cargo run -- migrate          -c crates/nitr/examples/data-io/nitr.toml

cargo run --features db,fetch --example data-io

curl -s 'http://127.0.0.1:3000/db/pragmas'   # wal, 5000, 1, 1
curl -s 'http://127.0.0.1:3000/rates'        # cached for 30s
curl -s 'http://127.0.0.1:3000/upstream'     # retried if flaky
curl -s 'http://127.0.0.1:3000/ssrf'         # metadata endpoint refused
```

See [Database](./server/database), [Cache](./server/cache) and
[Outbound HTTP](./server/fetch).

## `aggregate`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/aggregate)
· concurrency and transactions

`nitr.await_all` runs several `nitr.fetch` calls at once, and
`nitr.db:transaction` groups statements, including a transfer that rolls
back when the balance is too low.

```sh
cargo run --features db,fetch --example aggregate

curl 'http://127.0.0.1:3000/dashboard'      # nitr.await_all over /api/*
curl -X POST 'http://127.0.0.1:3000/transfer?from=alice&to=bob&amount=30'
curl -X POST 'http://127.0.0.1:3000/transfer?from=alice&to=bob&amount=9999'
```

> [!WARNING] Do not copy its fetch policy
>
> This example fetches from itself over loopback, so it allows private
> addresses. Do not do that in an app that fetches user-supplied URLs.
> See [Outbound HTTP](./server/fetch).

## `streaming`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/streaming)
· streaming response bodies

A CSV download written chunk by chunk, and a coroutine-based body. A
slow client slows the producer down instead of filling memory.

```sh
cargo run --example streaming

curl 'http://127.0.0.1:3000/report.csv'                  # writer callback
curl 'http://127.0.0.1:3000/chunks'                      # coroutine iterator
curl --limit-rate 1K 'http://127.0.0.1:3000/report.csv'  # slow client
```

See [Streaming & SSE](./server/streaming).

## `sse`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/sse)
· Server-Sent Events

A live ticker paced by a custom async Rust `time` module, so waiting
between events does not use up the execution time limit.

```sh
cargo run --example sse
curl -N 'http://127.0.0.1:3000/events'
```

## `basic-auth`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/basic-auth)
· HTTP Basic auth

`nitr.auth.basic` reads the header, `nitr.crypto.password_verify` checks
the stored argon2id hash, and `nitr.crypto.password_verify_dummy` makes
an unknown user take as long as a wrong password, so response times do
not reveal which users exist. The stored hashes came from
`nitr hash-password`.

```sh
cargo run --features crypto --example basic-auth

curl -u 'ada:lovelace' 'http://127.0.0.1:3000/private'   # 200
curl -u 'ada:wrong'    'http://127.0.0.1:3000/private'   # 401
curl -u 'nobody:wrong' 'http://127.0.0.1:3000/private'   # 401, same cost
curl -i 'http://127.0.0.1:3000/private'                  # 401 + WWW-Authenticate
```

See [Passwords & Basic Auth](./server/passwords).

## `bearer-auth`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/bearer-auth)
· shared-token auth

`nitr.auth.bearer` reads the header and `nitr.crypto.constant_time_eq`
compares the token: the two-line pattern for an internal API.

```sh
cargo run --features crypto --example bearer-auth

TOKEN=1f8e4c0a6b5d92e37a41c8f0d3b6a95c1e2d4f6a8b0c3e5d7f9a1b3c5d7e9f01
curl -H "Authorization: Bearer $TOKEN" 'http://127.0.0.1:3000/private'  # 200
curl -H "Authorization: Bearer wrong"  'http://127.0.0.1:3000/private'  # 401
curl -i 'http://127.0.0.1:3000/private'                # 401 + WWW-Authenticate
```

See [JWT](./server/jwt) and [Crypto & Auth](./server/crypto-auth).

## `tls`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/tls)
· HTTPS in-process

A server with a `[tls]` section. The example creates a throwaway
self-signed certificate on each run; a real deployment points
`[tls] cert` and `key` at real certificate files.

```sh
cargo run --example tls --features tls

curl -k 'https://127.0.0.1:3000/'        # -k: the certificate is self-signed
curl -k 'https://127.0.0.1:3000/whoami'
curl 'http://127.0.0.1:3000/'            # plain HTTP is refused
```

See [TLS](./server/tls).

## `standards`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/standards)
· the rest of HTTP, in Rust

Range requests, compression, CORS, form and multipart bodies, and
conditional responses, all handled in Rust.

```sh
cargo run --features compression,multipart --example standards

curl -i -H 'Range: bytes=0-15' 'http://127.0.0.1:3000/media/alphabet.txt'
curl -i -H 'Range: bytes=9999-' 'http://127.0.0.1:3000/media/alphabet.txt'  # 416

# app.js.gz is sent as-is, with no compression work at request time.
curl -i --compressed 'http://127.0.0.1:3000/media/app.js'

# A CORS preflight, answered without running Lua.
curl -i -X OPTIONS 'http://127.0.0.1:3000/api/notes' \
     -H 'Origin: https://app.example' \
     -H 'Access-Control-Request-Method: POST' \
     -H 'Access-Control-Request-Headers: content-type'
```

See [Responses](./server/responses) and [Requests](./server/requests).

## `static-site`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/static-site)
· static and dynamic in one process

Files under `public/` are served in Rust while `/api/*` routes run in
Lua. A second mount shows per-mount options.

```sh
cargo run --example static-site

curl -i 'http://127.0.0.1:3000/'                  # index.html
curl -i 'http://127.0.0.1:3000/assets/style.css'  # cache-control mount
curl -i 'http://127.0.0.1:3000/api/time'          # Lua route
curl -i 'http://127.0.0.1:3000/../etc/passwd'     # 404, not a leak
```

See [Static files](./server/static-files).

## `observability`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/observability)
· logs, request ids, limits

Structured logging from Lua, a request id on every response, per-client
rate limiting and request-size limits.

```sh
RUST_LOG=info,lua=debug cargo run --example observability

curl -i 'http://127.0.0.1:3000/'         # note the X-Request-ID header
for i in $(seq 1 6); do
  curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:3000/'
done                                     # 5 pass, then 429
```

See [Logging](./server/logging).

## `app-package`

[Source](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/app-package)
· the CLI layout, no Rust

What an application looks like when you use the `nitr` binary instead
of embedding it:

```
app-package/
├── nitr.toml       server + app configuration
├── app.lua         routes and middleware (returns nitr.app())
├── config.lua      runs at startup and on reload; result → nitr.cfg
├── lib/            plain Lua modules the app `require`s
├── public/         static files
└── tests/          *.lua files for `nitr test`
```

```sh
cargo run -p nitr-cli -- -c crates/nitr/examples/app-package/nitr.toml check
cargo run -p nitr-cli -- -c crates/nitr/examples/app-package/nitr.toml test
cargo run -p nitr-cli -- -c crates/nitr/examples/app-package/nitr.toml run
```

In your own project, run `nitr check`, `nitr test` or `nitr dev` next to
`nitr.toml`. [`nitr init`](./server/cli#init) creates one. See [Project
layout](./server/project-layout).

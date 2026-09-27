<script setup>import Badges from '@theme/components/badges/Badges.vue';</script>

<p align="center">
  <img src="/assets/nitr.svg" alt="Nitr" width="110" height="110" />
</p>

<br>

<Badges />

<hr>

# Introduction

**Nitr** is a [Rust](https://www.rust-lang.org/) web server that embeds
[Lua 5.4](https://www.lua.org/) so you can write fast, efficient and safe
lightweight dynamic backends.

You write the request handling in Lua. Everything underneath — HTTP,
routing, TLS, compression, static files, SQLite, the HTTP client,
cryptography — is Rust, and it ships in one binary.

The current release is **`0.0.0-beta.7`**, published on
[crates.io](https://crates.io/crates/nitr-cli). The source lives at
[github.com/nitrweb/nitr](https://github.com/nitrweb/nitr).

> [!WARNING] Early development
>
> Nitr is **not ready for production use** yet. Before 1.0, a minor
> release may still break the `nitr.*` Lua API. See
> [Stability & Versioning](./stability).

## A complete application

```lua
-- app.lua
local app = nitr.app()

app:get("/hello/:name", function(req)
    return nitr.json({ hello = req.params.name })
end)

return app
```

```toml
# nitr.toml
listen = "127.0.0.1:3000"
handler_script = "app.lua"
```

```sh
nitr dev
curl http://127.0.0.1:3000/hello/world
# {"hello":"world"}
```

One Lua file and two lines of configuration. No build step, no
dependencies to install: the router, the JSON encoder and the server all
come with the binary. [`nitr init`](./quick-start) scaffolds a fuller
starting point with a database, tests and editor completion.

## Two ways to use Nitr

Nitr is a **server binary** and a **Rust library crate**. Most people
want the first one.

|                   | [Server](./server/)                                      | [Library](./library/)                                                                                            |
| ----------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **You write**     | Lua (`app.lua`, `config.lua`)                            | Rust (`main.rs`) + Lua                                                                                           |
| **You run**       | `nitr dev`, `nitr run`                                   | `cargo run`                                                                                                      |
| **Configuration** | [`nitr.toml`](./server/configuration/file) + env + flags | [`Server::builder()`](./library/server-builder) or a `Config`                                                    |
| **Use it when**   | You are building a backend                               | You want to embed the server, or expose your own Rust code to Lua as [`nitr.ext.*`](./library/extension-modules) |

Both run the same engine, standard library and sandbox.

## Why Nitr

- **One binary, one config file.** Copy the binary and a few Lua files
  to a machine and you have an HTTP application.
  [`nitr build`](./server/deployment/single-file) packs the Lua files
  into the executable too.
- **Parallel without a global lock.** Nitr keeps a pool of independent
  Lua states, one per CPU core by default, and each request runs in one
  of them. See [How Nitr works](./how-it-works).
- **Safe by default.** Scripts run without `io` and `os`, with an 8 MiB
  memory limit and a 30-second time limit that stops even
  `while true do end`. `require` only loads from your scripts directory,
  and precompiled bytecode is refused. See
  [Security & the sandbox](./server/security).
- **One namespace.** Everything Nitr adds lives under the global `nitr`
  table (`nitr.json`, `nitr.db`, `nitr.crypto`, …). Your own Rust
  modules go under `nitr.ext.*`, where no built-in can clash with them.
- **The tedious parts of HTTP are done for you.** Range and conditional
  requests, compression, CORS preflights, streamed uploads, and 404/405
  responses are handled in Rust without running Lua.
- **Input checked before your handler runs.** Declare what a route
  accepts and Nitr validates the body, query, path parameters and
  headers, then hands you the clean result in `req.valid`:

  ```lua
  app:post("/api/notes", function(req)
      return nitr.json(create(req.valid.body), 201)
  end, { input = { body = NoteInput } })
  ```

  See [Validation](./server/validation/).

- **API docs from the same declaration.** Nitr generates an OpenAPI 3.1
  document from your routes and serves a Swagger UI page from the
  binary. See [OpenAPI](./server/openapi/).
- **HTTPS without a proxy.** A three-line `[tls]` section serves HTTPS
  directly, and `SIGHUP` picks up a renewed certificate. See
  [TLS termination](./server/tls).
- **Editor completion.** `nitr init` writes `nitr-types.lua`, which gives
  completion and inline docs for the whole `nitr.*` API in any editor
  that runs the Lua Language Server.

## Where to go next

| I want to…                     | Go to                                        |
| ------------------------------ | -------------------------------------------- |
| See it running in five minutes | [Quick Start](./quick-start)                 |
| Install the binary             | [Download & Install](./download-install)     |
| Understand the execution model | [How Nitr works](./how-it-works)             |
| Build an application           | [Server → Overview](./server/)               |
| Validate what a route accepts  | [Validation](./server/validation/)           |
| Publish an API document        | [OpenAPI & Swagger UI](./server/openapi/)    |
| Serve HTTPS directly           | [TLS termination](./server/tls)              |
| Store and check a password     | [Passwords & Basic auth](./server/passwords) |
| Sign or verify a token         | [JWT](./server/jwt)                          |
| Look up a `nitr.*` function    | [Lua API reference](./api/)                  |
| Run working code               | [Examples](./examples)                       |
| Embed Nitr in a Rust program   | [Library → Overview](./library/)             |

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

You write the request handling in Lua. Everything underneath — the HTTP
layer, routing, TLS termination, compression, static files, SQLite, the
outbound HTTP client, cryptography — is Rust, and it is already there.

The current release is **`0.0.0-beta.4`**, published on
[crates.io](https://crates.io/crates/nitr-cli); the source lives at
[github.com/nitrweb/nitr](https://github.com/nitrweb/nitr).

> [!WARNING] Early development
>
> Nitr is in early development and **not ready for production use**. The
> `nitr.*` Lua API is the surface we intend to keep most stable, but
> pre-1.0 a minor release may still break it. See
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
# → curl http://127.0.0.1:3000/hello/world
#   {"hello":"world"}
```

That is a complete Nitr application: one Lua file and the two lines of
configuration that point at it. No build step, no dependency manifest,
no framework to install — the routing, the JSON encoder and the HTTP
server all came with the binary. [`nitr init`](./quick-start) writes
both files, plus a database, tests and editor completions.

## Two ways to use Nitr

Nitr is both a **server binary** and a **Rust library crate**. The docs
are split the same way, and you almost certainly want the first one.

|                   | [Server](./server/)                                      | [Library](./library/)                                                                                            |
| ----------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **You write**     | Lua (`app.lua`, `config.lua`)                            | Rust (`main.rs`) + Lua                                                                                           |
| **You run**       | `nitr dev`, `nitr run`                                   | `cargo run`                                                                                                      |
| **Configuration** | [`nitr.toml`](./server/configuration/file) + env + flags | [`Server::builder()`](./library/server-builder) or a `Config`                                                    |
| **Use it when**   | You are building a backend                               | You want to embed the server, or expose your own Rust code to Lua as [`nitr.ext.*`](./library/extension-modules) |

Both run the same engine, the same `nitr.*` standard library and the
same sandbox. The library adds one thing the binary cannot: your own
Rust modules mounted into every Lua state.

## Why Nitr

**One process, one binary, one config file.** Drop a binary and a few
Lua files onto a machine and you have a complete HTTP application. With
[`nitr build`](./server/deployment/single-file) even the Lua files
disappear into the executable.

**Parallel by construction.** Nitr keeps a fixed pool of _independent_
Lua states — one per CPU core by default. A request checks out a state,
runs, and gives it back. There is no global interpreter lock, because
there is no global interpreter. See [How Nitr works](./how-it-works).

**Safe by default, not by discipline.** Every script runs with `io` and
`os` excluded from the standard library, an 8 MiB memory ceiling, a
30-second execution budget enforced by an instruction-count hook (so
`while true do end` is stopped, not merely discouraged — and `pcall`
cannot swallow the deadline), `require` confined to the scripts
directory, and every chunk compiled from source, never from bytecode.
Templates escape by default, static mounts hide dotfiles, and a
`nitr.toml` that would serve its own scripts refuses to boot. See
[Security & the sandbox](./server/security).

**One namespace, no collisions.** Everything Nitr gives Lua lives under
the global `nitr` table — `nitr.json`, `nitr.db`, `nitr.crypto`. Nitr
registers nothing else, so scripts never collide with the Lua standard
library, and your own Rust extensions mount one level down at
`nitr.ext.*` where no future builtin can ever reach them.

**The boring parts are already Rust.** Range requests, conditional
requests, compression, CORS preflights, multipart uploads that stream to
disk without touching the Lua heap, 404/405 answered without entering
Lua at all.

**HTTPS without a proxy in front.** Three lines of `[tls]` terminate TLS
in-process with rustls (the `ring` provider, a TLS 1.2 floor, ALPN
pinned to what the server actually speaks). The certificate and key are
validated before the port exists, so a mismatched pair refuses to boot
rather than failing every handshake on a port traffic already points at;
a renewal takes effect on `SIGHUP`, which re-reads both files and swaps
them in only when the new pair validates. Fronting Nitr with a proxy is
still perfectly good — it just is not the only way to serve HTTPS. See
[TLS termination](./server/tls).

**Editor completion for the whole surface.** `nitr init` writes
`nitr-types.lua`, generated LuaCATS definitions covering every
`nitr.*` API — completion, signatures and inline docs in any editor
running the Lua Language Server.

## Where to go next

| I want to…                     | Go to                                        |
| ------------------------------ | -------------------------------------------- |
| See it running in five minutes | [Quick Start](./quick-start)                 |
| Install the binary             | [Download & Install](./download-install)     |
| Understand the execution model | [How Nitr works](./how-it-works)             |
| Build an application           | [Server → Overview](./server/)               |
| Serve HTTPS directly           | [TLS termination](./server/tls)              |
| Store and check a password     | [Passwords & Basic auth](./server/passwords) |
| Sign or verify a token         | [JWT](./server/jwt)                          |
| Look up a `nitr.*` function    | [Lua API reference](./api/)                  |
| Run working code               | [Examples](./examples)                       |
| Embed Nitr in a Rust program   | [Library → Overview](./library/)             |

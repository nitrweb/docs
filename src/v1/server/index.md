# Server Overview

This section covers the `nitr` **binary**: the server you configure with
`nitr.toml` and the Lua application you write for it.

If instead you want to embed the server inside your own Rust program, or
expose your own Rust functions to Lua, that is the
[Library](../library/) section.

## The shape of an application

```
my-app/
├── nitr.toml       ← configuration: what the server does
├── config.lua      ← runs once at startup → nitr.cfg   (optional)
├── app.lua         ← routes and middleware; returns nitr.app()
├── routes/         ← route modules, wired by app.lua   (optional)
├── migrations/     ← plain SQL, applied by `nitr migrate`
├── templates/      ← minijinja templates
├── public/         ← static files, served by Rust
├── tests/          ← *.lua, run by `nitr test`
├── data/           ← the SQLite database (git-ignored)
├── .gitignore      ← ignores data/*.db*
└── nitr-types.lua  ← generated LuaCATS editor completions
```

`nitr init` writes exactly this. See [Project layout](./project-layout)
for what each piece does, which parts are optional, and what
`nitr init --minimal` leaves out.

## The two scripts you write

```lua
-- config.lua — runs exactly once, before any request
return { app_name = "my-app", started_at = nitr.time.now() }
```

```lua
-- app.lua — runs once per Lua state; builds the application
local app = nitr.app()

app:use(function(next)                    -- middleware
    return function(req)
        return next(req)
    end
end)

app:get("/users/:id", function(req)       -- a route
    return nitr.json({ id = req.params.id })
end)

app:on_error(function(err, req)           -- the error response
    return nitr.error(500, { code = "INTERNAL" })
end)

return app                                -- ← required
```

Neither script handles a request directly. `config.lua` prepares data;
`app.lua` _describes_ the application, once, and Nitr dispatches into
the pieces it registered. [How Nitr works](../how-it-works) explains
why that distinction matters.

## Reading order

### Getting the application running

| Page                               | What is in it                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| [Project layout](./project-layout) | Every file `nitr init` creates, and why                                              |
| [CLI commands](./cli)              | `run`, `dev`, `check`, `test`, `migrate`, `init`, `build`, `reload`, `hash-password` |
| [Configuration](./configuration/)  | How the file, environment and flags layer                                            |
| [Server defaults](./defaults)      | Every default value in one table                                                     |

### Writing handlers

| Page                                     | What is in it                                        |
| ---------------------------------------- | ---------------------------------------------------- |
| [Routing](./routing)                     | Paths, parameters, catch-alls, method handling       |
| [Middleware](./middleware)               | Global and per-route chains, composition order       |
| [Requests](./requests)                   | `req.*` fields, body reading, uploads, negotiation   |
| [Responses](./responses)                 | Helpers, headers, status codes, conditional requests |
| [Cookies & sessions](./cookies-sessions) | Signed cookies, sessions, CSRF                       |
| [Streaming & SSE](./streaming)           | Streaming bodies and Server-Sent Events              |
| [Errors](./errors)                       | `on_error`, error kinds, dev vs production `500`s    |

### The standard library

| Page                                  | What is in it                                         |
| ------------------------------------- | ----------------------------------------------------- |
| [Database](./database)                | `nitr.db`, transactions, migrations                   |
| [Templates](./templates)              | `nitr.template` (minijinja)                           |
| [Static files](./static-files)        | Rust-side serving, SPA mode, caching                  |
| [Validation](./validation)            | `nitr.validate` schemas                               |
| [Outbound HTTP](./fetch)              | `nitr.fetch`, concurrency, SSRF policy                |
| [Cache](./cache)                      | `nitr.cache`, and what does _not_ belong in it        |
| [Crypto & auth](./crypto-auth)        | Hashes, HMAC, random bytes, AEAD, `Authorization`     |
| [Passwords & Basic auth](./passwords) | argon2id, `nitr hash-password`, the login timing leak |
| [JWT](./jwt)                          | `nitr.crypto.jwt`, and the claims `verify` ignores    |
| [Testing](./testing)                  | `nitr test`, `describe`/`it`/`expect`                 |
| [Logging](./logging)                  | Span schema, JSON output, redaction rules             |

The exhaustive per-function inventory is the [Lua API
reference](../api/).

### Running it in production

| Page                                            | What is in it                                       |
| ----------------------------------------------- | --------------------------------------------------- |
| [Deployment](./deployment/)                     | Health probes, signals, reloads, drains             |
| [TLS termination](./tls)                        | `[tls]`, certificate reloads, HSTS, the redirect    |
| [Single-file deploys](./deployment/single-file) | `nitr build`                                        |
| [systemd](./deployment/systemd)                 | A hardened unit, and the two lines people get wrong |
| [Docker](./deployment/docker)                   | Signals, stop timeouts, Kubernetes probes           |
| [Security & the sandbox](./security)            | The threat model, stated honestly                   |

## Three things to know up front

**Only matching dynamic routes reach Lua.** Static files, `404`, `405`,
CORS preflights, health probes and every configured limit are answered
in Rust. Your handler is not a bouncer.

**Concurrency equals `workers`.** One request per Lua state, states are
independent, and there is no lock between them. Past the pool, requests
queue for `pool_wait_ms` and are then shed with `503`.

**Nothing crosses between states.** A Lua value never leaves the state
that made it. Shared state means [`nitr.cache`](./cache) (plain,
bounded, per-process) or [`nitr.db`](./database).

# Server Overview

This section covers the `nitr` **binary**: the server you configure with
`nitr.toml` and the Lua application you write for it. To embed Nitr in
your own Rust program instead, see [Library](../library/).

## The shape of an application

```
my-app/
├── nitr.toml       ← configuration
├── config.lua      ← runs once at startup → nitr.cfg   (optional)
├── app.lua         ← routes and middleware; returns nitr.app()
├── routes/         ← route modules                     (optional)
├── migrations/     ← SQL, applied by `nitr migrate`
├── templates/      ← minijinja templates
├── public/         ← static files
├── tests/          ← tests, run by `nitr test`
└── data/           ← the SQLite database (git-ignored)
```

`nitr init` creates this for you. See [Project layout](./project-layout).

```lua
-- app.lua
local app = nitr.app()

app:get("/users/:id", function(req)
    return nitr.json({ id = req.params.id })
end)

return app   -- required
```

`app.lua` runs once per Lua state to register routes; Nitr then calls
your handlers for each request. See [How Nitr works](../how-it-works).

## Three things to know

- **Only matching routes reach Lua.** Static files, `404`, `405`, CORS
  preflights, health probes and request limits are handled in Rust.
- **Concurrency equals `workers`.** Each Lua state handles one request
  at a time. When all are busy, requests wait up to `pool_wait_ms` and
  then get `503`.
- **Lua states share nothing.** To share data between requests, use
  [`nitr.cache`](./cache) or [`nitr.db`](./database).

## Pages in this section

### Setup

| Page                               | What is in it                                |
| ---------------------------------- | -------------------------------------------- |
| [Project layout](./project-layout) | Every file `nitr init` creates               |
| [CLI commands](./cli)              | `run`, `dev`, `check`, `test`, `migrate`, …  |
| [Configuration](./configuration/)  | `nitr.toml`, environment variables and flags |
| [Server defaults](./defaults)      | Every default value                          |

### Writing handlers

| Page                                     | What is in it                           |
| ---------------------------------------- | --------------------------------------- |
| [Routing](./routing)                     | Paths, parameters, methods              |
| [Middleware](./middleware)               | Global and per-route middleware         |
| [Requests](./requests)                   | `req` fields, bodies, uploads           |
| [Responses](./responses)                 | Response helpers, headers, status codes |
| [Cookies & sessions](./cookies-sessions) | Signed cookies, sessions, CSRF          |
| [Streaming & SSE](./streaming)           | Streaming bodies and Server-Sent Events |
| [Errors](./errors)                       | `on_error` and error responses          |

### Standard library

| Page                                  | What is in it                             |
| ------------------------------------- | ----------------------------------------- |
| [Database](./database)                | `nitr.db`, transactions, migrations       |
| [Templates](./templates)              | `nitr.template` (minijinja)               |
| [Static files](./static-files)        | Static serving, SPA mode, caching         |
| [Validation](./validation/)           | `nitr.validate`, route `input`, uploads   |
| [OpenAPI & Swagger UI](./openapi/)    | API docs generated from your routes       |
| [Outbound HTTP](./fetch)              | `nitr.fetch`                              |
| [Cache](./cache)                      | `nitr.cache`                              |
| [Crypto & auth](./crypto-auth)        | Hashes, HMAC, encryption, `Authorization` |
| [Passwords & Basic auth](./passwords) | Password hashing and login                |
| [JWT](./jwt)                          | `nitr.crypto.jwt`                         |
| [Testing](./testing)                  | `nitr test`                               |
| [Logging](./logging)                  | Log format and fields                     |

Every function is listed in the [Lua API reference](../api/).

### Production

| Page                                            | What is in it                    |
| ----------------------------------------------- | -------------------------------- |
| [Deployment](./deployment/)                     | Health probes, reloads, shutdown |
| [TLS](./tls)                                    | HTTPS, certificate reloads       |
| [Single-file deploys](./deployment/single-file) | `nitr build`                     |
| [systemd](./deployment/systemd)                 | A hardened service unit          |
| [Docker](./deployment/docker)                   | Containers and Kubernetes probes |
| [Security](./security)                          | The sandbox and security model   |

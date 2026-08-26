# The `nitr.toml` File

The complete reference. Every key is optional; the value shown is the
default.

> [!TIP] Two things to remember
>
> - **Unknown keys are a startup error.** A typo fails loudly.
> - Relative paths resolve against the **directory the config file lives
>   in**, not the working directory — so `nitr -c /srv/app/nitr.toml`
>   works from anywhere.

## Top level

```toml
listen = "127.0.0.1:3000"
handler_script = "scripts/handler.lua"
config_script = "scripts/config.lua"
dev_mode = false
workers = 4
max_streams = 3
trust_request_id = false
pidfile = "/run/nitr/nitr.pid"
```

| Key                | Type    | Default                 | Description                                                                                                                                                               |
| ------------------ | ------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listen`           | string  | `"127.0.0.1:3000"`      | Address the server binds to.                                                                                                                                              |
| `handler_script`   | path    | `"scripts/handler.lua"` | The script that returns `nitr.app()`. Runs once per Lua state.                                                                                                            |
| `config_script`    | path    | _unset_                 | Runs exactly once at startup; its return value becomes `nitr.cfg`. Without it, `nitr.cfg` is `nil`.                                                                       |
| `dev_mode`         | bool    | `false`                 | Hot reload + error details in responses. Also set by `--dev` and `nitr dev`.                                                                                              |
| `workers`          | integer | CPU cores               | Number of pooled Lua states — the maximum number of handlers executing at once.                                                                                           |
| `max_streams`      | integer | `workers - 1` (min 1)   | Maximum concurrent [streaming responses](../streaming). Each holds a pooled state for its whole lifetime, so the default keeps idle streams from pinning the entire pool. |
| `trust_request_id` | bool    | `false`                 | Accept an inbound `X-Request-ID` (well-formed, ≤ 64 ASCII chars) instead of generating one. Enable **only** behind a proxy that sets or sanitizes the header.             |
| `pidfile`          | path    | _unset_                 | File the server writes its pid to at startup and removes at exit. This is what [`nitr reload`](../cli#reload) uses to find the process.                                   |

> [!TIP] Sizing `workers`
>
> `workers` _is_ your concurrency limit for dynamic requests. The
> default (one per core) suits CPU-bound handlers. If your handlers
> spend most of their time waiting on `nitr.db` or `nitr.fetch`, a
> higher number keeps the pool from being the bottleneck — measure with
> `pool_checkout`'s `wait_ms` at debug level before changing it.

## `[limits]`

Request-size and connection limits, all enforced **before** a request
reaches Lua.

```toml
[limits]
max_body_bytes = 1048576
max_header_bytes = 16384
max_uri_bytes = 8192
max_connections = 1024
pool_wait_ms = 5000
header_read_ms = 30000
body_read_ms = 30000
max_form_parts = 64
max_field_bytes = 65536
max_file_bytes = 10485760
```

| Key                | Default | On violation                | Description                                                                                                                                                     |
| ------------------ | ------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `max_body_bytes`   | 1 MiB   | `413`                       | Request body cap, **counted as the body arrives** rather than trusted from `Content-Length`.                                                                    |
| `max_header_bytes` | 16 KiB  | connection rejected         | Request header buffer (minimum 8192).                                                                                                                           |
| `max_uri_bytes`    | 8 KiB   | `414`                       | Request URI cap.                                                                                                                                                |
| `max_connections`  | 1024    | listener stops accepting    | Concurrent TCP connections.                                                                                                                                     |
| `pool_wait_ms`     | 5000    | `503` + `Retry-After`       | How long a request waits for a free Lua state before being shed. `0` waits forever.                                                                             |
| `header_read_ms`   | 30000   | connection closed           | Deadline for the complete request headers. `0` disables.                                                                                                        |
| `body_read_ms`     | 30000   | `408` + `Connection: close` | How long each body read may wait for the next bytes. Bounds _progress_, not total transfer: any allowed size may take as long as it keeps moving. `0` disables. |
| `max_form_parts`   | 64      | `413`                       | Parts allowed in a `multipart/form-data` body.                                                                                                                  |
| `max_field_bytes`  | 64 KiB  | `413`                       | Per non-file form field. These become Lua strings, so this bounds the state's heap.                                                                             |
| `max_file_bytes`   | 10 MiB  | `413`                       | Per uploaded file. Files stream to disk in Rust and never enter the Lua heap.                                                                                   |

> [!WARNING] Raising `max_file_bytes` is not enough
>
> `max_body_bytes` bounds the **whole request**, uploads included. Raise
> both, or a large upload is rejected before the per-file limit is ever
> consulted.

## `[database]`

SQLite for the [`nitr.db`](../database) builtin. Without this section
the builtin is unavailable. `path` is the only required key; the pragma
defaults below are already applied.

```toml
[database]
path = "data/app.db"
journal_mode = "wal"
busy_timeout = 5000
synchronous = "normal"
foreign_keys = true
cache_size = -2000
migrations_dir = "migrations"
```

| Key              | Default        | Description                                                        |
| ---------------- | -------------- | ------------------------------------------------------------------ |
| `path`           | _required_     | The database file.                                                 |
| `journal_mode`   | `"wal"`        | `"wal"`, `"delete"`, or `"keep"` to leave the existing mode alone. |
| `busy_timeout`   | `5000`         | Milliseconds to wait on a lock instead of failing.                 |
| `synchronous`    | `"normal"`     | The right pairing with WAL.                                        |
| `foreign_keys`   | `true`         | SQLite leaves this off, which surprises everyone.                  |
| `cache_size`     | `-2000`        | KiB per connection (negative means KiB, per SQLite's convention).  |
| `migrations_dir` | `"migrations"` | Where `nitr migrate` looks for `.sql` files.                       |

> [!WARNING] WAL changes the on-disk file set
>
> WAL matters most because there is one connection per pooled state, and
> SQLite's default rollback journal serializes every writer and fails
> fast on contention. It also means the database is `app.db`,
> `app.db-wal` **and** `app.db-shm` — copying only `app.db` while the
> server runs no longer captures a consistent snapshot. Use
> `VACUUM INTO`, or stop the server.

## `[cache]`

The shared [`nitr.cache`](../cache). Enable it with `"cache"` in
`[std] features`.

```toml
[cache]
max_entries = 10000
max_bytes = 33554432
default_ttl = 300
```

| Key           | Default | Description                                |
| ------------- | ------- | ------------------------------------------ |
| `max_entries` | `10000` | Maximum number of entries (LRU beyond it). |
| `max_bytes`   | 32 MiB  | Total size ceiling.                        |
| `default_ttl` | `300`   | Seconds; `0` means no expiry.              |

Bounded and owned by Rust; entries are serialized, so no Lua value ever
crosses between states. It is **per-process**: a restart empties it, and
two Nitr processes have two independent caches — sessions and exact
counters do not belong here.

## `[compression]`

Off by default: it trades the server's CPU for bandwidth, and that
should be a decision rather than a surprise.

```toml
[compression]
enabled = true
algorithms = ["br", "gzip"]
min_size = 1024
types = ["text/*", "application/json", "application/javascript"]
```

| Key          | Default                | Description                                                                   |
| ------------ | ---------------------- | ----------------------------------------------------------------------------- |
| `enabled`    | `false`                | Turn on-the-fly compression on.                                               |
| `algorithms` | `["br", "gzip"]`       | Offered best-first; the **server's** order wins over the client's preference. |
| `min_size`   | `1024`                 | Below this, compressing costs more than it saves.                             |
| `types`      | text types + JSON + JS | Content types worth compressing.                                              |

> [!NOTE] Precompressed sidecars need none of this
>
> An `app.js.br` next to `app.js` is served whenever it exists,
> regardless of this section and regardless of the `compression` Cargo
> feature — serving an already-compressed file needs no encoder.

## `[cors]`

Cross-origin resource sharing, enforced in Rust: a preflight is answered
**without reaching a Lua state**. Disabled until `origins` is set.

```toml
[cors]
origins = ["https://app.example.com"]
methods = ["GET", "POST"]
headers = ["content-type", "authorization"]
expose_headers = ["x-request-id"]
credentials = false
max_age = 86400
```

| Key              | Default            | Description                                                                           |
| ---------------- | ------------------ | ------------------------------------------------------------------------------------- |
| `origins`        | _unset (disabled)_ | Allowed origins, or `["*"]` for a public API.                                         |
| `methods`        | —                  | Allowed methods.                                                                      |
| `headers`        | —                  | Allowed request headers.                                                              |
| `expose_headers` | —                  | Response headers the browser may read.                                                |
| `credentials`    | `false`            | **Cannot** be combined with `origins = ["*"]` — the server refuses to start if it is. |
| `max_age`        | —                  | Seconds a browser may cache the preflight.                                            |

## `[shutdown]`

```toml
[shutdown]
grace = 30
stream_grace = 5
```

| Key            | Default | Description                                                              |
| -------------- | ------- | ------------------------------------------------------------------------ |
| `grace`        | `30`    | Seconds for ordinary in-flight requests to finish.                       |
| `stream_grace` | `5`     | Extra seconds for streaming/SSE bodies, spent only if one is still live. |

On `SIGTERM`/`SIGINT` the server stops accepting, stops reporting ready,
lets in-flight work finish, and only then exits. **A drain that runs out
of time exits non-zero**, because a cut request is not a clean shutdown.

> [!WARNING] Your supervisor must wait longer than the drain
>
> systemd's `TimeoutStopSec` and Docker's `--time` must exceed
> `grace + stream_grace` (35s by default), or the process is killed
> mid-drain — cutting exactly the requests graceful shutdown exists to
> protect. See [Deployment](../deployment/).

## `[rate_limit]`

Per-client-IP fixed-window rate limiting. Disabled by default.

```toml
[rate_limit]
enabled = true
requests = 100
window = 60
trust_forwarded_for = false
```

| Key                   | Default | Description                                                                                        |
| --------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| `enabled`             | `false` | Turn the limiter on.                                                                               |
| `requests`            | `100`   | Allowed requests per window and client IP.                                                         |
| `window`              | `60`    | Window length in seconds.                                                                          |
| `trust_forwarded_for` | `false` | Key by `X-Forwarded-For`. Only behind a proxy that sets it — otherwise a client picks its own key. |

Exceeding the budget answers `429` with `Retry-After`.

> [!NOTE] It is a fixed window
>
> Bursts straddling a window boundary can briefly reach twice the
> intended rate. Documented rather than hidden — see [Known
> weaknesses](../security#known-weaknesses).

## `[fetch]`

Outbound-request policy for [`nitr.fetch`](../fetch). By default,
requests to loopback, private, link-local and CGNAT addresses are
refused (SSRF protection), and **every redirect hop is re-checked**.

```toml
[fetch]
allowed_hosts = ["api.example.com"]
allow_private_networks = false
max_response_bytes = 8388608
max_concurrent = 8
max_per_request = 32
connect_timeout = 10.0
timeout = 30.0
pool_max_idle_per_host = 8
max_retries = 5
proxy = "http://proxy.internal:3128"
no_proxy = false
propagate_trace_context = false
```

| Key                       | Default | Description                                                                                           |
| ------------------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `allowed_hosts`           | _unset_ | Exact-host allow-list, applied to **all hops**.                                                       |
| `allow_private_networks`  | `false` | Permit loopback/RFC1918 targets.                                                                      |
| `max_response_bytes`      | 8 MiB   | Cap on `resp:text()` / `resp:json()` bodies.                                                          |
| `max_concurrent`          | `8`     | Maximum requests per `nitr.await_all(...)`.                                                           |
| `max_per_request`         | `32`    | Total outbound calls one **inbound** request may make. `0` removes the cap.                           |
| `connect_timeout`         | `10.0`  | Seconds to establish a connection.                                                                    |
| `timeout`                 | `30.0`  | Default per-request budget; a per-call `timeout` option overrides it.                                 |
| `pool_max_idle_per_host`  | `8`     | Idle connections kept per host.                                                                       |
| `max_retries`             | `5`     | Ceiling on `retry.attempts`. Retries are opt-in per call and only ever applied to idempotent methods. |
| `proxy`                   | _unset_ | Explicit proxy. Unset reads `HTTPS_PROXY`/`HTTP_PROXY`.                                               |
| `no_proxy`                | `false` | Ignore the proxy environment variables entirely.                                                      |
| `propagate_trace_context` | `false` | Forward a W3C `traceparent` derived from the inbound request id.                                      |

> [!TIP] Why DNS rebinding does not work here
>
> A hostname is resolved **once**, inside the resolver the connector
> itself uses. A DNS server cannot answer one address to the policy
> check and a different one to the connect.

## `[static]`

Rust-side static file serving: ETag, `Last-Modified`, `304`, content
types, range requests and traversal protection. Scripts can add more
mounts with [`app:static(...)`](../static-files#extra-mounts).

```toml
[static]
dir = "public"
mount = "/"
spa = false
cache_control = "public, max-age=3600"
```

| Key             | Default            | Description                                                      |
| --------------- | ------------------ | ---------------------------------------------------------------- |
| `dir`           | _unset (disabled)_ | Directory to serve.                                              |
| `mount`         | `"/"`              | URL prefix.                                                      |
| `spa`           | `false`            | Serve `index.html` for unknown paths — React/Vue/Svelte routing. |
| `cache_control` | _unset_            | `Cache-Control` header for served files.                         |

## `[templating]`

```toml
[templating]
dir = "templates"
```

| Key   | Default | Description                                                           |
| ----- | ------- | --------------------------------------------------------------------- |
| `dir` | _unset_ | Where [`nitr.template`](../templates) loads minijinja templates from. |

Without `dir` the builtin is unavailable — there is no default location
to guess.

## `[testing]`

```toml
[testing]
dir = "tests"
```

| Key   | Default   | Description                                |
| ----- | --------- | ------------------------------------------ |
| `dir` | `"tests"` | Where `nitr test` discovers `*.lua` files. |

## `[env]`

A dotenv-style file loaded at startup, and what the opt-in `nitr.env`
builtin may read.

```toml
[env]
file = ".env"
allow = ["APP_", "API_TOKEN"]
```

| Key     | Default                                | Description                                                                                                 |
| ------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `file`  | `.env` next to `nitr.toml`, if present | The dotenv file to load. An **explicitly named** file must exist; the implicit `.env` may be absent.        |
| `allow` | _unset_                                | Exact names, or prefixes ending in `_`. Unset lets an enabled `env` builtin read any non-`NITR_*` variable. |

The file's values **never override** the real process environment, and
`NITR_*` internals are always hidden from scripts. See [Environment
variables](./env).

## `[health]`

Liveness and readiness, answered entirely in Rust — a handler cannot
influence them. Enabled by default on the main listener.

```toml
[health]
enabled = true
liveness = "/healthz"
readiness = "/readyz"
bind = "127.0.0.1:9090"
```

| Key         | Default      | Description                                                                                                                |
| ----------- | ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `enabled`   | `true`       | Serve the probes.                                                                                                          |
| `liveness`  | `"/healthz"` | Never touches a Lua state.                                                                                                 |
| `readiness` | `"/readyz"`  | Flips to `503 draining` the moment a graceful drain starts, so a rolling deploy shifts traffic _before_ requests can fail. |
| `bind`      | _unset_      | Optional separate address, to keep the probes off the public port.                                                         |

## `[log]`

```toml
[log]
format = "text"
level = "info"
```

| Key      | Default                          | Description                                                                                         |
| -------- | -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `format` | `"text"`                         | `"json"` emits one object per line with request/error fields as real keys, ready for a log shipper. |
| `level`  | `"info"` (`"debug"` in dev mode) | Overridden by the `RUST_LOG` environment variable.                                                  |

See [Logging](../logging) for the span schema and the redaction rules.

## `[std]`

Which `nitr.*` standard library modules exist in your scripts.

```toml
[std]
features = ["json", "http", "log", "time", "validate", "base64", "path", "url"]
```

When the key is omitted, exactly that minimal set is enabled. Valid
names:

| Feature    | Provides                                                                                                                                       | Always compiled in?                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `json`     | `nitr.json`                                                                                                                                    | yes                                |
| `http`     | `nitr.text`, `nitr.html`, `nitr.redirect`, `nitr.status`, `nitr.error`, `nitr.negotiate`, `nitr.etag`, `nitr.sse`, `nitr.csrf`, `nitr.session` | yes                                |
| `log`      | `nitr.log.*`                                                                                                                                   | yes                                |
| `time`     | `nitr.time.*`                                                                                                                                  | yes                                |
| `validate` | `nitr.validate`                                                                                                                                | yes                                |
| `base64`   | `nitr.base64`                                                                                                                                  | yes                                |
| `path`     | `nitr.path`                                                                                                                                    | yes                                |
| `url`      | `nitr.url`                                                                                                                                     | yes                                |
| `cache`    | `nitr.cache`                                                                                                                                   | yes                                |
| `dbg`      | `nitr.dbg`                                                                                                                                     | yes                                |
| `env`      | `nitr.env`                                                                                                                                     | yes                                |
| `fetch`    | `nitr.fetch`, `nitr.await_all`                                                                                                                 | needs the `fetch` Cargo feature    |
| `db`       | `nitr.db`, migrations, `nitr migrate`                                                                                                          | needs the `db` Cargo feature       |
| `template` | `nitr.template`                                                                                                                                | needs the `template` Cargo feature |
| `crypto`   | `nitr.crypto`, `nitr.auth`                                                                                                                     | needs the `crypto` Cargo feature   |

Two rules make mistakes loud:

- **Listing a feature is strict.** `"db"` without a `[database]` section
  fails at startup.
- **A feature must also be compiled in.** The released `nitr` binary has
  all of them; a build made with `--no-default-features` does not, and
  asking for one it lacks is a startup error naming the Cargo feature to
  enable. See [Cargo features](../../library/cargo-features).

## `[lua]`

The sandbox.

```toml
[lua]
stdlib = ["math", "table", "string", "utf8", "coroutine", "package"]
memory_limit = 8388608
exec_timeout_ms = 30000
```

| Key               | Default                                                       | Description                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stdlib`          | `["math", "table", "string", "utf8", "coroutine", "package"]` | Lua standard libraries loaded into every state.                                                                                                                                  |
| `memory_limit`    | 8 MiB                                                         | Per-state Lua memory limit in bytes. A state that hits it is poisoned, dropped and rebuilt.                                                                                      |
| `exec_timeout_ms` | `30000`                                                       | Wall-clock budget per handler invocation. Enforced by an instruction-count hook (which stops CPU-bound loops) **plus** an async timeout (which stops slow I/O). `0` disables it. |

> [!DANGER] `io` and `os` are excluded on purpose
>
> They give scripts ambient filesystem and process access. Nothing in
> `nitr.*` needs them — [`nitr.time`](../../api/#nitr-time) covers dates
> and clocks, [`nitr.path`](../../api/#nitr-path) is lexical only — but
> with `os` would come `os.execute`, `os.remove` and `os.getenv`. Adding
> them to `stdlib` is possible and is a deliberate reduction of the
> sandbox. See [Security](../security).

## The annotated original

The Nitr repository ships a fully commented
[`nitr.toml`](https://github.com/nitrweb/nitr/blob/master/nitr.toml)
carrying the same content as inline comments, if you prefer to read it
that way.

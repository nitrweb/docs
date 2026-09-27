# The `nitr.toml` File

The complete reference. Every key is optional unless marked required;
the value shown is the default.

- **Unknown keys are a startup error**, so a typo fails loudly. Old
  spellings (`database = "app.db"`, `tests_dir`, `templates_dir`) are
  refused with the new spelling named.
- **Relative paths resolve against the working directory**, not against
  the file. `nitr -c /srv/app/nitr.toml` still reads
  `handler_script = "app.lua"` as `./app.lua`, so start the process from
  the application directory (systemd's `WorkingDirectory=`) or use
  absolute paths. The one exception is [`[env] file`](#env), which
  resolves next to `nitr.toml`.
- `nitr check --print-config` shows the final values after the file,
  `NITR_*` variables and CLI flags are combined. See
  [Configuration](./).

The Nitr repository also ships a fully commented
[`nitr.toml`](https://github.com/nitrweb/nitr/blob/master/nitr.toml).

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

| Key                | Type    | Default                 | Description                                                                                                                                                                                                                    |
| ------------------ | ------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `listen`           | string  | `"127.0.0.1:3000"`      | Address to bind. With `[tls] enabled = true` this same address speaks HTTPS.                                                                                                                                                   |
| `handler_script`   | path    | `"scripts/handler.lua"` | The script that returns `nitr.app()`. Loaded once per Lua state.                                                                                                                                                               |
| `config_script`    | path    | _unset_                 | Runs once per (re)build. Its returned table becomes `nitr.cfg` in every state; without it, `nitr.cfg` is `nil`.                                                                                                                |
| `dev_mode`         | bool    | `false`                 | Hot reload and error details in responses. Also set by `--dev` and `nitr dev`.                                                                                                                                                 |
| `workers`          | integer | CPU cores               | Number of Lua states: the most handlers that run at once. Maximum 4096.                                                                                                                                                        |
| `max_streams`      | integer | `workers - 1` (min 1)   | Most concurrent [streaming responses](../streaming). Each holds a Lua state while it runs; past the cap a stream is answered `503`. May not exceed `workers`; `0` is refused. Startup warns when streams can hold every state. |
| `trust_request_id` | bool    | `false`                 | Reuse an incoming `X-Request-ID` (well-formed, up to 64 ASCII chars) instead of generating one. Enable **only** behind a proxy that sets or cleans the header.                                                                 |
| `pidfile`          | path    | _unset_                 | File the server writes its process id to at startup and removes at exit. [`nitr reload`](../cli#reload) uses it to find the server.                                                                                            |

> [!TIP] Sizing `workers`
>
> `workers` is your concurrency limit for Lua handlers. One per core
> suits CPU-bound handlers. If handlers mostly wait on `nitr.db` or
> `nitr.fetch`, a higher number keeps the pool from being the
> bottleneck.

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

| Key                | Default | When exceeded                             | Description                                                                                                           |
| ------------------ | ------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `max_body_bytes`   | 1 MiB   | `413`                                     | Request body cap, counted as the body arrives (not read from `Content-Length`).                                       |
| `max_header_bytes` | 16 KiB  | `431`                                     | Request header buffer. Values below 8192 are raised to 8192.                                                          |
| `max_uri_bytes`    | 8 KiB   | `414`                                     | Request URI cap. Must be below the header buffer (`max_header_bytes`, at least 8192), or startup fails.               |
| `max_connections`  | 1024    | listener stops accepting                  | Concurrent TCP connections. Maximum 1048576.                                                                          |
| `pool_wait_ms`     | 5000    | `503` + `Retry-After`                     | How long a request waits for a free Lua state. `0` waits forever.                                                     |
| `header_read_ms`   | 30000   | connection closed                         | Deadline for the complete request headers. `0` disables it.                                                           |
| `body_read_ms`     | 30000   | `408` + connection closed                 | How long each body read may wait for more bytes. It limits stalls, not total upload time. `0` disables it.            |
| `max_form_parts`   | 64      | `413`, via a Lua error in `req:multipart` | Parts allowed in a `multipart/form-data` body.                                                                        |
| `max_field_bytes`  | 64 KiB  | `413`, via a Lua error in `part:text()`   | Per non-file form field. Fields become Lua strings, so this bounds Lua memory.                                        |
| `max_file_bytes`   | 10 MiB  | `413`, via a Lua error in `part:save()`   | Per uploaded file. Files stream to disk and never enter Lua memory. Also caps a validation `file` rule's `max_bytes`. |

> [!WARNING] Raising `max_file_bytes` is not enough
>
> `max_body_bytes` caps the whole request, uploads included. Raise both.

The three multipart caps raise Lua errors. Uncaught, they answer `413`
without calling [`on_error`](../errors); catch them with `pcall` to answer
something else. See [Requests](../requests#file-uploads).

Two timing checks run at startup, only when both values are non-zero:

- `pool_wait_ms` greater than `[lua] exec_timeout_ms` is an **error**: a
  request would wait longer for a state than any handler may run.
- `body_read_ms` greater than `[lua] exec_timeout_ms` **warns**: a
  stalled body read would end as a handler timeout instead of a `408`.

## `[multipart]`

Where uploads may be saved. The upload size limits live in
[`[limits]`](#limits).

```toml
[multipart]
upload_dir = "uploads"
```

| Key          | Default                        | Description                                                                                |
| ------------ | ------------------------------ | ------------------------------------------------------------------------------------------ |
| `upload_dir` | _unset (`part:save` disabled)_ | Root directory for `part:save(path)`. Must exist and be writable at startup (Nitr checks). |

Paths passed to `part:save` are **relative to `upload_dir`**. Absolute
paths and paths that climb out with `..` are refused. Build the path
from `part.safe_filename`, the client's file name reduced to a plain
name. See [Requests → File uploads](../requests#file-uploads).

> [!DANGER] Keep uploads away from code
>
> Nitr refuses to start when `upload_dir` is inside the handler script's
> directory or `[templating] dir`: an uploaded file could become a
> loadable Lua module or replace a template. Inside `[static] dir` only
> warns, since serving uploads back (avatars) can be intended.

## `[cookies]`

Defaults for cookies **Nitr builds**: the session and CSRF cookies, and
anything set through `res.cookies:set` / `:set_signed`. A `Set-Cookie`
header you write yourself is not changed.

```toml
[cookies]
secure = "auto"
```

| Key      | Default  | Values                                                                                                                               |
| -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `secure` | `"auto"` | `"auto"`: `Secure` when `[tls] enabled = true`. `"always"`: TLS ends at a proxy in front of Nitr. `"never"`: plain-HTTP development. |

An explicit `secure` option passed from Lua always wins.

> [!WARNING] Behind a TLS proxy, use `"always"`
>
> The usual deployment is Nitr on loopback behind a proxy that handles
> TLS. `[tls] enabled = false` is right for Nitr, but cookies must still
> be `Secure`, and Nitr cannot detect the proxy. So when cookies would
> not be `Secure`, Nitr warns at startup (except in dev mode).

See [Cookies & sessions](../cookies-sessions).

## `[database]`

SQLite for the [`nitr.db`](../database) builtin. Without this section
the builtin is unavailable.

```toml
[database]
path = "data/app.db"
journal_mode = "wal"
busy_timeout = 5000
synchronous = "normal"
foreign_keys = true
cache_size = -2000
max_rows = 10000
migrations_dir = "migrations"
```

| Key              | Default    | Description                                                                                                |
| ---------------- | ---------- | ---------------------------------------------------------------------------------------------------------- |
| `path`           | _required_ | The database file. SQLite creates the file but not its directory; a missing directory is a startup error.  |
| `journal_mode`   | `"wal"`    | `"wal"`, `"delete"`, or `"keep"` to leave the file's current mode (safest when other tools open the file). |
| `busy_timeout`   | `5000`     | Milliseconds to wait on a lock before failing with `SQLITE_BUSY`.                                          |
| `synchronous`    | `"normal"` | SQLite `synchronous` pragma. `"normal"` is the usual pairing with WAL.                                     |
| `foreign_keys`   | `true`     | Enforce foreign keys (SQLite's own default is off).                                                        |
| `cache_size`     | `-2000`    | SQLite `cache_size` per connection; negative values are KiB.                                               |
| `max_rows`       | `10000`    | Most rows one `nitr.db:query` may return. A larger result raises an error instead of being cut short.      |
| `migrations_dir` | _unset_    | Where `nitr migrate` finds `NNN_name.sql` files. Unset uses `migrations/` when that directory exists.      |

> [!WARNING] WAL uses three files
>
> The database is `app.db`, `app.db-wal` and `app.db-shm`. Copying only
> `app.db` from a running server is not a consistent backup. Use
> `VACUUM INTO`, or stop the server.

## `[cache]`

The shared [`nitr.cache`](../cache). Enable it with `"cache"` in
[`[std] features`](#std).

```toml
[cache]
max_entries = 10000
max_bytes = 33554432
default_ttl = 300
```

| Key           | Default | Description                                                          |
| ------------- | ------- | -------------------------------------------------------------------- |
| `max_entries` | `10000` | Most entries; the least recently used is evicted past it.            |
| `max_bytes`   | 32 MiB  | Total size of stored entries, keys included.                         |
| `default_ttl` | `300`   | Seconds an entry lives when `set` does not say. `0` means no expiry. |

Keys are limited to 1024 bytes. The cache is per process: a restart
empties it, and two processes have separate caches.

## `[compression]`

On-the-fly response compression. Off by default, because it costs CPU.
Needs the `compression` Cargo feature.

```toml
[compression]
enabled = true
algorithms = ["br", "gzip"]
min_size = 1024
types = ["text/*", "application/json", "application/javascript"]
```

| Key          | Default          | Description                                                                                           |
| ------------ | ---------------- | ----------------------------------------------------------------------------------------------------- |
| `enabled`    | `false`          | Compress responses.                                                                                   |
| `algorithms` | `["br", "gzip"]` | Offered in this order; the server's order wins over the client's. Only `"br"` and `"gzip"` are valid. |
| `min_size`   | `1024`           | Smaller responses are sent uncompressed.                                                              |
| `types`      | see below        | Content types to compress. A trailing `*` matches a prefix (`"text/*"`).                              |

Default `types`: `text/*`, `application/json`, `application/javascript`,
`application/xml`, `image/svg+xml`. Already-compressed families (images,
video, archives) are skipped when matched by a `*` pattern; a full type
you list, such as `image/svg+xml`, is compressed. A response with
`Cache-Control: no-transform` is never compressed.

Precompressed files (`app.js.br` or `app.js.gz` next to `app.js`) are
served whenever they exist, whatever this section or the build says.

## `[cors]`

Cross-origin resource sharing, handled in Rust: preflight requests never
reach Lua. Disabled until `origins` is set.

```toml
[cors]
origins = ["https://app.example.com"]
methods = ["GET", "POST"]
headers = ["content-type", "authorization"]
expose_headers = ["x-request-id"]
credentials = false
max_age = 86400
```

| Key              | Default            | Description                                                                                                 |
| ---------------- | ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `origins`        | _unset (disabled)_ | Allowed origins as `scheme://host[:port]`, or `["*"]` for any. A path or trailing slash is a startup error. |
| `methods`        | _unset_            | Allowed methods (case-insensitive).                                                                         |
| `headers`        | _unset_            | Allowed request headers.                                                                                    |
| `expose_headers` | _unset_            | Response headers the browser may read.                                                                      |
| `credentials`    | `false`            | Allow cookies and `Authorization`. Cannot be combined with `origins = ["*"]`.                               |
| `max_age`        | _unset_            | Seconds a browser may cache the preflight answer.                                                           |

## `[tls]`

HTTPS served by Nitr itself (rustls). Needs the `tls` Cargo feature. See
[TLS](../tls) for certificates, renewal, HSTS and the HTTP redirect.

```toml
[tls]
enabled = true
cert = "/etc/nitr/tls/fullchain.pem"
key = "/etc/nitr/tls/privkey.pem"
min_version = "1.2"
handshake_ms = 10000
```

| Key            | Default                    | Description                                             |
| -------------- | -------------------------- | ------------------------------------------------------- |
| `enabled`      | `false`                    | Serve HTTPS on `listen`.                                |
| `cert`         | _required when enabled_    | PEM certificate chain: leaf first, then intermediates.  |
| `key`          | _required when enabled_    | PEM private key: PKCS#8, PKCS#1 or SEC1.                |
| `min_version`  | `"1.2"`                    | `"1.2"` or `"1.3"`. TLS 1.0 and 1.1 are not available.  |
| `handshake_ms` | `min(header_read_ms, 10s)` | Deadline for the TLS handshake. `0` is a startup error. |

Both files are read and checked at startup. `SIGHUP` or
[`nitr reload`](../cli#reload) re-reads them and switches only if the new
pair is valid. A key file readable by other users logs a warning.
`nitr build` never bundles `cert` or `key`.

> [!WARNING] TLS replaces plain HTTP on `listen`
>
> With `enabled = true`, nothing answers plain HTTP on that address and
> nothing redirects for you. See [TLS](../tls) for the redirect recipe.

## `[shutdown]`

```toml
[shutdown]
grace = 30
stream_grace = 5
readiness_delay = 5
```

| Key               | Default    | Description                                                                                                                                                                                                                                                  |
| ----------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `grace`           | `30`       | Seconds for in-flight requests to finish after `SIGTERM`/`SIGINT`.                                                                                                                                                                                           |
| `stream_grace`    | `5`        | Extra seconds for streaming and SSE responses still open after that.                                                                                                                                                                                         |
| `readiness_delay` | `5` or `0` | Seconds the server keeps serving after the signal while `/readyz` already answers `503`, so a load balancer stops sending traffic before the port closes. Defaults to `5` when the probes are on the main listener, `0` with `[health] bind` or in dev mode. |

A drain that runs out of time exits non-zero. Give your supervisor
(systemd `TimeoutStopSec`, Docker `--time`) longer than
`readiness_delay + grace + stream_grace`. See [Deployment](../deployment/).

## `[rate_limit]`

Per-client-IP fixed-window rate limiting. Over the budget, requests get
`429` with `Retry-After`.

```toml
[rate_limit]
enabled = true
requests = 100
window = 60
trust_forwarded_for = false
```

| Key                   | Default | Description                                                                                                                       |
| --------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`             | `false` | Turn the limiter on.                                                                                                              |
| `requests`            | `100`   | Requests allowed per window and client. At least `1`.                                                                             |
| `window`              | `60`    | Window length in seconds. At least `1`.                                                                                           |
| `trust_forwarded_for` | `false` | Identify clients by the **last** `X-Forwarded-For` entry (the one your proxy added). Enable **only** behind a proxy that sets it. |

IPv6 clients share one budget per `/64`. Because the window is fixed, a
burst across a window boundary can briefly reach twice the rate.

## `[fetch]`

Rules for outbound requests made with [`nitr.fetch`](../fetch). By
default, private, loopback and link-local addresses are refused, and
every redirect is checked again.

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

| Key                       | Default | Description                                                                                                                   |
| ------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `allowed_hosts`           | _unset_ | If set, only these exact host names may be fetched (redirects included).                                                      |
| `allow_private_networks`  | `false` | Allow loopback and private-network targets.                                                                                   |
| `max_response_bytes`      | 8 MiB   | Cap on bodies read with `resp:text()` / `resp:json()`.                                                                        |
| `max_concurrent`          | `8`     | Most requests of one `nitr.await_all(...)` in flight at a time; the rest wait.                                                |
| `max_per_request`         | `32`    | Most outbound calls one incoming request may make. `0` removes the cap.                                                       |
| `connect_timeout`         | `10.0`  | Seconds to connect.                                                                                                           |
| `timeout`                 | `30.0`  | Seconds per request. A per-call `timeout` may lower it, not raise it.                                                         |
| `pool_max_idle_per_host`  | `8`     | Idle connections kept per host.                                                                                               |
| `max_retries`             | `5`     | Upper limit for a call's `retry.attempts`. Retries are opt-in, only for idempotent methods, and never after a policy refusal. |
| `proxy`                   | _unset_ | Proxy URL. Unset uses `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY`.                                                             |
| `no_proxy`                | `false` | Ignore the proxy environment variables.                                                                                       |
| `propagate_trace_context` | `false` | Send a W3C `traceparent` header derived from the request id.                                                                  |

> [!WARNING] A proxy needs an explicit choice
>
> A proxy looks up target addresses itself, so Nitr cannot block private
> addresses behind it. With `"fetch"` enabled and a proxy configured
> (here or through the environment), Nitr refuses to start unless you
> also set `allowed_hosts`, `allow_private_networks = true`, or
> `no_proxy = true`.

## `[static]`

Static file serving in Rust, with ETag, `Last-Modified`, `304` and range
requests, without a Lua state. Routes win: a mount answers a `GET` or
`HEAD` only for a path no route serves with that method. Scripts can add
mounts with [`app:static(...)`](../static-files).

```toml
[static]
dir = "public"
mount = "/"
spa = false
cache_control = "public, max-age=3600"
dotfiles = false
```

| Key             | Default            | Description                                                                                                                    |
| --------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `dir`           | _unset (disabled)_ | Directory to serve. Must be readable at startup.                                                                               |
| `mount`         | `"/"`              | URL prefix.                                                                                                                    |
| `spa`           | `false`            | Serve `index.html` for paths nothing matches (single-page apps). A path a route serves with other methods still answers `405`. |
| `cache_control` | _unset_            | `Cache-Control` header for served files.                                                                                       |
| `dotfiles`      | `false`            | Serve names starting with `.`. `.well-known/` is always served.                                                                |

> [!DANGER] Never serve your code
>
> A `dir` that contains the handler script's directory or
> `[templating] dir` is a startup error. `dir = "."` would otherwise serve
> `app.lua` and `nitr.toml`. Point it at a folder of public files only.

## `[templating]`

```toml
[templating]
dir = "templates"
```

| Key   | Default | Description                                                           |
| ----- | ------- | --------------------------------------------------------------------- |
| `dir` | _unset_ | Where [`nitr.template`](../templates) loads minijinja templates from. |

Without `dir` the builtin is unavailable, and listing `"template"` in
`[std] features` is a startup error.

## `[testing]`

Settings for [`nitr test`](../testing).

```toml
[testing]
dir = "tests"
database = "data/test.db"
seed = "tests/fixtures/seed.sql"
capture = true
slow_ms = 1000
```

| Key        | Default                          | Description                                                                                      |
| ---------- | -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `dir`      | `"tests"`                        | Where `*.lua` test files are found. Not recursive: subfolders hold helpers that tests `require`. |
| `database` | _unset (a private file per run)_ | SQLite file tests use. A named file is recreated at the start of every run and kept afterwards.  |
| `seed`     | _unset_                          | SQL file applied after the migrations. `t.db.reset()` restores the database to this state.       |
| `capture`  | `true`                           | Show a test's log lines only if it fails. `nitr test --nocapture` streams them instead.          |
| `slow_ms`  | `1000`                           | Tests slower than this (milliseconds) are marked `slow`.                                         |

`nitr test` never uses `[database] path`, and refuses a
`[testing] database` that names the same file. It also refuses an
`upload_dir` inside `[testing] dir`.

## `[env]`

The dotenv file loaded at startup, and what the opt-in `nitr.env`
builtin may read. See [Environment variables](./env).

```toml
[env]
file = ".env"
allow = ["APP_", "API_TOKEN"]
```

| Key     | Default                                | Description                                                                                                   |
| ------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `file`  | `.env` next to `nitr.toml`, if present | Dotenv file to load, relative to `nitr.toml`. A file you name must exist. `NITR_ENV_FILE` overrides it.       |
| `allow` | _unset_                                | Names `nitr.env` may read: exact names, or prefixes ending in `_`. Unset allows any variable except `NITR_*`. |

## `[health]`

Liveness and readiness probes, answered in Rust (Lua never sees them).
On by default.

```toml
[health]
enabled = true
liveness = "/healthz"
readiness = "/readyz"
bind = "127.0.0.1:9090"
max_connections = 64
```

| Key               | Default      | Description                                                                                             |
| ----------------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| `enabled`         | `true`       | Serve the probes.                                                                                       |
| `liveness`        | `"/healthz"` | `200 ok` while the process runs. Never waits for a Lua state.                                           |
| `readiness`       | `"/readyz"`  | `200 ok`, then `503 draining` as soon as a graceful shutdown starts (see `[shutdown] readiness_delay`). |
| `bind`            | _unset_      | Separate address for the probes, to keep them off the public port. Always plain HTTP.                   |
| `max_connections` | `64`         | Connection cap for the separate `bind` listener only.                                                   |

Both paths must start with `/` and must differ. Only `GET` and `HEAD`
are answered.

## `[openapi]`

The [OpenAPI 3.1 document](../openapi/) generated from your routes.
Needs the `openapi` Cargo feature.

```toml
[openapi]
enabled = true
path = "/openapi.json"
servers = ["https://api.example.com"]
include_undocumented = true
output = "openapi.json"
```

| Key                    | Default           | Description                                                                                                         |
| ---------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `enabled`              | `false`           | Serve the document at `path`. `nitr openapi` generates it either way.                                               |
| `path`                 | `"/openapi.json"` | URL path. Must start with `/`, with no trailing slash. A route on this path is a startup error.                     |
| `servers`              | _unset_           | The document's `servers` list.                                                                                      |
| `include_undocumented` | `true`            | Include routes without a `doc` table. `doc = { hidden = true }` always leaves a route out.                          |
| `output`               | _unset_           | **Dev mode only**: file rewritten when the document changes. May not be a `.lua` file or inside `[templating] dir`. |

## `[swagger]`

The [Swagger UI page](../openapi/swagger-ui), served from the binary (no
CDN). Needs the `swagger` Cargo feature.

```toml
[swagger]
enabled = true
path = "/docs"
try_it_out = true

[swagger.options]
showExtensions = true
```

| Key                           | Default             | Description                                                                                                       |
| ----------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `enabled`                     | `false`             | Serve the page. Needs `[openapi] enabled = true`, or a `spec_url`.                                                |
| `path`                        | `"/docs"`           | URL path. May not overlap `[openapi] path` or a `[health]` path.                                                  |
| `title`                       | the `app:doc` title | Page title.                                                                                                       |
| `spec_url`                    | `[openapi] path`    | The document the page loads.                                                                                      |
| `allow_external_spec`         | `false`             | Allow a `spec_url` on another origin.                                                                             |
| `deep_linking`                | `true`              | Swagger UI `deepLinking`.                                                                                         |
| `doc_expansion`               | `"list"`            | `"list"`, `"full"` or `"none"`.                                                                                   |
| `filter`                      | `false`             | Show the operation filter box.                                                                                    |
| `try_it_out`                  | `false`             | Start with "Try it out" enabled.                                                                                  |
| `display_request_duration`    | `false`             | Show how long a request took.                                                                                     |
| `persist_authorization`       | `false`             | Keep entered tokens in the browser's `localStorage`.                                                              |
| `display_operation_id`        | `false`             | Show operation ids.                                                                                               |
| `default_models_expand_depth` | `1`                 | How deep schemas start expanded.                                                                                  |
| `[swagger.options]`           | _empty_             | Extra Swagger UI options, in camelCase. May not repeat a key above, nor set `url`, `dom_id`, `domNode` or `spec`. |

## `[log]`

```toml
[log]
format = "text"
level = "info"
```

| Key      | Default                          | Description                                                                                                                                     |
| -------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `format` | `"text"`                         | `"text"` for people, `"json"` (one object per line) for log shippers.                                                                           |
| `level`  | `"info"` (`"debug"` in dev mode) | A level (`error`, `warn`, `info`, `debug`, `trace`, `off`) or a `target=level` list. Anything else is a startup error. `RUST_LOG` overrides it. |

See [Logging](../logging).

## `[std]`

Which `nitr.*` modules your scripts can use.

```toml
[std]
features = ["json", "http", "log", "time", "validate", "base64", "path", "url"]
```

Without `features`, exactly this minimal set is enabled.

| Feature    | Provides                                                                                                                                       | Cargo feature |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `json`     | `nitr.json`                                                                                                                                    | —             |
| `http`     | `nitr.text`, `nitr.html`, `nitr.redirect`, `nitr.status`, `nitr.error`, `nitr.negotiate`, `nitr.etag`, `nitr.sse`, `nitr.csrf`, `nitr.session` | —             |
| `log`      | `nitr.log`                                                                                                                                     | —             |
| `time`     | `nitr.time`                                                                                                                                    | —             |
| `validate` | `nitr.validate`                                                                                                                                | —             |
| `base64`   | `nitr.base64`                                                                                                                                  | —             |
| `path`     | `nitr.path`                                                                                                                                    | —             |
| `url`      | `nitr.url`                                                                                                                                     | —             |
| `cache`    | `nitr.cache`                                                                                                                                   | —             |
| `dbg`      | `nitr.dbg`                                                                                                                                     | —             |
| `env`      | `nitr.env`                                                                                                                                     | —             |
| `fetch`    | `nitr.fetch`, `nitr.await_all`                                                                                                                 | `fetch`       |
| `db`       | `nitr.db`                                                                                                                                      | `db`          |
| `template` | `nitr.template`                                                                                                                                | `template`    |
| `crypto`   | `nitr.crypto`, `nitr.auth`                                                                                                                     | `crypto`      |

An explicit list is strict: an unknown name, `"db"` without
`[database]`, or `"template"` without `[templating] dir` fails at
startup. The released `nitr` binary includes every Cargo feature; a
custom build missing one fails at startup and names it. See
[Cargo features](../../library/cargo-features).

## `[lua]`

The Lua sandbox. See [Security](../security) for the full model.

```toml
[lua]
stdlib = ["math", "table", "string", "utf8", "coroutine", "package"]
memory_limit = 8388608
exec_timeout_ms = 30000
```

| Key               | Default                                                       | Description                                                                                                                        |
| ----------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `stdlib`          | `["math", "table", "string", "utf8", "coroutine", "package"]` | Lua standard libraries loaded into every state. `"io"` and `"os"` are allowed; `"debug"` is a startup error.                       |
| `memory_limit`    | 8 MiB                                                         | Memory limit per Lua state, in bytes. A state that hits it is thrown away and rebuilt. `0` is refused.                             |
| `exec_timeout_ms` | `30000`                                                       | Time limit per handler call, and per load of `config.lua` and the handler script. Covers busy loops and slow I/O. `0` disables it. |

> [!DANGER] Adding `io` or `os` weakens the sandbox
>
> They give scripts access to files and processes (`os.execute`,
> `os.remove`, `dofile`, `loadfile`). Nitr does not need them:
> [`nitr.time`](../../api/#nitr-time) covers dates and clocks.

`require` only loads `.lua` files from the handler script's directory
(`a.b` means `a/b.lua` or `a/b/init.lua`). Native modules and
precompiled bytecode cannot be loaded.

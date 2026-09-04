# The `nitr.toml` File

The complete reference. Every key is optional; the value shown is the
default.

> [!TIP] Three things to remember
>
> - **Unknown keys are a startup error.** A typo fails loudly. So does a
>   key that moved between releases — `tests_dir`, `templates_dir` and
>   the old `database = "app.db"` string are each refused with the new
>   spelling named, rather than being silently ignored.
> - **Relative paths resolve against the working directory**, not
>   against the file. `nitr -c /srv/app/nitr.toml` still reads
>   `handler_script = "scripts/handler.lua"` as `./scripts/handler.lua`,
>   so either start the process from the application directory (what
>   systemd's `WorkingDirectory=` is for) or write absolute paths. The
>   one exception is the `[env]` file, which is anchored next to
>   `nitr.toml`.
> - `nitr check --print-config` renders the configuration **after** the
>   file, the `NITR_*` variables and the CLI flags have been layered —
>   the answer to "which value actually won?".

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

| Key                | Type    | Default                 | Description                                                                                                                                                                                                                       |
| ------------------ | ------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listen`           | string  | `"127.0.0.1:3000"`      | Address the server binds to. With `[tls] enabled = true` this same address speaks HTTPS — TLS converts the listener, it does not add one.                                                                                         |
| `handler_script`   | path    | `"scripts/handler.lua"` | The script that returns `nitr.app()`. Loaded once per pooled Lua state.                                                                                                                                                           |
| `config_script`    | path    | _unset_                 | Runs exactly once per (re)build, in a bootstrap state; its return value is snapshotted into every other state as `nitr.cfg`. Without it, `nitr.cfg` is `nil`.                                                                     |
| `dev_mode`         | bool    | `false`                 | Hot reload + error details in responses. Also set by `--dev` and `nitr dev`.                                                                                                                                                      |
| `workers`          | integer | CPU cores               | Number of pooled Lua states — the maximum number of handlers executing at once.                                                                                                                                                   |
| `max_streams`      | integer | `workers - 1` (min 1)   | Maximum concurrent [streaming responses](../streaming). Each holds a pooled state for its whole lifetime, so the default keeps idle streams from pinning the entire pool. Beyond the cap, a streaming response is answered `503`. |
| `trust_request_id` | bool    | `false`                 | Accept an inbound `X-Request-ID` (well-formed, ≤ 64 ASCII chars) instead of generating one. Enable **only** behind a proxy that sets or sanitizes the header.                                                                     |
| `pidfile`          | path    | _unset_                 | File the server writes its pid to at startup and removes at exit. This is what [`nitr reload`](../cli#reload) uses to find the process.                                                                                           |

> [!TIP] Sizing `workers`
>
> `workers` _is_ your concurrency limit for dynamic requests. The
> default (one per core) suits CPU-bound handlers. If your handlers
> spend most of their time waiting on `nitr.db` or `nitr.fetch`, a
> higher number keeps the pool from being the bottleneck — measure with
> `pool_checkout`'s `wait_ms` at debug level before changing it.

> [!WARNING] `max_streams` may not exceed `workers`
>
> A streaming response holds a pooled state, so slots past `workers`
> could never be used. Asking for them is a startup error rather than a
> number that silently means something else.

> [!NOTE] The counts that size real objects have ceilings
>
> `workers` is capped at 4096 (each is a full Lua VM with its own memory
> budget) and `[limits] max_connections` / `[health] max_connections` at
> 1 048 576. A stray zero — `max_connections = 10000000000` — is a
> startup error naming the maximum, instead of a process that binds the
> port and then dies building the connection semaphore.

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

| Key                | Default | On violation                   | Description                                                                                                                                                     |
| ------------------ | ------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `max_body_bytes`   | 1 MiB   | `413`                          | Request body cap, **counted as the body arrives** rather than trusted from `Content-Length`.                                                                    |
| `max_header_bytes` | 16 KiB  | connection rejected            | Request header buffer (minimum 8192).                                                                                                                           |
| `max_uri_bytes`    | 8 KiB   | `414`                          | Request URI cap.                                                                                                                                                |
| `max_connections`  | 1024    | listener stops accepting       | Concurrent TCP connections.                                                                                                                                     |
| `pool_wait_ms`     | 5000    | `503` + `Retry-After`          | How long a request waits for a free Lua state before being shed. `0` waits forever.                                                                             |
| `header_read_ms`   | 30000   | connection closed              | Deadline for the complete request headers. `0` disables.                                                                                                        |
| `body_read_ms`     | 30000   | `408` + `Connection: close`    | How long each body read may wait for the next bytes. Bounds _progress_, not total transfer: any allowed size may take as long as it keeps moving. `0` disables. |
| `max_form_parts`   | 64      | Lua error from `req:multipart` | Parts allowed in a `multipart/form-data` body.                                                                                                                  |
| `max_field_bytes`  | 64 KiB  | Lua error from `part:text()`   | Per non-file form field. These become Lua strings, so this bounds the state's heap.                                                                             |
| `max_file_bytes`   | 10 MiB  | Lua error from `part:save()`   | Per uploaded file. Files stream to disk in Rust and never enter the Lua heap.                                                                                   |

> [!WARNING] Raising `max_file_bytes` is not enough
>
> `max_body_bytes` bounds the **whole request**, uploads included. Raise
> both, or a large upload is rejected before the per-file limit is ever
> consulted.

> [!NOTE] The three multipart caps are Lua errors, not statuses
>
> Everything above `max_form_parts` is enforced before a request reaches
> Lua, and answers with the status shown. The three multipart caps are
> different: they are raised as ordinary Lua errors from inside
> `req:multipart`, `part:text()` and `part:save()`, and nothing maps them
> to a status — Nitr cannot know whether an over-cap part is a client
> mistake or your protocol. Uncaught, they reach
> [`on_error`](../errors) as a `500`; catch them if you want a `413`. See
> [Requests → File uploads](../requests#file-uploads).

> [!NOTE] Two timings are checked against `[lua] exec_timeout_ms`
>
> `pool_wait_ms` **may not exceed** it (both non-zero): a request that
> waits for a state longer than any handler may run means the queue can
> only grow, so it is a startup error. `body_read_ms` exceeding it only
> **warns** (again, both non-zero) — a stalled buffered read
> (`req:text()`, `req:form()`) would then surface as a handler timeout
> blaming your code instead of the clean `408` it deserves.
>
> `0` means "no bound" on either key, not a smaller number, so a `0` on
> either side of a comparison switches that check off entirely.

## `[multipart]`

Filesystem policy for uploads. The byte caps stay in `[limits]` with
every other byte cap; a directory belongs here, beside `[static] dir`
and `[templating] dir`. Needs the `multipart` Cargo feature for
`req:multipart(...)` itself — but the section parses in every build, so
one configuration file stays readable whatever the binary was compiled
with.

```toml
[multipart]
upload_dir = "uploads"
```

| Key          | Default                           | Description                                                                                                                                                           |
| ------------ | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `upload_dir` | _unset (`part:save` unavailable)_ | Root that every `part:save(path)` resolves inside. Must exist and be **writable** at startup — checked with a real write probe, because existence is not writability. |

Paths handed to `part:save` are **relative to this directory**. An
absolute path, or one climbing out with `..`, is **refused rather than
re-rooted**, so where a file lands always follows from what the source
says. A missing intermediate directory is an error too: materializing
directories out of attacker-influenced strings is not a favour.

Leaving `upload_dir` unset leaves `part:save` unavailable — the same
call `[templating] dir` makes. There is no safe directory to guess, and
an upload written somewhere nobody chose is worse than a startup error.

> [!DANGER] Never put the upload root under the handler script
>
> `require` is pinned to the handler script's own directory, so an
> uploaded `.lua` file there would be a loadable module — upload-to-RCE
> written in configuration. That combination **refuses to boot**.

> [!DANGER] Nor inside `[templating] dir`
>
> An upload whose name matches a template would replace it, which is
> stored script injection through the renderer. That combination refuses
> to boot too, for the same reason.

> [!WARNING] Inside `[static] dir` only warns
>
> Serving uploads back over HTTP is a real deployment shape (user
> avatars), so it is a startup warning rather than a refusal — but it
> turns every uploaded byte into hosted content, which has to be a
> choice you made on purpose.

> [!TIP] Build the path from `part.safe_filename`
>
> `part.filename` is exactly what the client sent. `part.safe_filename`
> is that name reduced to a plain file name — no separators, no control
> characters, never empty — so `part:save(part.safe_filename)` is safe
> on its own. It is `nil` exactly when `filename` is, so it remains the
> same "is this a file?" test. See [File
> uploads](../requests#file-uploads).

## `[cookies]`

Defaults for the cookies **Nitr builds**: the session and CSRF cookies,
and anything through `res.cookies:set` / `:set_signed`. A handler that
writes the `Set-Cookie` header itself never passes the serializer, so
that cookie's attributes are the script's own business.

```toml
[cookies]
secure = "auto"
```

| Key      | Type   | Default  | Description                                                                                                                                                                         |
| -------- | ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `secure` | string | `"auto"` | `"auto"` — `Secure` when `[tls] enabled = true`; `"always"` — always `Secure`, for TLS terminated in front of this process; `"never"` — never `Secure`, for plain-HTTP development. |

An explicit `secure` in the caller's own options table **always wins**,
in both directions. This setting only decides what happens when Lua says
nothing — which is also why it covers `res.cookies:set(name, value)`
called with no options table at all.

`"always"` is not a nicety. The most common Nitr deployment is a
loopback bind behind a terminating proxy, where `[tls] enabled = false`
is the correct setting for _this process_ **and** the cookies must still
be `Secure`. Nothing here can detect that proxy, so `"auto"` resolving
to _not_ secure **warns at startup** rather than guessing, and `"never"`
together with `[tls] enabled = true` warns as the contradiction it is.
`"never"` on a plaintext listener is silent — you have answered the
question — and `dev_mode = true` suppresses the warning entirely.

> [!NOTE] Why `Secure` is not simply forced
>
> `HttpOnly` is forced on the session and CSRF cookies, and cannot be
> un-set. `Secure` deliberately is not: a `Secure` cookie sent over
> plain `http` is dropped by the browser without a word — a far worse
> failure to debug than a line in the startup log.

> [!TIP] The attribute table extends, it does not replace
>
> The session and CSRF cookies default to `HttpOnly` and
> `SameSite=Lax`, and your options table is merged **over** those
> defaults rather than replacing them. `same_site` stays overridable (a
> legitimate cross-site form needs `"None"`); `http_only` does not. See
> [Cookies & Sessions](../cookies-sessions).

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
max_rows = 10000
migrations_dir = "migrations"
```

| Key              | Default    | Description                                                                                                                                |
| ---------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `path`           | _required_ | The database file. SQLite creates the file, but **not** its directory — a missing parent is a startup error.                               |
| `journal_mode`   | `"wal"`    | `"wal"`, `"delete"`, or `"keep"` to leave the existing mode alone (the safe choice for a database other tools also open).                  |
| `busy_timeout`   | `5000`     | Milliseconds to wait on a lock instead of failing with `SQLITE_BUSY`.                                                                      |
| `synchronous`    | `"normal"` | The right pairing with WAL: durable across an application crash, at risk only from power loss mid-checkpoint.                              |
| `foreign_keys`   | `true`     | SQLite leaves this off, which surprises everyone.                                                                                          |
| `cache_size`     | `-2000`    | KiB per connection (negative means KiB, per SQLite's convention).                                                                          |
| `max_rows`       | `10000`    | Most rows one `nitr.db:query` may return. Past it the query **raises**, naming this setting.                                               |
| `migrations_dir` | _unset_    | Where `nitr migrate` looks for `NNN_name.sql` files. Unset uses `migrations/` when that directory exists, and ignores it when it does not. |

> [!NOTE] `max_rows` errors rather than truncating
>
> Every row is materialized in memory on the blocking thread and then
> copied into the Lua state, so an unbounded `SELECT *` — or an
> attacker-chosen `LIMIT` a handler interpolated — is a memory
> amplifier. A truncated result would be a wrong answer that looks like
> a right one, so the query fails instead. Page with `LIMIT`/`OFFSET`,
> or raise the ceiling deliberately.

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

| Key           | Default | Description                                                                                                        |
| ------------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| `max_entries` | `10000` | Maximum number of entries (LRU beyond it).                                                                         |
| `max_bytes`   | 32 MiB  | Total size ceiling for the stored entries — **keys included**, so a long request-derived key costs what it weighs. |
| `default_ttl` | `300`   | Seconds an entry lives when `set` does not say; `0` means no expiry, leaving eviction to the size bounds.          |

Keys themselves are bounded to 1024 bytes; a longer one raises rather
than being stored. Hash the varying part when it comes from a request.

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

| Key          | Default          | Description                                                                                                                                                |
| ------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`    | `false`          | Turn on-the-fly compression on. Needs the `compression` Cargo feature.                                                                                     |
| `algorithms` | `["br", "gzip"]` | Offered best-first; the **server's** order wins over the client's preference. Only `"br"` and `"gzip"` are valid names — anything else is a startup error. |
| `min_size`   | `1024`           | Below roughly a packet, compressing costs more than it saves.                                                                                              |
| `types`      | see below        | Content types worth compressing. A trailing `*` matches a prefix, so `"text/*"` covers every text subtype.                                                 |

The default `types` list is `["text/*", "application/json",
"application/javascript", "application/xml", "image/svg+xml"]`.
Already-compressed types — images, video, archives — are skipped even
when a pattern would match them.

> [!NOTE] Precompressed sidecars need none of this
>
> An `app.js.br` next to `app.js` is served whenever it exists,
> regardless of this section and regardless of the `compression` Cargo
> feature — serving an already-compressed file needs no encoder.

> [!TIP] `Cache-Control: no-transform` opts one response out
>
> A response that sets it is left alone — that header is the
> application saying the bytes _are_ the representation, which is what a
> signed payload or a byte-exact download needs. Set it from the handler
> where re-encoding would be wrong.

## `[cors]`

Cross-origin resource sharing, enforced in Rust: a preflight is answered
**without reaching a Lua state**, and the policy is auditable in one
place instead of spread across middleware. Disabled until `origins` is
set.

```toml
[cors]
origins = ["https://app.example.com"]
methods = ["GET", "POST"]
headers = ["content-type", "authorization"]
expose_headers = ["x-request-id"]
credentials = false
max_age = 86400
```

| Key              | Default            | Description                                                                                                                                                                                                     |
| ---------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `origins`        | _unset (disabled)_ | Allowed origins, or `["*"]` for a public API.                                                                                                                                                                   |
| `methods`        | _unset_            | Allowed methods. Matched case-insensitively, so `["post"]` approves a browser's `POST`.                                                                                                                         |
| `headers`        | _unset_            | Allowed request headers.                                                                                                                                                                                        |
| `expose_headers` | _unset_            | Response headers the browser may read.                                                                                                                                                                          |
| `credentials`    | `false`            | **Cannot** be combined with `origins = ["*"]` — browsers reject `Access-Control-Allow-Origin: *` on a credentialed request, so the server refuses to start rather than shipping a policy no browser will honor. |
| `max_age`        | _unset_            | Seconds a browser may cache the preflight.                                                                                                                                                                      |

## `[tls]`

Inbound TLS termination, served by rustls over the `ring` provider.
Needs the `tls` Cargo feature (included in `all`). Off by default, and
deliberately never inferred from a certificate lying around: turning a
port from plaintext to TLS is a decision an operator makes, not one a
stray file makes for them.

```toml
[tls]
enabled = true
cert = "/etc/nitr/tls/fullchain.pem"
key = "/etc/nitr/tls/privkey.pem"
min_version = "1.2"
handshake_ms = 10000
```

| Key            | Default                    | Description                                                                                                                          |
| -------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `enabled`      | `false`                    | Whether the listener speaks TLS.                                                                                                     |
| `cert`         | _required when enabled_    | PEM holding the certificate chain: leaf first, then any intermediates a client needs.                                                |
| `key`          | _required when enabled_    | PEM holding the matching private key: PKCS#8, PKCS#1 or SEC1.                                                                        |
| `min_version`  | `"1.2"`                    | `"1.2"` or `"1.3"`. `"1.2"` is the floor and what a public endpoint wants; `"1.3"` is for a closed set of clients known to speak it. |
| `handshake_ms` | `min(header_read_ms, 10s)` | Deadline for the TLS handshake itself. `0` is a **startup error**, never "unbounded".                                                |

Everything checkable is checked at startup: the binary must have the
`tls` feature, both paths must name readable files, and the pair must
load. A listener that accepts TCP and then fails every handshake is
indistinguishable from a network fault — and it fails _after_ a
deployment has already shifted traffic onto it. `nitr check` catches all
of it before a port exists.

TLS 1.0 and 1.1 cannot be selected under any spelling: they are
deprecated by RFC 8996, rustls implements neither, and accepting the
name would promise a downgrade no build here can keep. ALPN advertises
exactly `http/1.1`, because that is exactly what the server speaks.

> [!DANGER] `enabled = true` converts the listener — it does not add one
>
> The address in `listen` starts speaking HTTPS and **nothing answers
> plaintext**. There is no dual-listener mode and nothing redirects for
> you: an operator moving a deployment from `:80` to `:443` silently
> breaks every client, bookmark and health check that still says
> `http://`. [TLS](../tls) has the redirect recipe — a second tiny
> instance, built from routes rather than middleware, with the canonical
> host taken from configuration and never from the request's `Host`
> header.

> [!TIP] Renewal is a reload, not a restart
>
> `SIGHUP` (or [`nitr reload`](../cli#reload)) re-reads both files and
> swaps the acceptor in **only when the new pair validates** — a
> half-written file keeps the old material and warns. Replace both files
> before signalling, the way certbot's write-then-rename already does.

> [!WARNING] The key path is not re-anchored by `nitr build`
>
> `nitr build` re-roots the scripts, templates and static files into the
> bundle; `cert` and `key` are deliberately left alone. A private key
> inside a copyable one-file artifact is a private key that leaks with
> it. Keep it external, like the database. A key file readable beyond
> its owner also earns a startup warning — the server reads it anyway,
> because a security check whose failure mode is "the deployment does
> not come up" gets disabled.

> [!NOTE] HSTS is the handler's job
>
> There is deliberately no `[tls] hsts` key. HSTS is a commitment with a
> long tail — a `max-age` mistake is cached by browsers and cannot be
> retracted from the server side — so the number is yours to choose, in
> one line of middleware. See [TLS](../tls).

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

| Key                   | Default | Description                                                                                                                                              |
| --------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`             | `false` | Turn the limiter on.                                                                                                                                     |
| `requests`            | `100`   | Allowed requests per window and client.                                                                                                                  |
| `window`              | `60`    | Window length in seconds.                                                                                                                                |
| `trust_forwarded_for` | `false` | Key by the **last** `X-Forwarded-For` entry — the one the proxy in front appended — instead of the peer address. Enable **only** behind a trusted proxy. |

Exceeding the budget answers `429` with `Retry-After`.

> [!NOTE] The **last** `X-Forwarded-For` entry is the proxy's word
>
> The first entry is whatever the client wrote, so keying by it would
> let one header buy a fresh budget per request. The last one is the
> address the nearest proxy accepted the connection from — which is the
> right key whether that proxy overwrites the header or (as nginx,
> Caddy, Traefik and HAProxy do by default) appends to what arrived.
> Where a proxy adds a whole new header _line_ instead of extending the
> first, the last line is the one read. With more than one hop the
> budget keys by the nearest hop's client, not the origin client.
>
> A header that does not parse falls back to the peer address, and the
> setting is still only safe behind a proxy that actually sets it: on a
> directly-exposed listener, `true` lets any client choose its own key.

> [!NOTE] IPv6 clients are keyed by their /64
>
> A single subscriber routinely holds 2^64 addresses, so per-address
> budgets would be free to evade. The whole /64 shares one budget;
> IPv4 is keyed as itself, and a v4-mapped address (`::ffff:a.b.c.d`)
> is unwrapped first.

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

| Key                       | Default | Description                                                                                                                  |
| ------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `allowed_hosts`           | _unset_ | Exact-host allow-list, applied to **all hops**.                                                                              |
| `allow_private_networks`  | `false` | Permit loopback/RFC1918 targets.                                                                                             |
| `max_response_bytes`      | 8 MiB   | Cap on `resp:text()` / `resp:json()` bodies.                                                                                 |
| `max_concurrent`          | `8`     | Maximum requests per `nitr.await_all(...)`.                                                                                  |
| `max_per_request`         | `32`    | Total outbound calls one **inbound** request may make, including a loop issuing them one after another. `0` removes the cap. |
| `connect_timeout`         | `10.0`  | Seconds to establish a connection.                                                                                           |
| `timeout`                 | `30.0`  | Per-request budget, and a **ceiling**: a per-call `timeout` option may lower it, never raise it.                             |
| `pool_max_idle_per_host`  | `8`     | Idle connections kept per host.                                                                                              |
| `max_retries`             | `5`     | Ceiling on `retry.attempts`. Retries are opt-in per call and only ever applied to idempotent methods.                        |
| `proxy`                   | _unset_ | Explicit proxy. Unset reads `HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY`.                                                          |
| `no_proxy`                | `false` | Ignore the proxy environment variables entirely.                                                                             |
| `propagate_trace_context` | `false` | Forward a W3C `traceparent` derived from the inbound request id. Pass-through only: this is not a tracing SDK.               |

> [!TIP] Why DNS rebinding does not work here
>
> A hostname is resolved **once**, inside the resolver the connector
> itself uses. A DNS server cannot answer one address to the policy
> check and a different one to the connect.

> [!DANGER] A proxy plus `fetch` needs an explicit trust decision
>
> Behind a proxy the **proxy** resolves the target, so the guarded
> resolver above never runs and only the pre-flight name check does. So
> with `"fetch"` in `[std] features` and a proxy in play — `proxy` set
> here, **or** `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` present in the
> environment — the server refuses to start unless one of these says
> what you meant: `allowed_hosts` (targets that do not depend on DNS at
> all), `allow_private_networks = true` (the proxy is trusted to reach
> anything), or `no_proxy = true` (ignore the environment). The message
> names which source introduced the proxy, so an inherited variable in a
> CI image is diagnosable.

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
dotfiles = false
```

| Key             | Default            | Description                                                                                                                                                             |
| --------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dir`           | _unset (disabled)_ | Directory to serve. Probed at startup: a directory that exists but cannot be read is a startup error, not a deployment that answers `404` for reasons nothing explains. |
| `mount`         | `"/"`              | URL prefix.                                                                                                                                                             |
| `spa`           | `false`            | Serve `index.html` for unknown paths — React/Vue/Svelte routing.                                                                                                        |
| `cache_control` | _unset_            | `Cache-Control` header for served files.                                                                                                                                |
| `dotfiles`      | `false`            | Serve files and directories whose name starts with `.`. `.well-known/` is served regardless.                                                                            |

> [!NOTE] Dotfiles are hidden by default
>
> A request path with any `.`-prefixed component answers `404` before
> the filesystem is touched. `.env`, `.git/` and `.htpasswd` are exactly
> what ends up in a served directory by accident, and nothing a browser
> asks for begins with a dot — except `.well-known/`, which is exempt so
> ACME challenges and `security.txt` still work.

> [!DANGER] `dir` may not enclose your scripts or your templates
>
> `dir = "."` with `mount = "/"` answers `GET /app.lua` and
> `GET /nitr.toml`: the application served as static content. A `dir`
> that contains the handler script's directory or `[templating] dir`
> is a **startup error** naming both paths. Point it at a directory
> holding public assets only.

## `[templating]`

```toml
[templating]
dir = "templates"
```

| Key   | Default | Description                                                           |
| ----- | ------- | --------------------------------------------------------------------- |
| `dir` | _unset_ | Where [`nitr.template`](../templates) loads minijinja templates from. |

Without `dir` the builtin is unavailable — there is no default location
to guess, and silently rendering from the wrong directory is worse than
saying the builtin is not configured. Listing `"template"` in
`[std] features` without setting `dir` is a startup error.

## `[testing]`

```toml
[testing]
dir = "tests"
database = "test.db"
```

| Key        | Default                          | Description                                                                                                      |
| ---------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `dir`      | `"tests"`                        | Where `nitr test` discovers `*.lua` files.                                                                       |
| `database` | _unset (a private file per run)_ | The SQLite file tests run against when a `[database]` section exists. Never `[database] path`, whatever it says. |

> [!WARNING] `nitr test` never touches the configured database
>
> A test's `before_each` is typically `DELETE FROM ...`, and a
> `nitr.toml` naming the live database is exactly the file a developer
> runs `nitr test` beside. So the runner substitutes its own path: the
> one in `[testing] database`, or — when that is unset — a fresh private
> file it creates and removes when the run ends. Either way it applies
> `[database] migrations_dir` first, so tests see the schema rather than
> an empty file.

## `[env]`

A dotenv-style file loaded at startup, and what the opt-in `nitr.env`
builtin may read.

```toml
[env]
file = ".env"
allow = ["APP_", "API_TOKEN"]
```

| Key     | Default                                | Description                                                                                                                                                                                                          |
| ------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `file`  | `.env` next to `nitr.toml`, if present | The dotenv file to load, resolved relative to the config file. An **explicitly named** file must exist; the implicit `.env` may be absent. `NITR_ENV_FILE` overrides it and can only come from the real environment. |
| `allow` | _unset_                                | Exact names, or prefixes ending in `_`. Unset lets an enabled `env` builtin read any non-`NITR_*` variable.                                                                                                          |

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
max_connections = 64
```

| Key               | Default      | Description                                                                                                                                             |
| ----------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`         | `true`       | Serve the probes.                                                                                                                                       |
| `liveness`        | `"/healthz"` | "Is the process alive?" Never touches a Lua state — a probe that queued behind a saturated pool would cause the restart it exists to prevent.           |
| `readiness`       | `"/readyz"`  | "Should it receive traffic?" Flips to `503 draining` the moment a graceful drain starts, so a rolling deploy shifts traffic _before_ requests can fail. |
| `bind`            | _unset_      | Optional separate address, to keep the probes off the public port.                                                                                      |
| `max_connections` | `64`         | Connection cap for that separate listener. Ignored when the probes answer on the main listener, which has its own cap.                                  |

Both paths must start with `/`, and they must differ from each other:
they answer different questions, and one path cannot answer both.

> [!NOTE] Why `max_connections` is far below `[limits] max_connections`
>
> A prober opens one connection, not a thousand. Inheriting the main
> listener's cap would let the probe port consume the process's whole
> file-descriptor budget on its own — and "narrow" is not "bounded":
> without a cap, held-open probe connections were an unmetered
> descriptor hole.

> [!TIP] The probe port stays plaintext under `[tls]`
>
> A prober that must complete a TLS handshake fails exactly when
> liveness most needs to answer — during certificate trouble. TLS
> terminates on the main listener only, and the startup line says so.

## `[log]`

```toml
[log]
format = "text"
level = "info"
```

| Key      | Default                          | Description                                                                                         |
| -------- | -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `format` | `"text"`                         | `"json"` emits one object per line with request/error fields as real keys, ready for a log shipper. |
| `level`  | `"info"` (`"debug"` in dev mode) | A level name or any `tracing` filter directive. The `RUST_LOG` environment variable wins over it.   |

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
  fails at startup, as does `"template"` without `[templating] dir`. An
  unknown name fails too.
- **A feature must also be compiled in.** The released `nitr` binary has
  all of them; a build made with `--no-default-features` does not, and
  asking for one it lacks is a startup error naming the Cargo feature to
  enable. See [Cargo features](../../library/cargo-features).

Streaming uploads (`req:multipart`) and inbound TLS are Cargo features
without a `[std]` name — they are server capabilities, not `nitr.*`
modules.

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
> with `os` would come `os.execute`, `os.remove` and `os.getenv`, and
> adding `io` also restores `dofile` and `loadfile`, which read and
> execute any file the process can reach. Adding either to `stdlib` is
> possible and is a deliberate reduction of the sandbox. See
> [Security](../security).

> [!WARNING] `"debug"` is refused, not merely discouraged
>
> Listing it is a **startup error**. The Lua state is built with mlua's
> safe constructor, which cannot load the debug library at all — and it
> would defeat `exec_timeout_ms` anyway, since `debug.sethook` replaces
> the very instruction-count hook that stops CPU-bound loops.

> [!NOTE] What `"package"` gives you, and what it does not
>
> `require` resolves `a.b` to `<script dir>/a/b.lua` or
> `<script dir>/a/b/init.lua` through a searcher that owns the directory
> itself — it never consults `package.path`, so reassigning that string
> widens nothing, and module names must be dotted identifiers.
> `package.loadlib` and `package.searchpath` are removed, `package.cpath`
> is empty, and every chunk the runtime compiles is **text only**:
> precompiled Lua bytecode is refused wherever it could appear, `load`
> ignores a `"b"`/`"bt"` mode, and `string.dump` is gone. Lua 5.4 does
> not verify bytecode, and a hand-patched chunk is arbitrary memory
> access inside the process.

## The annotated original

The Nitr repository ships a fully commented
[`nitr.toml`](https://github.com/nitrweb/nitr/blob/master/nitr.toml)
carrying the same content as inline comments, if you prefer to read it
that way.

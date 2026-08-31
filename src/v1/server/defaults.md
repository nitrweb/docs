# Server Defaults

Every default value in one place. All of them are overridable — see
[Configuration](./configuration/).

Nitr's defaults are picked so that an unconfigured server is already a
defensible one: bound to loopback, sandboxed, bounded in memory and in
time, with every ambient capability — the filesystem, uploads, private
networks, TLS material — switched off until you ask for it. Nothing is
inferred from what happens to be lying around on disk.

## Zero configuration

With **no `nitr.toml` at all**, Nitr:

- listens on `127.0.0.1:3000`
- runs `scripts/handler.lua`
- has no config script, so `nitr.cfg` is `nil`
- exposes the minimal standard library: `json`, `http`, `log`, `time`,
  `validate`, `base64`, `path`, `url`
- has no database, no templates and no static mount
- has no upload directory, so `part:save()` is unavailable
- speaks plain HTTP: TLS is off, and cookies are not marked `Secure`
- serves `/healthz` and `/readyz` on the main listener
- logs at `info` in human-readable text

```sh
nitr run     # works in an empty directory with a scripts/handler.lua
```

A `nitr.toml` in the working directory is picked up automatically. Its
absence is not an error — Nitr simply falls back to the tables below.

> [!NOTE] Defaults are a starting point, not a deployment
>
> Three things the defaults cannot guess for you: where to listen,
> whether TLS is terminated here or in front of you (`[tls]`,
> `[cookies] secure`), and where uploads may land
> (`[multipart] upload_dir`).

## Top level

| Setting            | Default                | Notes                                     |
| ------------------ | ---------------------- | ----------------------------------------- |
| `listen`           | `127.0.0.1:3000`       | loopback; exposing the port is deliberate |
| `handler_script`   | `scripts/handler.lua`  | must exist at startup                     |
| `config_script`    | unset                  | without one, `nitr.cfg` is `nil`          |
| `dev_mode`         | `false`                | `--dev` and `nitr dev` also set it        |
| `workers`          | CPU cores              | `1` when the count cannot be detected     |
| `max_streams`      | `workers - 1`, min `1` | a stream holds a state for its lifetime   |
| `trust_request_id` | `false`                | only behind a proxy that sets the header  |
| `pidfile`          | unset                  | written at startup, removed at exit       |

`max_streams` may not exceed `workers`: every streaming response holds a
pooled Lua state for its whole lifetime, so the extra slots could never
be used, and a configuration asking for them refuses to start.

## Limits (`[limits]`)

| Setting            | Default | When exceeded                     |
| ------------------ | ------- | --------------------------------- |
| `max_body_bytes`   | 1 MiB   | `413`                             |
| `max_header_bytes` | 16 KiB  | `431`, then the connection closes |
| `max_uri_bytes`    | 8 KiB   | `414`                             |
| `max_connections`  | 1024    | the listener stops accepting      |
| `pool_wait_ms`     | 5000    | `503` + `Retry-After`             |
| `header_read_ms`   | 30000   | the connection is closed          |
| `body_read_ms`     | 30000   | `408` + `Connection: close`       |
| `max_form_parts`   | 64      | `req:multipart()` raises          |
| `max_field_bytes`  | 64 KiB  | `req:multipart()` raises          |
| `max_file_bytes`   | 10 MiB  | `req:multipart()` raises          |

`max_body_bytes` is counted **as the body arrives**, never read off
`Content-Length`: a chunked body declares nothing, and a dishonest one
declares the wrong number. An oversized upload is cut mid-flight rather
than buffered in full and then rejected.

`max_header_bytes` is hyper's read buffer, clamped up to hyper's 8 KiB
floor — a smaller value has no effect.

`body_read_ms` bounds **progress, not total transfer**: a body that keeps
arriving is fine at any size the byte limits allow; one that stalls fails
deterministically instead of holding a connection slot and a pooled Lua
state.

The last three rows bound `req:multipart()` only, and they surface as
ordinary Lua errors rather than a status code — Nitr cannot know whether
an over-cap part is a client mistake or your protocol. Catch them if you
want a `413`; see [Requests](./requests).

### What `0` means

It is not one thing:

| Key                       | `0` means                       |
| ------------------------- | ------------------------------- |
| `pool_wait_ms`            | wait forever for a Lua state    |
| `header_read_ms`          | no header deadline              |
| `body_read_ms`            | no stall bound                  |
| `[lua] exec_timeout_ms`   | no execution budget             |
| `[cache] default_ttl`     | entries never expire            |
| `[fetch] max_per_request` | no outbound-call cap            |
| `[tls] handshake_ms`      | **a startup error** — see below |

### Cross-key rules checked at startup

- `pool_wait_ms` above `[lua] exec_timeout_ms` **refuses to start**: a
  request would wait for a state longer than any handler is allowed to
  run, so the queue could only ever grow.
- `body_read_ms` above `[lua] exec_timeout_ms` **warns**: a stalled
  buffered read would surface as a handler timeout instead of a clean
  `408` that names the client.

Both comparisons need **both keys non-zero**. `0` means "no bound" on
either key rather than a smaller number, so `exec_timeout_ms = 0` (or a
`0` on the other side) switches the check off instead of failing it.

## Uploads (`[multipart]`)

| Setting      | Default                              |
| ------------ | ------------------------------------ |
| `upload_dir` | unset — `part:save()` is unavailable |

There is deliberately no default upload root — the same call
`[templating] dir` makes. There is no safe directory to guess, and an
upload written somewhere nobody chose is worse than a startup error.
Once it is set:

- paths given to `part:save()` are **relative to it**; absolute paths and
  anything climbing out with `..` are refused rather than re-rooted, so
  where a file lands always follows from the source;
- it must exist and be **writable** at startup — Nitr write-probes it,
  because existence is not writability and the alternative symptom is a
  `500` on a request nobody can reproduce;
- it must **not** sit inside the handler script's own directory:
  `require` is pinned there, so an uploaded `.lua` file would be a
  loadable module. That combination refuses to boot;
- inside `[static] dir` it only **warns** — serving uploads back is a
  real deployment shape, just one to choose on purpose.

Prefer `part.safe_filename` over the raw `part.filename` when building
the path: it is the client's name reduced to a plain file name, so it
cannot escape on its own.

## TLS (`[tls]`)

Needs the `tls` Cargo feature (included in `all`). A build without it
refuses `enabled = true` at startup, naming the flag to rebuild with.

| Setting        | Default                     | Notes                                     |
| -------------- | --------------------------- | ----------------------------------------- |
| `enabled`      | `false`                     | never inferred from a certificate on disk |
| `cert`         | unset                       | required when enabled; PEM, leaf first    |
| `key`          | unset                       | required when enabled; PKCS#8/PKCS#1/SEC1 |
| `min_version`  | `"1.2"`                     | `"1.2"` or `"1.3"`; nothing lower exists  |
| `handshake_ms` | `min(header_read_ms, 10 s)` | `0` is a startup error                    |

Both files are read **at startup**, so a half-configured or mismatched
pair refuses to boot instead of failing every handshake on a port traffic
already points at. rustls runs over the `ring` provider, and ALPN
advertises only `http/1.1` — exactly what this server speaks.

TLS 1.0 and 1.1 are deprecated by RFC 8996 and cannot be selected under
any spelling; an unknown `min_version` is a startup refusal, not a silent
fallback.

`handshake_ms = 0` is refused because the handshake happens _before_
hyper's header machinery exists: a stalled `ClientHello` would hold a
connection slot the header deadline can never reclaim, and 1024 of them
close the listener. Unset already means a bounded
`min(header_read_ms, 10 s)` — bounded even when `header_read_ms = 0`.
The handshake runs in the connection's own task, so a stalled one costs
one connection, not the accept loop.

> [!WARNING] `enabled = true` converts the listener, it does not add one
>
> The address in `listen` starts speaking HTTPS and nothing anywhere
> answers plaintext. Nothing redirects for you. See [TLS](./tls) for the
> redirect and HSTS recipes.

A renewed certificate takes effect on `SIGHUP` (or `nitr reload`): both
files are re-read and swapped in **only when the new pair validates**,
keeping the old material and warning otherwise. `nitr build` deliberately
does not re-anchor `cert`/`key` — a private key inside a copyable
one-file artifact is a private key that leaks with it.

## Cookies (`[cookies]`)

| Setting  | Default  | Values                          |
| -------- | -------- | ------------------------------- |
| `secure` | `"auto"` | `"auto"`, `"always"`, `"never"` |

| Value      | Meaning                                    |
| ---------- | ------------------------------------------ |
| `"auto"`   | `Secure` when `[tls] enabled = true`       |
| `"always"` | TLS is terminated in front of this process |
| `"never"`  | plain-HTTP development                     |

This reaches the cookies Nitr **builds** — the session and CSRF cookies,
and anything through `res.cookies:set` / `:set_signed`. A handler that
writes the `Set-Cookie` header itself bypasses it entirely; that cookie's
attributes are the script's own business. An explicit `secure` in the
caller's options always wins, in both directions.

> [!WARNING] Behind a terminating proxy, say `"always"`
>
> The most common deployment is a loopback bind behind a proxy that
> terminates TLS: `[tls] enabled = false` is correct for this process
> _and_ the cookies must still be `Secure`. Nothing here can detect that
> proxy, so a configuration resolving to "not secure" **warns at
> startup** (outside dev mode) rather than guessing.

`Secure` is deliberately not forced the way `HttpOnly` is: a `Secure`
cookie sent over plain `http` is dropped by the browser without a word,
a far worse failure than a startup line an operator can read.

The session and CSRF cookies additionally carry `path = "/"`,
`SameSite=Lax` and `HttpOnly` by default. A caller's attribute table
**extends** those rather than replacing them, and `http_only` cannot be
un-set. `same_site` stays overridable, because a legitimate cross-site
form needs `None`. See [Cookies and sessions](./cookies-sessions).

## Lua sandbox (`[lua]`)

| Setting            | Default                                                   |
| ------------------ | --------------------------------------------------------- |
| `stdlib`           | `math`, `table`, `string`, `utf8`, `coroutine`, `package` |
| `io` / `os`        | **excluded**                                              |
| `debug`            | **refused at startup**                                    |
| `memory_limit`     | 8 MiB per state                                           |
| `exec_timeout_ms`  | 30000                                                     |
| `require`          | confined to the handler script's directory                |
| native Lua modules | cannot be loaded                                          |

`io` and `os` are excluded rather than merely unset: they hand a script
ambient filesystem and process access. `nitr.time` covers dates and
clocks, so nothing here needs `os.date` — and with it would come
`os.execute`, `os.remove` and `os.getenv`. Adding `"io"` also restores
`dofile` and `loadfile`, which read and execute any file the process can
reach.

> [!DANGER] `"debug"` is not an opt-in
>
> Listing it is a configuration error naming the setting, not a silent
> downgrade. The Lua state is built with mlua's safe constructor, which
> cannot load the debug library at all — and `debug.sethook` would
> replace the instruction-count hook that stops CPU-bound loops, so the
> execution budget would quietly stop being a budget.

`exec_timeout_ms` is enforced twice: an instruction-count hook stops
`while true do end`, and an outer async timeout stops slow I/O.

## Standard library (`[std]`)

| Setting    | Default                                                            |
| ---------- | ------------------------------------------------------------------ |
| `features` | `json`, `http`, `log`, `time`, `validate`, `base64`, `path`, `url` |

Opt-in beyond that minimal set: `db`, `fetch`, `template`, `crypto`,
`cache`, `dbg`, `env`.

An explicit list is **strict** in two directions: an unknown name fails
at startup, and so does a listed feature missing its configuration
(`template` without `[templating] dir`, `db` without `[database]`). The
feature must also be compiled into the binary — the released `nitr`
includes all of them; a `--no-default-features` build does not, and
asking for one it lacks is a startup error naming the Cargo feature to
enable.

## Database (`[database]`)

Applied whenever a `[database]` section exists. `path` is the only
required key.

| Setting          | Default                              | Notes                                |
| ---------------- | ------------------------------------ | ------------------------------------ |
| `journal_mode`   | `wal`                                | or `delete`; `keep` keeps as-is      |
| `busy_timeout`   | 5000 ms                              | wait on a lock instead of failing    |
| `synchronous`    | `normal`                             | the right pairing with WAL           |
| `foreign_keys`   | `true`                               | SQLite leaves this off by default    |
| `cache_size`     | `-2000` (KiB per connection)         | negative values are KiB              |
| `migrations_dir` | unset — `migrations/` when it exists | ignored when the directory is absent |

WAL is the pragma that matters most: with one connection per pooled
state, SQLite's default rollback journal serializes every writer and
fails fast on contention.

> [!WARNING] WAL changes the on-disk file set
>
> The database becomes `app.db`, `app.db-wal` and `app.db-shm`, so
> copying `app.db` alone from a running server no longer captures a
> consistent snapshot. Use `VACUUM INTO`, or stop the server. See
> [Database](./database).

## Cache (`[cache]`)

| Setting       | Default                 |
| ------------- | ----------------------- |
| `max_entries` | 10000                   |
| `max_bytes`   | 32 MiB                  |
| `default_ttl` | 300 s (`0` = no expiry) |

The cache is per-process: a restart empties it, and two Nitr processes
have two independent caches. Sessions and exact counters do not belong
here.

## Outbound HTTP (`[fetch]`)

| Setting                   | Default                           |
| ------------------------- | --------------------------------- |
| `allowed_hosts`           | unset (any public host)           |
| `allow_private_networks`  | `false` (SSRF refused)            |
| `max_response_bytes`      | 8 MiB                             |
| `max_concurrent`          | 8                                 |
| `max_per_request`         | 32 (`0` removes the cap)          |
| `connect_timeout`         | 10 s                              |
| `timeout`                 | 30 s                              |
| `pool_max_idle_per_host`  | 8                                 |
| `max_retries`             | 5 (retries themselves are opt-in) |
| `proxy`                   | unset — reads `HTTPS_PROXY` etc.  |
| `no_proxy`                | `false`                           |
| `propagate_trace_context` | `false`                           |

Every redirect hop is re-checked against the same policy, and a hostname
is resolved once — inside the resolver the connector uses — so a DNS
server cannot answer one address to the check and another to the
connect. See [Outbound HTTP](./fetch).

## HTTP behaviour

| Setting                              | Default                              |
| ------------------------------------ | ------------------------------------ |
| `[compression] enabled`              | `false`                              |
| `[compression] algorithms`           | `br`, `gzip` (server order wins)     |
| `[compression] min_size`             | 1024 bytes                           |
| `[compression] types`                | `text/*`, JSON, JavaScript, XML, SVG |
| precompressed `.br` / `.gz` sidecars | always served when present           |
| `[cors]`                             | disabled until `origins` is set      |
| `[cors] credentials`                 | `false`                              |
| `[rate_limit] enabled`               | `false`                              |
| `[rate_limit] requests`              | 100 per window                       |
| `[rate_limit] window`                | 60 s                                 |
| `[rate_limit] trust_forwarded_for`   | `false`                              |
| `[static]`                           | disabled until `dir` is set          |
| `[static] mount`                     | `/`                                  |
| `[static] spa`                       | `false`                              |
| `[static] cache_control`             | unset                                |

Compression is off because it turns a CPU-cheap server into a
CPU-spending one, and that should be a decision rather than a surprise.
Already-compressed types (images, video, archives) are skipped even when
listed. Precompressed sidecars are served regardless of the section —
they cost nothing at runtime.

The compressed types in full are `text/*`, `application/json`,
`application/javascript`, `application/xml` and `image/svg+xml`. A
trailing `*` matches a prefix, so `text/*` covers every text subtype.

`[cors] credentials = true` cannot be combined with `origins = ["*"]`:
browsers reject that pair, so Nitr refuses to start rather than let you
ship a policy no browser will honour.

## Health and shutdown

| Setting                    | Default                   | Notes                              |
| -------------------------- | ------------------------- | ---------------------------------- |
| `[health] enabled`         | `true`                    | answered entirely in Rust          |
| `[health] liveness`        | `/healthz`                | never touches a Lua state          |
| `[health] readiness`       | `/readyz`                 | `503 draining` once a drain starts |
| `[health] bind`            | unset — the main listener | a separate port keeps probes off   |
| `[health] max_connections` | 64                        | only for a separate `bind`         |
| `[shutdown] grace`         | 30 s                      | ordinary in-flight requests        |
| `[shutdown] stream_grace`  | 5 s                       | extra, for streaming/SSE bodies    |

`[health] max_connections` sits deliberately far below
`[limits] max_connections`: a prober opens one connection, not a
thousand, and inheriting the main cap would let the probe port consume
the process's whole file-descriptor budget on its own. It is ignored
when the probes answer on the main listener, which has its own cap.

A separate probe listener stays **plaintext even under `[tls]`**: a
prober that must first complete a TLS handshake fails at exactly the
moment liveness still has to answer — during certificate trouble.

Liveness and readiness must start with `/` and must be different paths,
or the server refuses to start: they answer different questions. Only
`GET` and `HEAD` are recognised — a `POST /healthz` belongs to the
application. A drain that runs out of time exits non-zero, because a cut
request is not a clean shutdown.

## Logging (`[log]`)

| Setting    | Default                      |
| ---------- | ---------------------------- |
| `format`   | `text`                       |
| `level`    | `info` (`debug` in dev mode) |
| `RUST_LOG` | overrides `level`            |

Colour is used only when the format is `text`, stdout is a terminal, and
`NO_COLOR` is unset — so a pipe or a log shipper always receives
byte-clean plain text. See [Logging](./logging).

## Test runner and environment

| Setting         | Default                                  |
| --------------- | ---------------------------------------- |
| `[testing] dir` | `tests`                                  |
| `[env] file`    | `.env` next to `nitr.toml`, when present |
| `[env] allow`   | unset — any non-`NITR_*` variable        |

An env file's values never override the real process environment, and
`NITR_*` internals are hidden from scripts either way. An explicitly
named `file` must exist; the implicit `.env` is simply skipped when it
does not.

## Behaviour Nitr provides without being asked

Things that are simply on, with no key to enable them:

- `HEAD` reuses the matching `GET` route with the body stripped — after
  every header the `GET` would have had, compression included.
- A bare `OPTIONS` on a known path answers `204` with `Allow`.
- `405` (with `Allow`) when the path exists but the method does not.
- Static responses answer conditional requests (`ETag`,
  `Last-Modified`, `304`) and range requests (`206` / `416`, honouring
  `If-Range`).
- A request id per request (UUIDv7), echoed as `X-Request-ID`.
- Binary-safe request and response bodies.
- Multi-value response headers, `Set-Cookie` included.
- Query strings parsed and percent-decoded into `req.query`; for a
  repeated key the last value wins.
- Session and CSRF cookies carry `HttpOnly`, `SameSite=Lax` and
  `path = "/"`; a caller's table extends those rather than replacing
  them, and `http_only` cannot be un-set.
- Every uploaded part carries `part.safe_filename` beside the raw
  `part.filename` — the client's name reduced to a plain file name, so
  `part:save(part.safe_filename)` is safe on its own.
- Under `[tls]`, the handshake deadline is always present: there is no
  spelling that switches it off.
- Health answers carry `Cache-Control: no-store` — a cached "ok" defeats
  the probe.
- A pending migration refuses the boot rather than serving against a
  schema the code does not expect.
- An async builtin called where it cannot suspend — a script's top
  level, or a coroutine you resume yourself — fails with an error naming
  the builtin and the fix, instead of Lua's bare "attempt to yield from
  outside a coroutine".
- In dev mode the watcher reloads only on what a rebuild actually reads,
  Lua sources and the templates tree, so the database and its WAL
  sidecars cannot drive an endless reload loop.
- No Lua tracebacks in responses — unless `dev_mode` is on.
- Per-request panic containment: the state is recycled, the process
  lives.

# Server Defaults

Every default in one place. What each key does is explained in
[nitr.toml](./configuration/file); how to override it is in
[Configuration](./configuration/).

The defaults aim for a safe server out of the box: bound to loopback,
sandboxed, limited in memory and time, with the filesystem, uploads,
private networks and TLS off until you turn them on.

## With no `nitr.toml`

A `nitr.toml` in the working directory is loaded automatically. Without
one, Nitr:

- listens on `127.0.0.1:3000` and runs `scripts/handler.lua`;
- has no config script, so `nitr.cfg` is `nil`;
- enables only `json`, `http`, `log`, `time`, `validate`, `base64`,
  `path` and `url` from the standard library;
- has no database, templates, static files or upload directory;
- speaks plain HTTP, and cookies are not marked `Secure`;
- answers `/healthz` and `/readyz`;
- logs at `info` level as text.

Three things defaults cannot decide for you: the address to listen on,
where TLS ends (`[tls]` or a proxy, see `[cookies] secure`), and where
uploads go (`[multipart] upload_dir`).

## Top level

| Key                | Default                     |
| ------------------ | --------------------------- |
| `listen`           | `127.0.0.1:3000`            |
| `handler_script`   | `scripts/handler.lua`       |
| `config_script`    | unset                       |
| `dev_mode`         | `false`                     |
| `workers`          | CPU cores (`1` if unknown)  |
| `max_streams`      | `workers - 1`, at least `1` |
| `trust_request_id` | `false`                     |
| `pidfile`          | unset                       |

## `[limits]`

| Key                | Default | When exceeded             |
| ------------------ | ------- | ------------------------- |
| `max_body_bytes`   | 1 MiB   | `413`                     |
| `max_header_bytes` | 16 KiB  | `431`                     |
| `max_uri_bytes`    | 8 KiB   | `414`                     |
| `max_connections`  | 1024    | listener stops accepting  |
| `pool_wait_ms`     | 5000    | `503` + `Retry-After`     |
| `header_read_ms`   | 30000   | connection closed         |
| `body_read_ms`     | 30000   | `408` + connection closed |
| `max_form_parts`   | 64      | Lua error                 |
| `max_field_bytes`  | 64 KiB  | Lua error                 |
| `max_file_bytes`   | 10 MiB  | Lua error                 |

### What `0` means

| Key                       | `0` means                    |
| ------------------------- | ---------------------------- |
| `[limits] pool_wait_ms`   | wait forever for a Lua state |
| `[limits] header_read_ms` | no header deadline           |
| `[limits] body_read_ms`   | no stall limit               |
| `[lua] exec_timeout_ms`   | no time limit                |
| `[cache] default_ttl`     | entries never expire         |
| `[fetch] max_per_request` | no outbound-call limit       |
| `[tls] handshake_ms`      | **startup error**            |

## `[lua]` and `[std]`

| Key                     | Default                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| `[lua] stdlib`          | `math`, `table`, `string`, `utf8`, `coroutine`, `package`          |
| `[lua] memory_limit`    | 8 MiB per state                                                    |
| `[lua] exec_timeout_ms` | 30000                                                              |
| `[std] features`        | `json`, `http`, `log`, `time`, `validate`, `base64`, `path`, `url` |

`io` and `os` are off, `debug` is refused, and `require` only loads
files from the handler script's directory. Opt in to `db`, `fetch`,
`template`, `crypto`, `cache`, `dbg` and `env` through `[std] features`.

## `[database]`

Applied when a `[database]` section exists. `path` is required.

| Key              | Default                              |
| ---------------- | ------------------------------------ |
| `journal_mode`   | `wal`                                |
| `busy_timeout`   | 5000 ms                              |
| `synchronous`    | `normal`                             |
| `foreign_keys`   | `true`                               |
| `cache_size`     | `-2000` (2 MiB per connection)       |
| `max_rows`       | 10000                                |
| `migrations_dir` | `migrations/`, if that folder exists |

## `[cache]`

| Key           | Default |
| ------------- | ------- |
| `max_entries` | 10000   |
| `max_bytes`   | 32 MiB  |
| `default_ttl` | 300 s   |

## `[fetch]`

| Key                       | Default                                |
| ------------------------- | -------------------------------------- |
| `allowed_hosts`           | unset (any public host)                |
| `allow_private_networks`  | `false`                                |
| `private_hosts`           | empty (no host exempted by name)       |
| `max_response_bytes`      | 8 MiB                                  |
| `max_concurrent`          | 8                                      |
| `max_per_request`         | 32                                     |
| `connect_timeout`         | 10 s                                   |
| `timeout`                 | 30 s                                   |
| `pool_max_idle_per_host`  | 8                                      |
| `max_retries`             | 5                                      |
| `proxy`                   | unset (uses `HTTPS_PROXY` and friends) |
| `no_proxy`                | `false`                                |
| `propagate_trace_context` | `false`                                |

## HTTP features

| Key                                | Default                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| `[compression] enabled`            | `false`                                                                                    |
| `[compression] algorithms`         | `br`, `gzip`                                                                               |
| `[compression] min_size`           | 1024 bytes                                                                                 |
| `[compression] types`              | `text/*`, `application/json`, `application/javascript`, `application/xml`, `image/svg+xml` |
| `[cors]`                           | off until `origins` is set                                                                 |
| `[cors] credentials`               | `false`                                                                                    |
| `[headers]`                        | empty (no extra response headers)                                                          |
| `[rate_limit] enabled`             | `false`                                                                                    |
| `[rate_limit] requests`            | 100                                                                                        |
| `[rate_limit] window`              | 60 s                                                                                       |
| `[rate_limit] trust_forwarded_for` | `false`                                                                                    |
| `[static]`                         | off until `dir` is set                                                                     |
| `[static] mount`                   | `/`                                                                                        |
| `[static] spa`                     | `false`                                                                                    |
| `[static] cache_control`           | unset                                                                                      |
| `[static] dotfiles`                | `false` (`.well-known/` is always served)                                                  |
| `[templating] dir`                 | unset (`nitr.template` unavailable)                                                        |
| `[multipart] upload_dir`           | unset (`part:save` unavailable)                                                            |
| `[cookies] secure`                 | `"auto"` (`Secure` only when `[tls] enabled`)                                              |

## `[tls]`

| Key            | Default                     |
| -------------- | --------------------------- |
| `enabled`      | `false`                     |
| `cert`, `key`  | unset (required if enabled) |
| `min_version`  | `"1.2"`                     |
| `handshake_ms` | `min(header_read_ms, 10 s)` |

## Health and shutdown

| Key                          | Default                                     |
| ---------------------------- | ------------------------------------------- |
| `[health] enabled`           | `true`                                      |
| `[health] liveness`          | `/healthz`                                  |
| `[health] readiness`         | `/readyz`                                   |
| `[health] bind`              | unset (the main listener)                   |
| `[health] max_connections`   | 64                                          |
| `[shutdown] grace`           | 30 s                                        |
| `[shutdown] stream_grace`    | 5 s                                         |
| `[shutdown] readiness_delay` | 5 s (0 with `[health] bind` or in dev mode) |

## API docs

| Key                                     | Default         |
| --------------------------------------- | --------------- |
| `[openapi] enabled`                     | `false`         |
| `[openapi] path`                        | `/openapi.json` |
| `[openapi] servers`                     | unset           |
| `[openapi] include_undocumented`        | `true`          |
| `[openapi] output`                      | unset           |
| `[swagger] enabled`                     | `false`         |
| `[swagger] path`                        | `/docs`         |
| `[swagger] deep_linking`                | `true`          |
| `[swagger] doc_expansion`               | `list`          |
| `[swagger] try_it_out`                  | `false`         |
| `[swagger] persist_authorization`       | `false`         |
| `[swagger] default_models_expand_depth` | `1`             |

Other `[swagger]` booleans (`filter`, `display_request_duration`,
`display_operation_id`, `allow_external_spec`) default to `false`.
`nitr init` turns both `[openapi]` and `[swagger]` on in the scaffold.

## Logging, testing, environment

| Key                  | Default                              |
| -------------------- | ------------------------------------ |
| `[log] format`       | `text`                               |
| `[log] level`        | `info` (`debug` in dev mode)         |
| `[testing] dir`      | `tests`                              |
| `[testing] database` | unset (a private file per run)       |
| `[testing] seed`     | unset                                |
| `[testing] capture`  | `true`                               |
| `[testing] slow_ms`  | 1000                                 |
| `[env] file`         | `.env` next to `nitr.toml`, if found |
| `[env] allow`        | unset (any non-`NITR_*` variable)    |

## Always on

Behaviour with no setting to turn it on:

- `HEAD` reuses the matching `GET` route without the body; `OPTIONS` on
  a known path answers `204` with `Allow`; a known path with the wrong
  method answers `405` with `Allow`.
- Static files answer conditional (`304`) and range (`206`) requests,
  and precompressed `.br` / `.gz` files are served when present.
- Every request gets an id (UUIDv7), echoed as `X-Request-ID`.
- A route's [`input`](./validation/route-input) is validated before any
  Lua runs; a failure is a JSON `422`.
- Templates HTML-escape by default.
- Session and CSRF cookies are `HttpOnly` and `SameSite=Lax`.
- A pending migration stops the server from starting.
- Error responses never include Lua tracebacks unless `dev_mode` is on.
- A panic in one request does not stop the server; the Lua state is
  rebuilt.

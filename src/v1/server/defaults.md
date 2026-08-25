# Server Defaults

Every default value in one place. All of them are overridable — see
[Configuration](./configuration/).

## Zero configuration

With **no `nitr.toml` at all**, Nitr:

- listens on `127.0.0.1:3000`
- runs `scripts/handler.lua`
- has no config script, so `nitr.cfg` is `nil`
- exposes the minimal standard library: `json`, `http`, `log`, `time`,
  `validate`, `base64`, `path`, `url`
- has no database, no templates, no static mount
- serves `/healthz` and `/readyz`
- logs at `info` in human-readable text

```sh
nitr run     # works in an empty directory with a scripts/handler.lua
```

## Top level

| Setting            | Default                    |
| ------------------ | -------------------------- |
| `listen`           | `127.0.0.1:3000`           |
| `handler_script`   | `scripts/handler.lua`      |
| `config_script`    | unset                      |
| `dev_mode`         | `false`                    |
| `workers`          | number of CPU cores        |
| `max_streams`      | `workers - 1` (at least 1) |
| `trust_request_id` | `false`                    |
| `pidfile`          | unset                      |

## Limits

| Setting            | Default | Violation                   |
| ------------------ | ------- | --------------------------- |
| `max_body_bytes`   | 1 MiB   | `413`                       |
| `max_header_bytes` | 16 KiB  | connection rejected         |
| `max_uri_bytes`    | 8 KiB   | `414`                       |
| `max_connections`  | 1024    | listener stops accepting    |
| `pool_wait_ms`     | 5000    | `503` + `Retry-After`       |
| `header_read_ms`   | 30000   | connection closed           |
| `body_read_ms`     | 30000   | `408` + `Connection: close` |
| `max_form_parts`   | 64      | `413`                       |
| `max_field_bytes`  | 64 KiB  | `413`                       |
| `max_file_bytes`   | 10 MiB  | `413`                       |

## Lua sandbox

| Setting            | Default                                                   |
| ------------------ | --------------------------------------------------------- |
| `stdlib`           | `math`, `table`, `string`, `utf8`, `coroutine`, `package` |
| `io` / `os`        | **excluded**                                              |
| `memory_limit`     | 8 MiB per state                                           |
| `exec_timeout_ms`  | 30000                                                     |
| `require`          | confined to the handler script's directory                |
| native Lua modules | cannot be loaded                                          |

## Standard library

| Setting          | Default                                                            |
| ---------------- | ------------------------------------------------------------------ |
| `[std] features` | `json`, `http`, `log`, `time`, `validate`, `base64`, `path`, `url` |

Opt-in beyond that: `db`, `fetch`, `template`, `crypto`, `cache`,
`dbg`, `env`.

## Database

Applied whenever a `[database]` section exists:

| Setting          | Default                  |
| ---------------- | ------------------------ |
| `journal_mode`   | `wal`                    |
| `busy_timeout`   | 5000 ms                  |
| `synchronous`    | `normal`                 |
| `foreign_keys`   | `true`                   |
| `cache_size`     | −2000 KiB per connection |
| `migrations_dir` | `migrations`             |

## Cache

| Setting       | Default                 |
| ------------- | ----------------------- |
| `max_entries` | 10000                   |
| `max_bytes`   | 32 MiB                  |
| `default_ttl` | 300 s (`0` = no expiry) |

## Outbound HTTP (`nitr.fetch`)

| Setting                   | Default                           |
| ------------------------- | --------------------------------- |
| `allow_private_networks`  | `false` (SSRF refused)            |
| `allowed_hosts`           | unset (any public host)           |
| `max_response_bytes`      | 8 MiB                             |
| `max_concurrent`          | 8                                 |
| `max_per_request`         | 32                                |
| `connect_timeout`         | 10 s                              |
| `timeout`                 | 30 s                              |
| `pool_max_idle_per_host`  | 8                                 |
| `max_retries`             | 5 (retries themselves are opt-in) |
| `propagate_trace_context` | `false`                           |

## HTTP behaviour

| Setting                              | Default                          |
| ------------------------------------ | -------------------------------- |
| `[compression] enabled`              | `false`                          |
| `[compression] algorithms`           | `br`, `gzip` (server order wins) |
| `[compression] min_size`             | 1024 bytes                       |
| precompressed `.br` / `.gz` sidecars | always served when present       |
| `[cors]`                             | disabled until `origins` is set  |
| `[rate_limit]`                       | disabled                         |
| `[static]`                           | disabled until `dir` is set      |
| `[static] mount`                     | `/`                              |
| `[static] spa`                       | `false`                          |

## Health and shutdown

| Setting                   | Default           |
| ------------------------- | ----------------- |
| `[health] enabled`        | `true`            |
| `[health] liveness`       | `/healthz`        |
| `[health] readiness`      | `/readyz`         |
| `[health] bind`           | the main listener |
| `[shutdown] grace`        | 30 s              |
| `[shutdown] stream_grace` | 5 s               |

## Logging

| Setting    | Default                      |
| ---------- | ---------------------------- |
| `format`   | `text`                       |
| `level`    | `info` (`debug` in dev mode) |
| `RUST_LOG` | overrides `level`            |

## Behaviour Nitr provides without being asked

Things that are simply on, with no key to enable them:

- `HEAD` reuses the matching `GET` route with the body stripped.
- A bare `OPTIONS` on a known path answers `204` with `Allow`.
- `405` (with `Allow`) when the path exists but the method does not.
- Range requests: `206` / `416`, and `If-Range`.
- Conditional requests: `ETag`, `Last-Modified`, `304`.
- A request id per request (UUIDv7), echoed as `X-Request-ID`.
- Binary-safe request and response bodies.
- Multi-value response headers, `Set-Cookie` included.
- Percent-decoded query strings and path parameters.
- No Lua tracebacks in responses — unless `dev_mode` is on.
- Per-request panic containment: the state is recycled, the process
  lives.

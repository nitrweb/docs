# Deployment

A Nitr application is the `nitr` binary plus your files: `nitr.toml`,
Lua scripts, templates, static files and migrations. The database, the
`.env` file and TLS keys stay on the server. Pick how to ship it:

| Model                             | Deploy step                                | Guide                        |
| --------------------------------- | ------------------------------------------ | ---------------------------- |
| Binary plus application directory | `rsync` the files, then `systemctl reload` | [systemd](./systemd)         |
| One self-contained executable     | copy one file, then restart                | [Single-file](./single-file) |
| Container image                   | build and roll the image                   | [Docker](./docker)           |

## The deploy sequence

```sh
nitr check          # 1. configuration and scripts load
nitr test           # 2. the tests pass
nitr migrate        # 3. apply the schema once, from one place
systemctl reload myapp   # 4. or restart, or your orchestrator's rollout
```

> [!TIP] Migrate separately
>
> Run `nitr migrate` once per deploy, not from every starting instance,
> so two instances never race to change the schema. The server refuses
> to start while a migration is pending, so a missed step is loud. With
> exactly one instance, `nitr run --migrate` applies pending migrations
> and then serves, in one command.

## At a glance

| Concern                 | How                                                                              |
| ----------------------- | -------------------------------------------------------------------------------- |
| Is the process alive?   | `GET /healthz` returns `200 ok`                                                  |
| Should it get traffic?  | `GET /readyz` returns `200 ok`, or `503 draining` once shutdown starts           |
| Stop it                 | `SIGTERM`: stop accepting, drain for `[shutdown] grace` (+ `stream_grace`), exit |
| Reload scripts and TLS  | `SIGHUP`, or [`nitr reload`](../cli#reload)                                      |
| Terminate TLS           | `[tls] enabled = true`, or a proxy in front. See [TLS](#tls)                     |
| Machine-readable logs   | `[log] format = "json"`                                                          |
| Which config value won? | `nitr check --print-config`                                                      |

## Health probes

Both endpoints are answered by the server itself, before any Lua runs.
A handler cannot change them, and a busy Lua pool cannot delay them.

```toml
[health]
enabled = true          # the default
liveness = "/healthz"
readiness = "/readyz"
```

`/readyz` switches to `503 draining` as soon as a graceful shutdown
starts, while the server keeps serving for `[shutdown] readiness_delay`
(5 s), so the load balancer moves traffic away before the port closes.
That is what makes a rolling deploy seamless.

To keep the probes off the public port, give them their own listener:

```toml
[health]
bind = "127.0.0.1:9090"   # serves only the two probe paths
max_connections = 64      # this listener's own cap (default: 64)
```

> [!NOTE] The probe listener is always plaintext
>
> Even with `[tls]` on, so a certificate problem cannot fail liveness.
> If that is not acceptable, leave `bind` unset and the probes answer on
> the main listener over TLS.

## Graceful shutdown

```toml
[shutdown]
readiness_delay = 5   # keep serving while /readyz already answers 503
grace = 30            # seconds for in-flight requests
stream_grace = 5      # extra seconds, only if a stream is still open
```

On `SIGTERM` or `SIGINT`, Nitr switches `/readyz` to `503` and keeps
serving for `readiness_delay`. Then it stops accepting connections, lets
in-flight requests finish within `grace`, gives open streams
`stream_grace` more, and exits. `readiness_delay` defaults to `0` when
the probes have their own `[health] bind` listener, and in dev mode. If the time runs out and a
request is cut, it **exits non-zero**.

> [!WARNING] Your supervisor must wait longer than the drain
>
> Set systemd's `TimeoutStopSec`, `docker stop --time` or Kubernetes'
> `terminationGracePeriodSeconds` above
> `readiness_delay + grace + stream_grace` (40 s by default). Otherwise
> the process is killed mid-drain.

## Zero-downtime reload

`SIGHUP` rebuilds the Lua pool: the config script runs again and the
handler recompiles, while the process, its listener and open
connections stay up. With `[tls]` on, the certificate and key files are
re-read too.

```sh
nitr reload            # finds the process through `pidfile`
kill -HUP <pid>        # the same thing
systemctl reload myapp # with ExecReload=/bin/kill -HUP $MAINPID
```

In-flight requests finish on the old pool. If the new scripts or the
new certificate fail to load, the old ones stay in use and the error is
logged.

`nitr.toml` is **not** re-read. Settings from it need a restart:

| Reloaded by `SIGHUP`                                       | Needs a restart                                         |
| ---------------------------------------------------------- | ------------------------------------------------------- |
| Lua scripts and the config script                          | `listen`, `workers`                                     |
| Templates                                                  | `[limits]`, `[rate_limit]`, `[cors]`, `[compression]`   |
| The `[tls] cert` and `key` files                           | `[tls] enabled`, `min_version`, `handshake_ms`          |
| The [OpenAPI document](../openapi/), rebuilt with the pool | `[openapi]`, `[swagger]`, `[cache]`, `trust_request_id` |

Static files need no signal: they are read from disk on each request.

`nitr reload` needs a pidfile:

```toml
pidfile = "/run/nitr/nitr.pid"
```

It is written at startup and removed at exit. If it names a process
that is still running, a second instance refuses to start.

## TLS

Terminate TLS in Nitr or in a proxy in front of it. Pick one.

### Terminating in this process

```toml
listen = "0.0.0.0:443"

[tls]
enabled = true
cert = "/etc/nitr/tls/fullchain.pem"
key = "/etc/nitr/tls/privkey.pem"
```

This turns the listener into HTTPS only; nothing answers plain HTTP
and nothing redirects. Renewal is a reload. Setup, renewal hooks,
redirects and HSTS are in [TLS](../tls).

### Terminating at a proxy in front

The common setup: nginx, Caddy, HAProxy or a cloud load balancer
handles TLS, and Nitr listens on a private address with `[tls]` off.

```toml
listen = "127.0.0.1:3000"
trust_request_id = true          # accept the proxy's X-Request-ID

[cookies]
secure = "always"                # cookies stay Secure behind the proxy

[rate_limit]
trust_forwarded_for = true       # rate-limit by the client address the proxy reports
```

- `[cookies] secure = "always"` is required. The default `"auto"`
  follows `[tls] enabled`, which is off here, so cookies would lose
  `Secure`. The first cookie sent that way logs a warning.
- `trust_request_id` and `trust_forwarded_for` are safe **only** behind
  a proxy. Without one, any client could pick its own request id or
  rate-limit key. The limiter uses the **last** `X-Forwarded-For`
  entry, the one the proxy added, so it works whether the proxy
  replaces or appends to the header.
- HSTS belongs to the proxy.

## Backups

The SQLite database is the only state. With WAL it is three files
(`app.db`, `app.db-wal`, `app.db-shm`), so do not copy `app.db` alone
while the server runs. This is safe at any time:

```sh
sqlite3 data/app.db "VACUUM INTO 'backup-$(date +%F).db'"
```

See [Database](../database#why-wal-matters-here-specifically).

## Capacity

| Setting                    | Limits                                                   |
| -------------------------- | -------------------------------------------------------- |
| `workers`                  | Requests running Lua at once: your concurrency limit     |
| `max_streams`              | Open streaming/SSE responses (each holds a Lua state)    |
| `[limits] max_connections` | TCP connections on the main listener                     |
| `[limits] pool_wait_ms`    | How long a request waits for a free state before a `503` |

## Monitoring

There is no metrics endpoint yet. Use `[log] format = "json"`, ship the
logs, and alert on:

| Signal          | Log field                                                             |
| --------------- | --------------------------------------------------------------------- |
| Errors          | `span.status >= 500` on the `request` span                            |
| Latency         | `time.busy` on the `request` span                                     |
| Overload        | `status = 503`; at debug level, `outcome = "shed"` on `pool_checkout` |
| Rate limiting   | `status = 429`                                                        |
| Replaced states | `outcome = "rebuilt"`                                                 |

See [Logging](../logging).

# Deployment

The operational surface of a running Nitr process: how to tell whether
it is healthy, how to reload it, and how to stop it without cutting
requests.

## The whole surface, in one table

| Concern                 | Mechanism                                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Is the process alive?   | `GET /healthz` → `200 ok`, answered in Rust, never touches a Lua state                                                                 |
| Should it get traffic?  | `GET /readyz` → `200 ok`, flips to `503 draining` the moment a graceful shutdown starts                                                |
| Stop it                 | `SIGTERM` — stop accepting → flip readiness → drain for `[shutdown] grace` (+ `stream_grace`) → exit. A truncated drain exits non-zero |
| Reload it               | `SIGHUP`, or [`nitr reload`](../cli#reload) (finds the process via its `pidfile`)                                                      |
| Machine-readable logs   | `[log] format = "json"` — one object per line, request and error fields as real keys                                                   |
| Which config value won? | `nitr check --print-config`                                                                                                            |
| Single-file deploy      | [`nitr build --output myapp`](./single-file)                                                                                           |

## Health probes

Both endpoints are **owned by Rust**. A handler cannot influence them,
which is the point: an application cannot report itself healthy through
a broken handler.

```toml
[health]
enabled = true
liveness = "/healthz"
readiness = "/readyz"
```

| Endpoint   | Answers                   | Meaning                                                                       |
| ---------- | ------------------------- | ----------------------------------------------------------------------------- |
| `/healthz` | `200 ok`                  | The process is alive. Never touches a Lua state, so it stays fast under load. |
| `/readyz`  | `200 ok` / `503 draining` | Whether this instance should receive traffic.                                 |

**Readiness flipping before requests can fail is what makes a rolling
deploy hitless.** The endpoint reports `503 draining` while in-flight
work finishes, so the load balancer moves traffic _first_.

### Keeping probes off the public port

```toml
[health]
bind = "127.0.0.1:9090"   # probes only; the app never answers here
```

## Graceful shutdown

```toml
[shutdown]
grace = 30            # seconds for ordinary in-flight requests
stream_grace = 5      # extra, spent only if a stream is still live
```

On `SIGTERM` or `SIGINT`:

1. Stop accepting new connections.
2. Flip `/readyz` to `503 draining`.
3. Let in-flight requests finish, within `grace`.
4. Give live streams `stream_grace` extra seconds.
5. Exit.

> [!WARNING] Your supervisor must wait longer than the drain
>
> `TimeoutStopSec` (systemd) or `--time` (Docker) must exceed
> `grace + stream_grace` — 35 seconds by default. Set below that, the
> supervisor `SIGKILL`s the process mid-drain, cutting exactly the
> requests graceful shutdown exists to protect.

A drain that runs out of time **exits non-zero**, because a cut request
is not a clean shutdown. Configure `Restart=on-failure` accordingly.

## Zero-downtime reload

`SIGHUP` rebuilds the Lua runtime pool: the config script re-runs and
the handler recompiles, while live connections keep being served. It is
**not** a restart — the process, its listener and its keep-alive
connections all survive.

```sh
nitr reload            # via the configured pidfile
kill -HUP <pid>        # the same thing
systemctl reload myapp # ExecReload maps to it
```

```toml
pidfile = "/run/nitr/nitr.pid"
```

The pidfile is written only once the build succeeded and removed at exit
— including the error path — so a crashed server never leaves a stale
pid behind for `reload` to signal.

## Deployment models

### One binary plus files

Copy `nitr`, `nitr.toml` and the application directory onto the machine.
Run it under [systemd](./systemd). Deploys are an `rsync` plus
`systemctl reload`.

### One self-contained binary

[`nitr build --output myapp`](./single-file) appends the entire
application to the executable. A deploy is one file. The database stays
external, on purpose.

### A container

[Docker](./docker), with the database on a volume and Nitr as PID 1 so
it actually receives the `SIGTERM`.

## The deploy sequence that works

```sh
# 1. Validate the artifact before it goes anywhere near production.
nitr check

# 2. Apply the schema ONCE — not from every starting instance.
nitr migrate

# 3. Roll the instances. Readiness moves the traffic for you.
systemctl restart myapp        # or your orchestrator's rollout
```

> [!TIP] Migrate separately, always
>
> Applying schema changes at boot means a rolling deployment has two
> instances racing to change the same schema, each believing it is
> alone. That is why `nitr migrate` is its own command — and why the
> server refuses to start while a migration is pending, so a mistake
> here is loud.

## Behind a reverse proxy

Nitr does not terminate TLS. Put nginx, Caddy, HAProxy or a cloud load
balancer in front of it, and bind Nitr privately:

```toml
listen = "127.0.0.1:3000"
```

Two settings become safe to enable **only** behind a proxy that
sanitizes the relevant headers:

```toml
trust_request_id = true          # accept an inbound X-Request-ID

[rate_limit]
trust_forwarded_for = true       # key the limiter by X-Forwarded-For
```

Turned on without such a proxy, a client picks its own request id and
its own rate-limit key.

## Backups

The database is the only state, and WAL means it is three files:

```sh
sqlite3 data/app.db "VACUUM INTO 'backup-$(date +%F).db'"
```

`VACUUM INTO` is safe while the server is running. Copying `app.db`
alone is not — see
[Database → Why WAL matters](../database#why-wal-matters-here-specifically).

## Capacity

| Setting                    | What it bounds                                                           |
| -------------------------- | ------------------------------------------------------------------------ |
| `workers`                  | Concurrent dynamic requests — this **is** your concurrency limit         |
| `max_streams`              | Concurrent streaming/SSE responses (each holds a state for its lifetime) |
| `[limits] max_connections` | Concurrent TCP connections                                               |
| `[limits] pool_wait_ms`    | How long a request queues before being shed with `503`                   |

At debug level, `pool_checkout`'s `wait_ms` and
`outcome` (`hit` / `shed`) tell you whether the pool is the bottleneck
before your users do.

## Monitoring

There is no metrics endpoint yet ([known
limitation](../security#known-weaknesses)). Ship the JSON logs and alert
on:

| Signal          | Where                                                    |
| --------------- | -------------------------------------------------------- |
| Error rate      | `status >= 500` on the `request` span                    |
| Latency         | `time.busy` on the `request` span                        |
| Overload        | `outcome = "shed"` on `pool_checkout`, or `status = 503` |
| Rate limiting   | `status = 429`                                           |
| Recycled states | `outcome = "rebuilt"` from the pool                      |

See [Logging](../logging).

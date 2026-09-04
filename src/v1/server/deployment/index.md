# Deployment

The operational surface of a running Nitr process: how to tell whether
it is healthy, how to reload it, whether it terminates TLS itself, and
how to stop it without cutting requests.

## The whole surface, in one table

| Concern                 | Mechanism                                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Is the process alive?   | `GET /healthz` → `200 ok`, answered in Rust, never touches a Lua state                                                                 |
| Should it get traffic?  | `GET /readyz` → `200 ok`, flips to `503 draining` the moment a graceful shutdown starts                                                |
| Stop it                 | `SIGTERM` — stop accepting → flip readiness → drain for `[shutdown] grace` (+ `stream_grace`) → exit. A truncated drain exits non-zero |
| Reload it               | `SIGHUP`, or [`nitr reload`](../cli#reload) — rebuilds the Lua pool and re-reads the TLS material                                      |
| Terminate TLS           | `[tls] enabled = true` converts the listener in place; renewal is a reload. See [TLS](../tls)                                          |
| Machine-readable logs   | `[log] format = "json"` — one object per line, request and error fields as real keys                                                   |
| Which config value won? | `nitr check --print-config`                                                                                                            |
| Single-file deploy      | [`nitr build --output myapp`](./single-file)                                                                                           |

## Health probes

Both endpoints are **owned by Rust**. A handler cannot influence them,
which is the point: an application cannot report itself healthy through
a broken handler. Liveness never touches a Lua state either — a probe
that queued behind a saturated pool would trigger exactly the restart
it exists to prevent.

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
max_connections = 64      # this listener's own cap. Default: 64
```

`bind` moves the two probe paths onto a listener of their own, which
serves nothing else — every other path is a `404`. It carries the same
guards as the main accept loop (the `[limits] header_read_ms` deadline
and the same header buffer: "how long may a client take to say what it
wants?" has one answer per process) but **its own connection cap**,
deliberately far below `[limits] max_connections`. A prober opens one
connection, not a thousand, and inheriting the main cap would let the
probe port consume the whole process's descriptor budget on its own.

`max_connections` is ignored when the probes answer on the main
listener, which already has its own cap.

> [!NOTE] The probe listener stays plaintext, even under TLS
>
> With `[tls]` enabled, the main listener speaks HTTPS and the probe
> listener does not — and the startup line says so rather than implying
> it. A prober that must complete a TLS handshake is a prober that
> fails during exactly the certificate trouble liveness has to survive.
> If a cleartext probe port is unacceptable, leave `bind` unset so the
> probes answer on the main listener over TLS like everything else.

## Graceful shutdown

```toml
[shutdown]
grace = 30            # seconds for ordinary in-flight requests
stream_grace = 5      # extra, spent only if a stream is still live
```

On `SIGTERM` or `SIGINT`:

1. Stop accepting new connections.
2. Flip `/readyz` to `503 draining`. Responses issued from here on also
   carry `Connection: close`.
3. Let in-flight requests finish, within `grace`.
4. Give live streams `stream_grace` extra seconds.
5. Exit.

The probe listener stays up **through** the drain — readiness has to be
observable as `draining` while it happens — and only then drains
itself, with a tight one-second budget, because a probe answer is one
fixed-body round trip.

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
the handler recompiles, while live connections keep being served. With
`[tls]` enabled, the certificate and key files are re-read in the same
signal. It is **not** a restart — the process, its listener and its
keep-alive connections all survive.

```sh
nitr reload            # via the configured pidfile
kill -HUP <pid>        # the same thing
systemctl reload myapp # ExecReload maps to it
```

In-flight requests finish on the old pool, which is dropped when its
last guard returns. The two halves are **independent**: a failed
certificate re-read still rebuilds the pool, and a failed pool rebuild
still swaps in a good certificate. On either failure the old material
stays and the failure is logged.

The rebuild runs on its own task, so the listener keeps accepting and
`SIGTERM` keeps being answered while it happens — and a second `SIGHUP`
arriving mid-rebuild queues one more pass rather than being dropped,
since the rebuild in flight read the scripts before that signal.

### What a reload does not re-read

`nitr.toml` itself is never re-read, so everything compiled from it at
startup keeps its boot-time value. The boundary is worth writing down
rather than discovering:

| Reloaded by `SIGHUP`                                            | Needs a restart                                       |
| --------------------------------------------------------------- | ----------------------------------------------------- |
| The Lua pool: the config script re-runs, the handler recompiles | `listen` and `workers`                                |
| `[tls] cert` and `[tls] key` — the two _files_                  | `[tls] enabled`, `min_version`, `handshake_ms`        |
| Templates, since a rebuild reads them                           | `[limits]`, `[rate_limit]`, `trust_request_id`        |
| Nothing else                                                    | `[cors]`, `[compression]`, `[cache]` and its capacity |

Static files are in neither column: they are read from disk per
request, so changing one needs no signal at all.

```toml
pidfile = "/run/nitr/nitr.pid"
```

The pidfile is written only once the build succeeded and removed at
exit — including the error path — so a crashed server never leaves a
stale pid behind for `reload` to signal.

It is also created **exclusively**, never written through an existing
path. A file already there naming a live process refuses the boot as a
second instance; one left by a crash or an OOM kill names nothing alive
and is replaced. `nitr reload` checks the other direction, refusing to
signal a pid that cannot be, or does not look like, a nitr server —
because a reused pid means `SIGHUP` would land on a stranger's process.

## TLS

Nitr can terminate TLS itself, or sit behind something that does. These
are two different deployments, not two levels of the same one, and the
settings that follow differ accordingly. The full section reference is
in [TLS](../tls).

### Terminating in this process

```toml
listen = "0.0.0.0:443"

[tls]
enabled = true
cert = "/etc/nitr/tls/fullchain.pem"   # PEM: leaf first, then intermediates
key = "/etc/nitr/tls/privkey.pem"      # PEM: PKCS#8, PKCS#1 or SEC1
```

Both files are read **at startup**, so a mismatched or half-configured
pair refuses to boot rather than failing every handshake on a port
traffic has already been pointed at.

> [!WARNING] `enabled = true` converts the listener, it does not add one
>
> The address in `listen` speaks HTTPS and **nothing** answers
> plaintext. There is no dual-listener mode and nothing redirects for
> you, so a deployment moving from `:80` to `:443` silently breaks every
> client, bookmark and health check that still says `http://`. If those
> must keep working, run a second tiny instance whose whole application
> is a redirect — the recipe is in [TLS](../tls#redirecting-plaintext-to-https).

### Terminating at a proxy in front

The more common arrangement: nginx, Caddy, HAProxy or a cloud load
balancer terminates TLS and Nitr binds privately. `[tls]` stays off,
and three other settings take its place:

```toml
listen = "127.0.0.1:3000"
trust_request_id = true          # accept an inbound X-Request-ID

[cookies]
secure = "always"                # TLS is terminated in front of us

[rate_limit]
trust_forwarded_for = true       # key the limiter by X-Forwarded-For
```

`trust_request_id` and `trust_forwarded_for` are safe **only** behind a
proxy that sets or sanitizes those headers — and `trust_forwarded_for`
only if the proxy _overwrites_ `X-Forwarded-For` rather than appending
to whatever the client sent. Without one, a client picks its own
request id and its own rate-limit key.

`[cookies] secure` matters just as much. Its `"auto"` default follows
`[tls] enabled`, which is precisely wrong here: this process is
correctly plaintext _and_ its cookies must still be `Secure`. Nothing
can detect the proxy, so a configuration that resolves to "not secure"
**warns at startup** instead of guessing. HSTS, in this arrangement,
belongs to the proxy.

### Renewing a certificate

A renewal is a reload, not a restart:

```sh
systemctl reload myapp     # or: nitr reload, or: kill -HUP <pid>
```

The reload re-reads `[tls] cert` and `[tls] key` from their configured
paths and swaps the acceptor in **only when the new pair validates**; a
half-written file keeps the old material and logs a warning. A server
that stopped terminating TLS because certbot was mid-write would be
strictly worse than one serving a certificate valid for another few
days.

Connections already established keep the certificate they handshook
with; new ones get the new material. Replace both files first, then
signal — a renewal on disk changes nothing in a running process. An
ACME deploy hook is in [TLS](../tls#an-acme-deploy-hook).

## Deployment models

### One binary plus files

Copy `nitr`, `nitr.toml` and the application directory onto the
machine. Run it under [systemd](./systemd). Deploys are an `rsync` plus
`systemctl reload`.

### One self-contained binary

[`nitr build --output myapp`](./single-file) appends the entire
application to the executable. A deploy is one file. The database, the
env file and the TLS key stay external, on purpose.

### A container

[Docker](./docker), with the database on a volume, certificates mounted
read-only, and Nitr as PID 1 so it actually receives the `SIGTERM`.

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
| `[limits] max_connections` | Concurrent TCP connections on the main listener                          |
| `[limits] pool_wait_ms`    | How long a request queues before being shed with `503`                   |
| `[health] max_connections` | Concurrent connections on the separate probe listener. Default: 64       |

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

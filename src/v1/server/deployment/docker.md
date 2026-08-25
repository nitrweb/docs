# Docker

There is no published Nitr image yet. The reference `Dockerfile` below
builds one, and the two settings that actually matter are the signal
handling and the stop timeout.

## The Dockerfile

```dockerfile
# Two stages: the first builds the `nitr` binary once (cache-friendly),
# the second is the runtime image with just the binary and the app files.

FROM rust:1-slim AS build
WORKDIR /src
# No crates.io release yet — build from the repository:
RUN cargo install --git https://github.com/joseluisq/nitr nitr-cli

FROM debian:stable-slim
# curl exists solely for the HEALTHCHECK below; drop both if your
# orchestrator probes over TCP itself (Kubernetes httpGet needs no curl).
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# Run as a dedicated non-root user: Nitr embeds a scripting language, and
# nothing it does needs root.
RUN useradd --system --create-home --home-dir /app nitr
WORKDIR /app
COPY --from=build /usr/local/cargo/bin/nitr /usr/local/bin/nitr
# The application: configuration, scripts, static files, migrations.
COPY --chown=nitr:nitr . /app
USER nitr

# The SQLite database must live on a volume — it is mutable state, and an
# image layer is not where state belongs.
VOLUME /app/data

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/nitr"]
CMD ["run"]

HEALTHCHECK --interval=10s --timeout=2s --start-period=5s \
  CMD ["curl", "-fsS", "http://127.0.0.1:3000/healthz"]
```

```sh
docker build -f deploy/docker/Dockerfile -t myapp .
docker run -p 3000:3000 -v myapp-data:/app/data myapp
```

The original lives at
[`deploy/docker/Dockerfile`](https://github.com/joseluisq/nitr/blob/master/deploy/docker/Dockerfile).

## The three things that matter

### 1. Nitr must receive the `SIGTERM`

`docker stop` signals **PID 1 and nothing else**.

```dockerfile
ENTRYPOINT ["/usr/local/bin/nitr"]     # ✅ exec form: nitr IS pid 1
```

```dockerfile
ENTRYPOINT /usr/local/bin/nitr run     # ❌ shell form: sh is pid 1
```

The shell form puts `sh` in front, which swallows the signal. The
container then dies by `SIGKILL` ten seconds later, having drained
nothing.

### 2. Give `docker stop` more time than the drain

```sh
docker stop --time 40 myapp        # > [shutdown] grace (30) + stream_grace (5)
```

```yaml
# docker-compose.yml
services:
  app:
    stop_grace_period: 40s
```

```yaml
# Kubernetes
spec:
  terminationGracePeriodSeconds: 40
```

Below that, the orchestrator kills the process mid-drain — cutting the
requests graceful shutdown exists to protect.

### 3. The database is a volume

An image is immutable; SQLite is not.

```toml
[database]
path = "/app/data/app.db"
```

```sh
docker run -v myapp-data:/app/data myapp
```

With WAL, that directory holds `app.db`, `app.db-wal` and `app.db-shm` —
all three belong on the volume.

## Configuration

Override settings without rebuilding the image:

```sh
docker run \
  -e NITR_LISTEN=0.0.0.0:3000 \
  -e NITR_WORKERS=4 \
  -e NITR_LOG_FORMAT=json \
  -p 3000:3000 -v myapp-data:/app/data \
  myapp
```

> [!WARNING] Bind to `0.0.0.0` inside a container
>
> The default `127.0.0.1` is only reachable from inside the container,
> so a published port appears to do nothing. `NITR_LISTEN=0.0.0.0:3000`
> — and let the container network, not the bind address, be your
> isolation boundary.

Secrets go in via the environment or a mounted `.env`, never into a
layer:

```sh
docker run --env-file .env.production myapp
```

## Migrations

Run them as a one-off before rolling the new version — not from every
starting replica:

```sh
docker run --rm -v myapp-data:/app/data myapp migrate
```

```yaml
# Kubernetes: an init container or a Job
initContainers:
  - name: migrate
    image: myapp:1.2.3
    args: ['migrate']
    volumeMounts: [{ name: data, mountPath: /app/data }]
```

## Health probes

Both endpoints are Rust-owned and map straight onto orchestrator probes:

```yaml
livenessProbe:
  httpGet: { path: /healthz, port: 3000 }
readinessProbe:
  httpGet: { path: /readyz, port: 3000 }
  periodSeconds: 2
```

Readiness flipping to `503 draining` _before_ requests can fail is what
makes a rolling deploy hitless: the balancer moves traffic while
in-flight work finishes.

> [!TIP] Drop `curl` if your orchestrator probes over HTTP itself
>
> The `HEALTHCHECK` in the Dockerfile is the only reason `curl` is
> installed. Kubernetes' `httpGet` needs nothing inside the container —
> removing both shrinks the image and its attack surface.

## docker-compose

```yaml
services:
  app:
    build: .
    ports: ['3000:3000']
    volumes: ['myapp-data:/app/data']
    environment:
      NITR_LISTEN: 0.0.0.0:3000
      NITR_LOG_FORMAT: json
    stop_grace_period: 40s
    restart: unless-stopped
    healthcheck:
      test: ['CMD', 'curl', '-fsS', 'http://127.0.0.1:3000/healthz']
      interval: 10s
      timeout: 2s
      start_period: 5s

volumes:
  myapp-data:
```

## Kubernetes

SQLite in Kubernetes means **one replica** with a `ReadWriteOnce`
volume, or a `StatefulSet`. It does not mean a horizontally scaled
`Deployment` sharing one file.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: myapp }
spec:
  replicas: 1 # SQLite: one writer
  strategy: { type: Recreate } # not RollingUpdate, on one volume
  template:
    spec:
      terminationGracePeriodSeconds: 40
      securityContext:
        runAsNonRoot: true
      containers:
        - name: app
          image: myapp:1.2.3
          ports: [{ containerPort: 3000 }]
          env:
            - { name: NITR_LISTEN, value: '0.0.0.0:3000' }
            - { name: NITR_LOG_FORMAT, value: 'json' }
          livenessProbe: { httpGet: { path: /healthz, port: 3000 } }
          readinessProbe:
            { httpGet: { path: /readyz, port: 3000 }, periodSeconds: 2 }
          volumeMounts: [{ name: data, mountPath: /app/data }]
```

If you need many replicas, the state has to move out of SQLite — which
is what the [extension boundary](../../library/extension-modules) is for.

## A smaller image

**Use the [single-file build](./single-file):** `nitr build` produces one
executable, so the runtime stage copies exactly one file.

```dockerfile
FROM debian:stable-slim
COPY myapp /usr/local/bin/myapp
USER 65534:65534
WORKDIR /app
VOLUME /app/data
ENTRYPOINT ["/usr/local/bin/myapp"]
CMD ["run"]
```

**Or build a smaller binary** with only the [Cargo
features](../../library/cargo-features) you use — dropping `fetch`
removes reqwest, dropping `crypto` removes argon2.

## Hardening

```sh
docker run \
  --read-only \
  --tmpfs /tmp \
  -v myapp-data:/app/data \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  -p 3000:3000 \
  myapp
```

A read-only root filesystem works because the database directory is the
only thing Nitr legitimately writes — the same assumption the [systemd
unit](./systemd#the-hardening-block) makes.

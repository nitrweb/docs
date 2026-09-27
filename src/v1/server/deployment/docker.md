# Docker

There is no published Nitr image yet. This `Dockerfile` builds one from
your application directory, using the `nitr-cli` crate from crates.io.

## The Dockerfile

```dockerfile
FROM rust:1-slim AS build
# Pin the version: while every release is a pre-release,
# `cargo install` fails without --version.
RUN cargo install nitr-cli --version 0.0.0-beta.6

FROM debian:stable-slim
# curl is only for the HEALTHCHECK below.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN useradd --system --create-home --home-dir /app nitr
WORKDIR /app
COPY --from=build /usr/local/cargo/bin/nitr /usr/local/bin/nitr
COPY --chown=nitr:nitr . /app
USER nitr

# Listen on all interfaces, or the published port is unreachable.
ENV NITR_LISTEN=0.0.0.0:3000
# The SQLite database lives on a volume.
VOLUME /app/data
EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/nitr"]
CMD ["run"]

HEALTHCHECK --interval=10s --timeout=2s --start-period=5s \
  CMD ["curl", "-fsS", "http://127.0.0.1:3000/healthz"]
```

```sh
docker build -t myapp .
docker run -p 3000:3000 -v myapp-data:/app/data myapp
```

This is the repository's reference
[`deploy/docker/Dockerfile`](https://github.com/nitrweb/nitr/blob/master/deploy/docker/Dockerfile)
with two changes: the version pin, and `NITR_LISTEN`. The default
`127.0.0.1` is only reachable from inside the container.

With the `nitr init` layout, `[database] path = "data/app.db"` already
points into the volume. Add `data/` to `.dockerignore` so a local
database is not copied into the image.

## Three things that matter

### 1. Nitr must receive `SIGTERM`

`docker stop` signals only PID 1. Use the exec form of `ENTRYPOINT`, as
above, so `nitr` is PID 1:

```dockerfile
ENTRYPOINT ["/usr/local/bin/nitr"]     # exec form: nitr is PID 1
ENTRYPOINT /usr/local/bin/nitr run     # shell form: sh is PID 1 and swallows the signal
```

With the shell form, the container is killed after the timeout without
draining. The same applies to `docker kill -s HUP` for reloads.

### 2. Wait longer than the drain

The stop timeout must exceed
`[shutdown] readiness_delay + grace + stream_grace` (40 s by default):

```sh
docker stop --time 45 myapp
```

In Compose use `stop_grace_period: 45s`; in Kubernetes,
`terminationGracePeriodSeconds: 45`.

### 3. The database is a volume

```sh
docker run -v myapp-data:/app/data myapp
```

With WAL, the directory holds `app.db`, `app.db-wal` and `app.db-shm`.
All three belong on the volume.

## Configuration and secrets

Override settings with [environment variables](../configuration/env)
instead of rebuilding:

```sh
docker run \
  -e NITR_WORKERS=4 \
  -e NITR_LOG_FORMAT=json \
  --env-file .env.production \
  -p 3000:3000 -v myapp-data:/app/data \
  myapp
```

Pass secrets through the environment or a mounted `.env` file, never
through an image layer.

## Migrations

Run them once before rolling out a new version, not from every
replica:

```sh
docker run --rm -v myapp-data:/app/data myapp migrate
```

In Kubernetes, use an init container or a Job with `args: ['migrate']`.

## TLS

Most container setups terminate TLS at an ingress or load balancer and
leave `[tls]` off. Then set `[cookies] secure = "always"`; see
[Terminating at a proxy](./#terminating-at-a-proxy-in-front).

To terminate TLS in the container, mount the certificate and key
read-only:

```sh
docker run \
  -p 443:443 \
  -e NITR_LISTEN=0.0.0.0:443 \
  -e NITR_TLS_ENABLED=true \
  -e NITR_TLS_CERT=/run/secrets/tls/fullchain.pem \
  -e NITR_TLS_KEY=/run/secrets/tls/privkey.pem \
  -v /etc/nitr/tls:/run/secrets/tls:ro \
  -v myapp-data:/app/data \
  myapp
```

> [!DANGER] Never `COPY` a private key into the image
>
> Image layers are cached, pushed and pulled. Deleting the key in a
> later layer does not remove it from the history.

With `[tls]` on, the main port speaks only HTTPS and the
`HEALTHCHECK` above fails. Move the probes to their own plaintext
listener in `nitr.toml` (there is no environment variable for it):

```toml
[health]
bind = "127.0.0.1:9090"
```

```dockerfile
HEALTHCHECK --interval=10s --timeout=2s --start-period=5s \
  CMD ["curl", "-fsS", "http://127.0.0.1:9090/healthz"]
```

A renewed certificate takes effect on `SIGHUP`:

```sh
docker kill -s HUP myapp
kubectl exec deploy/myapp -- sh -c 'kill -HUP 1'   # the image has no kill binary
```

Restarting the container also works, with a short interruption.

## docker-compose

```yaml
services:
  app:
    build: .
    ports: ['3000:3000']
    volumes: ['myapp-data:/app/data']
    environment:
      NITR_LOG_FORMAT: json
    stop_grace_period: 45s
    restart: unless-stopped

volumes:
  myapp-data:
```

The image's `HEALTHCHECK` applies unless you override it.

## Kubernetes

SQLite allows one writer, so run **one replica** with a
`ReadWriteOnce` volume and the `Recreate` strategy. Scaling out needs
the state to move out of SQLite, for example through an
[extension module](../../library/extension-modules).

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: myapp }
spec:
  replicas: 1
  strategy: { type: Recreate }
  template:
    spec:
      terminationGracePeriodSeconds: 45
      securityContext: { runAsNonRoot: true }
      containers:
        - name: app
          image: myapp:1.2.3
          ports: [{ containerPort: 3000 }]
          env:
            - { name: NITR_LOG_FORMAT, value: 'json' }
          livenessProbe: { httpGet: { path: /healthz, port: 3000 } }
          readinessProbe:
            { httpGet: { path: /readyz, port: 3000 }, periodSeconds: 2 }
          volumeMounts: [{ name: data, mountPath: /app/data }]
```

Kubernetes' `httpGet` probes need nothing in the image, so you can drop
`curl` and the `HEALTHCHECK`.

## Hardening

```sh
docker run \
  --read-only --tmpfs /tmp \
  --cap-drop ALL --security-opt no-new-privileges \
  -v myapp-data:/app/data -p 3000:3000 \
  myapp
```

A read-only root filesystem works because the database directory is
the only thing Nitr writes, as in the
[systemd unit](./systemd#adjusting-the-hardening). To bind `:443` with
`--cap-drop ALL`, add `--cap-add NET_BIND_SERVICE`, or map host port
`443` to an unprivileged port in the container.

## A smaller image

Build a [single-file artifact](./single-file) and copy just that file:

```dockerfile
FROM debian:stable-slim
# ca-certificates lets nitr.fetch verify HTTPS servers.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY dist/myapp /usr/local/bin/myapp
RUN mkdir -p /app/data /app/cache && chown -R 65534:65534 /app
USER 65534:65534
WORKDIR /app
ENV NITR_LISTEN=0.0.0.0:3000 XDG_CACHE_HOME=/app/cache
VOLUME /app/data
ENTRYPOINT ["/usr/local/bin/myapp"]
CMD ["run"]
```

`XDG_CACHE_HOME` gives the artifact a place to extract itself. With
`--read-only`, mount a tmpfs at `/app/cache`, or the artifact extracts
to `/tmp` on every start. You can also build `nitr-cli` with only the
[Cargo features](../../library/cargo-features) you use.

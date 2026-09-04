# systemd

A reference unit, and the two lines people get wrong.

## Install

```sh
# 1. A dedicated unprivileged user.
useradd --system --home /srv/myapp --shell /usr/sbin/nologin nitr

# 2. The application: nitr.toml, app.lua, public/, migrations/, data/
install -d -o nitr -g nitr /srv/myapp/data
rsync -a ./ /srv/myapp/
chown -R nitr:nitr /srv/myapp

# 3. The unit.
cp nitr.service /etc/systemd/system/myapp.service
systemctl daemon-reload
systemctl enable --now myapp
```

## The unit

```ini
[Unit]
Description=Nitr application server
After=network-online.target
Wants=network-online.target

[Service]
Type=exec
User=nitr
Group=nitr
WorkingDirectory=/srv/myapp
ExecStart=/usr/local/bin/nitr run
# SIGHUP is Nitr's zero-downtime reload: the Lua runtime pool is rebuilt
# (config script re-runs, handler recompiles) while live connections keep
# being served. `systemctl reload myapp` maps to it.
ExecReload=/bin/kill -HUP $MAINPID

# SIGTERM starts Nitr's graceful drain: stop accepting, flip readiness,
# let in-flight requests finish. TimeoutStopSec MUST exceed the configured
# [shutdown] grace + stream_grace (default 30 + 5), or systemd SIGKILLs
# the process mid-drain and cuts the very requests the drain protects.
KillSignal=SIGTERM
TimeoutStopSec=40

# A truncated drain exits non-zero (a request was cut); restart on that
# and on crashes, but not on a clean `systemctl stop`.
Restart=on-failure
RestartSec=2

# Hardening. Nitr embeds a scripting language, so assume handler code can
# be wrong (not hostile — the sandbox handles capabilities, but defense in
# depth is cheap here):
NoNewPrivileges=true
# The whole filesystem read-only except the state directory: the SQLite
# database (and its -wal/-shm) is the one thing Nitr legitimately writes.
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/myapp/data
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true
# Nitr needs only sockets: TCP in, TCP out (fetch), and Unix for the OS.
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
MemoryDenyWriteExecute=true
CapabilityBoundingSet=
LockPersonality=true

[Install]
WantedBy=multi-user.target
```

The original lives at
[`deploy/systemd/nitr.service`](https://github.com/nitrweb/nitr/blob/master/deploy/systemd/nitr.service).

## The two lines people get wrong

### `TimeoutStopSec` must exceed the drain deadline

```ini
TimeoutStopSec=40      # > [shutdown] grace (30) + stream_grace (5)
```

Set it below that and systemd `SIGKILL`s the process mid-drain — cutting
exactly the requests graceful shutdown exists to protect. Whenever you
raise `grace` or `stream_grace`, raise this too.

### `ExecReload` sends `SIGHUP`, which is not a restart

```ini
ExecReload=/bin/kill -HUP $MAINPID
```

Nitr defines `SIGHUP` as "rebuild the Lua runtime pool without dropping
connections" — and, with `[tls]` enabled, "re-read the certificate and
key". The process, its listener and its keep-alive connections survive,
and the rebuild runs on its own task, so the listener keeps accepting
throughout. `systemctl reload myapp` is therefore genuinely
zero-downtime — which `systemctl restart` is not.

## The hardening block

It assumes the application writes **only** its SQLite database:

```ini
ProtectSystem=strict          # everything read-only…
ReadWritePaths=/srv/myapp/data  # …except this
```

Widen it deliberately, not preemptively. If your application writes
uploads:

```ini
ReadWritePaths=/srv/myapp/data /srv/myapp/uploads
```

> [!NOTE] A bundled artifact wants a cache directory
>
> A [`nitr build`](./single-file) artifact unpacks itself into
> `$XDG_CACHE_HOME/nitr/apps`, else `~/.cache/nitr/apps`. With
> `ProtectHome=true` there is no home to use, so the bundle re-extracts
> into a fresh private temporary directory on every start and logs a
> warning saying where. To keep the reuse, hand systemd the job:
>
> ```ini
> CacheDirectory=nitr
> Environment=XDG_CACHE_HOME=/var/cache
> ```
>
> systemd creates `/var/cache/nitr` owned by the service user. A plain
> `nitr` binary running loose Lua files needs neither line.

`CapabilityBoundingSet=` (empty) drops every capability. If you must
bind a port below 1024 — with `[tls]` on, `:443` is exactly that case —
add:

```ini
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
```

## What changes with TLS

Nothing structural. `[tls]` terminates TLS inside the same process, on
the same listener, under the same unit — see [TLS](../tls). Three
details are worth pinning down.

### The certificate directory is read-only, on purpose

`ProtectSystem=strict` makes the filesystem **read-only**, not
unreadable, so `/etc/nitr/tls` needs no entry at all:

```ini
ReadWritePaths=/srv/myapp/data     # the database — and nothing else
```

Do **not** add the certificate directory here. Nitr only ever reads
those two files; granting the server write access to its own private
key buys nothing and widens what a mistake in a handler could reach.
Only the ACME client needs to write there, and it runs as root, outside
this unit.

What the service account does need is **read** access to the files
themselves:

```sh
install -d -m 0750 -o root -g nitr /etc/nitr/tls
install -m 0600 -o nitr -g nitr fullchain.pem /etc/nitr/tls/
install -m 0600 -o nitr -g nitr privkey.pem   /etc/nitr/tls/
```

> [!TIP] Nitr checks the key's mode for you
>
> At startup, a `[tls] key` readable beyond its owner (any group or
> other bit set — `0640` and `0644` included) produces a warning naming
> the file and its mode. The server reads it regardless: protecting the
> file is the operator's job, not something a web server should refuse
> to boot over. A private key usually wants `0600` and the service
> user as its owner.

Pointing `[tls] cert`/`key` straight at `/etc/letsencrypt/live/...`
works too and skips the copy — but the symlinks there resolve into
`archive/`, which certbot creates `0700 root`, so the service account
must be given a path through it first.

### `systemctl reload` is how a renewal takes effect

A renewed certificate on disk changes nothing in a running process.
`ExecReload` already sends the `SIGHUP` that does:

```sh
systemctl reload myapp
```

The reload re-reads both files and swaps the acceptor in **only when
the new pair validates** — a half-written file keeps the old material
and logs a warning. Established connections keep the certificate they
handshook with. Because `ExecReload` signals `$MAINPID`, this needs no
`pidfile`.

### The certbot deploy hook

Replace both files, then signal. certbot writes atomically
(write-then-rename), so the only window in which a reload could see half
a file is the copy itself — `install` writes in place rather than
renaming, so it does not close that window on its own. Nitr's
validate-then-swap covers it anyway: a half-written pair fails to
validate, the old material stays live, and the reload logs a warning.

```sh
#!/bin/sh
# /etc/letsencrypt/renewal-hooks/deploy/50-nitr.sh
set -eu

install -m 0600 -o nitr -g nitr \
  "$RENEWED_LINEAGE/fullchain.pem" /etc/nitr/tls/fullchain.pem
install -m 0600 -o nitr -g nitr \
  "$RENEWED_LINEAGE/privkey.pem" /etc/nitr/tls/privkey.pem

systemctl reload myapp
```

```sh
chmod +x /etc/letsencrypt/renewal-hooks/deploy/50-nitr.sh

# Run it once by hand — certbot only sets RENEWED_LINEAGE itself.
RENEWED_LINEAGE=/etc/letsencrypt/live/example.com \
  /etc/letsencrypt/renewal-hooks/deploy/50-nitr.sh
journalctl -u myapp -n 20
```

The reload logs the certificate count it just loaded, so the journal is
where you confirm the hook worked — not the next renewal, ninety days
later.

> [!WARNING] Turning TLS on or off is a restart
>
> A reload re-reads the two **files**, never `nitr.toml`. Changing
> `[tls] enabled`, `min_version` or `handshake_ms` needs
> `systemctl restart`.

## Operating it

```sh
systemctl start myapp
systemctl stop myapp            # graceful drain, up to TimeoutStopSec
systemctl reload myapp          # SIGHUP: pool rebuild + TLS re-read
systemctl restart myapp         # drain, then a fresh process
systemctl status myapp

journalctl -u myapp -f          # follow the logs
journalctl -u myapp -p err      # errors only
```

## Logs

With `Type=exec`, Nitr's stdout goes to the journal. For structured
querying, use JSON:

```toml
[log]
format = "json"
```

```sh
journalctl -u myapp -o cat | jq 'select(.span.status >= 500)'
```

Output through a pipe is byte-clean — no ANSI escapes to strip.

## A pidfile is optional here

`ExecReload` signals `$MAINPID` directly, so systemd needs no pidfile.
Configure one only if you also want `nitr reload` to work from a shell:

```toml
pidfile = "/run/nitr/nitr.pid"
```

```ini
RuntimeDirectory=nitr           # creates /run/nitr, owned by the service user
```

## Deploying an update

```sh
rsync -a --exclude data/ ./ /srv/myapp/
cd /srv/myapp && sudo -u nitr nitr check && sudo -u nitr nitr migrate
systemctl reload myapp          # or restart, if the binary itself changed
```

`reload` suffices for changes to Lua sources and templates — both are
inputs the rebuild re-reads. Static files need no signal at all: they
are read from disk per request. Replacing the `nitr` binary itself, or
changing `nitr.toml`, needs a `restart`.

## Multiple applications on one host

Unit templates keep this tidy:

```sh
cp nitr.service /etc/systemd/system/nitr@.service
```

```ini
WorkingDirectory=/srv/%i
ExecStart=/usr/local/bin/nitr run
ReadWritePaths=/srv/%i/data
```

```sh
systemctl enable --now nitr@myapp
systemctl enable --now nitr@otherapp
```

Give each its own `listen` port and put the proxy in front.

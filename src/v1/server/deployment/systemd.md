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
[`deploy/systemd/nitr.service`](https://github.com/joseluisq/nitr/blob/master/deploy/systemd/nitr.service).

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
connections". The process, its listener and its keep-alive connections
survive. `systemctl reload myapp` is therefore genuinely zero-downtime —
which `systemctl restart` is not.

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

`CapabilityBoundingSet=` (empty) drops every capability. If you must
bind a port below 1024 — you usually should not, put a proxy in front —
add:

```ini
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
```

## Operating it

```sh
systemctl start myapp
systemctl stop myapp            # graceful drain, up to TimeoutStopSec
systemctl reload myapp          # SIGHUP: zero-downtime pool rebuild
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
journalctl -u myapp -o cat | jq 'select(.status >= 500)'
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

`reload` suffices for changes to Lua, templates and static files.
Replacing the `nitr` binary itself, or changing `nitr.toml`, needs a
`restart`.

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

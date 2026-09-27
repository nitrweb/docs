# systemd

Run Nitr as a hardened systemd service.

## Install

```sh
# 1. The binary, where the unit expects it.
install -m 0755 ~/.cargo/bin/nitr /usr/local/bin/nitr

# 2. A dedicated unprivileged user.
useradd --system --home /srv/myapp --shell /usr/sbin/nologin nitr

# 3. The application: nitr.toml, app.lua, public/, migrations/, data/
rsync -a ./ /srv/myapp/
install -d -o nitr -g nitr /srv/myapp/data
chown -R nitr:nitr /srv/myapp

# 4. The unit (below), then start it.
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
# SIGHUP is Nitr's zero-downtime reload.
ExecReload=/bin/kill -HUP $MAINPID

# SIGTERM starts the graceful drain. TimeoutStopSec MUST exceed
# [shutdown] readiness_delay + grace + stream_grace (default 5 + 30 + 5).
KillSignal=SIGTERM
TimeoutStopSec=45

# A cut drain exits non-zero; restart on that and on crashes.
Restart=on-failure
RestartSec=2

# Hardening: everything read-only except the database directory.
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/myapp/data
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
MemoryDenyWriteExecute=true
CapabilityBoundingSet=
LockPersonality=true

[Install]
WantedBy=multi-user.target
```

The same unit, with longer comments, is in the repository at
[`deploy/systemd/nitr.service`](https://github.com/nitrweb/nitr/blob/master/deploy/systemd/nitr.service).

## Two lines to get right

**`TimeoutStopSec` must exceed the drain.** It has to be longer than
`[shutdown] readiness_delay + grace + stream_grace`, or systemd kills the process
mid-drain and cuts the requests the drain protects. Raise it whenever
you raise either setting.

**`ExecReload` sends `SIGHUP`, which is not a restart.** It rebuilds
the Lua pool and re-reads TLS files while connections stay open, so
`systemctl reload myapp` has no downtime. See
[Zero-downtime reload](./#zero-downtime-reload).

## Adjusting the hardening

The unit assumes Nitr writes only its SQLite database. Widen
`ReadWritePaths` only for what your application writes, such as
uploads:

```ini
ReadWritePaths=/srv/myapp/data /srv/myapp/uploads
```

`CapabilityBoundingSet=` drops every capability. To bind a port below
1024, such as `:443` with `[tls]` on, add:

```ini
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
```

A [single-file artifact](./single-file) wants a cache directory to
extract into. `ProtectHome=true` hides the home directory, so give it
one:

```ini
CacheDirectory=nitr
Environment=XDG_CACHE_HOME=/var/cache
```

Without it, the artifact extracts again on every start and logs a
warning. A plain `nitr` binary does not need this.

## TLS

`ProtectSystem=strict` makes the filesystem read-only, not unreadable,
so the certificate directory needs no `ReadWritePaths` entry. Do not
add one: Nitr only reads those files. The service user does need to
read them:

```sh
install -d -m 0750 -o root -g nitr /etc/nitr/tls
install -m 0600 -o nitr -g nitr fullchain.pem privkey.pem /etc/nitr/tls/
```

Nitr warns at startup if the key is readable by anyone but its owner.

A renewed certificate takes effect on `systemctl reload myapp`. Use the
[ACME deploy hook](../tls#an-acme-deploy-hook) to copy the files and
reload after each renewal, then check `journalctl -u myapp` to confirm
it loaded. Turning `[tls]` on or off, or changing `min_version`, needs
a `systemctl restart`.

## Operating it

```sh
systemctl reload myapp          # SIGHUP: reload scripts and TLS files
systemctl restart myapp         # drain, then a fresh process
systemctl stop myapp            # graceful drain, up to TimeoutStopSec
journalctl -u myapp -f          # follow the logs
```

With `[log] format = "json"`, the journal can be queried with `jq`:

```sh
journalctl -u myapp -o cat | jq 'select(.span.status >= 500)'
```

`ExecReload` signals `$MAINPID`, so no pidfile is needed. Set one only
if you also want `nitr reload` from a shell:

```toml
pidfile = "/run/nitr/nitr.pid"
```

```ini
RuntimeDirectory=nitr           # creates /run/nitr for the service user
```

## Deploying an update

```sh
rsync -a --exclude data/ ./ /srv/myapp/
cd /srv/myapp && sudo -u nitr nitr check && sudo -u nitr nitr migrate
systemctl reload myapp
```

A reload is enough for Lua and template changes. Static files need
nothing. A new `nitr` binary or a changed `nitr.toml` needs
`systemctl restart myapp`.

## Several applications on one host

Turn the unit into a template, `/etc/systemd/system/nitr@.service`,
with `%i` as the application name:

```ini
WorkingDirectory=/srv/%i
ExecStart=/usr/local/bin/nitr run
ReadWritePaths=/srv/%i/data
```

```sh
systemctl enable --now nitr@myapp nitr@otherapp
```

Give each application its own `listen` port and put a proxy in front.

# Single-File Deploys

```sh
nitr build --output myapp
```

That appends the whole application — `nitr.toml`, every Lua source,
templates, static files and migrations — to a copy of the running
binary. The result is **one executable** with no dependency on the
directory it was built in.

```sh
scp myapp server:/usr/local/bin/
ssh server 'myapp run'
```

## What goes in

| Included                                 | Not included                          |
| ---------------------------------------- | ------------------------------------- |
| `nitr.toml` (the application manifest)   | The **database**                      |
| Lua sources — handler, config, `routes/` | The env file (`.env`)                 |
| Templates                                | Anything outside the configured paths |
| Static files                             |                                       |
| Migrations                               |                                       |

## What changes inside a bundle

Three behaviours differ from a directory-based run, all deliberately:

**`dev_mode` is forced off.** There are no source files to watch, and no
reason to leak tracebacks from a shipped artifact.

**Paths resolve inside the bundle.** The configuration and every path in
it come from a content-addressed temporary extraction directory, reused
across starts of the same artifact.

**The database path is untouched.** It resolves against the **working
directory**, as always. State stays outside the artifact, on purpose:
an image is immutable, and SQLite is not.

```sh
cd /srv/myapp        # where data/app.db lives
myapp run
```

The env file follows the same logic — it is external state, so a
relative `[env] file` resolves against the working directory rather than
against the extracted config.

## Requirements

`nitr build` needs a configuration file; the bundle records it as the
application manifest:

```sh
nitr -c nitr.production.toml build --output myapp
```

Without one, the command stops and says so rather than guessing.

## A realistic build

```sh
# 1. Validate against the configuration you are about to ship.
nitr -c nitr.production.toml check

# 2. Run the tests.
nitr test

# 3. Build the artifact.
nitr -c nitr.production.toml build --output dist/myapp
```

```sh
# On the server:
scp dist/myapp server:/usr/local/bin/myapp.new

ssh server '
  mv /usr/local/bin/myapp.new /usr/local/bin/myapp &&
  cd /srv/myapp &&
  myapp migrate &&
  systemctl restart myapp
'
```

The artifact runs every subcommand the normal binary does — `run`,
`migrate`, `check`, `test`, `reload` — against its own bundled
application.

## When it fits

| Good fit                                  | Prefer a directory or container                    |
| ----------------------------------------- | -------------------------------------------------- |
| Small deployments, a handful of machines  | You already have a container pipeline              |
| No package manager and no registry        | You want to patch a template without rebuilding    |
| An artifact you want to sign and checksum | Very large static asset trees (put those on a CDN) |
| Immutable, auditable deploys              |                                                    |

## Operational notes

**Startup extracts once per version.** The extraction directory is
content-addressed, so restarting the same artifact reuses it — a restart
is not slower than a normal one.

**Rollback is copying the previous file back.** Keep the last few
artifacts; nothing else has to be reverted, except a migration, which
never rolls back on its own.

**The bundle is bigger than the binary**, by roughly the size of your
Lua, templates and static files. Large asset trees belong on a CDN, not
inside an executable.

**A checksum identifies a deploy exactly:**

```sh
sha256sum dist/myapp
```

## systemd with a bundled artifact

```ini
[Service]
Type=exec
User=nitr
WorkingDirectory=/srv/myapp        # ← where data/app.db lives
ExecStart=/usr/local/bin/myapp run
ExecReload=/bin/kill -HUP $MAINPID
KillSignal=SIGTERM
TimeoutStopSec=40
ReadWritePaths=/srv/myapp/data
```

The `WorkingDirectory` is what makes the external database resolve
correctly. Everything else is identical to the [standard
unit](./systemd).

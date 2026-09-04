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

| Included                                                                                                             | Not included                               |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `nitr.toml`, stored under that name whatever it was called on disk                                                   | The **database**                           |
| Every `*.lua` under the handler script's directory — `require` is confined there, so any of them may load at runtime | The env file (`.env`)                      |
| The config script                                                                                                    | The **TLS certificate and key**            |
| The `[templating]` directory                                                                                         | The `[multipart] upload_dir`               |
| The `[static]` directory                                                                                             | The `[testing]` directory                  |
| The migrations directory                                                                                             | Anything outside the application directory |

Every path that _is_ archived must be relative and stay inside the
directory you build from. An absolute path, or one climbing out with
`..`, is refused with a message naming the setting rather than
silently producing a bundle that only works on the build machine.

## What stays outside, and why

The exclusions are not omissions. Each one is state that must outlive
the artifact, or must never be copied with it.

### The database

Its path is **untouched** by the bundle: it resolves against the
**working directory**, as always. Bundling mutable state into an
immutable artifact would be wrong in both directions — the artifact
stops being copyable, and the state stops being backup-able.

```sh
cd /srv/myapp        # where data/app.db lives
myapp run
```

### The TLS key and certificate

`[tls] cert` and `[tls] key` are **neither archived nor re-anchored**.

> [!DANGER] A private key inside a copyable one-file artifact leaks with it
>
> The whole point of the artifact is that it is one file you `scp`,
> checksum, sign and keep old copies of. A key baked into it inherits
> all of that. Keep certificate and key on the target machine, exactly
> like the database — absolute paths are the clearest way to say so.

A _relative_ `[tls] key` in a bundle therefore resolves against the
working directory at run time, not against the extraction directory.
Note also that `nitr.toml` itself **is** archived, so the key's
**path** travels with the artifact even though its bytes do not — a
path to a private key tells a reader where to look. See
[TLS](../tls#nitr-build-leaves-the-key-outside).

### Uploads

`[multipart] upload_dir` is left alone for a milder version of the same
reason: uploads outlive the deploy that received them, and re-anchoring
them inside a content-addressed extraction directory would make them
vanish on the next build.

### The env file

External state too, so a relative `[env] file` resolves against the
working directory rather than against the extracted config. That is
what lets one artifact run against staging and production secrets
without rebuilding.

## What changes inside a bundle

**`dev_mode` is forced off**, with a warning if the bundled config asked
for it. There are no source files to watch — the extraction is a
temporary copy, not your sources — and no reason to leak tracebacks
from a shipped artifact.

**Application paths resolve inside the bundle.** The handler and config
scripts, templates, static files and migrations all come from a
content-addressed extraction directory, reused across starts of the same
artifact.

**Extraction goes into the user's private cache**, not the shared temp
directory: `$XDG_CACHE_HOME/nitr/apps` if that names an absolute path,
otherwise `$HOME/.cache/nitr/apps`, created mode `0700` (and re-tightened
if it already existed with looser bits).

> [!DANGER] Why not `/tmp`
>
> The old location was `$TMPDIR/nitr-app-<key>`, and the key is
> computable by anyone who can read the executable. On a shared temp
> directory another local user could create that exact path first —
> marker file, their own `nitr.toml`, their own `app.lua` — and the next
> start would run **their** application as the operator. Reuse is only
> safe inside a directory that user owns and nobody else can enter.

**Without a writable cache directory, extraction is per-run.** A unit
with `ProtectHome=true`, or a container user with no `HOME`, has
nowhere private to reuse — so the bundle unpacks into a fresh private
directory on every start, and a warning on stderr says where. Correct,
just not reused; the cost is one extraction per start.

**Extraction is atomic.** The archive unpacks into a staging directory
and is renamed into place, so a crash mid-extract cannot leave a
half-populated directory that a later run trusts. Staging directories an
earlier run left behind are swept on the next successful extraction.
Every entry is validated first: no `..`, no absolute names, no symlinks
— a tampered bundle refuses to run rather than running partially.

## Requirements

`nitr build` needs a configuration file; the bundle records it as the
application manifest:

```sh
nitr -c nitr.production.toml build --output myapp
```

Without one, the command stops and says so rather than guessing. It
also refuses to build from an executable that already carries a
bundle — start from the plain `nitr` binary.

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

The artifact runs the same subcommands the normal binary does — `run`,
`migrate`, `check`, `reload` — against its own bundled application.
`nitr test` is the exception: the `[testing]` directory is not
archived, so tests run at build time, from the source tree.

## When it fits

| Good fit                                  | Prefer a directory or container                    |
| ----------------------------------------- | -------------------------------------------------- |
| Small deployments, a handful of machines  | You already have a container pipeline              |
| No package manager and no registry        | You want to patch a template without rebuilding    |
| An artifact you want to sign and checksum | Very large static asset trees (put those on a CDN) |
| Immutable, auditable deploys              |                                                    |

## Operational notes

**Startup extracts once per version.** The extraction directory is
content-addressed inside the user's private cache, so restarting the
same artifact reuses it — a restart is not slower than a normal one.
Two instances starting at once race harmlessly: the loser discards its
staging copy. Where no cache directory is available the artifact
re-extracts per start and says so.

**Rollback is copying the previous file back.** Keep the last few
artifacts; nothing else has to be reverted, except a migration, which
never rolls back on its own.

**The bundle is bigger than the binary**, by roughly the size of your
Lua, templates and static files. `nitr build` prints the file count and
the archived size when it finishes. Large asset trees belong on a CDN,
not inside an executable.

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

`WorkingDirectory` is what makes the external database resolve
correctly. Everything else is identical to the [standard
unit](./systemd).

> [!NOTE] `ProtectHome` and the extraction directory
>
> The bundle extracts into the running user's private cache
> (`$XDG_CACHE_HOME/nitr/apps`, else `~/.cache/nitr/apps`). The
> reference unit sets `ProtectHome=true`, which hides `/home` — so
> unless you give the service a cache directory of its own, every
> restart re-extracts into a fresh private temporary directory and logs
> a warning saying so. That is a few milliseconds, not a fault; keep the
> isolation unless you have measured otherwise.
>
> To keep both, hand systemd the job:
>
> ```ini
> CacheDirectory=nitr
> Environment=XDG_CACHE_HOME=/var/cache
> ```
>
> systemd creates `/var/cache/nitr` owned by the service user, and the
> extraction lands under it and is reused across restarts.

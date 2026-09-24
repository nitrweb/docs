# Single-File Deploys

`nitr build` packs your application into a copy of the `nitr` binary.
The result is **one executable** that runs anywhere, without the
directory it was built from.

## Build and ship

```sh
nitr -c nitr.production.toml check      # 1. validate what you will ship
nitr test                               # 2. run the tests from the source tree
mkdir -p dist
nitr -c nitr.production.toml build --output dist/myapp   # 3. build
```

```console
built dist/myapp (8 file(s), 68.5 KiB archived)
run it anywhere: the database path still resolves against the working directory
```

```sh
scp dist/myapp server:/usr/local/bin/myapp.new
ssh server '
  mv /usr/local/bin/myapp.new /usr/local/bin/myapp &&
  cd /srv/myapp &&
  myapp migrate &&
  systemctl restart myapp
'
```

The artifact takes the same subcommands as `nitr` (`run`, `migrate`,
`check`, `reload`, …) and applies them to its bundled application.

`nitr build` needs a configuration file, since it becomes the
application manifest. The output directory must already exist. Build
from the plain `nitr` binary, not from an artifact.

## What goes in

| Included                                                                       | Stays outside                      |
| ------------------------------------------------------------------------------ | ---------------------------------- |
| `nitr.toml` (stored under that name)                                           | The **database**                   |
| Every `*.lua` file under the handler script's directory, and the config script | The `.env` file                    |
| The `[templating]` directory                                                   | The **TLS certificate and key**    |
| The `[static]` directory                                                       | `[multipart] upload_dir`           |
| The migrations directory                                                       | Anything outside the app directory |

Every included path must be relative and inside the directory you
build from. An absolute path, or one with `..`, is refused with an
error naming the setting.

Test files are included only if they sit under the handler script's
directory, as in the `nitr init` layout. Run your tests before building
either way.

## What stays outside

The excluded files are state that must outlive a deploy or must never
be copied with the artifact.

- **The database** path resolves against the **working directory**,
  as usual. Start the artifact from the directory that holds your data:
  `cd /srv/myapp && myapp run`.
- **The `.env` file** also resolves against the working directory, so
  one artifact can run with staging or production secrets.
- **Uploads** stay in `[multipart] upload_dir`, untouched.
- **The TLS certificate and key** are never archived, and relative
  paths to them resolve against the working directory. Use absolute
  paths.

> [!DANGER] Keep private keys out of the artifact
>
> The artifact is meant to be copied, checksummed and archived. A key
> inside it would leak with every copy. Note that `nitr.toml` is
> archived, so the key's _path_ travels with it.

## What changes inside a bundle

- **`dev_mode` is forced off**, with a warning if the config asked for
  it. `[openapi] output` is ignored for the same reason; use
  `nitr openapi --output` instead.
- **The application is extracted on first start** into the user's
  private cache: `$XDG_CACHE_HOME/nitr/apps`, else
  `~/.cache/nitr/apps`, mode `0700`. Later starts of the same artifact
  reuse it, so restarts are not slower.
- **Without a writable cache directory** (a systemd unit with
  `ProtectHome=true`, or a container user with no home), the bundle is
  extracted to a fresh temporary directory on every start and a warning
  says where. It works; it is just not reused. The [systemd](./systemd)
  and [Docker](./docker) pages show how to give it a cache directory.
- **A tampered bundle refuses to run.** Entries with `..`, absolute
  names or symlinks are rejected, and a crash during extraction never
  leaves a half-extracted directory behind.

## Running it under systemd

Use the [standard unit](./systemd) with the artifact as `ExecStart`.
`WorkingDirectory` is what makes the database path resolve:

```ini
[Service]
WorkingDirectory=/srv/myapp        # where data/app.db lives
ExecStart=/usr/local/bin/myapp run
CacheDirectory=nitr                # a reusable extraction directory,
Environment=XDG_CACHE_HOME=/var/cache   # allowed even with ProtectHome=true
```

## When it fits

| Good fit                                   | Prefer a directory or container                  |
| ------------------------------------------ | ------------------------------------------------ |
| A few machines, no package registry        | You already have a container pipeline            |
| Signed, checksummed, immutable deploys     | You want to change a template without rebuilding |
| Rollback by copying the previous file back | Large static assets (put them on a CDN)          |

The artifact is larger than the binary by about the size of your Lua,
templates and static files. `sha256sum dist/myapp` identifies a deploy
exactly. Rolling back is copying the previous file back; migrations
never roll back on their own.

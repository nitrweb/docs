# CLI Commands

Everything the `nitr` binary can do. Run `nitr --help` for the same list
at the terminal.

```
Usage: nitr [OPTIONS] [COMMAND]

Commands:
  run       Start the server (the default when no command is given)
  dev       Start the server in development mode (hot reload)
  check     Load the configuration and scripts, then exit
  test      Run the Lua tests against an in-process server
  migrate   Apply pending SQL migrations from migrations/
  init      Scaffold a new Nitr application
  build     Package the application and this binary into one runnable file
  reload    Ask a running server (found via its `pidfile`) to reload

Options:
  -v, --version        Print the version and exit
  -c, --config <PATH>  Path to the TOML config file (default: ./nitr.toml)
      --dev            Enable development mode (hot reload)

Signals:
  SIGHUP               Zero-downtime reload: rebuilds the Lua runtime pool
```

## Global options

These apply to every command.

| Option                  | Description                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `-c`, `--config <PATH>` | The TOML configuration file. Defaults to `./nitr.toml`; if that file does not exist, Nitr starts with built-in defaults rather than failing. |
| `--dev`                 | Turns on development mode — identical to `nitr dev`, and to `dev_mode = true` in the file.                                                   |
| `-v`, `--version`       | Print the version and exit.                                                                                                                  |

> [!TIP] Relative paths resolve against the config file
>
> Paths inside `nitr.toml` (`handler_script`, `[static] dir`, …) resolve
> relative to the file's directory, so `nitr -c /srv/app/nitr.toml run`
> works from anywhere. The one exception is the **env file**, which is
> external state like the database and resolves against the working
> directory for a [bundled build](./deployment/single-file).

## `run`

```sh
nitr run     # or just: nitr
```

Starts the server. This is the default when no command is given.

- Binds `listen`, builds the Lua state pool, applies the configuration.
- Writes the `pidfile`, if one is configured — **only after** the build
  succeeded, so a pid that never served is never left behind for
  `nitr reload` to signal.
- On `SIGTERM`/`SIGINT` it [drains
  gracefully](./deployment/#graceful-shutdown); a truncated drain exits
  non-zero.
- On `SIGHUP` it rebuilds the Lua pool without dropping connections.

## `dev`

```sh
nitr dev
```

`run` plus development mode:

- **Hot reload.** A file watcher rebuilds the Lua pool when you save the
  handler script, a file under `routes/`, or a template. No restart, no
  dropped connections.
- **Error details in responses.** A failing handler answers with the
  headline, the failing source line, the traceback and the cause chain —
  as HTML when the client accepts it, plain text otherwise. In
  production the same failure is exactly `Internal Server Error`.
- **Debug-level logging** by default, which turns on the inner spans
  (`pool_checkout`, `lua_handler`, `db_query`, `fetch`) so you can see
  where the time went.

> [!WARNING] Never run dev mode in production
>
> It leaks source paths, line numbers and tracebacks to whoever can
> cause an error. [`nitr build`](#build) forces it off for exactly this
> reason.

## `check`

```sh
nitr check
nitr check --print-config
```

Loads the configuration and every script, then exits — **without binding
a port**. That makes it the right thing to run in CI, in a pre-deploy
step, and after editing `nitr.toml`.

It catches: unknown or contradictory configuration keys, missing files
and directories, Lua syntax errors, a handler script that forgets to
`return app`, and a builtin configured but not compiled into this binary.

`--print-config` prints the **effective** configuration after file +
environment + flag layering — the answer to "which value actually won?":

```sh
$ NITR_WORKERS=8 nitr check --print-config | head
listen = "127.0.0.1:3000"
handler_script = "app.lua"
workers = 8
...
```

## `test`

```sh
nitr test
nitr test --filter notes
```

Runs every `*.lua` file under `[testing] dir` (default `tests/`) against
an **in-process server**. Requests dispatch through the real router and
the real middleware chain — nothing is mocked.

`--filter <SUBSTRING>` runs only tests whose name or file name contains
the substring. The command exits non-zero if any test fails, so it drops
straight into CI. See [Testing](./testing).

## `migrate`

```sh
nitr migrate
nitr migrate --status
```

Applies pending `.sql` files from `[database] migrations_dir` (default
`migrations/`) in filename order, recording each one as applied.

`--status` reports what has run and what is pending, applying nothing.

The server **refuses to start while a migration is pending**, which is
what keeps the schema and the code from quietly disagreeing. See
[Database → Migrations](./database#migrations).

## `init`

```sh
nitr init                # into the current directory
nitr init my-app         # into my-app/
nitr init --minimal      # the four-file version
```

Scaffolds a complete application: `nitr.toml`, `config.lua`, `app.lua`,
a route module, a migration, a template, a static page, a test, a
`.gitignore`, and the generated `nitr-types.lua` completions. See
[Project layout](./project-layout).

It **refuses to overwrite an existing file** — running it in a
non-empty directory is safe, it will simply stop.

## `build`

```sh
nitr build --output myapp
```

Appends the whole application — `nitr.toml`, every Lua source,
templates, static files and migrations — to a copy of the running
binary. The result is one executable that no longer depends on the
directory it was built in.

- `dev_mode` is forced off: there are no source files to watch.
- The **database stays external**, resolving against the working
  directory as always. State does not belong inside an immutable
  artifact.
- A configuration file is required — the bundle records it as the
  application manifest.

See [Single-file deploys](./deployment/single-file).

## `reload`

```sh
nitr reload
```

Sends `SIGHUP` to the process named by the configured `pidfile`, which
makes it rebuild the Lua runtime pool without dropping connections. The
listener, the process and its keep-alive connections all survive.

Requires `pidfile` to be set in `nitr.toml` — without it, `reload` has
no way to find the server and says so. Needs Unix signals, so it is
unavailable on Windows.

Equivalent to `kill -HUP <pid>`, and to systemd's `ExecReload`.

## Exit codes

| Code | Meaning                                                                                     |
| ---- | ------------------------------------------------------------------------------------------- |
| `0`  | Success — including a clean, complete graceful drain.                                       |
| `1`  | Any failure: a configuration or script error, a failing test, a drain that ran out of time. |

`[log] format = "json"` and exit codes are the machine-readable
contract; the human-readable output text is not an API. See
[Stability](../stability).

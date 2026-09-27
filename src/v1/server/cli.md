# CLI Commands

Everything the `nitr` binary can do. `nitr --help` prints the same list,
and `nitr <command> --help` shows a command's flags.

```
Usage: nitr [OPTIONS] [COMMAND]

Commands:
  run            Start the server (the default when no command is given)
  dev            Start the server in development mode (hot reload)
  check          Load the configuration and scripts, then exit
  test           Run the Lua tests against an in-process server
  openapi        Generate the OpenAPI document from the application's routes
  migrate        Apply pending SQL migrations from migrations/
  init           Scaffold a new Nitr application
  build          Package the application and this binary into one runnable file
  reload         Ask a running server (found via its `pidfile`) to reload
  hash-password  Print an argon2id hash for a password, read from a prompt or stdin
  help           Print this message or the help of the given subcommand(s)

Options:
  -v, --version        Print the version and exit
  -c, --config <PATH>  Path to the TOML config file (default: ./nitr.toml)
      --dev            Enable development mode (hot reload)
  -h, --help           Print help
```

The global options work with every command and are described in
[Command-line flags](./configuration/cli). Every command except `init`
and `hash-password` loads and validates the configuration first.

## `run`

```sh
nitr run             # or just: nitr
nitr run --migrate   # apply pending migrations, then serve
```

Starts the server. This is the default command.

- `--migrate` runs [`nitr migrate`](#migrate) first and serves only if
  it succeeds: one command for a single container's entrypoint instead
  of `nitr migrate && nitr run`. Like `nitr migrate`, it needs a
  `[database]` section and a migrations directory. With several
  instances, run `nitr migrate` once instead, so they do not race to
  change the schema.

- Writes the [`pidfile`](./configuration/file#top-level), if set, once
  the server has started. If the pidfile already names a running
  process, startup fails; a file left behind by a crash is replaced.
- On `SIGTERM`/`SIGINT` it [shuts down gracefully](./deployment/): it
  stops accepting, finishes in-flight requests, then exits. A drain that
  runs out of time exits non-zero.
- On `SIGHUP` it reloads the Lua scripts without dropping connections
  and, with [`[tls]`](./tls) enabled, re-reads the certificate and key.

## `dev`

```sh
nitr dev
nitr dev --migrate   # apply pending migrations, then serve
```

`run` with development mode on:

- **Hot reload.** Saving a `.lua` file under the handler script's
  directory, the config script, or a template rebuilds the Lua states.
  No restart, no dropped connections.
- **Error details in responses.** A failing handler returns the error,
  the source line and the traceback. In production the response is
  just `Internal Server Error`.
- **Debug-level logging** by default.

> [!WARNING] Never use dev mode in production
>
> It shows source paths and tracebacks to anyone who can trigger an
> error. [`nitr build`](#build) turns it off.

## `check`

```sh
nitr check
nitr check --print-config
```

Loads the configuration and every script, then exits **without opening
a port**. Run it in CI and after editing `nitr.toml`. It catches unknown
or conflicting settings, missing files, Lua syntax errors, route
conflicts, a handler script that does not `return app`, and pending
migrations.

A static directory that does not exist yet (`[static] dir`, or an
`app:static` mount), such as a front-end build that CI runs later, is
not an error here: `check` logs a warning and skips static files.
`nitr run` still refuses it.

> [!WARNING] The config script really runs
>
> `nitr check` builds the server for real, so `config_script` runs once
> and its side effects happen.

`--print-config` prints the final configuration after the file,
environment variables and flags are combined, then exits. It only
parses the configuration: an unknown key is still an error, but the
other startup checks are skipped.

```sh
$ NITR_WORKERS=8 nitr check --print-config
config_script = "config.lua"
dev_mode = false
handler_script = "app.lua"
listen = "127.0.0.1:3000"
trust_request_id = false
workers = 8

[cache]
default_ttl = 300
...
```

Unset options are left out.

## `test`

```sh
nitr test
nitr test --filter notes --bail
nitr test --watch
nitr test --reporter junit --output junit.xml
```

Runs every `*.lua` file in `[testing] dir` (default `tests/`) against an
in-process server, through the real router, middleware and handlers.
Tests never use `[database] path`; they get their own database with the
migrations applied.

| Flag                    | Effect                                                                      |
| ----------------------- | --------------------------------------------------------------------------- |
| `--filter <SUBSTRING>`  | Run only tests whose name or file name contains the text.                   |
| `--bail`                | Stop at the first failing test.                                             |
| `--list`                | List every test with its `file:line`, without running any.                  |
| `--watch`               | Run again when a Lua file, template or test file changes, until Ctrl-C.     |
| `--reporter <REPORTER>` | `pretty` (default), `json` or `junit`.                                      |
| `-o`, `--output <FILE>` | Write the JSON/JUnit report to a file; the pretty lines still go to stdout. |
| `--nocapture`           | Print log lines as they happen instead of only under a failed test.         |

Exits `1` if any test fails or a `t.only` is left in a file. Like
`check`, it warns about and skips a static directory that does not
exist yet. See [Testing](./testing).

## `openapi`

```sh
nitr openapi                        # print the document to stdout
nitr openapi --output openapi.json  # write it to a file
nitr openapi --check                # exit 1 if the committed file is out of date
nitr openapi --ui site/             # write a static Swagger UI site
```

Generates the [OpenAPI document](./openapi/) from your routes without
opening a port. It works even when `[openapi] enabled = false`, so you
can publish the document from CI while keeping it off the server. Like
`check`, it runs the config script, but against a scratch copy of the
database with the migrations applied, so it never touches your real
database.

| Flag                    | Effect                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `-o`, `--output <PATH>` | Write to this file instead of stdout.                                                          |
| `--check`               | Compare with `--output`, else `[openapi] output`, else `openapi.json`; exit 1 on a difference. |
| `--ui <DIR>`            | Write the page, the document and its assets as a static site.                                  |

```console
$ nitr openapi --check
openapi: openapi.json is out of date: first difference at $.paths./api/notes.post.summary;
run `nitr openapi --output openapi.json` and commit the result
```

Log lines go to stderr here, so `nitr openapi | jq .` works.

## `migrate`

```sh
nitr migrate
nitr migrate --status
```

Applies pending `.sql` files from `[database] migrations_dir` (default
`migrations/`) in version order, each in its own transaction.

It creates the database file's directory when it is missing, so a
first deploy needs no `mkdir data`.

`--status` lists applied and pending migrations without writing
anything (it opens the database read-only and never creates it), and
flags any applied file that was changed afterwards
(`MODIFIED SINCE APPLIED`). Never edit an applied migration; add a new
one.

The server refuses to start while a migration is pending, so run
`nitr migrate` as a deploy step, or start a single instance with
[`nitr run --migrate`](#run). See
[Database → Migrations](./database#migrations).

## `init`

```sh
nitr init                # into the current directory
nitr init my-app         # into my-app/
nitr init --minimal      # only the bare minimum
```

Creates a working application: `nitr.toml`, `config.lua`, `app.lua`, a
route module, a `lib/` module, a migration, a template, a static page, a
test with a helper, `.gitignore`, `data/.gitkeep` and the
`nitr-types.lua` editor completions. `--minimal` writes only
`nitr.toml`, `app.lua`, `public/index.html`, one test and
`nitr-types.lua`. See [Project layout](./project-layout).

It never overwrites a file: if any target exists, it writes nothing.

## `build`

```sh
nitr build --output myapp
```

Packs the application into a copy of the `nitr` binary, producing one
executable. It includes the configuration file, every `.lua` file under
the handler script's directory, the config script, `[templating] dir`,
`[static] dir` and the migrations.

- Dev mode is always off in the built file, and it refuses `--config`
  (use `NITR_*` environment variables for per-deployment values). When
  the configuration asked for dev mode, the built file logs a `WARN`
  line saying it was turned off.
- The database, `[multipart] upload_dir`, the env file and the TLS
  certificate and key stay **outside** the file, resolved as usual at
  run time.
- A configuration file is required.
- Every bundled path must be inside the working directory.

See [Single-file deploys](./deployment/single-file).

## `reload`

```sh
nitr reload
```

Sends `SIGHUP` to the server named in the configured `pidfile` (same as
`kill -HUP <pid>`). The server reloads its Lua scripts without dropping
connections and, with TLS on, re-reads the certificate and key, keeping
the old ones if the new pair is invalid.

Needs `pidfile` in `nitr.toml`. Not available on Windows. Before
signalling, it checks that the pid belongs to a Nitr process. If the
server is a `nitr build` file, run `reload` from that file.

## `hash-password`

```sh
nitr hash-password                          # prompts twice, input hidden
printf %s "$PASSWORD" | nitr hash-password  # for scripts and CI
```

Prints an **argon2id** hash, and nothing else, so
`HASH=$(nitr hash-password)` gives exactly the string to store. It uses
the same code and parameters as
[`nitr.crypto.password_hash`](./passwords), and needs no application or
`nitr.toml`.

```
$ nitr hash-password
Password:
Confirm password:
$argon2id$v=19$m=19456,t=2,p=1$m9z1df0eQ2iTUMTMdNG9Lg$orLEhw5SZE3dVnKDfo0npcOXvrw/pBGD2eHhFVLFwMo
```

- There is no `--password` flag, on purpose: command-line arguments show
  up in `ps` and shell history.
- At the prompt you type the password twice; after three mismatches it
  gives up.
- From a pipe, only one trailing newline is removed, so use `printf %s`
  rather than `echo`.
- Empty passwords and passwords over 1024 bytes are refused.

> [!WARNING] Ctrl-C at the prompt leaves echo off
>
> Run `stty echo` (or `reset`) to get your typing back. If `stty` is
> not available, the password is read visibly and the prompt says so.

## Exit codes

| Code | Meaning                                                                                                     |
| ---- | ----------------------------------------------------------------------------------------------------------- |
| `0`  | Success, including a complete graceful shutdown.                                                            |
| `1`  | Any failure: a configuration or script error, a failing test, an unfinished drain, `openapi --check` drift. |

Exit codes and `[log] format = "json"` are stable for scripts; the
human-readable text is not. See [Stability](../stability).

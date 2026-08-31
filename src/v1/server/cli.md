# CLI Commands

Everything the `nitr` binary can do. Run `nitr --help` for the same list
at the terminal.

```
The Nitr server: drop a binary and a few Lua files onto a machine and you have a complete small HTTP application

Usage: nitr [OPTIONS] [COMMAND]

Commands:
  run            Start the server (the default when no command is given)
  dev            Start the server in development mode (hot reload)
  check          Load the configuration and scripts, then exit
  test           Run the Lua tests against an in-process server
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

Signals:
  SIGHUP           Zero-downtime reload: rebuilds the Lua runtime pool
```

## Global options

These are declared globally, so they are accepted on every command.

| Option                  | Description                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `-c`, `--config <PATH>` | The TOML configuration file. Defaults to `./nitr.toml`; if that file does not exist, Nitr starts with built-in defaults rather than failing. |
| `--dev`                 | Turns on development mode — identical to `nitr dev`, and to `dev_mode = true` in the file.                                                   |
| `-v`, `--version`       | Print the version and exit.                                                                                                                  |
| `-h`, `--help`          | Print help. Works per command too: `nitr build --help`.                                                                                      |

> [!NOTE] Two commands never read the configuration
>
> [`init`](#init) runs before a `nitr.toml` exists — it is what _writes_
> one — and [`hash-password`](#hash-password) must work even when the
> file on disk is broken. Both return before the configuration is
> loaded, so `--config` is accepted (it is a global flag) and ignored.
> Every other command loads and validates the configuration first.

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
- On `SIGHUP` it rebuilds the Lua pool without dropping connections —
  and, with [`[tls] enabled`](./tls), re-reads the certificate and key.

## `dev`

```sh
nitr dev
```

`run` plus development mode:

- **Hot reload.** A file watcher rebuilds the Lua pool when you save a
  file the rebuild actually reads: a `.lua` source anywhere under the
  handler script's directory (which covers `require`d modules and
  `routes/`), the configuration script, or anything in the templates
  tree. No restart, no dropped connections.
- **Error details in responses.** A failing handler answers with the
  headline, the failing source line, the traceback and the cause chain —
  as HTML when the client accepts it, plain text otherwise. In
  production the same failure is exactly `Internal Server Error`.
- **Debug-level logging** by default, which turns on the inner spans
  (`pool_checkout`, `lua_handler`, `db_query`, `fetch`) so you can see
  where the time went.

The watcher is deliberately narrow. Static files are read from disk per
request and need no watching at all, and the database, its `-wal`/`-shm`
sidecars, editor swap files and logs are all ignored: they live inside
the watched directories, and reacting to them would turn one save into
an endless rebuild → write → rebuild loop.

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

It performs a real build, so it catches: unknown or contradictory
configuration keys, missing files and directories, an upload root the
process cannot write to, Lua syntax errors, route conflicts, a handler
script that forgets to `return app`, a pending migration, and a builtin
configured but not compiled into this binary.

> [!WARNING] The configuration script really runs
>
> `nitr check` builds the server for real, which means `config_script`
> executes once and its side effects happen. Do not put anything in it
> you would not want a CI job to do.

`--print-config` prints the **effective** configuration after file +
environment + flag layering — the answer to "which value actually won?"
— and returns before the build-time checks: the contradiction, path,
TLS and health checks, the Lua load, and the pending-migration check.
Parsing still happens first, so an unknown or renamed key — in the file
or in the environment — is still an error rather than a printed
configuration:

```sh
$ NITR_WORKERS=8 nitr check --print-config
dev_mode = false
handler_script = "app.lua"
listen = "127.0.0.1:3000"
trust_request_id = false
workers = 8

[cache]
default_ttl = 300
...
```

Top-level keys come first, then a table per section, both sorted by
name. Unset options are absent rather than empty: TOML has no null.

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
It also flags a migration **modified since it was applied** — the
database and the repository disagreeing about what the schema is.
Nitr will not re-run it; restore the file or write a new one.

Migrating is a separate step on purpose. Applying schema changes at boot
is how the two instances of a rolling deployment race to change the same
schema, each believing it is alone. The server **refuses to start while
a migration is pending**, which is what keeps the schema and the code
from quietly disagreeing. See [Database → Migrations](./database#migrations).

Needs the `db` Cargo feature; without it the command says so instead of
failing obscurely.

## `init`

```sh
nitr init                # into the current directory
nitr init my-app         # into my-app/
nitr init --minimal      # the bare-minimum version
```

Scaffolds a complete application: `nitr.toml`, `config.lua`, `app.lua`,
a route module, a migration, a template, a static page, a test, a
`.gitignore`, `data/.gitkeep`, and the generated `nitr-types.lua`
completions. See [Project layout](./project-layout).

The scaffold is most people's first and most-copied example, so it shows
the patterns worth copying — middleware, validation, `on_error`, a
migration, a test — rather than the smallest thing that runs. Route
files are wired with an explicit `require` in `app.lua`: no
auto-discovery, so the application's shape stays visible in one file.

`--minimal` writes only `nitr.toml`, `app.lua`, `public/index.html` and
one test (plus `nitr-types.lua`).

It **refuses to overwrite an existing file** — every target is checked
before anything is written, so running it in a non-empty directory
stops without leaving a half-scaffolded tree behind.

## `build`

```sh
nitr build --output myapp
```

Appends the whole application to a copy of the running binary: the
configuration file, every `.lua` under the handler script's directory,
the configuration script, `[templating] dir`, `[static] dir` and the
migrations directory. The result is one executable that no longer
depends on the directory it was built in.

- `dev_mode` is forced off: there are no source files to watch, only a
  temporary extraction.
- The **database stays external**, resolving against the working
  directory as always. State does not belong inside an immutable
  artifact — and neither do `[multipart] upload_dir` (uploads outlive
  the bundle that received them) or [`[tls] cert`/`key`](./tls), since a
  private key inside a copyable one-file artifact leaks with it. None of
  those three paths is re-anchored.
- A configuration file is required — the bundle records it as the
  application manifest.
- Everything archived must live inside the working directory: an
  absolute path or one climbing out with `..` is refused by name.

See [Single-file deploys](./deployment/single-file).

## `reload`

```sh
nitr reload
```

Sends `SIGHUP` to the process named by the configured `pidfile`, which
makes it rebuild the Lua runtime pool without dropping connections. The
listener, the process and its keep-alive connections all survive. With
TLS enabled this is also how a renewed certificate takes effect: the
reload re-reads both PEM files and swaps them in **only when the new
pair validates**, keeping the old material otherwise.

Requires `pidfile` to be set in `nitr.toml` — without it, `reload` has
no way to find the server and says so. Needs Unix signals, so it is
unavailable on Windows.

Equivalent to `kill -HUP <pid>`, and to systemd's `ExecReload`.

## `hash-password`

```sh
nitr hash-password                          # prompts, echo off, confirms
printf %s "$PASSWORD" | nitr hash-password  # for scripts and CI
```

Prints an **argon2id** hash (`m=19456, t=2, p=1`) for a password read
from a terminal prompt or from stdin, and prints nothing else — so
`nitr hash-password > cred.txt` and `HASH=$(nitr hash-password)` both
give exactly the string you store.

```
$ nitr hash-password
Password:
Confirm password:
$argon2id$v=19$m=19456,t=2,p=1$m9z1df0eQ2iTUMTMdNG9Lg$orLEhw5SZE3dVnKDfo0npcOXvrw/pBGD2eHhFVLFwMo
```

It hashes by calling the very `nitr.crypto.password_hash` a handler
calls, so the parameters have exactly one definition in the codebase and
an operator-minted credential can never drift from what the running
server verifies. That also means it needs the `crypto` Cargo feature
(included in `all`, which is what the published binary ships with).

### No application, no configuration

This is the one command that runs with **neither**. It is what an
operator reaches for _before_ there is a working `nitr.toml` — seeding
the first admin credential, rotating one during an incident — and a
broken configuration file must not stand between them and a credential.
`nitr hash-password` therefore returns before the configuration is
loaded at all, exactly like [`init`](#init).

That is also why hashing belongs here rather than in a startup script:
`nitr.crypto.password_hash` is **async** (the argon2 work runs on the
blocking pool) and cannot be called from the top level of a handler
script, and a deployment that hashes per boot pays argon2's cost for
something a migration should have done once. See
[Passwords](./passwords).

### There is deliberately no `--password` flag

A password in `argv` is readable by every process on the box through
`/proc/<pid>/cmdline`, shows up in `ps`, and is written to the shell
history file afterwards — three places a credential outlives the command
that used it, none of them obvious at the moment of typing. A terminal
prompt covers the interactive case and a pipe covers the scripted one.

At the prompt the value is asked twice: a typo becomes a credential
nobody can ever use, and the only symptom is a login that always fails.
The prompt goes to **stderr**, not through the logger — it is
interactive UI, so it must appear whatever the log level is, must not be
timestamped or shipped to a collector, and must stay out of the stdout
the caller is capturing.

When piping, only **one trailing line ending** is removed (`\n`, with
its optional `\r`). A password may legitimately end in a space or a tab,
and trimming those would silently mint a hash that never verifies — so
prefer `printf %s` over `echo`.

The input is bounded by the same 1024-byte cap
(`nitr.crypto.max_password_bytes`) the server enforces at verify time: a
password the server would refuse must not be mintable here, and
`nitr hash-password < /dev/zero` must be a clear error rather than an
out-of-memory kill. An empty password is refused outright.

> [!WARNING] Ctrl-C at the prompt leaves echo off
>
> Terminal echo is restored when the command ends, including on the
> error path — but `SIGINT`'s default handler kills the process before
> any cleanup runs. If you interrupt the prompt, your shell will swallow
> input until you run `stty echo` (or `reset`).

> [!NOTE] Echo can only be turned off where `stty` works
>
> Echo is toggled by running `stty`, not by calling into libc — Nitr's
> workspace forbids `unsafe`, and one terminal flag does not justify a
> dependency. Where `stty` is missing or fails, and on platforms that do
> not have it at all, the password is read with echo **on** and the
> prompt says so: `(warning: this terminal is echoing)`. Visibly
> degraded beats refusing to run.

## Exit codes

| Code | Meaning                                                                                     |
| ---- | ------------------------------------------------------------------------------------------- |
| `0`  | Success — including a clean, complete graceful drain.                                       |
| `1`  | Any failure: a configuration or script error, a failing test, a drain that ran out of time. |

`[log] format = "json"` and exit codes are the machine-readable
contract; the human-readable output text is not an API. See
[Stability](../stability).

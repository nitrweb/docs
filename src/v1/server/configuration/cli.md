# Command-Line Flags

CLI flags are the **strongest** configuration layer: they beat
`NITR_*` environment variables, which beat `nitr.toml`, which beats the
built-in defaults.

Nitr keeps the flag surface deliberately small. Anything that belongs in
a deployment's configuration belongs in [`nitr.toml`](./file) or an
[environment variable](./env), where it can be reviewed and diffed.

## Global flags

Available on every command.

| Flag                    | Description                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `-c`, `--config <PATH>` | The TOML configuration file. Default: `./nitr.toml` — and if that file does not exist, Nitr runs with built-in defaults rather than failing. |
| `--dev`                 | Development mode: hot reload and error details in responses. Equivalent to `dev_mode = true` and to the `nitr dev` command.                  |
| `-v`, `--version`       | Print the version and exit.                                                                                                                  |
| `-h`, `--help`          | Print help. Works per command: `nitr build --help`.                                                                                          |

```sh
nitr --config /srv/app/nitr.toml run
nitr -c /srv/app/nitr.toml --dev
```

## Per-command flags

| Command   | Flag                    | Description                                                                    |
| --------- | ----------------------- | ------------------------------------------------------------------------------ |
| `check`   | `--print-config`        | Print the effective configuration after file + env + flag layering, then exit. |
| `test`    | `--filter <SUBSTRING>`  | Run only tests whose name or file name contains the substring.                 |
| `migrate` | `--status`              | Report applied and pending migrations, applying nothing.                       |
| `init`    | `[DIR]`                 | Directory to scaffold into. Default: the current directory.                    |
| `init`    | `--minimal`             | Write the four-file version instead of the full layout.                        |
| `build`   | `-o`, `--output <PATH>` | **Required.** Path of the single-file artifact to write.                       |

Full descriptions of each command are in [CLI commands](../cli).

## Signals

Not flags, but the other half of the runtime control surface:

| Signal               | Effect                                                                                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SIGHUP`             | Zero-downtime reload: rebuilds the Lua runtime pool. The process, listener and keep-alive connections survive. Also reachable as [`nitr reload`](../cli#reload).     |
| `SIGTERM` / `SIGINT` | Graceful shutdown: stop accepting → flip `/readyz` to `503 draining` → let in-flight work finish within `[shutdown] grace` → exit. A truncated drain exits non-zero. |

## Worked examples

**Run a specific application from anywhere.** Paths inside the file
resolve against the file's own directory:

```sh
nitr -c /srv/app/nitr.toml run
```

**Develop against production-shaped configuration**, without editing it:

```sh
nitr --dev -c nitr.production.toml
```

**Validate in CI**, no port bound, no database touched:

```sh
nitr -c nitr.toml check
```

**Debug the layering**, when a value is not what you expected:

```sh
NITR_WORKERS=8 nitr check --print-config | grep workers
# workers = 8
```

**Run one test while iterating:**

```sh
nitr test --filter "rejects an empty note"
```

**Build the deployable artifact:**

```sh
nitr -c nitr.production.toml build --output myapp
```

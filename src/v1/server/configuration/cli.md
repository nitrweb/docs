# Command-Line Flags

Flags are the strongest configuration layer: they beat `NITR_*`
environment variables, which beat `nitr.toml`, which beats the built-in
defaults. The flag list is short on purpose; everything else lives in
[`nitr.toml`](./file) or [environment variables](./env).

## Global flags

Accepted by every command.

| Flag                    | Description                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `-c`, `--config <PATH>` | The configuration file. Default: `./nitr.toml`. If that file does not exist, the defaults are used. |
| `--dev`                 | Development mode. Same as `nitr dev` or `dev_mode = true`.                                          |
| `-v`, `--version`       | Print the version and exit.                                                                         |
| `-h`, `--help`          | Print help. Also per command: `nitr build --help`.                                                  |

```sh
nitr -c /srv/app/nitr.toml run
nitr --dev -c nitr.production.toml
```

`--config` does not change how relative paths inside the file resolve:
they are relative to the working directory. See
[nitr.toml](./file). `init` and `hash-password` never read the
configuration, so `--config` has no effect on them.

## Per-command flags

| Command   | Flag                    | Description                                                         |
| --------- | ----------------------- | ------------------------------------------------------------------- |
| `check`   | `--print-config`        | Print the final configuration after all layers, then exit.          |
| `test`    | `--filter <SUBSTRING>`  | Run only tests whose name or file name contains the text.           |
| `test`    | `--bail`                | Stop at the first failing test.                                     |
| `test`    | `--list`                | List tests with their `file:line`, without running them.            |
| `test`    | `--watch`               | Run again on file changes, until Ctrl-C.                            |
| `test`    | `--reporter <REPORTER>` | `pretty` (default), `json` or `junit`.                              |
| `test`    | `-o`, `--output <FILE>` | Write the JSON/JUnit report to a file.                              |
| `test`    | `--nocapture`           | Print log lines as they happen.                                     |
| `openapi` | `-o`, `--output <PATH>` | Write the document to a file instead of stdout.                     |
| `openapi` | `--check`               | Exit 1 if the generated document differs from the saved one.        |
| `openapi` | `--ui <DIR>`            | Write a static Swagger UI site.                                     |
| `migrate` | `--status`              | Show applied, pending and modified migrations without applying any. |
| `init`    | `[DIR]`                 | Directory to create the app in. Default: the current directory.     |
| `init`    | `--minimal`             | Write the bare-minimum app.                                         |
| `build`   | `-o`, `--output <PATH>` | **Required.** Path of the executable to write.                      |

`run`, `dev`, `reload` and `hash-password` have no flags of their own.
Each command is described in [CLI commands](../cli).

## Signals

| Signal               | Effect                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `SIGHUP`             | Reload the Lua scripts (and TLS certificate) without dropping connections. Same as [`nitr reload`](../cli#reload).       |
| `SIGTERM` / `SIGINT` | Graceful shutdown: stop accepting, report `/readyz` as `503`, finish in-flight requests within `[shutdown] grace`, exit. |

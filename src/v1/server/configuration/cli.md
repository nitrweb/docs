# Command-Line Flags

CLI flags are the **strongest** configuration layer: they beat
`NITR_*` environment variables, which beat `nitr.toml`, which beats the
built-in defaults.

Nitr keeps the flag surface deliberately small. Anything that belongs in
a deployment's configuration belongs in [`nitr.toml`](./file) or an
[environment variable](./env), where it can be reviewed and diffed.

## Global flags

Declared globally, so they are accepted on every command.

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

> [!NOTE] `init` and `hash-password` ignore `--config`
>
> Both return before the configuration is loaded — `init` is what
> _writes_ a `nitr.toml`, and `hash-password` has to work when the one
> on disk is broken. `--config` is accepted on them because it is a
> global flag, and has no effect. Every other command loads and
> validates the configuration first.

## Per-command flags

| Command         | Flag                    | Description                                                                    |
| --------------- | ----------------------- | ------------------------------------------------------------------------------ |
| `check`         | `--print-config`        | Print the effective configuration after file + env + flag layering, then exit. |
| `test`          | `--filter <SUBSTRING>`  | Run only tests whose name or file name contains the substring.                 |
| `migrate`       | `--status`              | Report applied, pending and modified migrations, applying nothing.             |
| `init`          | `[DIR]`                 | Directory to scaffold into. Default: the current directory.                    |
| `init`          | `--minimal`             | Write the bare-minimum scaffold instead of the full layout.                    |
| `build`         | `-o`, `--output <PATH>` | **Required.** Path of the single-file artifact to write.                       |
| `hash-password` | —                       | None. The password comes from a prompt or from stdin, never from `argv`.       |

`run`, `dev` and `reload` have no flags of their own either: everything
they need is in the configuration.

Full descriptions of each command are in [CLI commands](../cli).

## Signals

Not flags, but the other half of the runtime control surface:

| Signal               | Effect                                                                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SIGHUP`             | Zero-downtime reload: rebuilds the Lua runtime pool and, with TLS enabled, re-reads the certificate and key. The process, listener and keep-alive connections survive. Also reachable as [`nitr reload`](../cli#reload). |
| `SIGTERM` / `SIGINT` | Graceful shutdown: stop accepting → flip `/readyz` to `503 draining` → let in-flight work finish within `[shutdown] grace` → exit. A truncated drain exits non-zero.                                                     |

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

**Validate in CI**, no port bound:

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

**Mint a credential before the application exists.** This is the one
command that needs neither an application nor a configuration file:

```sh
printf %s "$ADMIN_PASSWORD" | nitr hash-password
# $argon2id$v=19$m=19456,t=2,p=1$...
```

Store that string; never store the password. See
[Passwords](../passwords).

**Point a deployment at its own certificate**, keeping one `nitr.toml`
for every environment:

```sh
NITR_TLS_ENABLED=true \
NITR_TLS_CERT=/etc/nitr/tls/fullchain.pem \
NITR_TLS_KEY=/etc/nitr/tls/privkey.pem \
  nitr run
```

**Build the deployable artifact:**

```sh
nitr -c nitr.production.toml build --output myapp
```

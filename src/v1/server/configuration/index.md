# Configuration

Nitr reads its settings from four layers. The strongest wins:

```
CLI flags  >  NITR_* environment variables  >  nitr.toml  >  built-in defaults
```

| Layer       | Page                           | Example                            |
| ----------- | ------------------------------ | ---------------------------------- |
| CLI flags   | [Flags](./cli)                 | `nitr --dev -c /srv/app/nitr.toml` |
| Environment | [Environment variables](./env) | `NITR_LISTEN=0.0.0.0:8080`         |
| File        | [nitr.toml](./file)            | `listen = "127.0.0.1:3000"`        |
| Defaults    | [Server defaults](../defaults) | `127.0.0.1:3000`                   |

Every setting is optional. With no `nitr.toml`, Nitr listens on
`127.0.0.1:3000` and runs `scripts/handler.lua`.

## A typical configuration

```toml
listen = "127.0.0.1:3000"
handler_script = "app.lua"
config_script = "config.lua"
pidfile = "/run/nitr/nitr.pid"

[database]
path = "data/app.db"

[templating]
dir = "templates"

[static]
dir = "public"

[cookies]
secure = "always"    # TLS ends at a proxy in front of Nitr

[std]
features = ["json", "http", "log", "time", "validate", "db", "template", "crypto"]

[rate_limit]
enabled = true

[log]
format = "json"
```

Every section and key is documented in [nitr.toml](./file).

## Which value won?

```sh
nitr check --print-config
```

prints the final configuration after all layers, without starting the
server. See [`nitr check`](../cli#check).

## Validation

Nitr checks the configuration at startup and **refuses to start** when
something is wrong, instead of guessing. For example:

- an unknown key (a typo such as `hander_script`);
- settings that conflict, such as `[cors] credentials = true` with
  `origins = ["*"]`, or `max_streams` above `workers`;
- a configured file or directory that is missing or unusable;
- `[multipart] upload_dir` inside the scripts or templates directory, or
  `[static] dir` containing the scripts;
- a `[std]` feature that is unknown, missing its section, or not
  compiled into the binary;
- a pending database migration.

A few risky but valid setups only log a warning, for example cookies
that will not be `Secure` (see
[`[cookies]`](./file#cookies)). The error or warning always names the
setting. Run [`nitr check`](../cli#check) in CI to catch all of this
before deploying.

## Secrets

Keep secrets out of `nitr.toml`, since you commit it. Put them in the
process environment or a `.env` file, and read them in Lua with the
opt-in [`nitr.env`](./env#the-nitr-env-builtin) builtin:

```toml
[std]
features = ["json", "http", "log", "env"]

[env]
allow = ["APP_", "API_TOKEN"]
```

```lua
local token = nitr.env.get("API_TOKEN")
```

For login passwords, store only a hash made with
[`nitr hash-password`](../cli#hash-password). See
[Passwords](../passwords).

## Enabling builtins

`[std] features` decides which `nitr.*` modules exist. The default is
`json`, `http`, `log`, `time`, `validate`, `base64`, `path` and `url`;
add `db`, `fetch`, `template`, `crypto`, `cache`, `dbg` or `env` as
needed. See [nitr.toml → \[std\]](./file#std).

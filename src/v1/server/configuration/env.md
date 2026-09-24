# Environment Variables

Environment variables play two roles in Nitr:

|                        | Read by                          | Purpose                               |
| ---------------------- | -------------------------------- | ------------------------------------- |
| **`NITR_*` variables** | the **server**, at startup       | override `nitr.toml` values           |
| **`nitr.env`**         | your **Lua scripts**, at runtime | read your application's own variables |

## `NITR_*`: overriding the configuration

A `NITR_*` variable overrides the matching `nitr.toml` key, and a CLI
flag overrides both. Top-level keys use their plain names; section keys
are `NITR_<SECTION>_<KEY>`.

```sh
NITR_LISTEN=0.0.0.0:8080 NITR_WORKERS=8 NITR_LOG_FORMAT=json nitr run
```

| Variable                   | Key                     | Example                   |
| -------------------------- | ----------------------- | ------------------------- |
| `NITR_LISTEN`              | `listen`                | `0.0.0.0:8080`            |
| `NITR_HANDLER_SCRIPT`      | `handler_script`        | `app.lua`                 |
| `NITR_CONFIG_SCRIPT`       | `config_script`         | `config.lua`              |
| `NITR_WORKERS`             | `workers`               | `8`                       |
| `NITR_MAX_STREAMS`         | `max_streams`           | `4`                       |
| `NITR_DEV_MODE`            | `dev_mode`              | `true`                    |
| `NITR_PIDFILE`             | `pidfile`               | `/run/nitr/nitr.pid`      |
| `NITR_DATABASE_PATH`       | `[database] path`       | `/var/lib/nitr/app.db`    |
| `NITR_TEMPLATING_DIR`      | `[templating] dir`      | `templates`               |
| `NITR_TESTING_DIR`         | `[testing] dir`         | `tests`                   |
| `NITR_TESTING_DATABASE`    | `[testing] database`    | `data/test.db`            |
| `NITR_ENV_FILE`            | `[env] file`            | `/etc/nitr/app.env`       |
| `NITR_LUA_MEMORY_LIMIT`    | `[lua] memory_limit`    | `16777216`                |
| `NITR_LUA_EXEC_TIMEOUT_MS` | `[lua] exec_timeout_ms` | `30000`                   |
| `NITR_LIMITS_POOL_WAIT_MS` | `[limits] pool_wait_ms` | `5000`                    |
| `NITR_SHUTDOWN_GRACE`      | `[shutdown] grace`      | `30`                      |
| `NITR_COMPRESSION_ENABLED` | `[compression] enabled` | `true`                    |
| `NITR_TLS_ENABLED`         | `[tls] enabled`         | `true`                    |
| `NITR_TLS_CERT`            | `[tls] cert`            | `/etc/nitr/fullchain.pem` |
| `NITR_TLS_KEY`             | `[tls] key`             | `/etc/nitr/privkey.pem`   |
| `NITR_TLS_MIN_VERSION`     | `[tls] min_version`     | `1.3`                     |
| `NITR_OPENAPI_ENABLED`     | `[openapi] enabled`     | `false`                   |
| `NITR_OPENAPI_PATH`        | `[openapi] path`        | `/openapi.json`           |
| `NITR_SWAGGER_ENABLED`     | `[swagger] enabled`     | `false`                   |
| `NITR_SWAGGER_PATH`        | `[swagger] path`        | `/docs`                   |
| `NITR_LOG_FORMAT`          | `[log] format`          | `json` or `text`          |
| `NITR_LOG_LEVEL`           | `[log] level`           | `info,nitr_http=debug`    |

This is the complete list. Other keys (for example anything in
`[cors]`, `[static]` or `[fetch]`) can only be set in `nitr.toml`. An
unknown `NITR_*` name is silently ignored, so check with
`nitr check --print-config` when a value seems to have no effect.

Rules:

- **Empty means unset.** `NITR_WORKERS=` leaves the `nitr.toml` value in
  place.
- **Bad values stop startup** and name the variable, for example
  `invalid value for NITR_WORKERS: invalid digit found in string`.
- **Booleans are `true` or `false` only.** `1`, `yes` and `on` are
  errors.
- `NITR_LISTEN` needs a host and a port; IPv6 goes in brackets:
  `[::1]:3000`.
- `NITR_DATABASE_PATH` changes only the path. Without a `[database]`
  section it creates one with the defaults.
- `NITR_ENV_FILE` is only read from the real environment, not from an
  env file.

### TLS through the environment

Certificate paths often differ per machine, so one `nitr.toml` can be
pointed at each machine's files:

```sh
NITR_TLS_ENABLED=true \
NITR_TLS_CERT=/etc/nitr/tls/fullchain.pem \
NITR_TLS_KEY=/etc/nitr/tls/privkey.pem \
  nitr run
```

The usual `[tls]` checks still apply. In the same way,
`NITR_OPENAPI_ENABLED=false NITR_SWAGGER_ENABLED=false` turns the API
docs off in production.

> [!NOTE] Renamed variables are refused
>
> `NITR_DATABASE`, `NITR_POOL_WAIT_MS`, `NITR_COMPRESSION` and
> `NITR_TEMPLATES_DIR` stop startup with an error naming the new
> variable (`NITR_DATABASE_PATH`, `NITR_LIMITS_POOL_WAIT_MS`,
> `NITR_COMPRESSION_ENABLED`, `NITR_TEMPLATING_DIR`).

### Other variables Nitr reads

| Variable                                   | Effect                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `RUST_LOG`                                 | Overrides `[log] level` (`tracing` filter syntax).                                          |
| `NO_COLOR`                                 | Any non-empty value turns off colored output.                                               |
| `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` | Proxy for [`nitr.fetch`](../fetch) when `[fetch] proxy` is unset and `no_proxy` is `false`. |

## The env file

At startup Nitr loads a dotenv-style file into the process environment,
before applying `NITR_*` overrides. It can hold both `NITR_*` settings
and your own variables.

```ini
# .env
API_TOKEN=s3cret
NITR_WORKERS=8
```

Which file is loaded, strongest first:

1. `NITR_ENV_FILE`;
2. `[env] file` in `nitr.toml`;
3. `.env` next to `nitr.toml`, if it exists.

A file named by 1 or 2 must exist. Values in the file **never replace**
variables already set in the real environment. Relative paths resolve
against the directory of `nitr.toml`, except in a
[`nitr build`](../deployment/single-file) executable, where they resolve
against the working directory.

## The `nitr.env` builtin

Reading environment variables from Lua is opt-in:

```toml
[std]
features = ["json", "http", "log", "env"]   # add "env"

[env]
allow = ["APP_", "API_TOKEN"]
```

```lua
local token   = nitr.env.get("API_TOKEN")             -- string or nil
local region  = nitr.env.get("APP_REGION", "eu-west") -- with a default
local workers = nitr.env.number("APP_WORKERS", 4)     -- number
local beta    = nitr.env.bool("APP_BETA", false)      -- boolean
local present = nitr.env.has("API_TOKEN")             -- boolean
```

| Function                          | Returns                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `nitr.env.get(name, default?)`    | The value, or the default (`nil` without one).                                                                |
| `nitr.env.has(name)`              | Whether the variable is set and allowed.                                                                      |
| `nitr.env.number(name, default?)` | The value as a number; the default if unset or not a number.                                                  |
| `nitr.env.bool(name, default?)`   | `true` for `1`/`true`/`yes`/`on`, `false` for `0`/`false`/`no`/`off`/empty (any case); otherwise the default. |

- There is no setter and no way to list variables.
- `[env] allow` limits what can be read: exact names, or prefixes ending
  in `_`. Unset allows everything except `NITR_*`.
- `NITR_*` variables are never visible to scripts.
- A blocked name behaves exactly like an unset one.

> [!TIP] Read secrets once, in `config.lua`
>
> ```lua
> -- config.lua
> local token = nitr.env.get("API_TOKEN")
> assert(token, "API_TOKEN is not set")
> return { api_token = token }
> ```
>
> Handlers then use `nitr.cfg.api_token`, and a missing variable stops
> startup instead of failing on the first request.

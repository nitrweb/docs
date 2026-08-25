# Environment Variables

Two different things share the word "environment" in Nitr, and it is
worth separating them up front:

|                        | Who reads it                     | Purpose                               |
| ---------------------- | -------------------------------- | ------------------------------------- |
| **`NITR_*` variables** | the **server**, at startup       | override `nitr.toml` values           |
| **`nitr.env`**         | your **Lua scripts**, at runtime | read your own application's variables |

## `NITR_*` — overriding the configuration

Every `NITR_*` variable overrides the corresponding `nitr.toml` value,
and is in turn overridden by a CLI flag.

**Naming rule:** top-level keys keep their plain names; a sectioned
option is `NITR_<SECTION>_<OPTION>`.

### Top-level

| Variable              | Key              | Example              |
| --------------------- | ---------------- | -------------------- |
| `NITR_LISTEN`         | `listen`         | `0.0.0.0:8080`       |
| `NITR_HANDLER_SCRIPT` | `handler_script` | `app.lua`            |
| `NITR_CONFIG_SCRIPT`  | `config_script`  | `config.lua`         |
| `NITR_WORKERS`        | `workers`        | `8`                  |
| `NITR_MAX_STREAMS`    | `max_streams`    | `4`                  |
| `NITR_DEV_MODE`       | `dev_mode`       | `true`               |
| `NITR_PIDFILE`        | `pidfile`        | `/run/nitr/nitr.pid` |

### Sectioned

| Variable                   | Key                               |
| -------------------------- | --------------------------------- |
| `NITR_DATABASE_PATH`       | `[database] path`                 |
| `NITR_TEMPLATING_DIR`      | `[templating] dir`                |
| `NITR_TESTING_DIR`         | `[testing] dir`                   |
| `NITR_ENV_FILE`            | `[env] file`                      |
| `NITR_LUA_MEMORY_LIMIT`    | `[lua] memory_limit`              |
| `NITR_LUA_EXEC_TIMEOUT_MS` | `[lua] exec_timeout_ms`           |
| `NITR_LIMITS_POOL_WAIT_MS` | `[limits] pool_wait_ms`           |
| `NITR_SHUTDOWN_GRACE`      | `[shutdown] grace`                |
| `NITR_COMPRESSION_ENABLED` | `[compression] enabled`           |
| `NITR_LOG_FORMAT`          | `[log] format` (`text` \| `json`) |
| `NITR_LOG_LEVEL`           | `[log] level`                     |

```sh
NITR_LISTEN=0.0.0.0:8080 NITR_WORKERS=8 NITR_LOG_FORMAT=json nitr run
```

> [!TIP] Confirm what won
>
> ```sh
> NITR_WORKERS=8 nitr check --print-config
> ```
>
> prints the effective configuration after the whole layering.

### Renamed variables fail loudly

Four names were renamed, and the old spelling is **refused with the
replacement spelled out** rather than silently ignored — a stale
deployment manifest should not turn into a configuration mystery:

| Old                  | New                        |
| -------------------- | -------------------------- |
| `NITR_DATABASE`      | `NITR_DATABASE_PATH`       |
| `NITR_POOL_WAIT_MS`  | `NITR_LIMITS_POOL_WAIT_MS` |
| `NITR_COMPRESSION`   | `NITR_COMPRESSION_ENABLED` |
| `NITR_TEMPLATES_DIR` | `NITR_TEMPLATING_DIR`      |

### Other variables Nitr respects

| Variable                     | Effect                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| `RUST_LOG`                   | Overrides `[log] level`. Takes the usual `tracing` filter syntax (`info,nitr_http=debug`). |
| `NO_COLOR`                   | Any non-empty value disables ANSI colouring in the human-readable log output.              |
| `HTTPS_PROXY` / `HTTP_PROXY` | Used by [`nitr.fetch`](../fetch) when `[fetch] proxy` is unset and `no_proxy` is false.    |

## The env file

A dotenv-style file is loaded into the process environment at startup,
before the `NITR_*` pass runs — so it can supply `NITR_*` overrides as
well as your own application variables.

```toml
[env]
file = ".env"
```

```ini
# .env
DATABASE_URL=…
API_TOKEN=s3cret
NITR_WORKERS=8
```

**Which file is loaded**, strongest first:

1. `NITR_ENV_FILE` — names the file outright, and can only come from the
   real environment;
2. `[env] file` from `nitr.toml`;
3. an implicit `.env` next to `nitr.toml`.

Two rules follow from that list:

- **An explicitly named file must exist** (either of the first two); the
  implicit `.env` may simply be absent.
- **Loading never overwrites** a variable already present in the real
  process environment. The file is a default, not an override.

> [!NOTE] Where relative paths resolve
>
> Against the directory `nitr.toml` lives in. For a [bundled
> build](../deployment/single-file) the config lives in a temporary
> extraction directory, so the env file resolves against the **working
> directory** instead — it is external state, like the database.

## The `nitr.env` builtin

Reading environment variables from Lua is **opt-in**, and deliberately
narrow.

```toml
[std]
features = ["json", "http", "log", "env"]   # ← add "env"

[env]
allow = ["APP_", "API_TOKEN"]
```

```lua
local token   = nitr.env.get("API_TOKEN")             -- string | nil
local region  = nitr.env.get("APP_REGION", "eu-west") -- with a default
local workers = nitr.env.number("APP_WORKERS", 4)     -- parsed number
local beta    = nitr.env.bool("APP_BETA", false)      -- 1/true/yes/on
local present = nitr.env.has("API_TOKEN")             -- boolean
```

| Function                          | Returns                                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `nitr.env.get(name, default?)`    | The value, or the default (`nil` without one).                                                 |
| `nitr.env.has(name)`              | Whether the variable is set **and readable** — a policy-hidden name reports `false`.           |
| `nitr.env.number(name, default?)` | Parsed number; unset or unparseable answers the default.                                       |
| `nitr.env.bool(name, default?)`   | `1`/`true`/`yes`/`on` and `0`/`false`/`no`/`off`, any case; anything else answers the default. |

### The policy

- **Getters only.** No setter, and no enumeration — a script cannot dump
  the environment to find out what is there.
- **`[env] allow` filters reads.** Entries are exact names, or prefixes
  ending in `_`. Unset means "any variable except `NITR_*`".
- **`NITR_*` is never visible to scripts**, allow-list or not. Server
  internals are not application data.

> [!TIP] Read secrets once, in `config.lua`
>
> ```lua
> -- config.lua
> return { api_token = nitr.env.get("API_TOKEN") }
> ```
>
> Handlers then use `nitr.cfg.api_token`. One read at startup, and a
> missing variable fails at startup rather than on the first request
> that happens to need it.

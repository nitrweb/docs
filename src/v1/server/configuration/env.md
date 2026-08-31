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

| Variable                   | Key                     | Example                   |
| -------------------------- | ----------------------- | ------------------------- |
| `NITR_DATABASE_PATH`       | `[database] path`       | `/var/lib/nitr/app.db`    |
| `NITR_TEMPLATING_DIR`      | `[templating] dir`      | `templates`               |
| `NITR_TESTING_DIR`         | `[testing] dir`         | `tests`                   |
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
| `NITR_LOG_FORMAT`          | `[log] format`          | `json` (or `text`)        |
| `NITR_LOG_LEVEL`           | `[log] level`           | `info,nitr_http=debug`    |

```sh
NITR_LISTEN=0.0.0.0:8080 NITR_WORKERS=8 NITR_LOG_FORMAT=json nitr run
```

> [!NOTE] Those two tables are the whole list
>
> There is no generic TOML-key-to-variable mapping — the overrides are
> enumerated one by one in the source, and only those are read. Sections
> that appear nowhere above (`[cors]`, `[rate_limit]`, `[static]`,
> `[health]`, `[cookies]`, `[multipart]`, `[fetch]`, `[cache]`) have no
> environment override at all, and a section that _does_ appear is
> covered only for the option named: `NITR_SHUTDOWN_GRACE` exists,
> `stream_grace` has no variable. Everything else lives in
> [`nitr.toml`](./file).
>
> An unrecognized `NITR_SOMETHING` is simply ignored, so a typo shows up
> as "my value did nothing" rather than as an error. `nitr check
--print-config` is how you tell the difference.

### Rules that apply to all of them

- **An empty value means unset.** `NITR_WORKERS=` in a systemd unit or a
  CI matrix reads as "I did not set this", not as "set it to nothing",
  so the `nitr.toml` value survives. That is the same rule for the real
  environment and for a `.env` file.
- **A value that will not parse fails at startup, naming the variable**
  — `invalid value for NITR_WORKERS: invalid digit found in string`.
  A misconfigured deployment stops instead of silently running on a
  default nobody chose.
- **Booleans are spelled `true` and `false`.** `NITR_DEV_MODE`,
  `NITR_COMPRESSION_ENABLED` and `NITR_TLS_ENABLED` are parsed as Rust
  booleans, so `1`, `yes` and `on` are **errors**, not synonyms. (The
  `nitr.env` builtin described below is the lenient one; these are not.)
- `NITR_LISTEN` must be a full socket address — host **and** port, with
  an IPv6 address in brackets: `[::1]:3000`.
- `NITR_DATABASE_PATH` overrides only the path. The pragmas
  (`journal_mode`, `busy_timeout`, …) stay as configured, and if there
  is no `[database]` section at all the variable creates one with the
  defaults.
- `NITR_LOG_FORMAT` accepts exactly `text` or `json`; anything else is a
  startup error that says so.

> [!TIP] Confirm what won
>
> ```sh
> NITR_WORKERS=8 nitr check --print-config
> ```
>
> prints the effective configuration after the whole layering.

### TLS through the environment

The four `NITR_TLS_*` variables exist because certificate paths are
deployment facts, not application facts: the same `nitr.toml` ships to a
staging box and a production one whose ACME client writes elsewhere.

```sh
NITR_TLS_ENABLED=true \
NITR_TLS_CERT=/etc/nitr/tls/fullchain.pem \
NITR_TLS_KEY=/etc/nitr/tls/privkey.pem \
  nitr run
```

They set the values, they do not relax the checks. `NITR_TLS_ENABLED=true`
still requires both paths, still requires both files to be readable at
startup, still requires a binary built with the `tls` Cargo feature, and
`NITR_TLS_MIN_VERSION` still accepts only `1.2` or `1.3`. Enabling TLS
also **converts** the single listener rather than adding one — nothing
answers plaintext afterwards. See [TLS](../tls).

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

The refusal is checked before any override is applied, so the error
names the stale variable rather than whatever it happened to break. An
old name left in place but **empty** is unset like any other, and does
not trip the check.

### Other variables Nitr respects

| Variable                                   | Effect                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `RUST_LOG`                                 | Overrides `[log] level`. Takes the usual `tracing` filter syntax (`info,nitr_http=debug`). |
| `NO_COLOR`                                 | Any non-empty value disables ANSI colouring in the human-readable log output.              |
| `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` | Used by [`nitr.fetch`](../fetch) when `[fetch] proxy` is unset and `no_proxy` is false.    |

Colour is one decision, not several: JSON log output never carries ANSI,
a pipe or a log shipper gets byte-clean plain text, and `NO_COLOR` turns
it off everywhere at once — log lines, painted diagnostics and the test
runner's markers alike.

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

| Function                          | Returns                                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `nitr.env.get(name, default?)`    | The value, or the default (`nil` without one).                                                       |
| `nitr.env.has(name)`              | Whether the variable is set **and readable** — a policy-hidden name reports `false`.                 |
| `nitr.env.number(name, default?)` | Parsed number; unset or unparseable answers the default.                                             |
| `nitr.env.bool(name, default?)`   | `1`/`true`/`yes`/`on` and `0`/`false`/`no`/`off`/empty, any case; anything else answers the default. |

### The policy

- **Getters only.** No setter, and no enumeration — a script cannot dump
  the environment to find out what is there.
- **`[env] allow` filters reads.** Entries are exact names, or prefixes
  ending in `_`. Unset means "any variable except `NITR_*`".
- **`NITR_*` is never visible to scripts**, allow-list or not. Server
  internals are not application data.
- A hidden name is indistinguishable from an unset one: `get` answers
  the default and `has` answers `false`, so a script cannot probe the
  policy for what exists behind it.

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

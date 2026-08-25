# Configuration

Nitr reads its configuration from three places and layers them in a
fixed order.

## Precedence

**Strongest first:**

```
CLI flags  >  NITR_* environment variables  >  nitr.toml  >  built-in defaults
```

| Layer       | Page                           | Example                            |
| ----------- | ------------------------------ | ---------------------------------- |
| CLI flags   | [Flags](./cli)                 | `nitr --dev -c /srv/app/nitr.toml` |
| Environment | [Environment variables](./env) | `NITR_LISTEN=0.0.0.0:8080`         |
| File        | [nitr.toml](./file)            | `listen = "127.0.0.1:3000"`        |
| Defaults    | [Server defaults](../defaults) | `127.0.0.1:3000`                   |

Every setting is optional. With no `nitr.toml` at all, Nitr listens on
`127.0.0.1:3000` and runs `scripts/handler.lua`.

## Which value won?

Do not guess — ask:

```sh
nitr check --print-config
```

It prints the effective configuration after the whole layering, in TOML,
without binding a port.

```sh
$ NITR_WORKERS=8 nitr check --print-config
listen = "127.0.0.1:3000"
handler_script = "app.lua"
workers = 8
...
```

## Configuration is validated strictly

This is a design decision, not an inconvenience. Nitr **refuses to
start** when:

- a key is **unknown** — a typo like `hander_script` is an error, not a
  silently ignored line, and a key removed in a later version is a loud
  failure rather than a behaviour change you never noticed;
- two settings **contradict** each other — `[cors] credentials = true`
  together with `origins = ["*"]`, for instance;
- a configured **path does not exist**;
- a `[std]` feature is listed but its configuration is missing — `"db"`
  without a `[database]` section;
- a `[std]` feature is listed but **was not compiled into this binary**
  — the error names the Cargo feature to enable;
- a **migration is pending**.

> [!TIP] Put `nitr check` in CI
>
> It catches all of the above without a port, a database or a network.
> A deploy that fails in CI is cheaper than one that fails at startup.

## A minimal configuration

```toml
listen = "127.0.0.1:3000"
handler_script = "app.lua"
```

## A realistic one

```toml
listen = "0.0.0.0:3000"
handler_script = "app.lua"
config_script = "config.lua"
pidfile = "/run/nitr/nitr.pid"

[database]
path = "data/app.db"

[templating]
dir = "templates"

[static]
dir = "public"
mount = "/"

[std]
features = ["json", "http", "log", "time", "validate", "db", "template", "crypto"]

[limits]
max_body_bytes = 2097152

[rate_limit]
enabled = true
requests = 120
window = 60

[log]
format = "json"
```

Every section, key and default is documented in
[nitr.toml](./file).

## Secrets

Do not put secrets in `nitr.toml` — it is the file you commit. Two
supported ways in:

**A dotenv-style file**, loaded at startup and never overriding the real
process environment:

```toml
[env]
file = ".env"                     # default: `.env` next to nitr.toml
allow = ["APP_", "API_TOKEN"]     # what scripts may read
```

**The process environment directly**, read from Lua through the opt-in
`nitr.env` builtin:

```lua
local secret = nitr.env.get("SESSION_SECRET")
```

`nitr.env` is off unless you add `"env"` to `[std] features`, reads are
filtered by `[env] allow`, `NITR_*` internals are never visible to
scripts, and there is no setter and no enumeration. See
[Environment variables](./env#the-nitr-env-builtin).

## Enabling builtins

`[std] features` decides which parts of the `nitr.*` standard library
exist in your scripts:

```toml
[std]
features = ["json", "http", "log", "time", "validate", "base64", "path", "url"]
```

That list is also the **default** when the key is omitted. Anything
heavier — `db`, `fetch`, `template`, `crypto`, `cache`, `dbg`, `env` —
is opt-in. See [nitr.toml → \[std\]](./file#std).

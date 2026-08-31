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
without binding a port and without running the startup checks below. The
file is still parsed first, so an unknown or renamed key is still an
error rather than a printed configuration.

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

Unset options are simply absent: TOML has no null, and an absent key is
exactly what "not set" means.

## Configuration is validated strictly

This is a design decision, not an inconvenience. Nitr **refuses to
start** when:

- a key is **unknown** — a typo like `hander_script` is an error, not a
  silently ignored line, and a key removed in a later version is a loud
  failure rather than a behaviour change you never noticed;
- a key **moved** — `database = "app.db"`, `tests_dir` and
  `templates_dir` are each refused with the replacement spelled out,
  because "unknown key" would not tell you where the setting went;
- two settings **contradict** each other: `[cors] credentials = true`
  with `origins = ["*"]` (browsers reject that combination anyway),
  `max_streams` above `workers` (the extra slots could never be used),
  `[limits] pool_wait_ms` above `[lua] exec_timeout_ms` when both are
  non-zero (a request would wait for a Lua state longer than any handler
  may run, so the queue can only grow — `0` on either key means "no
  bound" and switches the comparison off);
- a configured **path does not exist**, or is a file where a directory
  belongs — `handler_script`, `config_script`, `[templating] dir`,
  `[static] dir`, `[multipart] upload_dir`, and the database's parent
  directory (SQLite creates the file, not its directory);
- a path exists but **cannot be used**: `[static] dir` is probed with a
  read, `[multipart] upload_dir` with a write. Existence is not
  permission, and a directory owned by the wrong user would otherwise
  answer every request with a 404 or a 500 that explains nothing;
- **`[multipart] upload_dir` sits inside the handler script's
  directory** — `require` is pinned there, so an uploaded `.lua` file
  would be a loadable module. That is the upload-to-RCE chain written in
  configuration, and there is no version of it anyone wants;
- **`[tls] enabled = true` is not backed up**: no `cert` or `key`, a
  path that is not a readable file, a `min_version` other than `"1.2"`
  or `"1.3"`, `handshake_ms = 0` (which would leave the handshake
  unbounded), or a binary built without the `tls` Cargo feature;
- `[health]` paths are malformed — `liveness` and `readiness` must start
  with `/` and must differ, since they answer different questions;
- an unknown `[compression]` algorithm is listed (only `"br"` and
  `"gzip"` exist), or an unknown name appears in `[lua] stdlib`;
- **`[lua] stdlib` includes `"debug"`** — the Lua state is built with
  mlua's safe constructor, which refuses that library outright, and
  `debug.sethook` would replace the instruction-count hook that stops
  CPU-bound loops;
- a `[std]` feature is listed but its configuration is missing — `"db"`
  without a `[database]` section, `"template"` without `[templating] dir`;
- a `[std]` feature is listed but **was not compiled into this binary**
  — the error names the Cargo feature to enable;
- a **migration is pending**.

> [!TIP] Put `nitr check` in CI
>
> It catches all of the above without binding a port. A deploy that
> fails in CI is cheaper than one that fails at startup. Note that
> `nitr check` performs a real build, so `config_script` runs and its
> side effects happen.

### What only warns

Four situations are legal but suspicious, so they are logged at startup
rather than refused. Each one has a deployment shape where it is the
right answer:

| Warning                                                | Why it is not a refusal                                                                                                                                                                                   |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[multipart] upload_dir` inside `[static] dir`         | Serving uploads back (user avatars) is a real choice — just one to make deliberately, since every upload becomes hosted content.                                                                          |
| Session and CSRF cookies resolving to **not** `Secure` | A `Secure` cookie sent over plain `http` is dropped by the browser silently, which is a far worse failure than a startup line.                                                                            |
| `[tls] key` readable beyond its owner                  | Containers legitimately run as root with a mounted secret, and a security check whose failure mode is "the deployment does not come up" gets disabled.                                                    |
| `[limits] body_read_ms` above `[lua] exec_timeout_ms`  | The execution budget fires first on a buffered read, turning what should be a clean `408` naming the client into a timeout-kind `500` blaming your code. Both keys must be non-zero for the check to run. |

The cookie warning is the one to read carefully. The most common Nitr
deployment is a loopback bind behind a terminating proxy, where
`[tls] enabled = false` is correct for _this_ process and the cookies
must still be `Secure`. Nothing here can detect that proxy, so say so:

```toml
[cookies]
secure = "always"    # TLS is terminated in front of this process
```

See [Cookies and sessions](../cookies-sessions).

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

[multipart]
upload_dir = "/var/lib/myapp/uploads"

[cookies]
secure = "always"

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

Passwords are a third case: they never enter the configuration at all,
in any form. Store the **hash**, minted once by
[`nitr hash-password`](../cli#hash-password), and compare against it at
request time — see [Passwords](../passwords).

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

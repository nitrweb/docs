# Lua API Reference

The complete surface Nitr exposes to Lua — one namespace, `nitr`.
Nothing else is registered as a global.

This page is the **inventory**: every function, what it takes and what
it returns. The [Server guides](../server/) are where each one is
explained with worked examples.

> [!NOTE] Entries marked with a _std feature_
>
> A tag like _(std feature: `db`)_ means the module needs that name in
> `[std] features` — and, for the heavier ones, the matching [Cargo
> feature](../library/cargo-features) compiled into the binary. See
> [Configuration → \[std\]](../server/configuration/file#std).

> [!TIP] Editor completion
>
> `nitr init` writes `nitr-types.lua`: generated LuaCATS definitions
> covering everything on this page. Any editor running the [Lua Language
> Server](https://luals.github.io/) picks it up and gives you
> completion, signatures and inline docs.

## Contents

|                 |                                                                                                                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Application** | [`nitr.app`](#nitr-app) · [`nitr.cfg`](#nitr-cfg) · [`nitr.ext`](#nitr-ext)                                                                                                                                                                                                     |
| **Responses**   | [`nitr.json`](#nitr-json) · [`nitr.text`](#nitr-text) · [`nitr.html`](#nitr-html) · [`nitr.redirect`](#nitr-redirect) · [`nitr.status`](#nitr-status) · [`nitr.error`](#nitr-error) · [`nitr.negotiate`](#nitr-negotiate) · [`nitr.etag`](#nitr-etag) · [`nitr.sse`](#nitr-sse) |
| **Security**    | [`nitr.crypto`](#nitr-crypto) · [`nitr.crypto.jwt`](#nitr-crypto-jwt) · [`nitr.auth`](#nitr-auth) · [`nitr.csrf`](#nitr-csrf) · [`nitr.session`](#nitr-session)                                                                                                                 |
| **Data**        | [`nitr.db`](#nitr-db) · [`nitr.cache`](#nitr-cache) · [`nitr.validate`](#nitr-validate)                                                                                                                                                                                         |
| **I/O**         | [`nitr.fetch`](#nitr-fetch) · [`nitr.await_all`](#nitr-await-all) · [`nitr.template`](#nitr-template)                                                                                                                                                                           |
| **Utilities**   | [`nitr.time`](#nitr-time) · [`nitr.base64`](#nitr-base64) · [`nitr.path`](#nitr-path) · [`nitr.url`](#nitr-url) · [`nitr.env`](#nitr-env)                                                                                                                                       |
| **Diagnostics** | [`nitr.log`](#nitr-log) · [`nitr.dbg`](#nitr-dbg) · [`nitr.errinfo`](#nitr-errinfo)                                                                                                                                                                                             |
| **Testing**     | [`nitr.test`](#nitr-test)                                                                                                                                                                                                                                                       |
| **Types**       | [Request, Response, App, and the rest →](./types)                                                                                                                                                                                                                               |

---

## Application

### `nitr.app`

`nitr.app() -> nitr.App`

Creates the application object the handler script must return. See
[`nitr.App`](./types#nitr-app) for its methods, and
[Routing](../server/routing).

### `nitr.cfg`

_(set when a `config_script` is configured)_

The configuration snapshot returned by `config.lua` — `nil` without one.
Plain data, snapshotted into every state. See
[Project layout](../server/project-layout#configlua--the-startup-script).

### `nitr.ext`

User-defined Rust extension modules registered with
`ServerBuilder::module`, one level below the standard library so no
future builtin can collide with them. Each module is a table:
`nitr.ext.<name>`. Absent until a module is registered. See [Extension
modules](../library/extension-modules).

---

## Responses

### `nitr.json`

`nitr.json(value, status?) -> nitr.Response` — _(std feature: `json`)_

As a function: a JSON response (`nitr.json({ ok = true })`). Also the
codec:

|                                     |                                        |
| ----------------------------------- | -------------------------------------- |
| `nitr.json:encode(value) -> string` | Encodes a value as JSON.               |
| `nitr.json:decode(s) -> any`        | Decodes JSON; errors on invalid input. |

### `nitr.text`

`nitr.text(body, status?) -> nitr.Response` — _(std feature: `http`)_

A `text/plain` response.

### `nitr.html`

`nitr.html(body, status?) -> nitr.Response` — _(std feature: `http`)_

A `text/html` response.

### `nitr.redirect`

`nitr.redirect(location, status?) -> nitr.Response` — _(std feature: `http`)_

A redirect; default `302`.

### `nitr.status`

`nitr.status(code) -> nitr.Response` — _(std feature: `http`)_

An empty response with the given status.

### `nitr.error`

`nitr.error(code, body?) -> nitr.Response` — _(std feature: `http`)_

An error response: a string body is sent as text, a table body as JSON.

### `nitr.negotiate`

`nitr.negotiate(req, offers) -> any` — _(std feature: `http`)_

Picks the offer whose media type best matches the `Accept` header;
function values are called with the request. No match answers `406`.

### `nitr.etag`

`nitr.etag(value, weak?) -> string` — _(std feature: `http`)_

A well-formed entity tag for whatever identifies the resource — a row
version, an `updated_at` — to pair with
[`req:fresh`](./types#nitr-request).

### `nitr.sse`

`nitr.sse(fn) -> nitr.Response` — _(std feature: `http`)_

A Server-Sent Events stream: `fn(send)` calls `send(event, data)`; table
data is JSON-encoded. See [Streaming & SSE](../server/streaming).

---

## Security

### `nitr.crypto`

_(std feature: `crypto`)_ — Crypto primitives from RustCrypto. Compose
them; never reimplement them in Lua. See
[Crypto & auth](../server/crypto-auth).

|                                                          |                                                                 |
| -------------------------------------------------------- | --------------------------------------------------------------- |
| `nitr.crypto.sha256(data) -> string`                     | SHA-256 digest, lowercase hex.                                  |
| `nitr.crypto.hmac_sha256(key, data) -> string`           | HMAC-SHA256, lowercase hex.                                     |
| `nitr.crypto.random_bytes(n) -> string`                  | `n` random bytes from the OS (1..=65536).                       |
| `nitr.crypto.constant_time_eq(a, b) -> boolean`          | Timing-safe comparison — what `==` on secrets is not.           |
| `nitr.crypto.password_hash(password) -> string`          | argon2id hash for storage.                                      |
| `nitr.crypto.password_verify(password, hash) -> boolean` | Verifies a password against a stored hash.                      |
| `nitr.crypto.seal(key, plaintext, aad?) -> string`       | Authenticated encryption (XChaCha20-Poly1305); printable token. |
| `nitr.crypto.open(key, sealed, aad?) -> string\|nil`     | Opens a sealed token; `nil` on any tampering.                   |

### `nitr.crypto.jwt`

_(std feature: `crypto`)_ — HMAC JWTs (HS256/384/512). Verification
demands an explicit algorithm allow-list; `exp` and `nbf` are checked by
default.

|                                                                       |                   |
| --------------------------------------------------------------------- | ----------------- |
| `nitr.crypto.jwt.sign(claims, key, opts?) -> string`                  | Signs a token.    |
| `nitr.crypto.jwt.verify(token, key, opts) -> table\|nil, string\|nil` | Verifies a token. |

### `nitr.auth`

_(std feature: `crypto`)_ — `Authorization` header parsing.

|                                                    |                              |
| -------------------------------------------------- | ---------------------------- |
| `nitr.auth.basic(req) -> string\|nil, string\|nil` | Basic credentials, or `nil`. |
| `nitr.auth.bearer(req) -> string\|nil`             | The bearer token, or `nil`.  |

### `nitr.csrf`

`nitr.csrf(opts) -> fun` — _(std feature: `http`)_

As a function: the CSRF middleware factory for `app:use` — a signed
double-submit cookie; unsafe methods must echo the token in
`X-CSRF-Token` or a `_csrf` field. Options: `secret` (required),
`cookie`, `header`, `field`, `cookie_opts`.

|                                  |                                                                       |
| -------------------------------- | --------------------------------------------------------------------- |
| `nitr.csrf.token(req) -> string` | The request's token, for a form or meta tag. Requires the middleware. |

### `nitr.session`

`nitr.session(req, opts) -> nitr.Session` — _(std feature: `http`)_

Loads (or starts) the stateless signed-cookie session. Options: `secret`
(required), `name`, `max_age`, `cookie`. See
[`nitr.Session`](./types#nitr-session).

---

## Data

### `nitr.db`

_(std feature: `db`)_ — SQLite (`[database] path`): WAL, busy timeout,
foreign keys on. See [Database](../server/database).

|                                                     |                                                                                                            |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `nitr.db:execute(sql, params?) -> integer`          | Runs a statement; returns the affected row count.                                                          |
| `nitr.db:query(sql, params?) -> table[]`            | All rows, each a column→value table.                                                                       |
| `nitr.db:query_row(sql, params?) -> table\|nil`     | The first row, or `nil`.                                                                                   |
| `nitr.db:query_one(sql, params?) -> any`            | The first column of the first row.                                                                         |
| `nitr.db:transaction(fn) -> any`                    | Runs `fn(tx)` atomically; rolls back on error. Nestable via savepoints. Use `tx`, not the outer `nitr.db`. |
| `nitr.db:query_async(sql, params?, kind?) -> table` | An unsent query, to run alongside fetches in `nitr.await_all`.                                             |

### `nitr.cache`

_(std feature: `cache`)_ — The bounded TTL + LRU cache shared by every
state. Entries are plain data; per-process, so **not** a session store.
See [Cache](../server/cache).

|                                            |                                                            |
| ------------------------------------------ | ---------------------------------------------------------- |
| `nitr.cache:get(key) -> any`               | The cached value, or `nil`.                                |
| `nitr.cache:set(key, value, ttl?)`         | Stores a value; `ttl` in seconds.                          |
| `nitr.cache:delete(key)`                   | Removes a key.                                             |
| `nitr.cache:clear()`                       | Empties the cache.                                         |
| `nitr.cache:remember(key, ttl, fn) -> any` | The cached value, or `fn()`'s result, stored and returned. |
| `nitr.cache:stats() -> table`              | Hit / miss / entry counters.                               |

### `nitr.validate`

_(std feature: `validate`)_ — Declarative validation, compiled once and
checked in Rust. See [Validation](../server/validation).

|                                               |                    |
| --------------------------------------------- | ------------------ |
| `nitr.validate.schema(fields) -> nitr.Schema` | Compiles a schema. |

---

## I/O

### `nitr.fetch`

`nitr.fetch(method, url, opts?) -> nitr.FetchHandle` — _(std feature: `fetch`)_

An outbound HTTP request — SSRF-guarded, redirect-checked. Options:
`headers`, `query`, `json`, `body`, `timeout`, `retry`. Returns an
**unsent** handle. See [Outbound HTTP](../server/fetch).

### `nitr.await_all`

`nitr.await_all(handles) -> table` — _(std feature: `fetch`)_

Runs fetch handles (and `db:query_async` handles) concurrently; returns
their results in order.

### `nitr.template`

_(std feature: `template`)_ — The minijinja template engine, loading
from `[templating] dir`. See [Templates](../server/templates).

|                                               |                     |
| --------------------------------------------- | ------------------- |
| `nitr.template:render(name, data?) -> string` | Renders a template. |

---

## Utilities

### `nitr.time`

_(std feature: `time`)_ — Safe clocks and time formatting (UTC), so
scripts never need the `os` library for a date.

|                                                            |                                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| `nitr.time.now() -> integer`                               | Unix seconds.                                                          |
| `nitr.time.monotonic() -> number`                          | Monotonic seconds, sub-second precision — for measuring durations.     |
| `nitr.time.format(ts, fmt) -> string`                      | Formats a timestamp in UTC.                                            |
| `nitr.time.parse(value, fmt) -> integer\|nil, string\|nil` | Parses per a strftime format (UTC unless the input carries an offset). |
| `nitr.time.http(ts) -> string`                             | IMF-fixdate (`Tue, 15 Nov 1994 08:12:31 GMT`).                         |
| `nitr.time.parse_http(value) -> integer\|nil`              | Parses the three HTTP date forms.                                      |
| `nitr.time.iso8601(ts) -> string`                          | RFC 3339 in UTC (`1994-11-15T08:12:31Z`).                              |

### `nitr.base64`

_(std feature: `base64`)_

|                                                                |                                                                |
| -------------------------------------------------------------- | -------------------------------------------------------------- |
| `nitr.base64.encode(data, opts?) -> string`                    | Encodes bytes. `{ url = true }` selects the URL-safe alphabet. |
| `nitr.base64.decode(value, opts?) -> string\|nil, string\|nil` | Decodes; forgiving about padding, never about the alphabet.    |

### `nitr.path`

_(std feature: `path`)_ — Lexical path manipulation, POSIX and Windows
styles. Pure text: **nothing touches the filesystem**.

|                                            |                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------- |
| `nitr.path.join(...) -> string`            | Joins segments; a later absolute segment never discards the base.   |
| `nitr.path.basename(path) -> string`       | The final component.                                                |
| `nitr.path.dirname(path) -> string`        | The directory part.                                                 |
| `nitr.path.extension(path) -> string\|nil` | The extension without the dot; `nil` for none, dotfiles included.   |
| `nitr.path.normalize(path) -> string`      | Resolves `.` and `..` lexically; `..` cannot climb out of the root. |
| `nitr.path.is_absolute(path) -> boolean`   | Whether the path is absolute (`/x`, `C:\x`, UNC).                   |

> [!WARNING] `normalize` is text-only
>
> Before real file access on Windows, also reject segments with trailing
> dots or spaces, or colons — Win32 rewrites those.

### `nitr.url`

_(std feature: `url`)_ — Percent-encoding, query strings, and a lexical
URL splitter.

|                                                        |                                                                                                                        |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `nitr.url.encode(value) -> string`                     | Percent-encodes a component (like `encodeURIComponent`).                                                               |
| `nitr.url.decode(value) -> string`                     | Percent-decodes; `+` is left alone — that is a form convention.                                                        |
| `nitr.url.query_parse(query) -> table<string, string>` | Parses a query string; `+` as space, last duplicate wins.                                                              |
| `nitr.url.query_build(params) -> string`               | Builds a query string, keys sorted.                                                                                    |
| `nitr.url.parse(value) -> table\|nil, string\|nil`     | Splits a URL lexically — not a WHATWG parser. Returns `{ scheme?, userinfo?, host?, port?, path, query?, fragment? }`. |

### `nitr.env`

_(std feature: `env`)_ — Read-only environment access. Opt-in; reads are
filtered by `[env] allow`, and `NITR_*` internals are never visible.
Getters only: no setter, no enumeration. See
[Environment variables](../server/configuration/env#the-nitrenv-builtin).

|                                                  |                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| `nitr.env.get(name, default?) -> string\|nil`    | Reads one variable.                                                       |
| `nitr.env.has(name) -> boolean`                  | Whether it is set **and readable**; a policy-hidden name reports `false`. |
| `nitr.env.number(name, default?) -> number\|nil` | Reads and parses a number; unset or unparseable answers the default.      |
| `nitr.env.bool(name, default?) -> boolean\|nil`  | Reads a flag: `1`/`true`/`yes`/`on` and `0`/`false`/`no`/`off`, any case. |

---

## Diagnostics

### `nitr.log`

_(std feature: `log`)_ — Structured logging into the request span.
Fields become real keys in JSON log output. See
[Logging](../server/logging).

|                                |                     |
| ------------------------------ | ------------------- |
| `nitr.log.debug(msg, fields?)` | Debug-level record. |
| `nitr.log.info(msg, fields?)`  | Info-level record.  |
| `nitr.log.warn(msg, fields?)`  | Warn-level record.  |
| `nitr.log.error(msg, fields?)` | Error-level record. |

### `nitr.dbg`

`nitr.dbg(value) -> any` — _(std feature: `dbg`)_

Debug-prints a value, structure included, to the log; returns it
unchanged.

### `nitr.errinfo`

`nitr.errinfo(caught) -> table`

Classifies a `pcall`-caught error into its structured form: `kind`,
`message`, `source`, `line`, `traceback`, `cause`, `pretty`. See
[Errors](../server/errors).

---

## Testing

### `nitr.test`

_(available in `nitr test` files only)_ — See
[Testing](../server/testing).

|                                                   |                                                                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nitr.test.request(method, path, opts?) -> table` | Dispatches through the real router / middleware / handler path. Options: `headers`, `body`, `json`. Returns `{ status, headers, body }` plus `:json()`. |
| `nitr.test.describe(name, fn)`                    | Groups tests; names are prefixed.                                                                                                                       |
| `nitr.test.it(name, fn)`                          | One test case.                                                                                                                                          |
| `nitr.test.expect(actual) -> table`               | Starts an assertion. Matchers: `to_equal`, `to_not_equal`, `to_be_nil`, `to_be_truthy`, `to_match`, `to_contain`.                                       |
| `nitr.test.before_each(fn)`                       | Runs before every test in the file.                                                                                                                     |
| `nitr.test.after_each(fn)`                        | Runs after every test in the file, failing ones included.                                                                                               |

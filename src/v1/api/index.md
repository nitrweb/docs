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
[Project layout](../server/project-layout).

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
[Crypto & auth](../server/crypto-auth) and
[Passwords](../server/passwords).

|                                                                       |                                                                                              |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `nitr.crypto.sha256(data) -> string`                                  | SHA-256 digest, lowercase hex.                                                               |
| `nitr.crypto.hmac_sha256(key, data) -> string`                        | HMAC-SHA256, lowercase hex.                                                                  |
| `nitr.crypto.random_bytes(n) -> string`                               | `n` random bytes from the OS (1..=65536).                                                    |
| `nitr.crypto.constant_time_eq(a, b) -> boolean`                       | Timing-safe comparison — what `==` on secrets is not.                                        |
| `nitr.crypto.password_hash(password) -> string`                       | **Async.** argon2id hash for storage: `m=19456, t=2, p=1`. Raises past `max_password_bytes`. |
| `nitr.crypto.password_verify(password, hash) -> boolean, string\|nil` | **Async.** Whether the password matches, plus a reason when the _stored hash_ is unusable.   |
| `nitr.crypto.password_verify_dummy(password) -> boolean`              | **Async.** Spends one argon2 hash against a process-private decoy; always `false`.           |
| `nitr.crypto.seal(key, plaintext, aad?) -> string`                    | Authenticated encryption (XChaCha20-Poly1305) under a 32-byte key; printable token.          |
| `nitr.crypto.open(key, sealed, aad?) -> string\|nil`                  | Opens a sealed token; `nil` on any tampering.                                                |
| `nitr.crypto.max_password_bytes: integer`                             | The password cap: 1024 bytes.                                                                |

> [!WARNING] The three password calls yield — never at the top level
>
> The argon2 work runs on the blocking pool, so `password_hash`,
> `password_verify` and `password_verify_dummy` **yield**. Call them
> from a handler or middleware. The top level of a handler script runs
> outside the async executor, and a yield there fails — so do not hash a
> seed credential at boot. Mint it once with `nitr hash-password` (see
> [CLI](../server/cli)) and store the hash instead.

> [!NOTE] `password_verify` returns two values
>
> ```lua
> local ok, problem = nitr.crypto.password_verify(password, row.hash)
> ```
>
> `ok` is the answer. `problem` is set **only when the stored hash can
> never verify anything** — a bcrypt row pasted in during a migration, a
> truncated column, parameters that would allocate the machine away. It
> is a closed set: `"unsupported hash format"`, `"incomplete hash"`,
> `"unsupported hash algorithm"`, `"hash parameters out of range"`,
> `"unusable hash"`. An ordinary wrong password leaves it `nil` — and so
> does one over `max_password_bytes`, which is answered `false` by a
> length comparison before argon2 ever runs, so `if problem then log` is
> not a lever a stranger can pull.

> [!TIP] Both branches of a login must cost one argon2 hash
>
> Returning early when the user does not exist answers in microseconds;
> a real user costs ~26 ms. That gap is measurable across a network, and
> it turns the login form into a query interface over your user list.
> Spend the hash on the no-such-user branch too:
>
> ```lua
> local row = nitr.db:query_row(
>     'select id, password_hash from users where email = ?', { email })
> if not row then
>     nitr.crypto.password_verify_dummy(password)
>     return unauthorized()
> end
> ```
>
> And size a registration field from the constant rather than a copied
> `1024`, so a 400 replaces `password_hash`'s error:
>
> ```lua
> if #password > nitr.crypto.max_password_bytes then
>     return nitr.error(400, { error = 'password too long' })
> end
> ```
>
> See [Passwords](../server/passwords).

### `nitr.crypto.jwt`

_(std feature: `crypto`)_ — HMAC JWTs (HS256 / HS384 / HS512).
Asymmetric algorithms are deliberately absent, and so is `alg: none`.
See [JWT](../server/jwt).

|                                                                       |                                                                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `nitr.crypto.jwt.sign(claims, key, opts?) -> string`                  | Signs a token. `opts` takes `alg` (default `"HS256"`).                                                       |
| `nitr.crypto.jwt.verify(token, key, opts) -> table\|nil, string\|nil` | The claims, or `nil` plus a short reason. `opts` **requires** `algorithms`; `leeway` in seconds is optional. |

> [!WARNING] What `verify` does **not** check
>
> It checks the signature, the token's `alg` against the allow-list you
> pass, and `exp` / `nbf` **when the token carries them**. No other
> claim, ever:
>
> - `iss` and `aud` are never read. A token minted by another issuer,
>   for another audience, verifies here exactly like one minted for you
>   — comparing them is your job. Note `aud` may be a string **or an
>   array** (RFC 7519 §4.1.3).
> - `typ` is written by `sign` and never verified. The asymmetry is the
>   trap: the field's presence suggests a check that does not exist.
> - **A token with no `exp` never expires.** "The signature is valid"
>   and "the token is still good" are different questions. If yours must
>   expire, require `exp` yourself.

### `nitr.auth`

_(std feature: `crypto`)_ — `Authorization` header parsing. Both take
the request, or the raw header value as a string.

|                                                    |                                    |
| -------------------------------------------------- | ---------------------------------- |
| `nitr.auth.basic(req) -> string\|nil, string\|nil` | The user and password, or nothing. |
| `nitr.auth.bearer(req) -> string\|nil`             | The bearer token, or `nil`.        |

> [!NOTE] `basic` is stricter than RFC 7617, and it fails closed
>
> Credentials must be **UTF-8** (a latin-1 payload reads as absent), and
> the scheme must be separated from the value by **at least one space**
> — extra spaces are trimmed, but a tab is not a separator. Anything the
> parser rejects reads as **no credentials, never a partial one**, so
> `if not user then` is the whole check. See
> [`basic-auth`](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/basic-auth).

> [!DANGER] Compare a bearer token with `constant_time_eq`, not `==`
>
> `bearer` hands you a secret, and `==` on a secret is not a
> constant-time compare. `constant_time_eq` still returns early on a
> **length** mismatch, though — length is not hidden — so a secret whose
> length varies must be compared as a digest:
>
> ```lua
> local ok = nitr.crypto.constant_time_eq(
>     nitr.crypto.sha256(token), nitr.crypto.sha256(expected))
> ```
>
> See [`bearer-auth`](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/bearer-auth).

### `nitr.csrf`

`nitr.csrf(opts) -> fun` — _(std feature: `http`)_

As a function: the CSRF middleware factory for `app:use` — a signed
double-submit cookie; unsafe methods must echo the token in
`X-CSRF-Token` or a `_csrf` field.

| Option        | Default             | What it is                                   |
| ------------- | ------------------- | -------------------------------------------- |
| `secret`      | required, 16+ bytes | Signing key for the token cookie.            |
| `cookie`      | `"_csrf"`           | The cookie **name** — a string, not a table. |
| `header`      | `"x-csrf-token"`    | Header the token may arrive in.              |
| `field`       | `"_csrf"`           | Form field the token may arrive in.          |
| `cookie_opts` | see below           | The cookie **attributes**.                   |

|                                  |                                                                       |
| -------------------------------- | --------------------------------------------------------------------- |
| `nitr.csrf.token(req) -> string` | The request's token, for a form or meta tag. Requires the middleware. |

Here `cookie` is the **name** and `cookie_opts` the attributes.
[`nitr.session`](#nitr-session) below spells the pair the other way
round — the two asides under it cover both.

### `nitr.session`

`nitr.session(req, opts) -> nitr.Session` — _(std feature: `http`)_

Loads (or starts) the stateless signed-cookie session: the whole session
lives in the cookie, so there is no store to provision. See
[`nitr.Session`](./types#nitr-session) and
[Sessions](../server/cookies-sessions#sessions).

| Option    | Default             | What it is                          |
| --------- | ------------------- | ----------------------------------- |
| `secret`  | required, 16+ bytes | Signing key for the session cookie. |
| `name`    | `"session"`         | The cookie **name**.                |
| `max_age` | none                | `Max-Age`, in seconds.              |
| `cookie`  | see below           | The cookie **attributes** table.    |

> [!WARNING] `cookie` means two different things
>
> The two modules spell the same pair of ideas differently, and swapping
> them issues the wrong cookie without complaining:
>
> |                       | `nitr.csrf(opts)`          | `nitr.session(req, opts)`  |
> | --------------------- | -------------------------- | -------------------------- |
> | cookie **name**       | `cookie` (default `_csrf`) | `name` (default `session`) |
> | cookie **attributes** | `cookie_opts`              | `cookie`                   |
>
> So `nitr.csrf({ secret = ..., cookie = { path = '/admin' } })` sets no
> path at all — it names the cookie after a table.

> [!NOTE] The attribute tables extend the defaults, they do not replace them
>
> Both start from `path = "/"`, `HttpOnly` and `SameSite=Lax`, and your
> table is merged over that, so a default you did not mention survives.
> **`http_only` cannot be un-set** — a session or CSRF cookie readable
> from page scripts is not a choice Nitr offers. `same_site` stays
> overridable, because a legitimate cross-site form needs `"None"`.
>
> `secure` is decided by the `[cookies] secure` policy when you leave it
> out: the default `"auto"` means Secure whenever
> [TLS](../server/tls) is enabled for this process. An explicit `secure`
> from Lua always wins, in both directions.

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
[Environment variables](../server/configuration/env#the-nitr-env-builtin).

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

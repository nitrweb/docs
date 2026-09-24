# Lua API Reference

Everything Nitr gives Lua lives in one global table, `nitr`. This page
lists each function with its signature and a one-line description. The
[Server guides](../server/) explain them with examples, and
[Types](./types) covers the objects they return.

A tag like _(std feature: `db`)_ means the module must be listed in
[`[std] features`](../server/configuration/file#std). The `db`, `fetch`,
`template` and `crypto` modules also need the matching [Cargo
feature](../library/cargo-features) in the binary; the released `nitr`
binary has all of them.

> [!TIP] Editor completion
>
> `nitr init` writes `nitr-types.lua`, type definitions for everything on
> this page. Editors running the [Lua Language
> Server](https://luals.github.io/) use it for completion and inline docs.

## Contents

|                 |                                                                                                                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Application** | [`nitr.app`](#nitr-app) · [`nitr.cfg`](#nitr-cfg) · [`nitr.ext`](#nitr-ext)                                                                                                                                                                                                     |
| **Responses**   | [`nitr.json`](#nitr-json) · [`nitr.text`](#nitr-text) · [`nitr.html`](#nitr-html) · [`nitr.redirect`](#nitr-redirect) · [`nitr.status`](#nitr-status) · [`nitr.error`](#nitr-error) · [`nitr.negotiate`](#nitr-negotiate) · [`nitr.etag`](#nitr-etag) · [`nitr.sse`](#nitr-sse) |
| **Security**    | [`nitr.crypto`](#nitr-crypto) · [`nitr.crypto.jwt`](#nitr-crypto-jwt) · [`nitr.auth`](#nitr-auth) · [`nitr.csrf`](#nitr-csrf) · [`nitr.session`](#nitr-session) · [`nitr.cookie`](#nitr-cookie)                                                                                 |
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
[`nitr.App`](./types#nitr-app) and [Routing](../server/routing).

### `nitr.cfg`

_(set when a `config_script` is configured)_

The table returned by `config.lua`, or `nil` without one. See [Project
layout](../server/project-layout).

### `nitr.ext`

Your own Rust modules, registered with `ServerBuilder::module`. Each one
is a table at `nitr.ext.<name>`; the table is absent until a module is
registered. See [Extension modules](../library/extension-modules).

---

## Responses

### `nitr.json`

`nitr.json(value, status?) -> nitr.Response` — _(std feature: `json`)_

A JSON response (`nitr.json({ ok = true })`). It is also the codec:

|                                     |                                        |
| ----------------------------------- | -------------------------------------- |
| `nitr.json:encode(value) -> string` | Encodes a value as JSON.               |
| `nitr.json:decode(s) -> any`        | Decodes JSON; errors on invalid input. |

> [!NOTE] Strings must be UTF-8
>
> A string holding raw bytes (such as `nitr.crypto.random_bytes(16)`)
> raises instead of encoding. Encode it with
> [`nitr.base64`](#nitr-base64) first. This applies everywhere Nitr
> serializes a value: JSON, the cache, sessions, JWT claims, SSE data and
> `fetch` bodies.

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

A well-formed entity tag for whatever identifies the resource (a row
version, an `updated_at`). Pair it with
[`req:fresh`](./types#nitr-request).

### `nitr.sse`

`nitr.sse(fn) -> nitr.Response` — _(std feature: `http`)_

A Server-Sent Events stream: `fn(send)` calls `send(event, data)`; table
data is JSON-encoded. An event name containing a line break raises. See
[Streaming & SSE](../server/streaming).

---

## Security

### `nitr.crypto`

_(std feature: `crypto`)_ — Hashing, passwords and encryption. See
[Crypto & auth](../server/crypto-auth) and [Passwords](../server/passwords).

|                                                                       |                                                                                                                  |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `nitr.crypto.sha256(data) -> string`                                  | SHA-256 digest, lowercase hex.                                                                                   |
| `nitr.crypto.hmac_sha256(key, data) -> string`                        | HMAC-SHA256, lowercase hex.                                                                                      |
| `nitr.crypto.random_bytes(n) -> string`                               | `n` random bytes from the OS (1 to 65536).                                                                       |
| `nitr.crypto.constant_time_eq(a, b) -> boolean`                       | Timing-safe comparison. Use it instead of `==` for secrets.                                                      |
| `nitr.crypto.password_hash(password) -> string`                       | **Async.** argon2id hash for storage (`m=19456, t=2, p=1`). Raises above `max_password_bytes`.                   |
| `nitr.crypto.password_verify(password, hash) -> boolean, string\|nil` | **Async.** Whether the password matches. The second value is set only when the _stored hash_ is unusable.        |
| `nitr.crypto.password_verify_dummy(password) -> boolean`              | **Async.** Spends one argon2 hash and returns `false`. Call it when the user does not exist, so timing is equal. |
| `nitr.crypto.seal(key, plaintext, aad?) -> string`                    | Authenticated encryption (XChaCha20-Poly1305) with a 32-byte key; returns a printable token.                     |
| `nitr.crypto.open(key, sealed, aad?) -> string\|nil`                  | Opens a sealed token; `nil` if it was tampered with.                                                             |
| `nitr.crypto.max_password_bytes: integer`                             | The password size limit: 1024 bytes. Check `#password` against it to answer `400` instead of raising.            |

The reasons `password_verify` can return are `"unsupported hash format"`,
`"incomplete hash"`, `"unsupported hash algorithm"`,
`"hash parameters out of range"` and `"unusable hash"`. A wrong password,
even an oversized one, returns `false, nil`.

> [!WARNING] Call the password functions from handlers or middleware
>
> They are async, so calling them at the top level of a script fails at
> startup. To seed a credential, create the hash once with
> [`nitr hash-password`](../server/cli) and store it.

### `nitr.crypto.jwt`

_(std feature: `crypto`)_ — HMAC JWTs (HS256, HS384, HS512). See
[JWT](../server/jwt).

|                                                                       |                                                                                                         |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `nitr.crypto.jwt.sign(claims, key, opts?) -> string`                  | Signs a token. `opts.alg` defaults to `"HS256"`.                                                        |
| `nitr.crypto.jwt.verify(token, key, opts) -> table\|nil, string\|nil` | The claims, or `nil` plus a reason. `opts.algorithms` is required; `leeway` (seconds, ≥ 0) is optional. |

> [!WARNING] `verify` checks only the signature, `alg`, `exp` and `nbf`
>
> It never reads `iss` or `aud` (which may be a string or an array);
> compare them yourself. A token without `exp` never expires, so require
> `exp` if your tokens must expire.

### `nitr.auth`

_(std feature: `crypto`)_ — `Authorization` header parsing. Both take
the request, or the raw header value as a string.

|                                                    |                                  |
| -------------------------------------------------- | -------------------------------- |
| `nitr.auth.basic(req) -> string\|nil, string\|nil` | The user and password, or `nil`. |
| `nitr.auth.bearer(req) -> string\|nil`             | The bearer token, or `nil`.      |

`basic` accepts only UTF-8 credentials, with at least one space (not a
tab) after the scheme. Anything it cannot parse returns `nil`, never a
partial result.

> [!WARNING] Compare a bearer token with `constant_time_eq`
>
> `==` leaks timing. `constant_time_eq` still returns early when the
> lengths differ, so for a secret whose length varies, compare digests:
> `constant_time_eq(nitr.crypto.sha256(token), nitr.crypto.sha256(expected))`.

### `nitr.csrf`

`nitr.csrf(opts) -> fun` — _(std feature: `http`)_

CSRF middleware for `app:use`, using a signed double-submit cookie.
Unsafe methods must send the token back in the `X-CSRF-Token` header or
a `_csrf` form field. A request the browser marks
`Sec-Fetch-Site: cross-site` is refused before the token is checked,
unless `cookie_opts.same_site = "None"`. See
[Cookies & sessions](../server/cookies-sessions).

| Option        | Default             | What it is                                                               |
| ------------- | ------------------- | ------------------------------------------------------------------------ |
| `secret`      | required, 16+ bytes | Signing key for the token cookie.                                        |
| `cookie`      | `"_csrf"`           | The cookie **name**.                                                     |
| `header`      | `"x-csrf-token"`    | Header the token may arrive in.                                          |
| `field`       | `"_csrf"`           | Form field the token may arrive in.                                      |
| `cookie_opts` | —                   | The cookie **attributes**, merged over the [defaults](#cookie-defaults). |

|                                  |                                                                       |
| -------------------------------- | --------------------------------------------------------------------- |
| `nitr.csrf.token(req) -> string` | The request's token, for a form or meta tag. Requires the middleware. |

### `nitr.session`

`nitr.session(req, opts) -> nitr.Session` — _(std feature: `http`)_

Loads or starts a session stored entirely in a signed cookie. See
[`nitr.Session`](./types#nitr-session) and
[Sessions](../server/cookies-sessions#sessions).

| Option    | Default             | What it is                                                               |
| --------- | ------------------- | ------------------------------------------------------------------------ |
| `secret`  | required, 16+ bytes | Signing key for the session cookie.                                      |
| `name`    | `"session"`         | The cookie **name**.                                                     |
| `max_age` | none                | Lifetime in seconds, also checked on the server.                         |
| `cookie`  | —                   | The cookie **attributes**, merged over the [defaults](#cookie-defaults). |

> [!WARNING] `cookie` means different things in `nitr.csrf` and `nitr.session`
>
> In `nitr.csrf`, `cookie` is the name and `cookie_opts` the attributes.
> In `nitr.session`, `name` is the name and `cookie` the attributes.
> Mixing them up gives the wrong cookie without an error.

#### Cookie defaults

Both cookies start from `path = "/"`, `HttpOnly` and `SameSite=Lax`, and
your attribute table is merged over them. `http_only` cannot be turned
off. When you leave `secure` out, the [`[cookies] secure`](../server/configuration/file#cookies)
setting decides; its default `"auto"` sets it whenever
[TLS](../server/tls) is on.

### `nitr.cookie`

_(std feature: `http`)_ — The HMAC-SHA256 signing that
`res.cookies:set_signed` and `req.cookies:verify` use. Useful for a
signed value sent outside a cookie, or to forge a signed cookie in a
test.

|                                                           |                                                                                               |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `nitr.cookie.sign(name, value, secret) -> string`         | Signs `value`. The name is part of the signature, so the value cannot move to another cookie. |
| `nitr.cookie.verify(name, signed, secret) -> string\|nil` | The original value, or `nil` when the signature does not match.                               |

```lua
local signed = nitr.cookie.sign("prefs", "dark", secret)
nitr.cookie.verify("prefs", signed, secret)   -- "dark"
nitr.cookie.verify("other", signed, secret)   -- nil
```

---

## Data

### `nitr.db`

_(std feature: `db`)_ — The SQLite database from `[database] path`. See
[Database](../server/database).

|                                                     |                                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `nitr.db:execute(sql, params?) -> integer`          | Runs a statement; returns the number of affected rows.                                                             |
| `nitr.db:query(sql, params?) -> table[]`            | All rows, each a column→value table. Raises when the result exceeds `[database] max_rows` (default 10000).         |
| `nitr.db:query_row(sql, params?) -> table\|nil`     | The first row, or `nil` when there is none.                                                                        |
| `nitr.db:query_one(sql, params?) -> table`          | The only row. Raises when there are none or more than one. It returns a row, so read a column: `query_one(...).n`. |
| `nitr.db:transaction(fn) -> any`                    | Runs `fn(tx)` in a transaction; rolls back on error. Can be nested. Use `tx` inside, not `nitr.db`.                |
| `nitr.db:query_async(sql, params?, kind?) -> table` | An unsent query, to run alongside fetches in `nitr.await_all`.                                                     |

### `nitr.cache`

_(std feature: `cache`)_ — An in-memory cache with TTL and LRU eviction,
shared by all workers of one process. See [Cache](../server/cache).

|                                              |                                                                                           |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `nitr.cache:get(key) -> any`                 | The cached value, or `nil`.                                                               |
| `nitr.cache:set(key, value, opts?)`          | Stores a value. `opts` is `{ ttl = seconds }`.                                            |
| `nitr.cache:delete(key) -> boolean`          | Removes a key; returns whether it existed.                                                |
| `nitr.cache:clear()`                         | Empties the cache.                                                                        |
| `nitr.cache:remember(key, opts?, fn) -> any` | The cached value, or `fn()`'s result, stored and returned. `opts` is `{ ttl = seconds }`. |
| `nitr.cache:stats() -> table`                | Hit, miss and entry counts.                                                               |

The TTL is always a table (`{ ttl = 600 }`); a bare number raises. Keys
are limited to 1024 bytes.

### `nitr.validate`

_(std feature: `validate`)_ — Declarative validation, checked in Rust.
See [Validation](../server/validation/).

A rule is a table (`{ type = "string", min_len = 1 }`), a shorthand
string (`"string|trim|min_len:1|required"`), a mix of both
(`{ "string|required", message = "…" }`) or a compiled schema. Types:
`string`, `integer`, `number`, `boolean`, `array`, `table`, `map`, `any`,
`file`.

|                                                      |                                                                                                                 |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `nitr.validate.schema(fields, opts?) -> nitr.Schema` | Compiles a schema. Call it at the top level of a file, not per request. Unknown rule keys fail at load.         |
| `nitr.validate.expand(shorthand) -> table`           | The table form of a shorthand rule string.                                                                      |
| `nitr.validate.format(name, spec)`                   | Registers a [custom string format](../server/validation/formats#custom-formats) before the schemas that use it. |
| `nitr.validate.formats() -> string[]`                | Every format name, built in and custom, sorted.                                                                 |
| `nitr.validate.messages(messages)`                   | App-wide default messages per rule. Load time only.                                                             |
| `nitr.validate.media_types() -> table`               | The media types a `file` rule accepts: `{ ["image/png"] = { extensions, family, tier, dimensions } }`.          |

[File-rule presets](../server/validation/files#presets). Each returns a
rule table; `opts` overrides any key.

|                                    |                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `nitr.validate.image(opts?)`       | png, jpeg, gif, webp, bmp; `max_bytes = "5mb"`, `max_pixels = 25000000`      |
| `nitr.validate.document(opts?)`    | pdf, docx, xlsx, pptx, odt, ods, odp, rtf; `max_bytes = "20mb"`              |
| `nitr.validate.spreadsheet(opts?)` | xlsx, ods, csv; `max_bytes = "20mb"`                                         |
| `nitr.validate.text_file(opts?)`   | txt, csv, md, json, xml, yaml; UTF-8 required; `max_bytes = "1mb"`           |
| `nitr.validate.archive(opts?)`     | zip, gzip, tar, bz2, xz, zstd, 7z; `max_bytes = "50mb"`                      |
| `nitr.validate.audio(opts?)`       | mp3, wav, ogg, flac, m4a; `max_bytes = "50mb"`                               |
| `nitr.validate.video(opts?)`       | mp4, mov, webm, mkv; `max_bytes = "500mb"` (above `[limits] max_file_bytes`) |
| `nitr.validate.font(opts?)`        | woff, woff2, ttf, otf; `max_bytes = "5mb"`                                   |
| `nitr.validate.any_file(opts)`     | Any type except executables; `max_bytes` required                            |

---

## I/O

### `nitr.fetch`

`nitr.fetch(method, url, opts?) -> nitr.FetchHandle` — _(std feature: `fetch`)_

An outbound HTTP request, with SSRF protection and checked redirects.
Options: `headers`, `query`, `json`, `body`, `timeout`, `retry`. Returns
an **unsent** [handle](./types#nitr-fetchhandle). See
[Outbound HTTP](../server/fetch).

### `nitr.await_all`

`nitr.await_all(...) -> ...` — _(std feature: `fetch`)_

Runs fetch handles and `db:query_async` handles concurrently. Pass them
as separate arguments; the results come back as multiple values in the
same order. At most `[fetch] max_concurrent` run at once.

```lua
local profile, stats = nitr.await_all(
    nitr.fetch("GET", profile_url),
    nitr.fetch("GET", stats_url)
)
```

### `nitr.template`

_(std feature: `template`)_ — minijinja templates from
`[templating] dir`. See [Templates](../server/templates).

|                                               |                                |
| --------------------------------------------- | ------------------------------ |
| `nitr.template:render(name, data?) -> string` | **Async.** Renders a template. |

HTML escaping is on, except for names ending (before any `.j2`, `.jinja`
or `.jinja2`) in `.txt`, `.text`, `.md`, `.csv`, `.json`, `.yaml`,
`.yml` or `.toml`. So `mail.txt.j2` is not escaped and `page.j2` is.

---

## Utilities

### `nitr.time`

_(std feature: `time`)_ — Clocks and date formatting in UTC.

|                                                            |                                                                       |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| `nitr.time.now() -> integer`                               | Unix seconds.                                                         |
| `nitr.time.monotonic() -> number`                          | Monotonic seconds with sub-second precision, for measuring durations. |
| `nitr.time.format(ts, fmt?) -> string`                     | Formats a timestamp in UTC with a strftime format.                    |
| `nitr.time.parse(value, fmt) -> integer\|nil, string\|nil` | Parses with a strftime format (UTC unless the input has an offset).   |
| `nitr.time.http(ts) -> string`                             | HTTP date (`Tue, 15 Nov 1994 08:12:31 GMT`).                          |
| `nitr.time.parse_http(value) -> integer\|nil`              | Parses the three HTTP date forms.                                     |
| `nitr.time.iso8601(ts) -> string`                          | RFC 3339 in UTC (`1994-11-15T08:12:31Z`).                             |

### `nitr.base64`

_(std feature: `base64`)_

|                                                                |                                                             |
| -------------------------------------------------------------- | ----------------------------------------------------------- |
| `nitr.base64.encode(data, opts?) -> string`                    | Encodes bytes. `{ url = true }` uses the URL-safe alphabet. |
| `nitr.base64.decode(value, opts?) -> string\|nil, string\|nil` | Decodes. Padding is optional; invalid characters fail.      |

### `nitr.path`

_(std feature: `path`)_ — Path string handling, POSIX and Windows
styles. It never touches the filesystem.

|                                            |                                                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `nitr.path.join(...) -> string`            | Joins segments; a later absolute segment does not replace the base.                                                                   |
| `nitr.path.basename(path) -> string`       | The final component.                                                                                                                  |
| `nitr.path.dirname(path) -> string`        | The directory part.                                                                                                                   |
| `nitr.path.extension(path) -> string\|nil` | The extension without the dot; `nil` for none (including dotfiles).                                                                   |
| `nitr.path.normalize(path) -> string`      | Resolves `.` and `..`; `..` cannot go above the root. On Windows, also reject trailing dots, spaces and colons before opening a file. |
| `nitr.path.is_absolute(path) -> boolean`   | Whether the path is absolute (`/x`, `C:\x`, UNC).                                                                                     |

### `nitr.url`

_(std feature: `url`)_ — Percent-encoding, query strings and a simple URL
splitter.

|                                                        |                                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `nitr.url.encode(value) -> string`                     | Percent-encodes a component (like `encodeURIComponent`).                                                     |
| `nitr.url.decode(value) -> string`                     | Percent-decodes; leaves `+` as is.                                                                           |
| `nitr.url.query_parse(query) -> table<string, string>` | Parses a query string; `+` is a space and the last duplicate wins.                                           |
| `nitr.url.query_build(params) -> string`               | Builds a query string with sorted keys.                                                                      |
| `nitr.url.parse(value) -> table\|nil, string\|nil`     | Splits a URL into `{ scheme?, userinfo?, host?, port?, path, query?, fragment? }`. Not a full WHATWG parser. |

### `nitr.env`

_(std feature: `env`)_ — Read-only environment variables, limited to the
names `[env] allow` permits. `NITR_*` variables are never visible. See
[Environment variables](../server/configuration/env#the-nitr-env-builtin).

|                                                  |                                                                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `nitr.env.get(name, default?) -> string\|nil`    | The value, or the default when unset or not allowed.                                                             |
| `nitr.env.has(name) -> boolean`                  | Whether it is set and allowed.                                                                                   |
| `nitr.env.number(name, default?) -> number\|nil` | The value as a number; the default when unset or not a number.                                                   |
| `nitr.env.bool(name, default?) -> boolean\|nil`  | `1`/`true`/`yes`/`on` or `0`/`false`/`no`/`off` (any case). Empty is `false`; anything else returns the default. |

---

## Diagnostics

### `nitr.log`

_(std feature: `log`)_ — Structured logging, tied to the current
request. `fields` become keys in JSON logs. See
[Logging](../server/logging).

|                                |                     |
| ------------------------------ | ------------------- |
| `nitr.log.debug(msg, fields?)` | Debug-level record. |
| `nitr.log.info(msg, fields?)`  | Info-level record.  |
| `nitr.log.warn(msg, fields?)`  | Warn-level record.  |
| `nitr.log.error(msg, fields?)` | Error-level record. |

### `nitr.dbg`

`nitr.dbg(value) -> any` — _(std feature: `dbg`)_

Logs a value, including nested tables, and returns it unchanged.

### `nitr.errinfo`

`nitr.errinfo(caught) -> table`

Turns an error caught with `pcall` into the [error
table](./types#the-error-table): `kind`, `message`, `source`, `line`,
`traceback`, `cause`, `pretty`. See [Errors](../server/errors).

---

## Testing

### `nitr.test`

_(available in `nitr test` files only)_ — The test framework. See
[Testing](../server/testing) for a guide. Below, `t` is `nitr.test`
(`local t = nitr.test`).

#### Structure

|                               |                                                                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `t.describe(name, fn)`        | Groups tests. Names get the group prefix, and hooks inside apply to the group. An error in the body fails the group; the file continues. |
| `t.it(name, fn)`              | Registers one test.                                                                                                                      |
| `t.skip(name, fn_or_reason?)` | Registers a skipped test.                                                                                                                |
| `t.todo(name)`                | A test not written yet.                                                                                                                  |
| `t.only(name, fn)`            | Skips the file's other tests. The run exits `1` while any `only` remains.                                                                |
| `t.each(cases)(name, fn)`     | One test per case. A list case is formatted into `name` and unpacked into `fn`; a table case is passed whole.                            |
| `t.fail(message?)`            | Fails the current test.                                                                                                                  |
| `t.before_each(fn)`           | Runs before every later test in this group and nested groups.                                                                            |
| `t.after_each(fn)`            | Runs after every later test in this group, even when it failed.                                                                          |
| `t.before_all(fn)`            | Runs once before the group's first test that runs.                                                                                       |
| `t.after_all(fn)`             | Runs once after the group's last test that runs.                                                                                         |

#### Assertions

`t.expect(actual)` returns the matchers: `to_equal`, `to_not_equal`,
`to_be_nil`, `to_not_be_nil`, `to_be_truthy`, `to_be_false`,
`to_be_a(type)`, `to_have_length`, `to_have_key`, `to_be_greater_than`,
`to_be_greater_than_or_equal`, `to_be_less_than`,
`to_be_less_than_or_equal`, `to_match_object(subset)`,
`to_match(pattern)`, `to_not_match`, `to_contain`, `to_not_contain`,
`to_throw(text?)`, `to_not_throw`, `to_contain_log(subset)`. On a
response: `to_have_status(n)`, `to_have_header(name, value_or_pattern?)`,
`to_have_json(subset)`.

#### Requests

|                                                                                                |                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `t.request(method, path, opts?) -> nitr.test.Response`                                         | Sends a request through the full server path (protection, router, middleware, handler). Options: `headers`, `query`, `cookies`, `auth`, one of `json`/`form`/`multipart`/`body`, `remote_addr`, `timeout`. |
| `t.get` · `t.post` · `t.put` · `t.patch` · `t.delete` · `t.head` · `t.options` `(path, opts?)` | Shortcuts for `t.request`.                                                                                                                                                                                 |
| `t.client(opts?) -> nitr.test.Client`                                                          | A client with defaults: `{ base?, headers?, cookies = true?, remote_addr? }`. With `cookies = true`, its `jar` keeps cookies between calls.                                                                |
| `t.session_cookie(data, { secret, name?, max_age? }) -> string`                                | The cookie value `session:save` would write for `data`.                                                                                                                                                    |

The returned objects are described in [Types →
Testing](./types#nitr-test-response).

#### Unit tools

|                                         |                                                                                                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `t.fake_request(spec?) -> nitr.Request` | A request object from `{ method?, path?, params?, valid?, ... }` plus the request options. Skips protection, body limits and validation. |
| `t.app() -> nitr.test.App`              | The application compiled into the test state. See [`nitr.test.App`](./types#nitr-test-app).                                              |

#### Doubles

Reset before every test.

|                                                           |                                                                                                                               |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `t.fetch.mock(rule, ...)`                                 | Canned answers for `nitr.fetch`: `{ url, method?, status?, headers?, json? \| body?, times? }`; `url` exact or ending in `*`. |
| `t.fetch.strict(on?)`                                     | A request no rule matches raises instead of going out.                                                                        |
| `t.fetch.calls() -> table[]`                              | Every outbound call: `{ method, url, headers, body?, json?, mocked }`.                                                        |
| `t.fetch.reset()`                                         | Drops the rules, the calls and the strict flag.                                                                               |
| `t.clock.set(ts)` / `advance(secs)` / `now()` / `reset()` | Controls the clock behind `nitr.time`, session and JWT expiry, cache TTLs and the rate limiter.                               |
| `t.env.set(name, value)` / `unset(name)` / `reset()`      | Overrides `nitr.env`; names `[env] allow` hides stay hidden.                                                                  |
| `t.logs() -> table[]` / `t.logs.clear()`                  | The current test's log entries: `{ level, target, message, fields?, request_id? }`.                                           |

#### Database fixtures

|                          |                                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `t.db.reset()`           | Restores the database as it was after migrations, the config script and `[testing] seed`. |
| `t.db.truncate(tables?)` | Empties the named tables (all application tables without an argument).                    |
| `t.db.seed(spec)`        | Runs a SQL file under `[testing] dir`, or inserts `{ table = { row, ... } }`.             |
| `t.db.isolate()`         | Calls `reset()` after every test in the file.                                             |

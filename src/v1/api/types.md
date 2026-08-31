# Lua API Types

The objects the [`nitr.*` functions](./index) hand you. Every one is
covered by the generated `nitr-types.lua` completions, so your editor
knows all of this too.

## `nitr.Request`

The incoming request, passed to every handler and middleware. See
[Requests](../server/requests).

| Field         | Type                                          | Description                                                             |
| ------------- | --------------------------------------------- | ----------------------------------------------------------------------- |
| `method`      | `string`                                      | Request method, uppercase (`"GET"`).                                    |
| `path`        | `string`                                      | URI path (`"/users/42"`).                                               |
| `params`      | `table<string, string>`                       | Path parameters captured by the router (`:id` → `params.id`).           |
| `query`       | `table<string, string>`                       | Parsed query string; repeated keys keep the last value.                 |
| `headers`     | `table<string, string>`                       | Request headers, **lowercase names**.                                   |
| `id`          | `string`                                      | The request id (UUIDv7, echoed as `X-Request-ID`).                      |
| `remote_addr` | `string`                                      | Peer address (`"ip:port"`).                                             |
| `uri`         | `table`                                       | URI components: `scheme`, `host`, `port`, `path`, `authority`, `query`. |
| `cookies`     | [`nitr.RequestCookies`](#nitr-requestcookies) | Parsed request cookies.                                                 |

| Method                                    | Description                                                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `:json() -> table`                        | Reads and decodes the body as JSON. Errors on an empty or invalid body.                                                                          |
| `:text() -> string`                       | Reads the whole body as a string.                                                                                                                |
| `:form() -> table<string, string>`        | Reads an `application/x-www-form-urlencoded` body as a table. The parse is cached, so middleware and handler can both call it.                   |
| `:multipart(fn) -> integer`               | Invokes `fn(part)` once per part of a `multipart/form-data` body, in arrival order; returns the part count. Needs the `multipart` Cargo feature. |
| `:read(n?) -> string\|nil`                | Streams the body: the next chunk as it arrives, or at least `n` bytes. `nil` marks the end.                                                      |
| `:accepts(...) -> string\|nil`            | The best match among the given media types for the `Accept` header, or `nil`.                                                                    |
| `:fresh(etag, last_modified?) -> boolean` | Whether the client's cached copy is current, per `If-None-Match` / `If-Modified-Since`.                                                          |

## `nitr.RequestCookies`

Cookies from the `Cookie` header. Index by name: `req.cookies.session`.

| Method                                 | Description                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `:verify(name, secret) -> string\|nil` | The verified value of a signed cookie, or `nil` when missing **or** tampered. |

See [Cookies & sessions](../server/cookies-sessions).

## `nitr.Response`

A response: `{ status, headers, body }` plus a cookie builder. The
helpers build these; handlers may also build them by hand. See
[Responses](../server/responses).

| Field     | Type                                            | Description                                                                    |
| --------- | ----------------------------------------------- | ------------------------------------------------------------------------------ |
| `status`  | `integer`                                       | HTTP status code. Default `200`.                                               |
| `headers` | `table`                                         | Response headers. A value may be a string, an integer, or an array of strings. |
| `body`    | `string \| fun(...) \| nil`                     | Body string, or a [streaming body](../server/streaming) function.              |
| `cookies` | [`nitr.ResponseCookies`](#nitr-responsecookies) | `Set-Cookie` builder, attached by the helpers.                                 |

## `nitr.ResponseCookies`

Builder for `Set-Cookie` headers on a response.

| Method                                    | Description                                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `:set(name, value, opts?)`                | Adds a cookie. Options: `http_only`, `secure`, `path`, `domain`, `max_age` (seconds), `same_site` (`"Strict"` / `"Lax"` / `"None"`). |
| `:set_signed(name, value, secret, opts?)` | Adds an HMAC-signed cookie, verifiable later with `req.cookies:verify`.                                                              |

> [!NOTE] `secure` has a server-resolved default
>
> Leave `secure` out and the `[cookies] secure` policy decides — the
> default `"auto"` means Secure whenever [TLS](../server/tls) is enabled
> for this process. An explicit value from Lua always wins, in both
> directions, and the resolution also covers `:set(name, value)` called
> with no options table at all. Every other attribute here is exactly
> what you pass: unlike the session and CSRF cookies, these do not
> extend a set of defaults.

## `nitr.App`

The application: routes, middleware, error handling, static mounts.
Return it from the handler script. See [Routing](../server/routing).

| Method                       | Description                                                                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `:get(path, ...)`            | Registers a GET route: `middleware..., handler`, plus an optional trailing `{ on_error = fn }`. Paths take `:name` parameters and a trailing `*` catch-all. |
| `:post(path, ...)`           | Registers a POST route (see `get`).                                                                                                                         |
| `:put(path, ...)`            | Registers a PUT route (see `get`).                                                                                                                          |
| `:delete(path, ...)`         | Registers a DELETE route (see `get`).                                                                                                                       |
| `:patch(path, ...)`          | Registers a PATCH route (see `get`).                                                                                                                        |
| `:head(path, ...)`           | Registers a HEAD route. Without one, HEAD reuses the GET route with the body stripped.                                                                      |
| `:options(path, ...)`        | Registers an OPTIONS route. Without one, OPTIONS answers `204` with `Allow`.                                                                                |
| `:use(mw)`                   | Adds app-wide middleware: a factory `fn(next) -> fn(req)`. **Must be called before any route.**                                                             |
| `:on_error(handler)`         | Sets the app-wide error handler: `fn(err, req)`, where `err` is the [structured error](../server/errors#the-error-value).                                   |
| `:static(mount, dir, opts?)` | Mounts a static directory, served in Rust. Options: `{ spa = boolean, cache_control = string }`.                                                            |

## `nitr.Part`

One part of a multipart upload, delivered to the `req:multipart`
callback. See [Requests → File uploads](../server/requests#file-uploads).

| Field / method               | Description                                                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `name: string`               | Form field name. A part with no name yields `""`, never `nil` — so test it with `part.name ~= ""`, not `if part.name`.              |
| `filename: string\|nil`      | The client-supplied file name, **exactly as sent** — raw and untrusted. `nil` for an ordinary field, a string for a file.           |
| `safe_filename: string\|nil` | The same name reduced to a plain file name: no separators, no control characters, never empty. `nil` exactly when `filename` is.    |
| `content_type: string\|nil`  | Part content type.                                                                                                                  |
| `:text() -> string`          | Reads a non-file field as a string, bounded by `[limits] max_field_bytes`.                                                          |
| `:save(path) -> integer`     | Streams a file part to `path` — resolved inside `[multipart] upload_dir` — without it entering the Lua heap; returns bytes written. |
| `:discard() -> integer`      | Drains and drops the part; returns the bytes skipped.                                                                               |

> [!TIP] Prefer `safe_filename` — and keep `filename` for the record
>
> `filename` is attacker-controlled text: `../../etc/passwd`,
> `C:\Windows\evil.exe`, a name full of control characters, or nothing
> at all. It stays raw on purpose — applications legitimately record
> what the user called their file — so `safe_filename` is a **second**
> value, not a replacement.
>
> `safe_filename` is that name reduced to something that can only ever
> name a file directly inside the upload root: the last path segment
> (both `/` and `\` count, because the sender's OS is not yours),
> control characters dropped, leading and trailing dots and spaces
> trimmed, truncated to 255 bytes on a character boundary, and `upload`
> when nothing survives.
>
> | Sent by the client       | `safe_filename` |
> | ------------------------ | --------------- |
> | `report.pdf`             | `report.pdf`    |
> | `../../etc/passwd`       | `passwd`        |
> | `C:\Windows\evil.exe`    | `evil.exe`      |
> | `.hidden`                | `hidden`        |
> | `name.txt. . `           | `name.txt`      |
> | `..`, `/`, empty, spaces | `upload`        |
>
> Because the result contains no separator by construction,
> `part:save(part.safe_filename)` is safe on its own and the upload root
> is a backstop rather than the only defense. It is also `nil` exactly
> when `filename` is, so `if part.safe_filename then` remains the same
> "is this a file?" test.

> [!WARNING] `part:save` needs `[multipart] upload_dir`
>
> Without that key the call is **unavailable** — there is no safe
> directory to guess. Paths are **relative** to that root: an absolute
> path, or one climbing out with `..`, is refused rather than re-rooted,
> so where a file lands always follows from the source. Missing
> intermediate directories are an error too, not an implicit
> `create_dir_all`.
>
> A refused path is rejected **before** the part is consumed, so a
> handler can catch the error and still `:discard()` the part or retry
> with `safe_filename`.

## `nitr.FetchHandle`

An **unsent** outbound request from `nitr.fetch`. Send it, or hand it to
`nitr.await_all`. See [Outbound HTTP](../server/fetch).

| Method                          | Description           |
| ------------------------------- | --------------------- |
| `:send() -> nitr.FetchResponse` | Performs the request. |

## `nitr.FetchResponse`

An outbound response.

| Field / method                   | Description                                                    |
| -------------------------------- | -------------------------------------------------------------- |
| `status: integer`                | HTTP status code.                                              |
| `headers: table<string, string>` | Response headers.                                              |
| `url: string`                    | Final URL **after redirects**.                                 |
| `:text() -> string`              | The body as a string, bounded by `[fetch] max_response_bytes`. |
| `:json() -> table`               | The body decoded as JSON.                                      |
| `:read() -> string\|nil`         | Streams the body chunk by chunk; `nil` at the end.             |

## `nitr.Schema`

A compiled validation schema from `nitr.validate.schema`. See
[Validation](../server/validation).

| Method                                    | Description                                                                                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `:check(value) -> table\|nil, table\|nil` | Validates a value. Returns the data (**declared fields only**), or `nil` plus `{ message, fields }` mapping each failing path to its message. |

## `nitr.Session`

A stateless signed-cookie session from `nitr.session`. Assign fields
directly (`session.user_id = 42`). See
[Sessions](../server/cookies-sessions#sessions).

| Method        | Description                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| `:save(resp)` | Serializes the session into a signed cookie on the response. An empty session **deletes** the cookie. |
| `:clear()`    | Removes every field; `save` then writes the deletion cookie.                                          |

> [!WARNING] The whole session travels in the cookie
>
> `save` refuses a session whose JSON exceeds 2800 bytes — chosen so the
> signed, base64-encoded cookie stays under the ~4 KiB browsers enforce
> — rather than emitting a cookie the browser would drop. Store a key
> here and the rest in the database. `save` and `clear` are also
> reserved names: a data field called either would shadow the method
> forever after, so it is rejected instead of saved.

## `nitr.Tx`

A database transaction handle inside `nitr.db:transaction`. Same query
API as [`nitr.db`](./index#nitr-db) — `execute`, `query`, `query_row`,
`query_one` — plus nesting via savepoints.

> [!WARNING] Use `tx`, not the outer `nitr.db`
>
> The outer handle refuses to run while a transaction is open, rather
> than silently joining it. See
> [Database → Transactions](../server/database#transactions).

## The error table

Not a named type, but the shape every `on_error` handler and
`nitr.errinfo` produces:

| Field       | Description                                                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `kind`      | One of `"lua"`, `"nitr"`, `"module"`, `"timeout"`, `"memory"`, `"panic"`. A **closed set** — branch on this, never on `message`. |
| `message`   | The failure message.                                                                                                             |
| `source`    | The failing chunk, when known.                                                                                                   |
| `line`      | The failing line, when known.                                                                                                    |
| `module`    | The failing module, when attributed.                                                                                             |
| `traceback` | Bounded Lua call stack, innermost first.                                                                                         |
| `cause`     | Bounded underlying Rust error chain.                                                                                             |
| `pretty`    | The concise form for a console `print` — ANSI-colored on a terminal, identical to plain text otherwise.                          |

> [!NOTE] `tostring(err)` stays plain
>
> `pretty` is the only colored field. `tostring(err)`, and concatenating
> an error into a string, deliberately produce uncolored text — those
> strings end up in HTTP bodies and log files.

See [Errors](../server/errors#the-error-value).

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

| Field / method              | Description                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `name: string\|nil`         | Form field name.                                                                     |
| `filename: string\|nil`     | Client-supplied file name. **Never trust it** — run it through `nitr.path.basename`. |
| `content_type: string\|nil` | Part content type.                                                                   |
| `:text() -> string`         | Reads a non-file field as a string, bounded by `[limits] max_field_bytes`.           |
| `:save(path) -> integer`    | Streams a file part to `path` without entering the Lua heap; returns bytes written.  |
| `:discard()`                | Drains and drops the part.                                                           |

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

See [Errors](../server/errors#the-error-value).

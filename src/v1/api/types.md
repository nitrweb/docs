# Lua API Types

The objects the [`nitr.*` functions](./index) return or pass to you. The
generated `nitr-types.lua` describes all of them for your editor.

## `nitr.Request`

The incoming request, passed to every handler and middleware. See
[Requests](../server/requests).

| Field         | Type                                          | Description                                                                             |
| ------------- | --------------------------------------------- | --------------------------------------------------------------------------------------- |
| `method`      | `string`                                      | Request method, uppercase (`"GET"`).                                                    |
| `path`        | `string`                                      | URI path (`"/users/42"`).                                                               |
| `params`      | `table<string, string>`                       | Path parameters captured by the router (`:id` → `params.id`).                           |
| `query`       | `table<string, string>`                       | Parsed query string; for a repeated key the last value wins.                            |
| `headers`     | `table<string, string>`                       | Request headers, with **lowercase names**.                                              |
| `id`          | `string`                                      | The request id (UUIDv7, sent back as `X-Request-ID`).                                   |
| `remote_addr` | `string`                                      | Peer address (`"ip:port"`).                                                             |
| `uri`         | `table`                                       | URI parts: `scheme`, `host`, `port`, `path`, `authority`, `query`.                      |
| `cookies`     | [`nitr.RequestCookies`](#nitr-requestcookies) | Parsed request cookies.                                                                 |
| `valid`       | `table\|nil`                                  | The route's validated input, `{ body, query, params, headers }`; `nil` without `input`. |

`req.valid` holds only the parts the route's
[`input`](../server/validation/route-input) declared, converted to the
declared types, with unknown fields removed and defaults filled in. The
raw fields (`req.params`, `req.query`, `req:json()`) still hold what the
client sent.

| Method                                     | Description                                                                                                                                          |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `:json() -> table`                         | Reads and decodes the body as JSON. Errors on an empty or invalid body.                                                                              |
| `:text() -> string`                        | Reads the whole body as a string.                                                                                                                    |
| `:form() -> table<string, string>`         | Reads an `application/x-www-form-urlencoded` body. The result is cached, so middleware and handler can both call it.                                 |
| `:multipart(fn) -> integer`                | Calls `fn(part)` for each [part](#nitr-part) of a `multipart/form-data` body, in order; returns the part count. Needs the `multipart` Cargo feature. |
| `:read(n?) -> string\|nil`                 | Streams the body: the next chunk, or at least `n` bytes. `nil` at the end.                                                                           |
| `:accepts(...) -> string\|nil`             | The best match for the `Accept` header among the given media types, or `nil`.                                                                        |
| `:fresh(etag?, last_modified?) -> boolean` | Whether the client's cached copy is current, per `If-None-Match` / `If-Modified-Since`.                                                              |

## `nitr.RequestCookies`

Cookies from the `Cookie` header. Index by name: `req.cookies.session`.
See [Cookies & sessions](../server/cookies-sessions).

| Method                                 | Description                                                           |
| -------------------------------------- | --------------------------------------------------------------------- |
| `:verify(name, secret) -> string\|nil` | The value of a signed cookie, or `nil` when missing or tampered with. |

## `nitr.Response`

A response table: `{ status, headers, body }` plus a cookie builder. The
helpers build these, and handlers may also build them by hand. See
[Responses](../server/responses).

| Field     | Type                                            | Description                                                                 |
| --------- | ----------------------------------------------- | --------------------------------------------------------------------------- |
| `status`  | `integer`                                       | HTTP status code. Default `200`.                                            |
| `headers` | `table`                                         | Response headers. A value may be a string, an integer or a list of strings. |
| `body`    | `string \| fun(...) \| nil`                     | Body string, or a [streaming body](../server/streaming) function.           |
| `cookies` | [`nitr.ResponseCookies`](#nitr-responsecookies) | `Set-Cookie` builder, attached by the helpers.                              |

## `nitr.ResponseCookies`

Builds `Set-Cookie` headers on a response.

| Method                                    | Description                                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `:set(name, value, opts?)`                | Adds a cookie. Options: `http_only`, `secure`, `path`, `domain`, `max_age` (seconds), `same_site` (`"Strict"` / `"Lax"` / `"None"`). |
| `:set_signed(name, value, secret, opts?)` | Adds an HMAC-signed cookie, readable later with `req.cookies:verify`.                                                                |

Without `secure`, the [`[cookies] secure`](../server/configuration/file#cookies)
setting decides (by default: on when TLS is enabled). Other attributes
are exactly what you pass.

> [!WARNING] Cookie names and values must be valid cookie text
>
> `:set` raises on a value with whitespace, quotes, commas, semicolons or
> backslashes. Encode untrusted text with `nitr.base64.encode`, or use
> `:set_signed`, which encodes for you.

## `nitr.App`

The application: routes, middleware, error handling and static files.
Return it from the handler script. See [Routing](../server/routing).

| Method                       | Description                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `:get(path, ...)`            | Registers a GET route: `middleware..., handler`, then an optional [options table](#route-options). Paths take `:name` parameters and a trailing `*`. |
| `:post(path, ...)`           | Registers a POST route (see `get`).                                                                                                                  |
| `:put(path, ...)`            | Registers a PUT route (see `get`).                                                                                                                   |
| `:delete(path, ...)`         | Registers a DELETE route (see `get`).                                                                                                                |
| `:patch(path, ...)`          | Registers a PATCH route (see `get`).                                                                                                                 |
| `:head(path, ...)`           | Registers a HEAD route. Without one, HEAD uses the GET route and drops the body.                                                                     |
| `:options(path, ...)`        | Registers an OPTIONS route. Without one, OPTIONS answers `204` with `Allow`.                                                                         |
| `:use(mw)`                   | Adds app-wide middleware: a factory `fn(next) -> fn(req)`. **Call it before any route.**                                                             |
| `:on_error(handler)`         | Sets the app-wide error handler `fn(err, req)`; `err` is the [error table](#the-error-table).                                                        |
| `:on_invalid(handler)`       | Sets the app-wide answer to failed `input` validation: `fn(err, req)`. A route's own `on_invalid` wins. Default: JSON `422`.                         |
| `:doc(info)`                 | App-level information for the [OpenAPI document](../server/openapi/documenting#app-doc). Once per app.                                               |
| `:static(mount, dir, opts?)` | Serves a directory. Options: `spa`, `cache_control`, `dotfiles`. Dotfiles answer `404` unless `dotfiles = true`; `.well-known/` is always served.    |

### Route options

The optional table after the handler. Unknown keys fail at load.

| Key          | What it does                                                                                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `input`      | `{ body, query, params, headers }` schemas, checked before the handler and passed as `req.valid`. See [Route input](../server/validation/route-input).                                          |
| `doc`        | `{ summary, description, tags, operation_id, responses, security, deprecated, hidden }` for the [OpenAPI document](../server/openapi/documenting#per-route-doc). Request schemas go in `input`. |
| `on_invalid` | `fn(err, req)`: this route's answer to failed `input` validation.                                                                                                                               |
| `on_error`   | `fn(err, req)`: this route's error handler.                                                                                                                                                     |

```lua
app:post("/api/notes", function(req)
    return nitr.json(create(req.valid.body), 201)
end, {
    input = { body = NoteInput },
    doc   = { summary = "Create a note", tags = { "notes" },
              responses = { [201] = { description = "Created", schema = Note } } },
})
```

## `nitr.Part`

One part of a multipart upload, passed to the `req:multipart` callback.
See [Requests → File uploads](../server/requests#file-uploads).

| Field / method               | Description                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `name: string`               | Form field name; `""` when the part has none.                                                            |
| `filename: string\|nil`      | The file name exactly as the client sent it (untrusted). `nil` for an ordinary field.                    |
| `safe_filename: string\|nil` | `filename` reduced to a single safe file name (`../../etc/passwd` → `passwd`). `nil` when `filename` is. |
| `content_type: string\|nil`  | Part content type.                                                                                       |
| `:text() -> string`          | Reads a non-file field, up to `[limits] max_field_bytes`.                                                |
| `:save(path) -> integer`     | Streams the part to `path` inside `[multipart] upload_dir`; returns the bytes written.                   |
| `:discard() -> integer`      | Reads and drops the part; returns the bytes skipped.                                                     |

`:save` needs `[multipart] upload_dir`. The path must be relative to it,
and missing directories are not created. `part:save(part.safe_filename)`
is always safe.

## `nitr.FetchHandle`

An **unsent** request from `nitr.fetch`. Send it, or pass it to
`nitr.await_all`. See [Outbound HTTP](../server/fetch).

| Method                          | Description           |
| ------------------------------- | --------------------- |
| `:send() -> nitr.FetchResponse` | Performs the request. |

## `nitr.FetchResponse`

The response to an outbound request.

| Field / method                   | Description                                               |
| -------------------------------- | --------------------------------------------------------- |
| `status: integer`                | HTTP status code.                                         |
| `headers: table<string, string>` | Response headers.                                         |
| `url: string`                    | Final URL after redirects.                                |
| `:text() -> string`              | The body as a string, up to `[fetch] max_response_bytes`. |
| `:json() -> table`               | The body decoded as JSON.                                 |
| `:read() -> string\|nil`         | Streams the body chunk by chunk; `nil` at the end.        |

## `nitr.Schema`

A compiled schema from `nitr.validate.schema`. See
[Validation](../server/validation/).

| Method                                    | Description                                                                                                                |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `:check(value) -> table\|nil, table\|nil` | Validates a value. Returns the data (declared fields only, transformed), or `nil` plus the [error](#the-validation-error). |
| `:partial() -> nitr.Schema`               | A copy with every top-level field optional, such as a PATCH body.                                                          |
| `:pick(names) -> nitr.Schema`             | A copy with only the named fields.                                                                                         |
| `:omit(names) -> nitr.Schema`             | A copy without the named fields. Fails at load if a cross-field rule uses a removed field.                                 |
| `:extend(fields) -> nitr.Schema`          | A copy with fields added or replaced; `false` removes one.                                                                 |
| `:with(opts) -> nitr.Schema`              | A copy with different options (`title`, `strict`, `messages`, the cross-field groups, `checks`).                           |
| `:fields() -> string[]`                   | The declared field names, sorted.                                                                                          |

Each method returns a new schema and leaves the original unchanged. See
[Composition](../server/validation/composition).

### The validation error

The second value from `:check`, and the body of the default `422`.

| Field     | Description                                                                                         |
| --------- | --------------------------------------------------------------------------------------------------- |
| `code`    | Always `"VALIDATION_FAILED"`.                                                                       |
| `message` | Summary line; `"validation failed"` unless overridden.                                              |
| `fields`  | Path → message: `email`, `home.city`, `tags[2]`. On a route, prefixed with the part (`body.email`). |
| `errors`  | One entry per failing path, sorted: `{ path, part?, field, rule, message, params?, label? }`.       |

`params` holds the rule's parameters (`{ max = 20 }`), never the
submitted value. See [Messages & errors](../server/validation/messages).

## `nitr.File`

An upload that passed a route's [`file` rule](../server/validation/files).
The bytes stay on disk under `[multipart] upload_dir` and never enter
Lua memory. A file you neither save nor discard is deleted when the
request ends.

| Field / method               | Description                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `filename: string\|nil`      | The client's file name, unchanged. For display only, never as a path.                   |
| `safe_filename: string\|nil` | That name reduced to one safe file name.                                                |
| `extension: string\|nil`     | The lowercase last extension of `safe_filename`.                                        |
| `content_type: string`       | The media type detected from the bytes (the client's header only when detection fails). |
| `size: integer`              | Bytes received.                                                                         |
| `width: integer\|nil`        | Image width (png, jpeg, gif, webp, bmp, tiff).                                          |
| `height: integer\|nil`       | Image height.                                                                           |
| `:save(rel) -> string`       | Moves the file to `rel` inside `[multipart] upload_dir`; returns the path.              |
| `:text() -> string`          | The contents, for a file within `[limits] max_field_bytes`.                             |
| `:hash(algo?) -> string`     | A hex digest read from disk. `sha256` is the default and only algorithm.                |
| `:discard()`                 | Deletes the file now.                                                                   |

## `nitr.Session`

A session stored in a signed cookie, from `nitr.session`. Set fields
directly (`session.user_id = 42`). See
[Sessions](../server/cookies-sessions#sessions).

| Method        | Description                                                                           |
| ------------- | ------------------------------------------------------------------------------------- |
| `:save(resp)` | Writes the session into a signed cookie on the response. An empty session deletes it. |
| `:clear()`    | Removes every field; `save` then deletes the cookie.                                  |

> [!WARNING] Keep sessions small
>
> `save` raises when the session's JSON exceeds 2800 bytes, so the cookie
> fits the browser's 4 KiB limit. Store an id here and the rest in the
> database. The field names `save`, `clear` and `_exp` are reserved.

## `nitr.Tx`

The transaction handle passed to `nitr.db:transaction`. It has the same
query methods as [`nitr.db`](./index#nitr-db) and can nest transactions.
See [Database → Transactions](../server/database#transactions).

> [!WARNING] Use `tx`, and only inside the block
>
> `nitr.db` raises while a transaction is open, and `tx` raises once the
> block has returned. Build `query_async` handles from `tx` when they
> should run in the transaction.

## The error table

What `on_error` handlers receive and `nitr.errinfo` returns. See
[Errors](../server/errors#the-error-value).

| Field       | Description                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------- |
| `kind`      | One of `"lua"`, `"nitr"`, `"module"`, `"timeout"`, `"memory"`, `"panic"`. Branch on this, not on `message`.       |
| `message`   | The error message.                                                                                                |
| `source`    | The script where it failed, when known.                                                                           |
| `line`      | The line where it failed, when known.                                                                             |
| `module`    | The module that failed, when known.                                                                               |
| `traceback` | The Lua call stack (shortened), innermost first.                                                                  |
| `cause`     | The underlying Rust error chain (shortened).                                                                      |
| `pretty`    | A short form for printing to a console, colored on a terminal. `tostring(err)` gives the same text without color. |

## Testing types

These exist only in [`nitr test`](./index#nitr-test) files.

### `nitr.test.Response`

The result of `t.request` and its shortcuts.

| Field / method                   | Description                                                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `status: integer`                | The status code.                                                                                                                         |
| `headers: table<string, string>` | Lowercase name → last value. Call `resp:headers(name)` for every value.                                                                  |
| `raw_headers: table[]`           | `{ name, value }` pairs in order, repeats included.                                                                                      |
| `body: string`                   | The whole body; streams are collected.                                                                                                   |
| `cookies: table<string, table>`  | Name → `{ value, path, domain, max_age, expires, secure, http_only, same_site }` from every `Set-Cookie`.                                |
| `error: table\|nil`              | When the handler raised: the [error table](#the-error-table) plus `handled` (true when `on_error` answered). Never sent to real clients. |
| `:json() -> any`                 | The body decoded as JSON; raises if it is not JSON.                                                                                      |
| `:text() -> string`              | The body as a string.                                                                                                                    |
| `:header(name) -> string\|nil`   | The first value of a header.                                                                                                             |
| `:sse() -> table[]`              | The body parsed as Server-Sent Events: `{ event?, data, id?, retry? }` per event.                                                        |

### `nitr.test.Client`

A client from `t.client`, with its defaults and cookie jar applied to
every request.

| Field / method                                                                          | Description                                         |
| --------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `jar: nitr.test.Jar\|nil`                                                               | The cookie jar, when created with `cookies = true`. |
| `:request(method, path, opts?) -> nitr.test.Response`                                   | Sends a request.                                    |
| `:get` · `:post` · `:put` · `:patch` · `:delete` · `:head` · `:options` `(path, opts?)` | Shortcuts for `:request`.                           |

### `nitr.test.Jar`

A client's cookie jar. It stores cookies by name and path, honours
`Max-Age` and `Expires` (using `t.clock`), and records but does not
enforce `Secure` and `Domain`.

| Method                     | Description                                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `:get(name) -> table\|nil` | `{ name, value, path, domain?, secure?, http_only?, same_site?, expires_at? }`, or `nil` once deleted or expired. |
| `:set(name, value, opts?)` | Stores a cookie as if the server had set it. `opts` is `{ path? }`.                                               |
| `:clear()`                 | Forgets every cookie.                                                                                             |

### `nitr.test.App`

The application compiled into the test state, from `t.app()`. Its
top-level code and `app:use` factories run once more in the test state,
and nothing it registers is served.

| Method                                      | Description                                                                                                                                  |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `:handler(method, path) -> fun(req): table` | A route's handler without its middleware, by pattern (`"/notes/:id"`) or by a path the router matches.                                       |
| `:dispatch(method, path, req) -> table`     | Routes `req` (filling `req.params`) and runs the middleware chain and handler. Unmatched paths answer `404`, `405` or the `OPTIONS` default. |
| `:routes() -> table[]`                      | `{ method, path, file, line }` per route, in registration order.                                                                             |

`:dispatch` skips `input` validation, `on_invalid`, `on_error` and the
protection layer; use `t.request` to test those.

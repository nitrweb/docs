# Route Input Validation

A route can declare what it accepts. Nitr then checks the request **in
Rust, before your handler runs**, and hands the handler the result as
`req.valid`.

```lua
app:post("/api/notes", function(req)
    local note = req.valid.body          -- checked, typed, stripped
    return nitr.json(create_note(note), 201)
end, { input = { body = NoteInput } })
```

There is no `if not data then` in that handler, because a request that
would have failed never got there.

## The `input` table

`input` is one of the keys a route's trailing [options
table](../routing#route-options) may carry, beside `doc`, `on_invalid`
and `on_error`.

| Key       | Validates                                                                           | Reaches the handler as |
| --------- | ----------------------------------------------------------------------------------- | ---------------------- |
| `body`    | The request body                                                                    | `req.valid.body`       |
| `query`   | The query string                                                                    | `req.valid.query`      |
| `params`  | The path parameters (`:id`)                                                         | `req.valid.params`     |
| `headers` | Request headers, by **lowercase** name                                              | `req.valid.headers`    |
| `strict`  | `true` to report undeclared fields in this route's parts, instead of stripping them |                        |

Declare only the parts you care about. A part you leave out is absent
from `req.valid`.

```lua
app:get("/api/notes/:id", function(req)
    local note = notes[req.valid.params.id]          -- an integer, not "42"
    if not note then return nitr.error(404, { code = "NOT_FOUND" }) end
    return nitr.json(note)
end, {
    input = {
        params  = { id = "integer|min:1" },
        query   = { fields = "string|one_of:short,full|default:short" },
        headers = { ["x-team"] = "string|format:alpha_dash|required" },
    },
})
```

> [!NOTE] `req.valid` is `nil` without an `input`
>
> Routes you have not annotated behave exactly as before. `req.valid`
> exists only where a route declared something, so `if req.valid then`
> is a meaningful test in shared middleware.

## Text becomes values

A query string, a path parameter, a header and an HTML form all carry
**text**. The schema says what that text means, and Nitr converts before
checking — so `limit=20` reaches you as the number `20`.

| Declared  | `"20"` | `"on"` | `"true"` | `""` (blank)                   |
| --------- | ------ | ------ | -------- | ------------------------------ |
| `integer` | `20`   | —      | —        | **absent**                     |
| `number`  | `20`   | —      | —        | **absent**                     |
| `boolean` | —      | `true` | `true`   | **absent**                     |
| `string`  | `"20"` | `"on"` | `"true"` | `""` — a value, not an absence |

Booleans accept `true`/`1`/`on` and `false`/`0`, which is what browsers
send: an unchecked checkbox sends nothing at all, a checked one sends
`on`.

Parsing is strict on purpose. `+20`, `20`, `0x10`, `1e3`, `020` and
`nan` are **not** integers, so they stay the strings they were and the
type rule reports them — one message for one mistake, rather than a
number the client did not write.

```lua
input = {
    query = {
        limit  = "integer|min:1|max:100|default:20",
        offset = "integer|min:0|default:0",
        sort   = "string|one_of:id,priority,due|default:id",
        draft  = "boolean|default:false",
    },
}
```

```console
GET /api/notes?limit=abc
→ 422  { "fields": { "query.limit": "must be an integer" } }

GET /api/notes?limit=500
→ 422  { "fields": { "query.limit": "must be at most 100" } }

GET /api/notes
→ 200  req.valid.query == { limit = 20, offset = 0, sort = "id", draft = false }
```

### Repeated keys and `name[]`

A key that appears more than once collects into an array when the rule
says `array`; `name[]` is read as `name`, which is how HTML forms and
most clients spell a list.

```lua
input = { query = { tags = { "array|max_items:3", items = "string|format:slug" } } }
```

```console
GET /items?tags=a&tags[]=b       →  req.valid.query.tags == { "a", "b" }
```

Repeated **header lines** collect the same way, and a failing one is
reported by index:

```json
{
  "fields": {
    "headers.x-team[2]": "must be letters, digits, hyphens or underscores"
  }
}
```

## Bodies and content types

A bare schema under `body` accepts **JSON and urlencoded forms** —
the two shapes a body arrives in without extra machinery.

```lua
input = { body = NoteInput }                       -- json, form
```

Say `content` to change that:

```lua
-- JSON only.
input = { body = { schema = NoteInput, content = { "json" } } }

-- An HTML form that may also carry files.
input = { body = { schema = Profile, content = { "form", "multipart" } } }

-- The whole body is one file (see File uploads).
input = { body = { file = nitr.validate.image({ max_bytes = "2mb" }), content = { "raw" } } }
```

| `content`     | Media type                                      |
| ------------- | ----------------------------------------------- |
| `"json"`      | `application/json`, or no `Content-Type` at all |
| `"form"`      | `application/x-www-form-urlencoded`             |
| `"multipart"` | `multipart/form-data`                           |
| `"raw"`       | Anything — the body is one file                 |

A body that does not match answers **`415`**, naming what the route does
accept, with an `Accept` response header saying the same thing:

```console
$ curl -siX POST localhost:3000/api/notes -H 'content-type: text/plain' -d hi
HTTP/1.1 415 Unsupported Media Type
accept: application/json, application/x-www-form-urlencoded
content-type: application/json
```

```json
{
  "code": "UNSUPPORTED_MEDIA_TYPE",
  "message": "unsupported media type; accepted: application/json, application/x-www-form-urlencoded",
  "accepted": ["application/json", "application/x-www-form-urlencoded"]
}
```

### The raw body is still yours

Validation does not consume the body. `req:json()`, `req:form()` and
`req:text()` all still work in the handler, reading the same cached
bytes — useful when you want the checked view _and_ the original.

```lua
app:post("/notes", function(req)
    local clean = req.valid.body        -- stripped and normalized
    local raw   = req:json()            -- exactly what arrived
end, { input = { body = NoteInput } })
```

## When it fails: the `422`

The default answer is a JSON `422` with the [full error
shape](./messages#the-error-shape):

```json
{
  "code": "VALIDATION_FAILED",
  "message": "validation failed",
  "fields": {
    "body.text": "is required",
    "query.limit": "must be at most 100"
  },
  "errors": [
    {
      "path": "body.text",
      "part": "body",
      "field": "text",
      "rule": "required",
      "message": "is required"
    },
    {
      "path": "query.limit",
      "part": "query",
      "field": "limit",
      "rule": "max",
      "message": "must be at most 100",
      "params": { "max": 100 }
    }
  ]
}
```

Every path is prefixed with the part it came from, so one response can
carry failures from the body, the query and the headers at once and you
can still tell them apart.

## Shaping the answer: `on_invalid`

Set it per route, or once for the whole application. A route-level
`on_invalid` wins.

```lua
-- App-wide: JSON for scripts, plain text for a browser form post.
app:on_invalid(function(err, req)
    nitr.log.debug("rejected", { path = req.path, fields = err.fields })
    if req:accepts("application/json", "text/html") == "text/html" then
        local lines = { err.message }
        for _, e in ipairs(err.errors) do
            lines[#lines + 1] = e.path .. ": " .. e.message
        end
        return nitr.text(table.concat(lines, "\n"), 422)
    end
    return nitr.error(422, { code = err.code, message = err.message,
                             fields = err.fields, errors = err.errors })
end)
```

```lua
-- Per route: this one speaks a legacy client's dialect.
app:post("/v1/import", handler, {
    input = { body = ImportSchema },
    on_invalid = function(err, req)
        return nitr.error(400, { error = err.errors[1].message })
    end,
})
```

`err` is the same table `schema:check` returns as its second value —
`{ code, message, fields, errors }` — with the part prefixes applied.

Re-rendering a form is the case this exists for:

```lua
app:post("/signup", function(req)
    return nitr.redirect("/welcome", 303)
end, {
    input = { body = { schema = Signup, content = { "form" } } },
    on_invalid = function(err, req)
        return nitr.html(nitr.template:render("signup.j2", {
            errors = err.fields,        -- name → message, ready for the template
            values = req:form(),        -- what they typed, to fill the form back in
        }), 422)
    end,
})
```

## Where validation sits in the request

```text
limits (413, 414) → routing (404, 405) → input validation (415, 422) → middleware → handler
```

Two consequences worth knowing:

- **Validation runs before your middleware.** A route with both an
  `input` and an auth middleware answers `422` to a malformed request
  from an unauthenticated client — the cheap check runs first, and no
  Lua state does work for a body that was never going to be accepted.
  If you need auth to be decided first, check it in the handler.
- **Size limits are not validation.** A body over
  `[limits] max_body_bytes` is a `413` before any schema is consulted.
  `max_bytes` in a schema bounds one _field_; `[limits]` bounds the
  request.

> [!NOTE] A bug in a `check` is still a `500`
>
> `on_invalid` answers _invalid input_. A `check` function that raises
> — a nil index, a typo — is an application error, so it reaches
> [`on_error`](../errors) as a `500` and is logged as one. Rejecting a
> value and crashing on it never get confused.

## `strict`: report unknown fields

By default undeclared fields are **stripped**. Set `strict` to have them
reported instead:

```lua
app:post("/strict", handler, {
    input = { body = { a = "string" }, strict = true },
})
```

```console
POST {"a":"x","titel":1}
→ 422  { "fields": { "body.titel": "is not a known field" } }
```

Useful for an internal API where a misspelled field is a caller bug
worth surfacing; wrong for a public one, where a client sending an extra
field it invented should not break. A schema can also carry
[`strict` as an option](./composition#strict-report-unknown-fields),
which the route-level flag overrides.

## Declarations are checked when the app loads

An `input` that cannot work is a startup error naming the route and the
line that registered it — never a surprise at the first request:

```text
app.lua:42: app:post("/upload", ...): a `file` rule needs `content = { "multipart" }`, which is opt-in
app.lua:57: app:get("/items/:id", ...): input.params names `di`, which the route pattern does not capture (captured: id)
app.lua:12: app:post("/x", ...): unknown option `imput` (allowed: on_error, on_invalid, input, doc)
```

`nitr check` performs the same build, so CI catches all of them.

## Testing a validated route

`nitr test` speaks the three body shapes, so an upload or a form post is
testable without a browser:

```lua
t.it("rejects an empty note before the handler runs", function()
    local resp = t.request("POST", "/api/notes", { json = {} })
    t.expect(resp.status).to_equal(422)
    t.expect(resp:json().fields["body.text"]).to_equal("is required")
    t.expect(resp:json().errors[1].rule).to_equal("required")
end)

t.it("bounds the page size", function()
    local resp = t.request("GET", "/api/notes?limit=500")
    t.expect(resp.status).to_equal(422)
    t.expect(resp:json().fields["query.limit"]).to_equal("must be at most 100")
end)
```

See [Testing](../testing#request-bodies).

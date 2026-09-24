# Route Input Validation

A route can declare what it accepts. Nitr then checks each request **in
Rust, before your handler runs**, and passes the result as `req.valid`.

```lua
app:post("/api/notes", function(req)
    local note = req.valid.body          -- checked, typed, extra fields removed
    return nitr.json(create_note(note), 201)
end, { input = { body = NoteInput } })
```

A request that fails never reaches the handler, so it needs no
`if not data then` check.

## The `input` table

`input` goes in the route's trailing
[options table](../routing#route-options), next to `doc`, `on_invalid`
and `on_error`.

| Key       | Checks                                                         | Handler gets        |
| --------- | -------------------------------------------------------------- | ------------------- |
| `body`    | The request body                                               | `req.valid.body`    |
| `query`   | The query string                                               | `req.valid.query`   |
| `params`  | The path parameters (`:id`)                                    | `req.valid.params`  |
| `headers` | Request headers, by **lowercase** name                         | `req.valid.headers` |
| `strict`  | `true` to reject undeclared fields in every part of this route |                     |

Declare only the parts you need. Each takes a schema or a plain table of
rules.

```lua
app:get("/api/notes/:id", function(req)
    local note = notes[req.valid.params.id]          -- the integer 42, not "42"
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

On routes without `input`, `req.valid` is `nil`, so shared middleware can
test `if req.valid then`.

## Text becomes values

Query strings, path parameters, headers and HTML forms carry **text**.
Nitr converts the text to the declared type before checking, so
`limit=20` arrives as the number `20`.

| Declared  | `"20"` | `"on"` | `"true"` | `""` (blank)  |
| --------- | ------ | ------ | -------- | ------------- |
| `integer` | `20`   | —      | —        | **absent**    |
| `number`  | `20`   | —      | —        | **absent**    |
| `boolean` | —      | `true` | `true`   | **absent**    |
| `string`  | `"20"` | `"on"` | `"true"` | `""`, a value |

Booleans accept `true`/`1`/`on` and `false`/`0`. A checked HTML checkbox
sends `on`; an unchecked one sends nothing, so give it a default.

Conversion is strict: `+20`, `0x10`, `1e3`, `020` and `nan` are not
integers, and fail with `must be an integer`.

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
GET /api/notes?limit=abc   → 422  { "fields": { "query.limit": "must be an integer" } }
GET /api/notes?limit=500   → 422  { "fields": { "query.limit": "must be at most 100" } }
GET /api/notes             → 200  req.valid.query == { limit = 20, offset = 0, sort = "id", draft = false }
```

### Repeated keys and `name[]`

When the rule is an `array`, a key that appears more than once collects
into a list, and `name[]` is read as `name`:

```lua
input = { query = { tags = { "array|max_items:3", items = "string|format:slug" } } }
```

```console
GET /items?tags=a&tags[]=b       →  req.valid.query.tags == { "a", "b" }
```

Repeated header lines collect the same way, and a failing one is
reported by position: `headers.x-team[2]`.

## Bodies and content types

A schema under `body` accepts **JSON and URL-encoded forms**. Use
`content` to change that:

```lua
input = { body = NoteInput }                                          -- json, form

input = { body = { schema = NoteInput, content = { "json" } } }       -- JSON only

input = { body = { schema = Profile, content = { "form", "multipart" } } }  -- a form with files

input = { body = { file = nitr.validate.image({ max_bytes = "2mb" }), content = { "raw" } } }
```

| `content`     | Media type                                      |
| ------------- | ----------------------------------------------- |
| `"json"`      | `application/json`, or no `Content-Type` at all |
| `"form"`      | `application/x-www-form-urlencoded`             |
| `"multipart"` | `multipart/form-data`                           |
| `"raw"`       | Any: the whole body is one file                 |

Multipart and raw bodies carry files; see [File uploads](./files). A body
of any other type gets a **`415`** that lists what the route accepts,
also sent in an `Accept` header:

```json
{
  "code": "UNSUPPORTED_MEDIA_TYPE",
  "message": "unsupported media type; accepted: application/json, application/x-www-form-urlencoded",
  "accepted": ["application/json", "application/x-www-form-urlencoded"]
}
```

Validation does not use up the body. `req:json()`, `req:form()` and
`req:text()` still return exactly what the client sent.

## When it fails: the `422`

By default a failure is a JSON `422`. Each path starts with the part it
came from (`body.text`, `query.limit`), so failures from several parts
fit in one response. The full shape is on
[Messages & errors](./messages#the-error-shape).

## Custom answers: `on_invalid`

Set `on_invalid` per route, or once with `app:on_invalid(...)`. The
route's own handler wins. It receives the error table and the request:

```lua
app:on_invalid(function(err, req)
    nitr.log.debug("rejected", { path = req.path, fields = err.fields })
    return nitr.error(422, { code = err.code, fields = err.fields })
end)

app:post("/v1/import", handler, {
    input = { body = ImportSchema },
    on_invalid = function(err, req)
        return nitr.error(400, { error = err.errors[1].message })
    end,
})
```

Showing a form again with its errors is the typical use:

```lua
app:post("/signup", function(req)
    return nitr.redirect("/welcome", 303)
end, {
    input = { body = { schema = Signup, content = { "form" } } },
    on_invalid = function(err, req)
        return nitr.html(nitr.template:render("signup.j2", {
            errors = err.fields,        -- path → message
            values = req:form(),        -- what they typed
        }), 422)
    end,
})
```

::: v-pre

```html
<label>
  Email <input name="email" value="{{ values.email }}" />
  {% if errors["body.email"] %}
  <p class="error">{{ errors["body.email"] }}</p>
  {% endif %}
</label>
```

:::

Note the `body.` prefix in the key.

## Where validation runs

```text
limits (413, 414) → routing (404, 405) → input validation (415, 422) → middleware → handler
```

- **Validation runs before your middleware.** A malformed request from a
  client that is not logged in gets a `422`, not a `401`. If auth must
  come first, check it in the handler.
- **Size limits come first.** A body over `[limits] max_body_bytes` is a
  `413` before any schema runs. `max_bytes` in a rule limits one field.

## `strict`: report unknown fields

By default undeclared fields are removed. With `strict = true` in
`input`, they fail instead:

```lua
app:post("/items", handler, {
    input = { body = { a = "string" }, strict = true },
})
```

```console
POST {"a":"x","titel":1}   → 422  { "fields": { "body.titel": "is not a known field" } }
```

The route's `strict` overrides a schema's own
[`strict` option](./composition#strict-report-unknown-fields).

## Declarations are checked at load

An `input` that cannot work fails when the app loads, naming the route
and line:

```text
route `POST /upload` (app.lua:42): input.body: a `file` rule needs `content = { "multipart" }` (or "raw"), which is opt-in
route `GET /items/:id` (app.lua:57): input.params names `di`, which the route pattern does not capture (captured: id)
app:post("/x", ...): unknown option `imput` (allowed: on_error, on_invalid, input, doc)
```

`nitr check` runs the same load, so CI catches these. To test validated
routes, including form and multipart bodies, see
[Testing](../testing#request-bodies).

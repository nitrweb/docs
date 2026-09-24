# Validation

`nitr.validate` checks untrusted input against a schema. You declare the
schema once, it is compiled when the app loads, and the checks run in
Rust. You get back typed values, with undeclared fields removed, or a
map of per-field errors.

It is enabled by default: `validate` is in the default `[std] features`.

There are two ways to use a schema, and most apps use both:

- **On a route**, as [`input`](./route-input): Nitr checks the request
  **before your handler runs** and passes the result as `req.valid`. Bad
  input gets a `422` you did not have to write.
- **Directly**, with `schema:check(value)`: anywhere you have a value to
  check, such as a background job or a response from another service.

## A quick example

```lua
local S = nitr.validate

local NoteInput = S.schema({
    text     = "string|trim|min_len:1|max_len:500|required",
    tags     = { "array|max_items:5|unique", items = "string|format:slug" },
    priority = "integer|min:1|max:5|default:3",
})

app:post("/api/notes", function(req)
    -- Already checked, converted and trimmed. No `if not data`.
    local note = req.valid.body
    return nitr.json(create_note(note), 201)
end, { input = { body = NoteInput } })
```

A bad request never reaches the handler:

```console
$ curl -sX POST localhost:3000/api/notes \
    -H 'content-type: application/json' -d '{"tags":["ok","Bad Tag"],"priority":9}'
```

```json
{
  "code": "VALIDATION_FAILED",
  "message": "validation failed",
  "fields": {
    "body.priority": "must be at most 5",
    "body.tags[2]": "must be a slug (lowercase letters, digits, hyphens)",
    "body.text": "is required"
  },
  "errors": ["…one detailed entry per failure…"]
}
```

[Messages & errors](./messages#the-error-shape) describes each field.

## Checking a value yourself

`schema:check` returns either the data, or `nil` and an error:

```lua
local data, err = NoteInput:check(value)
if not data then
    return nitr.error(422, { code = err.code, fields = err.fields })
end
-- `data` holds only the declared fields, typed and transformed.
```

The error has the same shape as the route's `422`, without the `body.`
prefix on paths.

## Writing a rule

A rule can be a table, a shorthand string, or both mixed:

```lua
text = { type = "string", trim = true, min_len = 1, required = true }
text = "string|trim|min_len:1|required"
text = { "string|trim|min_len:1|required", description = "The note body" }
```

[Rules & types](./rules) lists every rule key.

## Compile once, at load time

Build schemas at the top level of a file, not inside a handler:

```lua
-- ✅ compiled once, when the app loads
local NoteInput = nitr.validate.schema({ ... })

app:post("/notes", function(req)
    -- ❌ would compile the schema again on every request
    local schema = nitr.validate.schema({ ... })
end)
```

Mistakes in a schema, such as a misspelled rule key (`maxlen` for
`max_len`), are errors when the app loads, never silent no-ops. Run
`nitr check` in CI to catch them before a deploy.

## Undeclared fields are removed

```lua
local schema = nitr.validate.schema({ name = "string|required" })
local data = schema:check({ name = "Ada", is_admin = true })
-- data == { name = "Ada" }        ← is_admin is gone
```

This protects you from mass assignment: a client cannot slip a field
like `is_admin` into a database write, because `check` returns only what
you declared. To reject unknown fields instead, use
[`strict`](./composition#strict-report-unknown-fields).

## Where to go next

| Page                            | What is in it                                                             |
| ------------------------------- | ------------------------------------------------------------------------- |
| [Rules & types](./rules)        | Every rule key, per type, and the shorthand syntax                        |
| [String formats](./formats)     | The 36 built-in formats, and how to add your own                          |
| [Route input](./route-input)    | `input`, `req.valid`, content types, text conversion, `on_invalid`        |
| [File uploads](./files)         | The `file` type, presets, and `nitr.File`                                 |
| [Messages & errors](./messages) | The error shape, default messages, and how to change them                 |
| [Composition](./composition)    | Schema options, rules across fields, and deriving one schema from another |
| [OpenAPI](../openapi/)          | The same declarations, published as an API document                       |

Function signatures are in the [API reference](../../api/#nitr-validate)
and [`nitr.Schema`](../../api/types#nitr-schema).

# Validation

`nitr.validate` compiles a declarative schema **once**, at load time, and
checks untrusted input in Rust, per request. You get typed values, a
per-field error map, and undeclared fields stripped rather than passed
through.

Enabled by default — `validate` is in the minimal `[std] features` set.

There are two ways to use it, and you will probably use both:

|                                             |                                                                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **On a route**, as [`input`](./route-input) | Nitr checks the request **before your handler runs** and hands it `req.valid`. A failure is a `422` you never wrote. |
| **By hand**, as `schema:check(value)`       | You call it wherever you like — a background job, a config file, a value from another service.                       |

## The 30-second version

```lua
local S = nitr.validate

local NoteInput = S.schema({
    text     = "string|trim|min_len:1|max_len:500|required",
    tags     = { "array|max_items:5|unique", items = "string|format:slug" },
    priority = "integer|min:1|max:5|default:3",
})

app:post("/api/notes", function(req)
    -- Already checked, coerced, trimmed and stripped. No `if not data`.
    local note = req.valid.body
    return nitr.json(create_note(note), 201)
end, { input = { body = NoteInput } })
```

A bad request never reaches the handler:

```console
$ curl -sX POST localhost:3000/api/notes \
    -H 'content-type: application/json' -d '{"tags":["Bad Tag"],"priority":9}'
```

```json
{
  "code": "VALIDATION_FAILED",
  "message": "validation failed",
  "fields": {
    "body.priority": "must be at most 5",
    "body.tags[1]": "must be a slug (lowercase letters, digits, hyphens)",
    "body.text": "is required"
  },
  "errors": [
    {
      "path": "body.priority",
      "part": "body",
      "field": "priority",
      "rule": "max",
      "message": "must be at most 5",
      "params": { "max": 5 }
    },
    {
      "path": "body.tags[1]",
      "part": "body",
      "field": "tags",
      "rule": "format",
      "message": "must be a slug (lowercase letters, digits, hyphens)",
      "params": { "format": "a slug (lowercase letters, digits, hyphens)" }
    },
    {
      "path": "body.text",
      "part": "body",
      "field": "text",
      "rule": "required",
      "message": "is required"
    }
  ]
}
```

## Checking a value yourself

The same schema, called directly. Two return values, and they are
exclusive: **data and no error**, or **`nil` and an error**.

```lua
local data, err = NoteInput:check(value)
if not data then
    return nitr.error(422, { code = err.code, fields = err.fields })
end
-- `data` holds only the declared fields, typed and transformed.
```

## Writing a rule

Three spellings, one vocabulary. Every token in a shorthand string is a
rule key with exactly the same meaning as in a table, so you can mix them
freely and a typo fails at load time either way.

```lua
-- A table: explicit, and the only form for nested structure.
text = { type = "string", trim = true, min_len = 1, required = true }

-- Shorthand: the same rule, one line.
text = "string|trim|min_len:1|required"

-- Mixed: shorthand plus the keys a string cannot carry.
text = { "string|trim|min_len:1|required",
         description = "The note body",
         check = function(s) return s:match("%a") ~= nil, "must contain a letter" end }
```

`nitr.validate.expand` prints what a shorthand string means, which is the
fastest way to check your reading of one:

```lua
nitr.dbg(nitr.validate.expand("integer|min:1|max:5|default:3"))
-- { type = "integer", min = 1, max = 5, default = 3 }
```

## Compile once, at load time

```lua
-- ✅ file scope: compiled once per pooled Lua state
local NoteInput = nitr.validate.schema({ ... })

app:post("/notes", function(req)
    -- ❌ this would recompile the schema on every request
    local schema = nitr.validate.schema({ ... })
end)
```

Compilation walks the rule tables, resolves formats and builds the
checker. Doing it per request throws that away and spends the request's
execution budget on it.

> [!WARNING] An unknown rule key is a startup error
>
> `requird`, `maxlen`, `min_length` — none of them silently validate
> nothing. The compiler knows which keys each type accepts and refuses
> anything else, naming the field:
>
> ```text
> invalid schema for `text`: unknown key `maxlen` for a string rule
> ```
>
> That is the whole reason this is not JSON Schema: a closed vocabulary
> can tell you that you misspelled something.

## Undeclared fields are stripped

```lua
local schema = nitr.validate.schema({ name = "string|required" })
local data = schema:check({ name = "Ada", is_admin = true })
-- data == { name = "Ada" }        ← is_admin is gone
```

This is a security property, not a convenience. Mass assignment happens
when a request body flows into a database write carrying a field the
client should not control. `check` returns only what you declared, so
passing `data` straight through is safe.

To be told about the extra field instead of quietly dropping it, use
[`strict`](./composition#strict-report-unknown-fields).

## Where to go next

| Page                            | What is in it                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [Rules & types](./rules)        | Every rule key, per type — strings, numbers, arrays, maps, nested tables — and the shorthand grammar |
| [String formats](./formats)     | The 36 built-in formats, and how to register your own                                                |
| [Route input](./route-input)    | `input`, `req.valid`, content types, text coercion, the `422`, `on_invalid`                          |
| [File uploads](./files)         | The `file` type, the presets, `nitr.File`, and how a file's type is really decided                   |
| [Messages & errors](./messages) | Default messages, overrides, placeholders, labels, and the exact error shape                         |
| [Composition](./composition)    | Schema options, cross-field rules, and deriving one schema from another                              |
| [OpenAPI](../openapi/)          | The same declarations, published as an API document                                                  |

## Quick reference

| Function                                 | Returns                                                   |
| ---------------------------------------- | --------------------------------------------------------- |
| `nitr.validate.schema(fields, opts?)`    | A compiled [`nitr.Schema`](../../api/types#nitr-schema)   |
| `nitr.validate.expand(shorthand)`        | The table form of a shorthand string                      |
| `nitr.validate.format(name, spec)`       | Registers a [custom format](./formats#custom-formats)     |
| `nitr.validate.formats()`                | Every format name, sorted                                 |
| `nitr.validate.messages(messages)`       | [App-wide default messages](./messages#app-wide-defaults) |
| `nitr.validate.media_types()`            | The media types a [`file` rule](./files) may name         |
| `nitr.validate.image(opts?)` and friends | [File-rule presets](./files#presets)                      |

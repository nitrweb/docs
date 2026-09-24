# Rules & Types

A schema maps field names to **rules**. A rule names the value's type,
then what else must be true of it.

```lua
local S = nitr.validate

local schema = S.schema({
    email = "string|trim|case:lower|format:email|required",
    age   = "integer|min:13|max:120",
})
```

## The three spellings

All three compile to the same thing, and you can choose per field.

```lua
-- Table form. The only way to nest.
{ type = "string", trim = true, min_len = 1, max_len = 500, required = true }

-- Shorthand. The type comes first; then `key` or `key:value` tokens.
"string|trim|min_len:1|max_len:500|required"

-- Mixed. Shorthand, plus table keys a string cannot hold.
{ "string|trim|min_len:1|required",
  description = "The note body",
  check = function(s) return s:match("%a") ~= nil, "must contain a letter" end }
```

### Shorthand syntax

`type|token|token…`, where each token is a rule key with the same
meaning it has in a table.

| Token                                | Meaning                                                                                          | Example                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------- |
| A bare key                           | A flag: `required`, `trim`, `unique`, `utf8`, `match_extension`, `allow_executables`             | `"string\|trim\|required"`         |
| `key:number`                         | A numeric rule: `min`, `max_len`, `max_items`, `max_pixels`, …                                   | `"integer\|min:1\|max:5"`          |
| `key:a,b,c`                          | A list rule: `one_of`, `not_one_of`, `contains_any`, `contains_all`, `types`, `extensions`       | `"string\|one_of:draft,published"` |
| `key:text`                           | Anything else, as text                                                                           | `"string\|format:email"`           |
| `default:` / `equals:` / `contains:` | Read as the field's type: a number on `integer`/`number`, `true`/`false` on `boolean`, else text | `"integer\|default:3"`             |

Escape a literal `|` or `,` with a backslash. `nitr.validate.expand`
shows what a shorthand string means:

```lua
nitr.dbg(nitr.validate.expand([[string|one_of:a\,b,c]]))
-- { type = "string", one_of = { "a,b", "c" } }
```

## Keys every type accepts

| Key           | Meaning                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------- |
| `type`        | `string`, `number`, `integer`, `boolean`, `array`, `table`, `map`, `any`, `file`                |
| `required`    | The field must be present. An optional field may be absent, but is still checked when present   |
| `default`     | Used when the field is absent. It is checked like a sent value                                  |
| `equals`      | Must equal this exact value                                                                     |
| `one_of`      | Allowed values                                                                                  |
| `not_one_of`  | Forbidden values                                                                                |
| `description` | Text for the [OpenAPI document](../openapi/). Required when the rule has a `check`              |
| `example`     | An example value for the document                                                               |
| `label`       | A display name, for the `{label}` placeholder and error entries ([Messages](./messages#labels)) |
| `message`     | One message for every rule on this field ([Messages](./messages))                               |
| `messages`    | A message per rule: `{ max_len = "Keep it under {max}" }`                                       |
| `check`       | `function(v) -> boolean, reason?`: your own test, run after every built-in rule passed          |
| `transform`   | `function(v) -> v`: rewrites the value in the output, after `check`                             |

```lua
{
    status   = { "string|one_of:draft,published,archived", default = "draft" },
    currency = "string|format:currency_code|not_one_of:XXX",
    bio      = "string|max_len:500",       -- optional, but at most 500 chars when sent
}
```

### `check` and `transform`

`check` runs only after the field passed its other rules, so it always
gets a value of the right type. Return `false` (and optionally a reason)
to reject:

```lua
pw = { "string|min_len:8",
       description = "not a known-common password",
       check = function(s) return not COMMON[s], "is too common" end }
```

A `check` needs a `description`, because the API document cannot publish
a Lua function; leaving it out is a load error.

`transform` rewrites the value that ends up in the output:

```lua
email = { "string|format:email", transform = function(s) return s:lower() end }
```

Both run in Lua, inside the request's time budget. A `check` that raises
(a typo, a nil index) is a `500`, not a validation failure.

## `string`

| Key                             | Meaning                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| `trim`                          | Strip surrounding whitespace before the other rules                                  |
| `case`                          | `"lower"` or `"upper"`: convert before the other rules                               |
| `min_len` / `max_len` / `len`   | Length in characters                                                                 |
| `format`                        | One of the [built-in or custom formats](./formats)                                   |
| `starts_with` / `ends_with`     | Literal prefix / suffix                                                              |
| `contains` / `does_not_contain` | Literal substring                                                                    |
| `after` / `before`              | Time bounds: `"now"` or a literal. Needs `format = "date"`, `"datetime"` or `"time"` |

```lua
{
    slug  = "string|format:slug|max_len:60|required",
    title = "string|trim|min_len:1|max_len:200|required",
    code  = "string|len:6|format:uppercase",
    due   = "string|format:date|after:now",
    from  = { "string|format:date", before = "2030-01-01" },
}
```

`trim` and `case` change the value you get back, and later rules see the
changed value. That is why `"string|trim|min_len:1"` rejects `"   "`.

## `number` and `integer`

| Key                               | `number` | `integer` | Meaning                    |
| --------------------------------- | :------: | :-------: | -------------------------- |
| `min` / `max`                     |    ✅    |    ✅     | Inclusive bounds           |
| `exclusive_min` / `exclusive_max` |    ✅    |    ✅     | Exclusive bounds           |
| `multiple_of`                     |    ✅    |    ✅     | Must be a multiple of      |
| `decimals`                        |    ✅    |     —     | At most _n_ decimal places |

```lua
{
    age      = "integer|min:0|max:150",
    quantity = "integer|min:1|multiple_of:6",
    price    = "number|min:0|decimals:2",
    ratio    = "number|exclusive_min:0|max:1",
}
```

`integer` rejects a number with a fractional part (`3.5`). A whole number
sent as a float, like `3.0`, is accepted.

## `boolean`

```lua
{ subscribed = "boolean|default:false" }
```

No extra keys. For which text counts as `true` in a query string or
form, see [text conversion](./route-input#text-becomes-values).

## `array`

| Key                             | Meaning                                                          |
| ------------------------------- | ---------------------------------------------------------------- |
| `items`                         | **Required.** The rule every element must pass (nesting allowed) |
| `min_items` / `max_items`       | Length bounds                                                    |
| `unique`                        | No duplicate elements                                            |
| `contains`                      | Must include this value                                          |
| `contains_any` / `contains_all` | Must include one of / all of these values                        |
| `max_total_bytes`               | For an array of files: the combined size limit                   |

```lua
{
    tags   = { "array|min_items:1|max_items:10|unique", items = "string|format:slug|max_len:32" },
    roles  = { "array", items = "string|one_of:admin,editor,viewer", contains_any = { "admin", "editor" } },
    scores = { "array|max_items:100", items = "integer|min:0|max:100" },
}
```

A failing element is reported by its position, counting from 1:
`tags[2]`.

## `table`: a nested object

```lua
local Address = nitr.validate.schema({
    street   = "string|required",
    city     = "string|required",
    postcode = "string|format:alphanumeric",
})

local schema = nitr.validate.schema({
    name    = "string|required",
    address = { type = "table", required = true, fields = Address },
})
```

`fields` takes a table of rules or a compiled schema. Reusing a schema
is covered in [Composition](./composition#reusing-a-schema-as-a-field).
Nested failures use dotted paths: `address.postcode`.

## `map`: arbitrary keys

A `table` has named fields; a `map` has keys you do not know in advance,
all following one rule.

| Key                     | Meaning                         |
| ----------------------- | ------------------------------- |
| `keys`                  | A rule every key must pass      |
| `values`                | A rule every value must pass    |
| `min_keys` / `max_keys` | Bounds on the number of entries |

```lua
{
    meta = { "map|max_keys:10",
             keys   = "string|format:alpha_dash|max_len:32",
             values = "string|max_len:200" },
}
```

## `any`: anything, with a size limit

For a value you store and return untouched, such as a client's settings
blob.

```lua
{ payload = { type = "any", max_bytes = "64kb" } }
```

`max_bytes` is the only type-specific rule.

## `file`: an upload

```lua
{ avatar = nitr.validate.image({ max_bytes = "2mb", max_width = 4000 }) }
```

See [File uploads](./files).

## Load-time errors

A schema that cannot work fails when the app loads, naming the field:

```text
invalid schema for `age`: `min` is greater than `max`
invalid schema for `text`: unknown rule `maxlen` for type `string` (allowed: type, required, …)
invalid schema for `due`: `after` needs `format = "date"`, `"datetime"` or `"time"`
invalid schema for `name`: unknown format `emial` (expected one of: alpha, alpha_dash, …)
invalid schema for `tags`: type `array` requires `items`
```

`nitr check` loads the app the same way, so CI catches these.

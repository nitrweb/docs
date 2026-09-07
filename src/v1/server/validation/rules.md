# Rules & Types

A schema maps field names to **rules**. A rule always says what type the
value is, and then what else must be true of it.

```lua
local S = nitr.validate

local schema = S.schema({
    email = "string|trim|case:lower|format:email|required",
    age   = "integer|min:13|max:120",
})
```

## The three spellings

They compile to the same thing. Pick per field, not per schema.

```lua
-- Table form. Explicit, and the only way to nest.
{ type = "string", trim = true, min_len = 1, max_len = 500, required = true }

-- Shorthand. The type comes first; the rest are `key` or `key:value`.
"string|trim|min_len:1|max_len:500|required"

-- Mixed. Shorthand for the rules, table keys for what a string cannot hold.
{ "string|trim|min_len:1|required",
  description = "The note body",
  check = function(s) return s:match("%a") ~= nil, "must contain a letter" end }
```

### The shorthand grammar

`type|token|token…`, where a token is a rule key on its own (a flag) or
`key:value`.

| Token shape                          | Meaning                                                                                        | Example                            |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------- |
| A bare key                           | The flag rules: `required`, `trim`, `unique`, `utf8`, `match_extension`, `allow_executables`   | `"string\|trim\|required"`         |
| `key:number`                         | The numeric rules — `min`, `max_len`, `max_items`, `max_pixels`, …                             | `"integer\|min:1\|max:5"`          |
| `key:a,b,c`                          | The list rules — `one_of`, `not_one_of`, `contains_any`, `contains_all`, `types`, `extensions` | `"string\|one_of:draft,published"` |
| `key:text`                           | Everything else, as text                                                                       | `"string\|format:email"`           |
| `default:` / `equals:` / `contains:` | Typed by the rule's own type: a number on `integer`/`number`, text otherwise                   | `"integer\|default:3"`             |

A literal `|` or `,` inside a value is escaped with a backslash:

```lua
S.expand([[string|one_of:a\,b,c]])
-- { type = "string", one_of = { "a,b", "c" } }
```

Print any shorthand to see what it means:

```lua
nitr.dbg(nitr.validate.expand("array|max_items:5|unique"))
-- { type = "array", max_items = 5, unique = true }
```

## Keys every type accepts

| Key           | Meaning                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| `type`        | `string`, `number`, `integer`, `boolean`, `array`, `table`, `map`, `any`, `file`                               |
| `required`    | The field must be present. Without it, an absent field is simply absent — but a _present_ one is still checked |
| `default`     | Substituted when the field is absent. A default is not re-checked: give a value the rules would accept         |
| `equals`      | Must equal this exact literal                                                                                  |
| `one_of`      | An allow-list of exact values                                                                                  |
| `not_one_of`  | A deny-list of exact values                                                                                    |
| `description` | Prose. Reaches the [OpenAPI document](../openapi/); required when you write a `check`                          |
| `example`     | An example value for the document                                                                              |
| `label`       | The name to use for this field in messages instead of the key ([Messages](./messages#labels))                  |
| `message`     | One message for every rule on this field ([Messages](./messages))                                              |
| `messages`    | A message per rule code: `{ max_len = "Keep it under {max}" }`                                                 |
| `check`       | `function(v) -> boolean, message?` — your own predicate, run after every Rust rule passed                      |
| `transform`   | `function(v) -> v` — rewrites the value on its way into the output, after everything else                      |

```lua
{
    status   = { "string|one_of:draft,published,archived", default = "draft" },
    currency = "string|format:currency_code|not_one_of:XXX",
    bio      = "string|max_len:500",                    -- optional, bounded when given
}
```

> [!TIP] `required` is about presence, nothing else
>
> An optional field with rules is not a weaker field: it is a field that
> may be missing, and must be correct when it is not. `bio` above
> accepts absence and rejects 501 characters.

### `check` and `transform`

`check` runs **last**, after every declarative rule on the field has
already passed — so it never sees a value of the wrong type, and it costs
nothing on input that failed earlier. It returns `false` (optionally with
a message) to reject.

```lua
pw = { "string|min_len:8",
       description = "not a known-common password",
       check = function(s) return not COMMON[s], "is too common" end }
```

`transform` runs after `check` and rewrites the stored value:

```lua
email = { "string|format:email", transform = function(s) return s:lower() end }
```

> [!NOTE] A `check` needs a `description`
>
> A predicate written in Lua cannot be published in an API document, so
> its `description` is what the document says instead. Omitting it is a
> load-time error — the alternative is a document that under-states what
> the server enforces. See [OpenAPI](../openapi/#what-the-document-claims).

Both run inside the request's execution budget, in the caller's
coroutine, so a slow `check` is a slow request and the budget stops it.

## `string`

| Key                             | Meaning                                                         |
| ------------------------------- | --------------------------------------------------------------- |
| `trim`                          | Strip surrounding whitespace **before** every other rule        |
| `case`                          | `"lower"` or `"upper"` — normalize before checking              |
| `min_len` / `max_len` / `len`   | Character counts                                                |
| `format`                        | One of the [built-in or custom formats](./formats)              |
| `starts_with` / `ends_with`     | Literal prefix / suffix                                         |
| `contains` / `does_not_contain` | Literal substring                                               |
| `after` / `before`              | Time bounds — needs `format = "date"`, `"datetime"` or `"time"` |

```lua
{
    slug  = "string|format:slug|max_len:60|required",
    title = "string|trim|min_len:1|max_len:200|required",
    code  = "string|len:6|format:uppercase",
    due   = "string|format:date|after:now",
    from  = { "string|format:date", before = "2030-01-01" },
}
```

`trim` and `case` are normalizations, not checks: they change the value
that ends up in your output, and every later rule sees the normalized
form. That is why `"string|trim|min_len:1"` rejects `"   "` — after
trimming there is nothing left.

`after`/`before` take `"now"` or a literal in the field's own format.

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

`integer` also rejects a value with a fractional part — `3.5` is not an
integer, and neither is `3.0` arriving from JSON as a float with a
fraction.

## `boolean`

```lua
{ subscribed = "boolean|default:false" }
```

No extra keys: a boolean is true or false. What varies is what counts as
one on the way in — see [text coercion](./route-input#text-becomes-values).

## `array`

| Key                             | Meaning                                                          |
| ------------------------------- | ---------------------------------------------------------------- |
| `items`                         | A rule applied to **every** element (any rule, nesting included) |
| `min_items` / `max_items`       | Length bounds                                                    |
| `unique`                        | No duplicate elements                                            |
| `contains`                      | Must include this literal                                        |
| `contains_any` / `contains_all` | Must include one of / all of these literals                      |
| `max_total_bytes`               | Ceiling on the combined size of the elements                     |

```lua
{
    tags   = { "array|min_items:1|max_items:10|unique", items = "string|format:slug|max_len:32" },
    roles  = { "array", items = "string|one_of:admin,editor,viewer", contains_any = { "admin", "editor" } },
    scores = { "array|max_items:100", items = "integer|min:0|max:100" },
}
```

A failing element is reported by index, one-based:

```json
{
  "fields": {
    "tags[2]": "must be a slug (lowercase letters, digits, hyphens)"
  }
}
```

## `table` — a nested object

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

`fields` takes a plain table of rules or a compiled schema — the second
lets you reuse the same object shape in several places and publish it as
one named component in the [OpenAPI document](../openapi/).

Nested failures are reported by dotted path:

```json
{ "fields": { "address.postcode": "must be letters and digits only" } }
```

## `map` — arbitrary keys

A `table` has a fixed set of fields; a `map` has a fixed _shape_ for keys
and values you did not name in advance.

| Key                     | Meaning                         |
| ----------------------- | ------------------------------- |
| `keys`                  | A rule every key must satisfy   |
| `values`                | A rule every value must satisfy |
| `min_keys` / `max_keys` | Entry-count bounds              |

```lua
{
    meta = { "map|max_keys:10",
             keys   = "string|format:alpha_dash|max_len:32",
             values = "string|max_len:200" },
}
```

## `any` — anything, bounded

For a field you genuinely pass through — a client-supplied blob you will
store and hand back untouched.

```lua
{ payload = { type = "any", max_bytes = "64kb" } }
```

`max_bytes` is the only rule, and it is the point: "anything" without a
size ceiling is a memory amplifier.

## `file` — an upload

Files have a page of their own, because deciding what a file _is_ takes
more than a type name.

```lua
{ avatar = nitr.validate.image({ max_bytes = "2mb", max_width = 4000 }) }
```

See [File uploads](./files).

## Where a rule can go wrong at load time

Contradictions are caught when the schema compiles, not when a request
arrives:

```text
invalid schema for `age`: `min` is greater than `max`
invalid schema for `text`: unknown key `maxlen` for a string rule
invalid schema for `due`: `after` needs `format = "date"`, `"datetime"` or `"time"`
invalid schema for `name`: unknown format `emial` (expected one of: alpha, alpha_dash, …)
```

With `nitr check` in CI, none of these can reach a deploy.

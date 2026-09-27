# Schema Options & Composition

The second argument to `nitr.validate.schema` holds settings for the
whole schema: its name, strictness, messages, and rules that involve
more than one field.

```lua
local Signup = nitr.validate.schema({
    email    = "string|format:email|required",
    password = "string|min_len:12|required",
    confirm  = "string|required",
}, {
    title        = "Signup",
    equal_fields = { { "password", "confirm" } },
})
```

| Option               | What it does                                                 |
| -------------------- | ------------------------------------------------------------ |
| `title`              | Names the schema in the [OpenAPI document](../openapi/)      |
| `strict`             | Reject undeclared fields instead of removing them            |
| `messages`           | Messages for this schema ([Messages](./messages#one-schema)) |
| `at_least_one`       | At least one of these fields must be present                 |
| `mutually_exclusive` | At most one of these fields may be present                   |
| `dependent_required` | If this field is present, these others must be too           |
| `equal_fields`       | These fields must have the same value                        |
| `ordered`            | These fields must be in ascending order                      |
| `checks`             | Your own Lua checks over the whole object                    |

An unknown option, or a group that names an unknown field, is an error
when the app loads.

## `title`: name it if you publish it

```lua
local Note = nitr.validate.schema({ ... }, { title = "Note" })
```

Without a title, the schema is written out in full wherever it is used
in the API document. With one, it appears once as
`#/components/schemas/Note` and every use refers to it, so generated
clients get one `Note` type.

## `strict`: report unknown fields

```lua
local Internal = nitr.validate.schema({ a = "string" }, { strict = true })
```

```json
{ "fields": { "titel": "is not a known field" } }
```

The default (remove unknown fields quietly) suits a public API, where a
client may send extra fields. `strict` suits an internal API, where an
unknown field is probably a typo. A route's
[`input.strict`](./route-input#strict-report-unknown-fields) overrides
the schema's setting.

## Rules across fields

These run only when every field of the object passed its own rules, and
they see the checked, converted values. Fields that are absent are
skipped unless the rule is about presence.

| Option               | Example                                | Fails with (on field)                                                    |
| -------------------- | -------------------------------------- | ------------------------------------------------------------------------ |
| `at_least_one`       | `{ { "email", "phone" } }`             | `at least one of "email", "phone" is required` (`phone`, the last one)   |
| `mutually_exclusive` | `{ { "card_token", "bank_account" } }` | `only one of "card_token", "bank_account" may be given` (`bank_account`) |
| `dependent_required` | `{ address = { "city", "postcode" } }` | `requires "city", "postcode"` (`address`)                                |
| `equal_fields`       | `{ { "password", "confirm" } }`        | `must equal password` (`confirm`)                                        |
| `ordered`            | `{ { "start_at", "end_at" } }`         | `must be after start_at` (`end_at`)                                      |

Each option takes a list of groups, except `dependent_required`, which
maps a field to the fields it needs.

### `ordered`

Each field must be strictly greater than the one before it. The fields
must all be numbers, or all strings with the same `date`, `datetime` or
`time` format, which is how Nitr knows to compare them as times rather
than as text.

```lua
local Booking = nitr.validate.schema({
    start_at  = "string|format:date|required",
    end_at    = "string|format:date|required",
    price     = "number|min:0",
    max_price = "number|min:0",
}, {
    ordered = { { "start_at", "end_at" }, { "price", "max_price" } },
})
```

### A message per group

Each group can carry its own `message`, with `{fields}` or `{field}`:

```lua
{
    at_least_one = { { "email", "phone", message = "Give us one way to reach you" } },
    ordered      = { { "start_at", "end_at", message = "must be after {field}" } },
}
```

## `checks`: your own rules over the whole object

When no built-in option expresses a rule, write it. Each entry needs a
`description`, which is what the API document shows.

```lua
local Order = nitr.validate.schema({
    subtotal = "number|min:0|required",
    discount = "number|min:0|default:0",
    total    = "number|min:0|required",
}, {
    checks = {
        { description = "total equals subtotal minus discount",
          check = function(data) return data.total == data.subtotal - data.discount end,
          message = "does not add up" },
    },
})
```

`check` receives the checked object and returns `false` (and optionally
a reason) to reject it. Checks run last, and only when everything else
passed. A failure is reported on the object itself (path `$`, or `body`
on a route).

## Deriving one schema from another

Each method returns a **new** schema and leaves the original unchanged.

| Method            | Gives you                                     |
| ----------------- | --------------------------------------------- |
| `:partial()`      | Every top-level field optional, no defaults   |
| `:pick(names)`    | Only the named fields                         |
| `:omit(names)`    | Every field except the named ones             |
| `:extend(fields)` | Fields added or replaced; `false` removes one |
| `:with(opts)`     | The same fields with some options changed     |
| `:fields()`       | The declared field names, sorted              |

### Create and update

Write the full schema for creating a record, and derive the update
schema from it:

```lua
local NoteInput = nitr.validate.schema({
    text     = "string|trim|min_len:1|max_len:500|required",
    tags     = { "array|max_items:5", items = "string|format:slug" },
    priority = "integer|min:1|max:5|default:3",
}, { title = "NoteInput" })

local NotePatch = NoteInput:partial():with({ title = "NotePatch" })

app:post("/api/notes", create, { input = { body = NoteInput } })
app:patch("/api/notes/:id", update, {
    input = { params = { id = "integer|min:1" }, body = NotePatch },
})
```

`:partial()` removes `required` and every `default`: a `text` that is
sent must still be a non-empty string of at most 500 characters, and an
omitted `priority` stays omitted instead of resetting the stored value
to `3`.

### Narrowing and widening

```lua
local PublicNote = NoteInput:omit({ "priority" })

local AdminNote = NoteInput:extend({
    pinned = "boolean|default:false",
    owner  = "string|format:uuid|required",
})

local Search = NoteInput:pick({ "text", "tags" }):with({ title = "Search" })

local NoOwner = AdminNote:extend({ owner = false })   -- removes `owner`

local Lenient = Internal:with({ strict = false })     -- other options kept
```

> [!NOTE] Dropping a field a group uses
>
> `Signup:omit({ "confirm" })` fails at load, because `equal_fields`
> still names `confirm`. Change the groups too:
> `Signup:with({ equal_fields = {} }):omit({ "confirm" })`.

## Reusing a schema as a field

A compiled schema can be used as a field's rule, directly or through
`fields`:

```lua
local Address = nitr.validate.schema({
    street = "string|required",
    city   = "string|required",
}, { title = "Address" })

local Customer = nitr.validate.schema({
    name    = "string|required",
    home    = { type = "table", fields = Address, required = true },
    work    = Address,
    history = { "array|max_items:20", items = Address },
}, { title = "Customer" })
```

Because `Address` has a `title`, the API document describes it once and
refers to it three times. Failures use the full path: `home.city`,
`history[2].street`.

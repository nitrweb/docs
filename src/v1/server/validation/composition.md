# Schema Options & Composition

The second argument to `nitr.validate.schema` holds everything that is
about the schema rather than about one field: its name, its strictness,
its messages, and the rules that span more than one field.

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

| Option               | What it does                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `title`              | Names the schema. Publishes it once under `components/schemas` in the [OpenAPI document](../openapi/) and references it everywhere else |
| `strict`             | Report undeclared fields instead of stripping them                                                                                      |
| `messages`           | Default messages for this schema ([Messages](./messages#one-schema))                                                                    |
| `at_least_one`       | At least one of these fields must be present                                                                                            |
| `mutually_exclusive` | At most one of these fields may be present                                                                                              |
| `dependent_required` | If this field is present, these others must be too                                                                                      |
| `equal_fields`       | These fields must all carry the same value                                                                                              |
| `ordered`            | These fields must be in ascending order                                                                                                 |
| `checks`             | Whole-object predicates written in Lua                                                                                                  |

An unknown option is a load-time error naming the allowed ones, exactly
like an unknown rule key.

## `title`: name it if you publish it

```lua
local Note = nitr.validate.schema({ ... }, { title = "Note" })
```

Without a title the schema is inlined wherever it appears in the API
document. With one it becomes `#/components/schemas/Note`, referenced
from every operation that uses it — which is what makes generated
clients produce one `Note` type instead of four anonymous ones.

## `strict`: report unknown fields

```lua
local Internal = nitr.validate.schema({ a = "string" }, { strict = true })
```

```json
{ "fields": { "titel": "is not a known field" } }
```

The default is to strip silently, which is right for a public API — a
client sending a field it invented should not break. `strict` is right
for an internal one, where a misspelled field is a caller bug worth
surfacing. A route can also set it for all of its parts at once with
[`input.strict`](./route-input#strict-report-unknown-fields), which wins
over the schema's own.

## Cross-field rules

These run **after** every field of the object passed, on the validated
output — so they always see typed, normalized values, and they cost
nothing when a field already failed.

### `at_least_one`

```lua
{ at_least_one = { { "email", "phone" } } }
```

> at least one of email, phone is required

Attributed to the **last** field in the group, so a form can show it in
one place.

### `mutually_exclusive`

```lua
{ mutually_exclusive = { { "card_token", "bank_account" } } }
```

> only one of card_token, bank_account may be given

### `dependent_required`

A map, not a list: "if the key is present, the values must be too".

```lua
local Shipping = nitr.validate.schema({
    ship        = "boolean|default:false",
    address     = "string",
    city        = "string",
    postcode    = "string",
}, {
    dependent_required = { address = { "city", "postcode" } },
})
```

Give an `address` without a `city` and the error names what is missing,
on `address`:

> requires city

### `equal_fields`

```lua
{ equal_fields = { { "password", "confirm" } } }
```

> must equal password

Reported on the field that differs, naming the first one it disagreed
with. Fields that are absent are skipped, so this composes with
`required` rather than duplicating it.

### `ordered`

Ascending order, over numbers or over `date` / `datetime` / `time`
strings — which is why the format matters: it is what tells Nitr how to
compare two strings as moments rather than as text.

```lua
local Booking = nitr.validate.schema({
    start_at = { "string|format:date|required", label = "Check-in" },
    end_at   = { "string|format:date|required", label = "Check-out" },
    price    = "number|min:0",
    max_price = "number|min:0",
}, {
    ordered = { { "start_at", "end_at" }, { "price", "max_price" } },
})
```

> must be after Check-in

### A message per group

Every group takes its own `message`, with `{fields}` or `{field}`
available:

```lua
{
    at_least_one = { { "email", "phone", message = "Give us one way to reach you" } },
    ordered      = { { "start_at", "end_at", message = "{field} comes first" } },
}
```

## `checks`: predicates over the whole object

When a rule spans fields in a way no declarative form expresses, write
it. Each entry needs a `description` — that is what the API document
publishes, since the function itself cannot be.

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

`check` receives the validated object and returns `false` (optionally
with a message) to reject. It runs last, after the fields and the
cross-field groups, in the caller's coroutine and inside the request's
execution budget.

## Deriving one schema from another

Six methods, each returning a **new** schema. The original is untouched,
so a derived schema is safe to build at load time and share.

| Method            | Gives you                                           |
| ----------------- | --------------------------------------------------- |
| `:partial()`      | The same schema with every top-level field optional |
| `:pick(names)`    | Only the named fields                               |
| `:omit(names)`    | Everything but the named fields                     |
| `:extend(fields)` | Fields added or replaced; `false` removes one       |
| `:with(opts)`     | The same fields under different options             |
| `:fields()`       | The declared field names, sorted                    |

### The POST/PATCH pair

This is the case `:partial()` exists for. Write the schema once, as the
full thing, and derive the update:

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

`:partial()` drops `required`, and nothing else: a `text` that _is_ sent
still has to be a trimmed, non-empty string of at most 500 characters.

### Narrowing and widening

```lua
-- A public listing that must not accept the internal fields.
local PublicNote = NoteInput:omit({ "internal_ref" })

-- The same note, plus what only an admin may set.
local AdminNote = NoteInput:extend({
    pinned = "boolean|default:false",
    owner  = "string|format:uuid|required",
})

-- Just the two fields a search form sends.
local Search = NoteInput:pick({ "text", "tags" }):with({ title = "Search" })

-- Drop a field an inherited schema declared.
local Trimmed = AdminNote:extend({ owner = false })
```

> [!NOTE] A dropped field a cross-field rule names is a load-time error
>
> `:omit({ "confirm" })` on a schema whose options say
> `equal_fields = { { "password", "confirm" } }` fails when the derived
> schema compiles — not silently, and not at the first request. Derive
> the options too, with `:with(...)`, when you drop a field a group
> mentions.

### Options, changed

`:with(opts)` replaces the options it names and keeps the rest:

```lua
local Lenient = Internal:with({ strict = false })
local Loud    = Signup:with({ messages = { required = "We need this" } })
```

`title`, `strict`, `messages`, the five cross-field groups and `checks`
are all settable this way.

## Reusing a schema as a field

A compiled schema is a rule. Nest it directly, or through `fields`:

```lua
local Address = nitr.validate.schema({
    street = "string|required",
    city   = "string|required",
}, { title = "Address" })

local Customer = nitr.validate.schema({
    name    = "string|required",
    home    = { type = "table", fields = Address, required = true },
    work    = { type = "table", fields = Address },
    history = { "array|max_items:20", items = { type = "table", fields = Address } },
}, { title = "Customer" })
```

Because `Address` has a `title`, the API document emits it once and
references it three times. Failures are reported by path:

```json
{
  "fields": {
    "home.city": "is required",
    "history[2].street": "is required"
  }
}
```

# Messages & Errors

Every rule has a default message that completes the sentence "this field
…", such as `is required` or `must be at least 13`. You can replace
messages per field, per schema or for the whole app.

## The error shape

`schema:check` and a route's `422` return the same table:

```lua
local data, err = schema:check(value)
```

| Field     | What it is                                                                      |
| --------- | ------------------------------------------------------------------------------- |
| `code`    | Always `"VALIDATION_FAILED"`                                                    |
| `message` | The summary line: `"validation failed"` unless you [changed it](#the-whole-app) |
| `fields`  | Path → message. Ready to hand to a template or a client                         |
| `errors`  | One entry per failure, sorted by path, when you need more detail                |

Each entry of `errors`:

| Key       | What it is                                                                      |
| --------- | ------------------------------------------------------------------------------- |
| `path`    | `text`, `tags[2]`, `home.city`. On a route, prefixed with the part: `body.text` |
| `part`    | `body`, `query`, `params` or `headers`. Route validation only                   |
| `field`   | The nearest named field: `tags` for `tags[2]`                                   |
| `rule`    | The rule that failed: `required`, `max_len`, `format`, `check`, `unknown`, …    |
| `message` | The final message                                                               |
| `params`  | The rule's own settings (`{ max = 20 }`), when it has any                       |
| `label`   | The field's [`label`](#labels), when it has one                                 |

```json
{
  "path": "body.text",
  "part": "body",
  "field": "text",
  "rule": "max_len",
  "message": "Keep it under 20",
  "params": { "max": 20 }
}
```

Errors never include the submitted value: `params` holds the limit that
was broken, and there is no `{value}` placeholder. Error bodies get
logged and shown to people, and the value may be a secret.

A `checks` entry in the schema options fails on the object itself: its
path is `$` from `schema:check`, or the part name (`body`) on a route.

## Changing a message

From most to least specific: a field's per-rule `messages`, the field's
`message`, the schema's `messages`, then the app's. A `check` function's
own reason is used when none of those covers `check`.

### One field, one rule

```lua
text = { "string|trim|min_len:1|max_len:20|required",
         messages = {
             required = "Say something",
             max_len  = "Keep it under {max}",
         } }
```

### One field, every rule

```lua
zip = { "string|len:5|format:numeric", message = "must be a five-digit ZIP code" }
```

Use this when the rules together express one idea.

### One schema

```lua
local Signup = nitr.validate.schema({
    email    = "string|format:email|required",
    password = "string|min_len:12|required",
}, {
    messages = { required = "We need this one" },
})
```

### The whole app

```lua
-- app.lua, at the top
nitr.validate.messages({
    required = "This field is required",
    summary  = "Please fix the highlighted fields",   -- the `message` line
})
```

`summary` works only here. Call `nitr.validate.messages` while the app
loads; calling it from a handler raises, so one request can never change
what another is told.

## Placeholders

A message can include the failed rule's settings in `{braces}`:

```lua
messages = {
    max_len = "Keep it under {max} characters",
    one_of  = "Pick one of: {choices}",
    min     = "{label} must be at least {min}",
}
```

`{label}` (the field's label, or its name) and `{path}` work in every
message. The others depend on the rule:

| Rules                                                                                                                               | Placeholder                |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `min_len`, `min`, `exclusive_min`, `min_items`, `min_keys`, `min_bytes`, `min_width`, `min_height`                                  | `{min}`                    |
| `max_len`, `max`, `exclusive_max`, `max_items`, `max_keys`, `max_bytes`, `max_total_bytes`, `max_width`, `max_height`, `max_pixels` | `{max}`                    |
| `len`                                                                                                                               | `{len}`                    |
| `multiple_of`                                                                                                                       | `{step}`                   |
| `decimals`                                                                                                                          | `{decimals}`               |
| `type`                                                                                                                              | `{type}`                   |
| `format`                                                                                                                            | `{format}`                 |
| `one_of`, `not_one_of`, `contains_any`, `contains_all`                                                                              | `{choices}`                |
| `equals`                                                                                                                            | `{expected}`               |
| `starts_with`, `ends_with`, `does_not_contain`, `filename`                                                                          | `{text}`                   |
| `contains`                                                                                                                          | `{text}`, `{item}`         |
| `after`, `before`                                                                                                                   | `{limit}`                  |
| `types` / `extensions`                                                                                                              | `{types}` / `{extensions}` |
| `aspect`                                                                                                                            | `{aspect}`                 |
| `at_least_one`, `mutually_exclusive`, `dependent_required`                                                                          | `{fields}`                 |
| `equal_fields`, `ordered`                                                                                                           | `{field}`                  |

A field's `message` may use the placeholders of any rule on that field.
An unknown placeholder, or a message longer than 500 characters, is a
load error:

```text
invalid message for `a` (rule `max_len`): unknown placeholder `{maxx}` (allowed: {max}, {label}, {path})
```

## Labels

`label` gives a field a display name. It fills `{label}` and is copied
onto each of that field's error entries, so a form can show a friendly
name without a separate lookup table:

```lua
local Booking = nitr.validate.schema({
    start_at = { "string|format:date|required", label = "Check-in" },
})

for _, e in ipairs(err.errors) do
    print((e.label or e.field) .. ": " .. e.message)
end
```

Rules across fields (`ordered`, `equal_fields`, …) name the other field
by its key, not its label. Use a group `message` to reword them; see
[Composition](./composition#a-message-per-group).

## Messages are plain text

Nitr removes control characters from messages and cuts them at 200
characters, but does **not** HTML-escape them. Templates
[escape by default](../templates#escaping-read-this-one); if you build
HTML another way, escape the message yourself.

## The default messages

| Rule                                              | Default message                                                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `type`                                            | `must be a string` / `an integer` / `a number` / `a boolean` / `a list` / `an object` / `a file`               |
| `required`                                        | `is required`                                                                                                  |
| `min_len` / `max_len` / `len`                     | `must be at least {min} characters` / `at most {max} characters` / `exactly {len} characters`                  |
| `min` / `max`                                     | `must be at least {min}` / `must be at most {max}`                                                             |
| `exclusive_min` / `exclusive_max`                 | `must be greater than {min}` / `must be less than {max}`                                                       |
| `multiple_of` / `decimals`                        | `must be a multiple of {step}` / `must have at most {decimals} decimal places`                                 |
| `format`                                          | `must be {format}`: see [String formats](./formats)                                                            |
| `one_of` / `not_one_of`                           | `must be one of: {choices}` / `must not be one of: {choices}`                                                  |
| `equals`                                          | `must be {expected}`                                                                                           |
| `starts_with` / `ends_with`                       | `must start with {text}` / `must end with {text}`                                                              |
| `contains` / `does_not_contain`                   | `must contain {text}` (arrays: `must include {item}`) / `must not contain {text}`                              |
| `after` / `before`                                | `must be after {limit}` / `must be before {limit}`; with `now`: `must be in the future` / `in the past`        |
| `min_items` / `max_items` / `unique`              | `must have at least {min} items` / `at most {max} items` / `must not contain duplicates`                       |
| `contains_any` / `contains_all`                   | `must include one of: {choices}` / `must include all of: {choices}`                                            |
| `min_keys` / `max_keys` / `keys`                  | `must have at least {min} entries` / `at most {max} entries` / `must have string keys`                         |
| `max_bytes` / `min_bytes` / `max_total_bytes`     | `must be at most {max}` (non-files: `… in size`) / `must be at least {min}` / `must be at most {max} in total` |
| `types` / `extensions`                            | `must be {types}` / `must have one of these extensions: {extensions}`                                          |
| `match_extension` / `executable`                  | `must have an extension that matches its content` / `must not be an executable`                                |
| `min_width` / `max_width`                         | `must be at least {min} px wide` / `must be at most {max} px wide`                                             |
| `min_height` / `max_height` / `max_pixels`        | `must be at least {min} px tall` / `at most {max} px tall` / `must be at most {max} pixels`                    |
| `aspect` / `dimensions` / `utf8`                  | `must have a {aspect} aspect ratio` / `must have readable image dimensions` / `must be UTF-8 text`             |
| `filename`                                        | `must have a name`, or `must have a valid name: {text}`                                                        |
| `at_least_one` / `mutually_exclusive`             | `at least one of {fields} is required` / `only one of {fields} may be given`                                   |
| `dependent_required` / `equal_fields` / `ordered` | `requires {fields}` / `must equal {field}` / `must be after {field}`                                           |
| `unknown`                                         | `is not a known field`                                                                                         |
| `check`                                           | `is invalid`, or the reason your `check` returned                                                              |
| `json` / `multipart` / `body`                     | `must be valid JSON` / `must be a well-formed multipart body` / `must be an object`                            |

Sizes print in readable units (`2 MB`), and lists print quoted
(`"email", "phone"`).

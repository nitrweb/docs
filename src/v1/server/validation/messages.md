# Messages & Errors

Every rule has a default message, written to complete the sentence "this
field …". You override at whichever level makes sense, and the most
specific one wins.

```json
{
  "fields": {
    "body.text": "is required",
    "body.age": "must be at least 13"
  }
}
```

## The error shape

Both `schema:check` and a route's `422` produce the same table.

```lua
local data, err = schema:check(value)
```

| Field     | What it is                                                                       |
| --------- | -------------------------------------------------------------------------------- |
| `code`    | Always `"VALIDATION_FAILED"` — a stable string to branch on                      |
| `message` | The summary line, `"validation failed"` unless you changed it                    |
| `fields`  | Path → message. The form-error map, ready to hand to a template or a client      |
| `errors`  | One entry per failing path, sorted, for anything that needs more than a sentence |

Each entry of `errors`:

| Key       | What it is                                                                     |
| --------- | ------------------------------------------------------------------------------ |
| `path`    | `text`, `tags[2]`, `home.city` — and on a route, prefixed: `body.text`         |
| `part`    | `body`, `query`, `params` or `headers`. Route validation only                  |
| `field`   | The nearest named field — `tags` for `tags[2]`                                 |
| `rule`    | The rule code that failed: `required`, `max_len`, `format`, `check`, `unknown` |
| `message` | The rendered message                                                           |
| `params`  | The rule's own parameters (`{ max = 20 }`), when it has any                    |
| `label`   | The field's [`label`](#labels), when it has one                                |

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

> [!NOTE] `params` is the rule's, never the input's
>
> An error entry carries the _bound_ that was violated, not the value
> that violated it. That is deliberate: an error body is logged, echoed
> and sometimes shown to a third party, and the submitted value is the
> part you would not want in any of those places. There is no `{value}`
> placeholder either.

`fields` is the map you want ninety percent of the time; `errors` is
there when you need to group by `part`, count by `rule`, or sort your own
way.

## Overriding a message

Four levels, most specific first.

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

A field-level `message` replaces whatever any rule on that field would
have said. Use it where the rules together express one idea and naming
them individually would be noise.

### One schema

```lua
local Signup = nitr.validate.schema({
    email    = "string|format:email|required",
    password = "string|min_len:12|required",
}, {
    messages = {
        required = "We need this one",
        summary  = "Please check the form",     -- the `message` line
    },
})
```

### The whole application

```lua
-- app.lua, at the top
nitr.validate.messages({
    required = "This field is required",
    summary  = "Please fix the highlighted fields",
})
```

> [!WARNING] `nitr.validate.messages` is load-time only
>
> Calling it after the application has compiled **raises**. Wording is
> configuration, not per-request state: one request must never be able
> to change what another request is told. Put the call at the top of
> `app.lua`, beside your other one-time setup.

## Placeholders

A template may name the rule's own parameters in `{braces}`. Which ones
exist depends on the rule, and naming one a rule does not have is a
**load-time error** — a message can never render as `{maxx}`.

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

```lua
messages = {
    max_len = "Keep it under {max} characters",
    one_of  = "Pick one of: {choices}",
    min     = "{min} at the very least",
}
```

A field-level `message` may use any placeholder the field's own rules
expose, plus `{type}`.

## Labels

`label` renames a field in the places a message names it — the cross-field
rules, and your own rendering.

```lua
local Booking = nitr.validate.schema({
    start_at = { "string|format:date|required", label = "Check-in" },
    end_at   = { "string|format:date|required", label = "Check-out" },
}, { ordered = { { "start_at", "end_at" } } })
```

```json
{ "fields": { "end_at": "must be after Check-in" } }
```

The `label` also arrives on every error entry, so a form renderer can
show a human name without a second table mapping keys to captions:

```lua
for _, e in ipairs(err.errors) do
    print((e.label or e.field) .. ": " .. e.message)
end
```

## Rendering a form again

`fields` is keyed by path, which is exactly what a template wants:

```lua
app:post("/signup", handler, {
    input = { body = { schema = Signup, content = { "form" } } },
    on_invalid = function(err, req)
        return nitr.html(nitr.template:render("signup.j2", {
            errors = err.fields,
            values = req:form(),
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

Note the `body.` prefix: route validation reports which part of the
request a failure came from. A standalone `schema:check` has no prefix,
so the key there is just `email`.

## Messages are safe to render

Every message is sanitized before it leaves Rust, so a rule's parameters
cannot carry markup into a page. Templates
[escape by default](../templates#escaping-read-this-one) as well, which
is the belt to this page's braces.

```lua
{ a = { "string|max_len:2", message = '<b>too long</b> & "quoted"' } }
```

reaches the client as text, not markup — in the JSON body and in a
rendered template alike.

## The default messages

For reference, and so you can tell which ones you actually want to
change:

| Rule                                                                   | Default message                                                                                    |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `type`                                                                 | `must be a string` / `an integer` / `a list` / `an object` / `a file` …                            |
| `required`                                                             | `is required`                                                                                      |
| `min_len` / `max_len` / `len`                                          | `must be at least {min} characters` …                                                              |
| `min` / `max`                                                          | `must be at least {min}` / `at most {max}`                                                         |
| `exclusive_min` / `exclusive_max`                                      | `must be greater than {min}` / `less than {max}`                                                   |
| `multiple_of` / `decimals`                                             | `must be a multiple of {step}` / `must have at most {decimals} decimal places`                     |
| `format`                                                               | `must be {format}` — an email address, a UUID, …                                                   |
| `one_of` / `not_one_of`                                                | `must be one of: {choices}` / `must not be one of: {choices}`                                      |
| `equals`                                                               | `must be {expected}`                                                                               |
| `starts_with` / `ends_with` / `contains` / `does_not_contain`          | `must start with {text}` …                                                                         |
| `after` / `before`                                                     | `must be in the future` / `in the past`, or `must be after {limit}`                                |
| `min_items` / `max_items` / `unique`                                   | `must have at least {min} items` … / `must not contain duplicates`                                 |
| `contains_any` / `contains_all`                                        | `must include one of: {choices}` / `all of: {choices}`                                             |
| `min_keys` / `max_keys`                                                | `must have at least {min} entries` …                                                               |
| `max_bytes` / `min_bytes` / `max_total_bytes`                          | `must be at most {max}` …                                                                          |
| `types` / `extensions`                                                 | `must be {types}` / `must have one of these extensions: {extensions}`                              |
| `match_extension` / `executable`                                       | `must have an extension that matches its content` / `must not be an executable`                    |
| `min_width` / `max_width` / `min_height` / `max_height` / `max_pixels` | `must be at most {max} px wide` …                                                                  |
| `aspect` / `dimensions` / `utf8`                                       | `must have a {aspect} aspect ratio` / `must have readable image dimensions` / `must be UTF-8 text` |
| `at_least_one` / `mutually_exclusive`                                  | `at least one of {fields} is required` / `only one of {fields} may be given`                       |
| `dependent_required` / `equal_fields` / `ordered`                      | `requires {fields}` / `must equal {field}` / `must be after {field}`                               |
| `unknown`                                                              | `is not a known field`                                                                             |
| `check`                                                                | `is invalid` — or whatever your `check` returned as its second value                               |
| `json` / `multipart` / `body`                                          | `must be valid JSON` / `must be a well-formed multipart body` / `must be an object`                |
| `filename`                                                             | `must have a name`                                                                                 |

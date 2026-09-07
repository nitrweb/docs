# String Formats

`format` names a syntactic shape a string must have. Each one is a
careful, dependency-free Rust implementation, and each is
[fuzzed](../security#fuzzing).

```lua
{
    email = "string|format:email|required",
    id    = "string|format:uuid",
    site  = "string|format:url",
    when  = "string|format:datetime",
}
```

A failure reports the format's own phrase, so the message reads as a
sentence: `must be an email address`, `must be a slug (lowercase
letters, digits, hyphens)`.

## The built-in formats

`nitr.validate.formats()` returns this list at runtime, custom formats
included.

### Identifiers and text shapes

| `format`       | Accepts                            | Message says                                |
| -------------- | ---------------------------------- | ------------------------------------------- |
| `alpha`        | Letters only                       | letters only                                |
| `alphanumeric` | Letters and digits                 | letters and digits only                     |
| `numeric`      | Digits only                        | digits only                                 |
| `alpha_dash`   | Letters, digits, `-`, `_`          | letters, digits, hyphens or underscores     |
| `slug`         | Lowercase letters, digits, hyphens | a slug (lowercase letters, digits, hyphens) |
| `lowercase`    | No uppercase characters            | lowercase                                   |
| `uppercase`    | No lowercase characters            | uppercase                                   |
| `ascii`        | ASCII only                         | ASCII text                                  |
| `printable`    | No control characters              | printable text                              |
| `hex`          | Hexadecimal digits                 | a hex string                                |
| `base64`       | Standard base64                    | a base64 string                             |
| `base64url`    | URL-safe base64                    | a URL-safe base64 string                    |
| `hex_color`    | `#RGB`, `#RRGGBB`, `#RRGGBBAA`     | a hex color (#RGB, #RRGGBB or #RRGGBBAA)    |
| `semver`       | A semantic version                 | a semantic version                          |
| `uuid`         | A UUID                             | a UUID                                      |
| `ulid`         | A ULID                             | a ULID                                      |
| `json`         | Text that parses as JSON           | valid JSON                                  |
| `jwt`          | Three base64url segments           | a JWT                                       |

### Network and addressing

| `format`   | Accepts                  | Message says                 |
| ---------- | ------------------------ | ---------------------------- |
| `email`    | An email address         | an email address             |
| `url`      | An `http`/`https` URL    | an http(s) URL               |
| `domain`   | A domain name            | a domain name                |
| `hostname` | A DNS hostname           | a hostname                   |
| `ip`       | IPv4 or IPv6             | an IP address                |
| `ipv4`     | IPv4 only                | an IPv4 address              |
| `ipv6`     | IPv6 only                | an IPv6 address              |
| `cidr`     | An IP range in CIDR form | an IP range in CIDR notation |
| `mac`      | A MAC address            | a MAC address                |

### Time

| `format`   | Accepts               | Message says               |
| ---------- | --------------------- | -------------------------- |
| `date`     | `YYYY-MM-DD`          | a date (YYYY-MM-DD)        |
| `datetime` | An RFC 3339 timestamp | an RFC 3339 datetime       |
| `time`     | `HH:MM` or `HH:MM:SS` | a time (HH:MM or HH:MM:SS) |

These three are also what [`after` and `before`](./rules#string) compare
with, and what an [`ordered` group](./composition#ordered) sorts by.

### Codes and checksums

| `format`        | Accepts                               | Message says                 |
| --------------- | ------------------------------------- | ---------------------------- |
| `phone`         | E.164 (`+` and digits)                | a phone number in E.164 form |
| `country_code`  | Two letters, ISO 3166-1 alpha-2 shape | a two-letter country code    |
| `currency_code` | Three letters, ISO 4217 shape         | a three-letter currency code |
| `language_tag`  | `en`, `en-US`                         | a language tag (en, en-US)   |
| `credit_card`   | Digits passing the Luhn checksum      | a valid card number          |
| `iban`          | An IBAN passing the mod-97 checksum   | a valid IBAN                 |

> [!NOTE] A format is a shape, not a fact
>
> `format = "email"` catches typos and obvious junk. Only sending a
> confirmation proves an address exists. `credit_card` and `iban` verify
> a checksum, which catches a transposed digit — it says nothing about
> whether the account exists or has money in it. `country_code` checks
> the shape, not membership of the current ISO list.

## Custom formats

`nitr.validate.format(name, spec)` registers a format you can then use
anywhere `format =` is accepted — including as an array's `items` rule
and inside a nested schema.

```lua
local S = nitr.validate

S.format("note_ref", {
    description = "A note reference: N- followed by up to 8 digits",
    pattern     = "^N-[0-9]{1,8}$",
    example     = "N-42",
    check       = function(s) return s:match("^N%-%d%d?%d?%d?%d?%d?%d?%d?$") ~= nil end,
})

local schema = S.schema({
    ref  = "string|format:note_ref|required",
    refs = { "array|max_items:10", items = "string|format:note_ref" },
})
```

| Key           | Required | What it is                                                                                       |
| ------------- | :------: | ------------------------------------------------------------------------------------------------ |
| `description` |    ✅    | The noun phrase completing "must be …", and what the API document publishes                      |
| `check`       |    ✅    | `function(s) -> boolean` — the actual test                                                       |
| `message`     |          | A full message, instead of `must be <description>`                                               |
| `pattern`     |          | A regular expression for the [document](../openapi/) only — **documentation, never enforcement** |
| `example`     |          | An example value for the document                                                                |

> [!WARNING] `pattern` documents; `check` enforces
>
> Nitr does not run the `pattern` — it publishes it, so a client
> generator and a downstream gateway can. The two must agree, and
> keeping them in agreement is your job. When in doubt, leave `pattern`
> out: an absent pattern is honest, a wrong one is worse than none.

### Register before you use it

```lua
-- app.lua, at the top: once per pooled Lua state, before any schema.
nitr.validate.format("note_ref", { ... })

local NoteInput = nitr.validate.schema({ ref = "string|format:note_ref" })
```

Formats live in the state that registered them, and a schema resolves
its format at **compile** time. Registering after the schema that uses
it is a load-time error naming the unknown format, not a surprise at the
first request.

Two more load-time rules keep the vocabulary honest:

- **A built-in name cannot be replaced.** `format("email", …)` is
  refused. A reader who sees `format = "email"` should not have to check
  whether this application redefined it.
- **A name cannot be registered twice.** The second call is an error,
  not a silent override.

## Listing what is available

```lua
nitr.dbg(nitr.validate.formats())
-- { "alpha", "alpha_dash", "alphanumeric", …, "note_ref", …, "uuid" }
```

Sorted, and it includes your own. Handy in a test that asserts a format
you rely on is actually registered.

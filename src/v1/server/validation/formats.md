# String Formats

`format` names the shape a string must have. The checks are written in
Rust, with no outside dependencies, and are
[fuzz-tested](../security#fuzzing).

```lua
{
    email = "string|format:email|required",
    id    = "string|format:uuid",
    site  = "string|format:url",
    when  = "string|format:datetime",
}
```

A failure reads as a sentence: `must be an email address`.

## The built-in formats

`nitr.validate.formats()` returns every format name, sorted, including
your own.

### Identifiers and text shapes

| `format`       | Accepts                            | Message: "must be …"                        |
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

| `format`   | Accepts                  | Message: "must be …"         |
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

| `format`   | Accepts               | Message: "must be …"       |
| ---------- | --------------------- | -------------------------- |
| `date`     | `YYYY-MM-DD`          | a date (YYYY-MM-DD)        |
| `datetime` | An RFC 3339 timestamp | an RFC 3339 datetime       |
| `time`     | `HH:MM` or `HH:MM:SS` | a time (HH:MM or HH:MM:SS) |

These three are what [`after` and `before`](./rules#string) and an
[`ordered` group](./composition#ordered) compare.

### Codes and checksums

| `format`        | Accepts                               | Message: "must be …"                        |
| --------------- | ------------------------------------- | ------------------------------------------- |
| `phone`         | E.164 (`+` and digits)                | a phone number in E.164 form (+ and digits) |
| `country_code`  | Two letters, ISO 3166-1 alpha-2 shape | a two-letter country code                   |
| `currency_code` | Three letters, ISO 4217 shape         | a three-letter currency code                |
| `language_tag`  | `en`, `en-US`                         | a language tag (en, en-US)                  |
| `credit_card`   | Digits passing the Luhn checksum      | a valid card number                         |
| `iban`          | An IBAN passing the mod-97 checksum   | a valid IBAN                                |

> [!NOTE] A format checks shape, not truth
>
> `email` catches typos; only a confirmation email proves the address
> exists. `credit_card` and `iban` catch a mistyped digit, not whether
> the account exists. `country_code` checks two letters, not the current
> ISO list.

## Custom formats

`nitr.validate.format(name, spec)` registers a format you can use
anywhere `format` is accepted, including in array `items` and nested
schemas.

```lua
local S = nitr.validate

S.format("note_ref", {
    description = "A note reference: N- followed by up to 8 digits",
    check       = function(s) return s:match("^N%-%d%d?%d?%d?%d?%d?%d?%d?$") ~= nil end,
    message     = "must be a note reference like N-42",
    pattern     = "^N-[0-9]{1,8}$",
    example     = "N-42",
})

local schema = S.schema({
    ref  = "string|format:note_ref|required",
    refs = { "array|max_items:10", items = "string|format:note_ref" },
})
```

| Key           | Required | What it is                                                             |
| ------------- | :------: | ---------------------------------------------------------------------- |
| `description` |    ✅    | What the [API document](../openapi/) says about the format             |
| `check`       |    ✅    | `function(s) -> boolean, reason?`: the actual test                     |
| `message`     |          | The failure message. Without it: `must be a valid <name>`              |
| `pattern`     |          | A regular expression **published** in the document. Nitr never runs it |
| `example`     |          | An example value for the document                                      |

> [!WARNING] `check` enforces; `pattern` only documents
>
> Clients and gateways may use `pattern`, so keep it in agreement with
> `check`. If you are unsure, leave `pattern` out.

### Register before you use it

Call `nitr.validate.format` at the top of `app.lua`, before any schema
that uses it:

```lua
nitr.validate.format("note_ref", { ... })

local NoteInput = nitr.validate.schema({ ref = "string|format:note_ref" })
```

A schema looks its formats up when it compiles, so using a format before
registering it fails at load with `unknown format`. Names are lowercase
letters, digits and underscores. Replacing a built-in format, or
registering the same name twice, is also a load error.

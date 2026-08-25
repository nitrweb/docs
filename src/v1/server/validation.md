# Validation

`nitr.validate` compiles a declarative schema **once** and checks values
in Rust. You get a per-field error map, and undeclared fields are
stripped rather than passed through.

Enabled by default (`validate` is in the minimal `[std] features` set).

## The pattern

```lua
-- Compile once, at file scope. NOT inside the handler.
local schema = nitr.validate.schema({
    name  = { type = "string", min_len = 1, max_len = 100, required = true },
    email = { type = "string", format = "email", required = true },
    age   = { type = "integer", min = 0, max = 150 },
})

app:post("/users", function(req)
    local data, err = schema:check(req:json())
    if not data then
        return nitr.error(422, {
            code   = "VALIDATION_FAILED",
            fields = err.fields,
        })
    end

    -- `data` contains ONLY the declared fields.
    return nitr.json(create_user(data), 201)
end)
```

A failed check gives:

```json
{
  "code": "VALIDATION_FAILED",
  "fields": {
    "email": "must be a valid email address",
    "name": "is required"
  }
}
```

> [!WARNING] Compile at load time
>
> `nitr.validate.schema(...)` compiles the schema. Calling it inside a
> handler recompiles it on **every request**. Put it at the top of the
> route module, where it runs once per Lua state.

## Rules by type

### `string`

| Rule                  | Meaning                                     |
| --------------------- | ------------------------------------------- |
| `required`            | Must be present                             |
| `min_len` / `max_len` | Character count bounds                      |
| `format`              | One of the [formats](#string-formats) below |
| `one_of`              | An allow-list of exact values               |

```lua
{
    slug   = { type = "string", format = "slug", required = true },
    status = { type = "string", one_of = { "draft", "published", "archived" } },
    bio    = { type = "string", max_len = 500 },
}
```

### `number` and `integer`

| Rule          | Meaning                       |
| ------------- | ----------------------------- |
| `required`    | Must be present               |
| `min` / `max` | Inclusive bounds              |
| `one_of`      | An allow-list of exact values |

```lua
{
    age      = { type = "integer", min = 0, max = 150 },
    price    = { type = "number", min = 0 },
    priority = { type = "integer", one_of = { 1, 2, 3 } },
}
```

`integer` additionally rejects a value with a fractional part.

### `boolean`

```lua
{ subscribed = { type = "boolean", required = true } }
```

### `array`

| Rule                      | Meaning                         |
| ------------------------- | ------------------------------- |
| `required`                | Must be present                 |
| `items`                   | A rule applied to every element |
| `min_items` / `max_items` | Length bounds                   |

```lua
{
    tags = {
        type = "array",
        min_items = 1,
        max_items = 10,
        items = { type = "string", min_len = 1, max_len = 30 },
    },
}
```

### `table` (nested objects)

| Rule       | Meaning         |
| ---------- | --------------- |
| `required` | Must be present |
| `fields`   | A nested schema |

```lua
local schema = nitr.validate.schema({
    name = { type = "string", required = true },
    address = {
        type = "table",
        required = true,
        fields = {
            street   = { type = "string", required = true },
            city     = { type = "string", required = true },
            postcode = { type = "string", format = "alphanumeric" },
        },
    },
})
```

Nested errors are reported by path:

```json
{ "fields": { "address.postcode": "must be alphanumeric" } }
```

## String formats

Each is one careful, dependency-free Rust implementation — a syntactic
sanity check, not full RFC validation.

| `format`       | Accepts                 |
| -------------- | ----------------------- |
| `email`        | An email address        |
| `uuid`         | A UUID                  |
| `url`          | A URL                   |
| `ip`           | An IPv4 or IPv6 address |
| `ipv4`         | An IPv4 address         |
| `ipv6`         | An IPv6 address         |
| `hostname`     | A DNS hostname          |
| `date`         | A calendar date         |
| `datetime`     | A date and time         |
| `hex`          | Hexadecimal digits      |
| `base64`       | Base64                  |
| `alphanumeric` | Letters and digits      |
| `slug`         | A URL slug              |

```lua
{
    email = { type = "string", format = "email" },
    id    = { type = "string", format = "uuid" },
    site  = { type = "string", format = "url" },
    when  = { type = "string", format = "datetime" },
}
```

> [!NOTE] `format = "email"` is not proof of delivery
>
> Syntactic validation catches typos and obvious junk. Only sending a
> confirmation proves an address exists.

## Undeclared fields are stripped

```lua
local schema = nitr.validate.schema({
    name = { type = "string", required = true },
})

local data = schema:check({ name = "Ada", is_admin = true })
-- data == { name = "Ada" }        ← is_admin is gone
```

This is a security property, not a convenience: mass-assignment
vulnerabilities happen when a request body flows into a database write
carrying a field the client should not control. `check` returns only
what you declared, so passing `data` straight through is safe.

## Optional versus required

Omit `required` and the field may be absent — but if it _is_ present, it
must still satisfy every other rule:

```lua
{
    bio = { type = "string", max_len = 500 },   -- optional, but bounded when given
}
```

## Validating query parameters

Query values are always **strings**, so declare them as strings and
convert afterwards:

```lua
local list_schema = nitr.validate.schema({
    page  = { type = "string", format = "alphanumeric" },
    limit = { type = "string", format = "alphanumeric" },
})

app:get("/api/items", function(req)
    local q = list_schema:check(req.query) or {}
    local page  = math.max(tonumber(q.page)  or 1,  1)
    local limit = math.min(tonumber(q.limit) or 20, 100)
    return nitr.json(list_items(page, limit))
end)
```

> [!TIP] Clamp, do not reject, for pagination
>
> A `limit=999999` is better answered by silently clamping to your
> maximum than by a `422` — and clamping is what protects the database.

## Validation middleware

Reusable across routes:

```lua
local function validates(schema)
    return function(next)
        return function(req)
            local data, err = schema:check(req:json())
            if not data then
                return nitr.error(422, { code = "VALIDATION_FAILED", fields = err.fields })
            end
            req.data = data
            return next(req)
        end
    end
end

app:post("/users", validates(user_schema), function(req)
    return nitr.json(create_user(req.data), 201)
end)
```

## The error shape

```lua
local data, err = schema:check(value)
```

| Returned | On success               | On failure                                                       |
| -------- | ------------------------ | ---------------------------------------------------------------- |
| `data`   | the declared fields only | `nil`                                                            |
| `err`    | `nil`                    | `{ message = "...", fields = { ["path.to.field"] = "reason" } }` |

`err.fields` maps each failing path to a human-readable reason
(`"is required"`, `"must be at least 3 characters"`, `"must be one of:
draft, published"`), which makes it directly usable as a form-error map
on the client.

## A complete example

```lua
-- routes/articles.lua
local create_schema = nitr.validate.schema({
    title = { type = "string", min_len = 1, max_len = 200, required = true },
    body  = { type = "string", min_len = 1, required = true },
    tags  = {
        type = "array", max_items = 5,
        items = { type = "string", format = "slug" },
    },
    status = { type = "string", one_of = { "draft", "published" } },
})

return function(app)
    app:post("/api/articles", require_auth, function(req)
        local data, err = create_schema:check(req:json())
        if not data then
            return nitr.error(422, { code = "VALIDATION_FAILED", fields = err.fields })
        end

        local id = nitr.db:transaction(function(tx)
            tx:execute(
                "INSERT INTO articles (title, body, status, author, created_at) \
                 VALUES (?, ?, ?, ?, ?)",
                { data.title, data.body, data.status or "draft", req.user, nitr.time.now() }
            )
            local article_id = tx:query_one("SELECT last_insert_rowid()")
            for _, tag in ipairs(data.tags or {}) do
                tx:execute(
                    "INSERT INTO article_tags (article_id, tag) VALUES (?, ?)",
                    { article_id, tag }
                )
            end
            return article_id
        end)

        return nitr.json({ id = id }, 201)
    end)
end
```

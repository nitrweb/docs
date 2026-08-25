# Testing

`nitr test` runs your Lua tests against an **in-process server**.
Requests dispatch through the real router, the real middleware chain and
the real handlers. Nothing is mocked.

```sh
nitr test
nitr test --filter notes
```

The command exits non-zero if any test fails, so it drops straight into
CI.

## Where tests live

```toml
[testing]
dir = "tests"      # the default
```

Every `*.lua` file in that directory is a test file. `nitr.test` is
available **only** in test files.

## Writing a test

```lua
-- tests/notes_test.lua
local t = nitr.test

t.it("greets by name", function()
    local resp = t.request("GET", "/api/hello?name=nitr")
    t.expect(resp.status).to_equal(200)
    t.expect(resp:json().hello).to_equal("nitr")
end)
```

## Grouping

`describe` groups tests; the group name prefixes each one in the output:

```lua
local t = nitr.test

t.describe("notes API", function()
    t.it("starts empty", function()
        local resp = t.request("GET", "/api/notes")
        t.expect(resp.status).to_equal(200)
        t.expect(resp:json()).to_equal({})
    end)

    t.it("creates a note", function()
        local resp = t.request("POST", "/api/notes", { json = { text = "hi" } })
        t.expect(resp.status).to_equal(201)
        t.expect(resp:json().text).to_equal("hi")
    end)
end)
```

Groups nest, and the names compose:

```
notes API › creates a note   ok
```

## Setup and teardown

```lua
t.before_each(function()
    nitr.db:execute("DELETE FROM notes")
end)

t.after_each(function()
    -- runs even when the test failed
end)
```

`before_each` runs before every test in the **file**; `after_each` runs
after every test in the file, including failing ones, so cleanup is not
skipped by a failure.

> [!TIP] Reset state, do not share it
>
> Tests run in one process against one database. `before_each` deleting
> the rows a test depends on is what keeps them independent and
> order-insensitive.

## Making requests

```lua
t.request("GET", "/api/notes")

t.request("POST", "/api/notes", {
    json = { text = "hello" },              -- encodes and sets Content-Type
})

t.request("POST", "/login", {
    headers = { ["content-type"] = "application/x-www-form-urlencoded" },
    body    = "username=ada&password=secret",
})

t.request("GET", "/me", {
    headers = { ["Authorization"] = "Bearer " .. token },
})
```

| Option    | Meaning                                             |
| --------- | --------------------------------------------------- |
| `json`    | Table body, JSON-encoded, with the content type set |
| `body`    | Raw string body                                     |
| `headers` | Request headers                                     |

The response is `{ status, headers, body }` plus `resp:json()`:

```lua
local resp = t.request("GET", "/api/notes")
resp.status                      -- 200
resp.headers["content-type"]     -- "application/json"
resp.body                        -- the raw string
resp:json()                      -- decoded
```

Query strings go in the path, as they would over the wire:

```lua
t.request("GET", "/api/notes?limit=10&offset=20")
```

## Matchers

```lua
t.expect(value).to_equal(expected)        -- deep equality for tables
t.expect(value).to_not_equal(other)
t.expect(value).to_be_nil()
t.expect(value).to_be_truthy()
t.expect(str).to_match(pattern)           -- Lua pattern
t.expect(container).to_contain(item)
```

`to_equal` compares tables **deeply**, so you can assert a whole
response body at once:

```lua
t.expect(resp:json()).to_equal({ id = 1, text = "hi" })
```

## Failure output

A failure names the assertion, both values, and the `file:line`:

```
notes API › creates a note   FAILED
  tests/notes_test.lua:14: expected 201, got 422
```

That is the whole point of the framework: you should not have to add
prints to find out what went wrong.

## Filtering

```sh
nitr test --filter notes          # by test name or file name
nitr test --filter "rejects an empty"
```

The substring is matched against both the test's (composed) name and its
file name.

## What a good suite covers

```lua
local t = nitr.test

t.before_each(function()
    nitr.db:execute("DELETE FROM notes")
end)

t.describe("notes API", function()
    -- The happy path
    t.it("creates and reads back a note", function()
        local created = t.request("POST", "/api/notes", { json = { text = "hi" } })
        t.expect(created.status).to_equal(201)

        local list = t.request("GET", "/api/notes")
        t.expect(#list:json()).to_equal(1)
    end)

    -- Validation
    t.it("rejects an empty note", function()
        local resp = t.request("POST", "/api/notes", { json = {} })
        t.expect(resp.status).to_equal(422)
        t.expect(resp:json().fields.text).to_match("required")
    end)

    -- Not found
    t.it("404s for a missing note", function()
        t.expect(t.request("GET", "/api/notes/999").status).to_equal(404)
    end)

    -- Authorization — middleware runs for real, so this is a real check
    t.it("requires authentication to delete", function()
        t.expect(t.request("DELETE", "/api/notes/1").status).to_equal(401)
    end)

    -- Method handling, answered in Rust
    t.it("405s on an unsupported method", function()
        t.expect(t.request("PATCH", "/api/notes").status).to_equal(405)
    end)
end)
```

## Testing middleware

Because dispatch is real, middleware needs no special treatment — assert
on its effects:

```lua
t.it("adds security headers to every response", function()
    local resp = t.request("GET", "/")
    t.expect(resp.headers["x-content-type-options"]).to_equal("nosniff")
end)

t.it("rejects an invalid token", function()
    local resp = t.request("GET", "/me", {
        headers = { ["Authorization"] = "Bearer nonsense" },
    })
    t.expect(resp.status).to_equal(401)
end)
```

## Testing an authenticated flow

Chain requests, carrying the cookie or token forward:

```lua
t.it("logs in and reaches the dashboard", function()
    local login = t.request("POST", "/login", {
        headers = { ["content-type"] = "application/x-www-form-urlencoded" },
        body    = "username=ada&password=secret",
    })
    t.expect(login.status).to_equal(303)

    local cookie = login.headers["set-cookie"]
    local page = t.request("GET", "/dashboard", {
        headers = { ["Cookie"] = cookie },
    })
    t.expect(page.status).to_equal(200)
end)
```

## Tests and the database

Tests run against the database in your configuration. Point `nitr test`
at a throwaway one so a run cannot touch real data:

```sh
NITR_DATABASE_PATH=data/test.db nitr migrate
NITR_DATABASE_PATH=data/test.db nitr test
```

## In CI

```yaml
- run: cargo install --git https://github.com/joseluisq/nitr nitr-cli
- run: nitr check # configuration and scripts load
- run: nitr migrate # schema is current
- run: nitr test # behaviour is correct
```

`nitr check` first is worth the second it costs: a configuration error
fails with a clear message rather than as a puzzling test failure.

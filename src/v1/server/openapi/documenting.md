# Documenting Routes

Two tables shape the generated document: `app:doc` for the API as a
whole, and a `doc` on each route for the operation. Everything about
what a request _must look like_ stays in
[`input`](../validation/route-input) — writing it twice is exactly the
drift this design avoids.

## `app:doc`

Called once, before your routes.

```lua
local app = nitr.app()

app:doc({
    title       = "Notes",
    version     = "1.0.0",
    description = "A small notes API, documented from its own route table.",
    tags = {
        { name = "notes", description = "Create and read notes" },
        { name = "admin", description = "Operator endpoints" },
    },
    security = {
        team   = { type = "apiKey", ["in"] = "header", name = "x-team" },
        bearer = { type = "http", scheme = "bearer", bearerFormat = "JWT" },
    },
})
```

| Key                | What it is                                                                        |
| ------------------ | --------------------------------------------------------------------------------- |
| `title`            | The API's name. Also the default `<title>` of the [Swagger UI page](./swagger-ui) |
| `version`          | Your API's version — not Nitr's                                                   |
| `description`      | Prose for the top of the document. Markdown, as OpenAPI readers expect            |
| `terms_of_service` | A URL                                                                             |
| `contact`          | `{ name, url, email }`                                                            |
| `license`          | `{ name, url }` or `{ name, identifier }`                                         |
| `tags`             | `{ { name, description } }` — the groups operations sort into                     |
| `security`         | Named security schemes, referenced by name from a route's `doc.security`          |
| `external_docs`    | `{ url, description }`                                                            |

An unknown key is a **load-time error** naming the allowed ones. A
misspelled `descripton` producing a document with no description is
exactly the failure nobody notices.

### Security schemes

`security` is a map from a name you choose to an OpenAPI security scheme
object. Routes then reference the name:

```lua
app:doc({
    security = {
        team   = { type = "apiKey", ["in"] = "header", name = "x-team" },
        bearer = { type = "http", scheme = "bearer", bearerFormat = "JWT" },
    },
})

app:get("/api/notes", list, {
    input = { headers = { ["x-team"] = "string|format:alpha_dash|required" } },
    doc   = { summary = "List notes", security = { "team" } },
})
```

> [!NOTE] A scheme documents; it does not authenticate
>
> Declaring `bearer` tells a reader and a client generator that this
> operation expects a token. It does not check one — that is your
> middleware's job, and
> [`nitr.auth.bearer`](../crypto-auth) plus
> `nitr.crypto.constant_time_eq` is how you do it. Requiring the header
> to be _present_ is what `input.headers` gives you.
>
> `["in"]` is bracketed because `in` is a Lua keyword.

## Per-route `doc`

The third argument to a route registration is its
[options table](../routing#route-options); `doc` is one of its keys.

```lua
app:post("/api/notes", function(req)
    return nitr.json(create(req.valid.body), 201)
end, {
    input = { body = NoteInput },
    doc = {
        summary      = "Create a note",
        description  = "Creates a note owned by the calling team.",
        tags         = { "notes" },
        operation_id = "createNote",
        security     = { "team" },
        responses = {
            [201] = { description = "Created", schema = Note },
            [409] = { description = "A note with that reference exists" },
        },
    },
})
```

| Key            | What it becomes                                                                         |
| -------------- | --------------------------------------------------------------------------------------- |
| `summary`      | The one-line title shown in a list of operations                                        |
| `description`  | The longer prose under it                                                               |
| `tags`         | Which `app:doc` tags this operation belongs to                                          |
| `operation_id` | `operationId` — the method name a generated client gets. Defaults to `get_api_notes_id` |
| `responses`    | `{ [code] = { description, schema?, content? } }`                                       |
| `security`     | Scheme names from `app:doc`                                                             |
| `deprecated`   | Marks the operation deprecated                                                          |
| `hidden`       | Keeps the route out of the document entirely                                            |

> [!WARNING] Request schemas do not go in `doc`
>
> `doc = { body = … }` is a load-time error pointing at `input`. There
> is one place a request shape is declared, and it is the place that
> also enforces it:
>
> ```text
> app.lua:42: doc.body is not a documentation key: request schemas are
> declared under `input`, which both enforces and documents them
> ```

## Responses

Each entry needs a `description`; `schema` and `content` are optional.

```lua
responses = {
    [200] = { description = "A page of notes",
              schema = { type = "array", items = Note } },
    [404] = { description = "No such note" },
    [204] = { description = "Deleted" },
}
```

`schema` takes a compiled schema, or an inline rule table — the same
vocabulary the request side uses, so `{ type = "array", items = Note }`
means what it looks like. A titled schema is emitted once under
`components/schemas` and referenced.

`content` names the media type when it is not `application/json`:

```lua
responses = {
    [200] = { description = "The report", content = "text/csv" },
}
```

> [!DANGER] A response schema is documentation, and only that
>
> It is emitted with `x-nitr-enforced: false`. Nitr does not check what
> your handler returns, on purpose: a response that failed validation
> would have to become a `500`, turning a documentation mistake into an
> outage. Write a [test](../testing) that asserts the shape instead —
> that is the check that belongs here.

## Hiding a route

```lua
app:get("/internal/metrics", function(req)
    return nitr.json({ notes = count() })
end, { doc = { hidden = true } })
```

Present in the router, absent from the document. Use it for operator
endpoints and anything whose existence is not part of the published
contract.

To go the other way — document _only_ what you annotated — turn off the
default that includes everything:

```toml
[openapi]
include_undocumented = false
```

Then a route without a `doc` table is left out, and adding one is how a
route becomes public. The two approaches suit different teams; pick one
deliberately, because the defaults differ in what a _forgotten_ route
does.

## A worked example

The whole thing together — validated, documented, and served:

```lua
local S = nitr.validate
local app = nitr.app()

app:doc({
    title   = "Notes",
    version = "1.0.0",
    tags    = { { name = "notes", description = "Create and read notes" } },
    security = { team = { type = "apiKey", ["in"] = "header", name = "x-team" } },
})

local team = { ["x-team"] = "string|format:alpha_dash|required" }

local NoteInput = S.schema({
    text     = { "string|trim|min_len:1|max_len:500|required",
                 description = "The note body" },
    tags     = { "array|max_items:5|unique", items = "string|format:slug|max_len:32" },
    priority = "integer|min:1|max:5|default:3",
}, { title = "NoteInput" })

-- Documentation only: responses are never checked.
local Note = S.schema({
    id       = "integer|required",
    text     = "string|required",
    tags     = { "array", items = "string" },
    priority = "integer",
}, { title = "Note" })

app:get("/api/notes", function(req)
    local q = req.valid.query
    return nitr.json(list_notes(q.limit, q.offset))
end, {
    input = {
        query = {
            limit  = "integer|min:1|max:100|default:20",
            offset = "integer|min:0|default:0",
        },
        headers = team,
    },
    doc = {
        summary = "List notes", tags = { "notes" }, security = { "team" },
        responses = { [200] = { description = "A page of notes",
                                schema = { type = "array", items = Note } } },
    },
})

app:post("/api/notes", function(req)
    return nitr.json(create(req.valid.body), 201)
end, {
    input = { body = NoteInput, headers = team },
    doc = {
        summary = "Create a note", tags = { "notes" }, security = { "team" },
        responses = { [201] = { description = "Created", schema = Note } },
    },
})

app:get("/internal/metrics", metrics, { doc = { hidden = true } })

return app
```

The complete, runnable version is the
[`openapi` example](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/openapi).

## Prose is escaped where it is rendered

`title` and `description` reach the document as the text you wrote —
JSON has no markup problem. The [Swagger UI page](./swagger-ui) renders
them, and it escapes them: a `</script>` in your API title cannot break
out of the page it is displayed on. The same holds for a field's
`description` and a custom format's `example`.

Prose fields are bounded at 64 KiB each, and a document that will leave
the process — served, or written to `[openapi] output` — is bounded at
1 MiB. An oversized one is a **startup** error naming the size, because
the size of a document is a property of the application rather than of
a request. (`nitr openapi` still prints it, whatever its size.)

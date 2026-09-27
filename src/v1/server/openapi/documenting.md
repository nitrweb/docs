# Documenting Routes

Two tables shape the generated document: `app:doc` describes the API as
a whole, and a `doc` table on each route describes that operation.
Request shapes are declared only in [`input`](../validation/route-input),
which both enforces and documents them.

## `app:doc`

Call it once, before your routes:

```lua
local app = nitr.app()

app:doc({
    title       = "Notes",
    version     = "1.0.0",
    description = "A small notes API.",
    tags = {
        { name = "notes", description = "Create and read notes" },
    },
    security = {
        team   = { type = "apiKey", ["in"] = "header", name = "x-team" },
        bearer = { type = "http", scheme = "bearer", bearerFormat = "JWT" },
    },
})
```

| Key                | What it is                                                                    |
| ------------------ | ----------------------------------------------------------------------------- |
| `title`            | The API's name, also the default title of the [Swagger UI page](./swagger-ui) |
| `version`          | Your API's version                                                            |
| `description`      | Markdown shown at the top of the document                                     |
| `terms_of_service` | A URL                                                                         |
| `contact`          | `{ name, url, email }`                                                        |
| `license`          | `{ name, url }` or `{ name, identifier }`                                     |
| `tags`             | `{ { name, description } }`, the groups operations are listed under           |
| `security`         | Named OpenAPI security schemes that routes refer to by name                   |
| `external_docs`    | `{ url, description }`                                                        |

An unknown key, such as a misspelt `descripton`, is a load-time error
that lists the allowed keys.

### Security schemes

`security` maps a name you choose to an OpenAPI security scheme. Routes
refer to it by name:

```lua
app:get("/api/notes", list, {
    input = { headers = { ["x-team"] = "string|format:alpha_dash|required" } },
    doc   = { summary = "List notes", security = { "team" } },
})
```

`["in"]` needs brackets because `in` is a Lua keyword.

> [!NOTE] A scheme documents; it does not authenticate
>
> Checking the token is your middleware's job, for example with
> [`nitr.auth.bearer`](../crypto-auth) and
> `nitr.crypto.constant_time_eq`. `input.headers` can require the
> header to be present.

## Per-route `doc`

`doc` is a key of the route's [options table](../routing#route-options):

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

| Key            | What it becomes                                                                       |
| -------------- | ------------------------------------------------------------------------------------- |
| `summary`      | The one-line title in the list of operations                                          |
| `description`  | Longer text under it                                                                  |
| `tags`         | Which `app:doc` tags the operation belongs to                                         |
| `operation_id` | `operationId`, the method name in generated clients. Default: e.g. `get_api_notes_id` |
| `responses`    | `{ [code] = { description, schema?, content? } }`                                     |
| `security`     | Scheme names from `app:doc`                                                           |
| `deprecated`   | Marks the operation deprecated                                                        |
| `hidden`       | Leaves the route out of the document                                                  |

Request schemas do not go in `doc`. `doc = { body = … }` is a load-time
error that points you to `input`.

## Responses

Each response needs a `description`. `schema` and `content` are
optional:

```lua
responses = {
    [200] = { description = "A page of notes",
              schema = { type = "array", items = Note } },
    [204] = { description = "Deleted" },
    [404] = { description = "No such note" },
}
```

`schema` takes a compiled schema or an inline rule table, using the
same rules as request validation. A schema with a `title` is written
once under `components/schemas` and referenced. `content` sets the media
type when it is not JSON:

```lua
responses = {
    [200] = { description = "The report", content = "text/csv" },
}
```

An operation whose documented responses have no `2xx` entry, such as
one that lists only its `404`, still gets a default `200` response
described as `OK`, so a generated client always has a success shape.
Document the real success code to replace it.

Response schemas are documentation only: Nitr never checks what a
handler returns (see
[What the document claims](./#what-the-document-claims)).

## Hiding a route

```lua
app:get("/internal/metrics", metrics, { doc = { hidden = true } })
```

The route still works; it is just not in the document. To do the
opposite and publish **only** routes that have a `doc` table:

```toml
[openapi]
include_undocumented = false
```

Choose one approach on purpose: it decides whether a route you forgot
to document is public or not.

## A complete example

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

The runnable version is the
[`openapi` example](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/openapi).

## Limits

Each text field (`title`, `description` and so on) may be up to
64 KiB, and a served or written document up to 1 MiB. A larger one is a
startup error. `nitr openapi` prints it regardless of size. The Swagger
UI page escapes all text it displays.

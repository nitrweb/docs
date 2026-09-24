# OpenAPI

Nitr generates an **OpenAPI 3.1** document from your routes. Request
schemas come from each route's [`input`](../validation/route-input) and
descriptions from its [`doc`](./documenting), so the document always
matches what the server enforces.

```lua
app:post("/api/notes", create_note, {
    input = { body = NoteInput },              -- enforced, and documented
    doc   = { summary = "Create a note", tags = { "notes" } },
})
```

```console
$ curl -s localhost:3000/openapi.json | jq '.paths."/api/notes".post.summary'
"Create a note"
```

`nitr init` turns on both the document and the
[Swagger UI page](./swagger-ui), so a new application serves
`/openapi.json` and `/docs` from the first `nitr dev`.

## Turning it on

```toml
[openapi]
enabled = true
path = "/openapi.json"
servers = ["https://api.example.com"]
```

It is off by default, because the document maps every path, parameter
and field of your API. The `nitr` binary includes the `openapi`
[Cargo feature](../../library/cargo-features).

| Key                    | Default           | What it does                                                      |
| ---------------------- | ----------------- | ----------------------------------------------------------------- |
| `enabled`              | `false`           | Serve the document at `path`                                      |
| `path`                 | `"/openapi.json"` | Where it is served                                                |
| `servers`              | _unset_           | The document's `servers` list                                     |
| `include_undocumented` | `true`            | Include routes without a `doc` table                              |
| `output`               | _unset_           | **Dev mode only**: a file rewritten whenever the document changes |

## What the document contains

| From                                                    | Becomes                                                                                |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| The route table                                         | `paths`, one operation per method, `:id` written as `{id}`                             |
| `input.query` / `input.params` / `input.headers`        | `parameters`, with types, bounds, formats and defaults                                 |
| `input.body`                                            | `requestBody`, with the content types the route accepts                                |
| A schema's `title`                                      | A named entry under `components/schemas`                                               |
| [`app:doc`](./documenting#app-doc)                      | `info`, `tags`, `components/securitySchemes`                                           |
| A route's [`doc`](./documenting#per-route-doc)          | `summary`, `description`, `tags`, `operationId`, `responses`, `security`, `deprecated` |
| A [custom format](../validation/formats#custom-formats) | Its `description`, `example` and `pattern`, if given                                   |

A route without `doc` still gets an `operationId` built from its method
and path: `GET /api/notes/:id` becomes `get_api_notes_id`.

## What the document claims

Every generated schema says whether Nitr checks it:

| Marker                      | Meaning                                                             |
| --------------------------- | ------------------------------------------------------------------- |
| `x-nitr-enforced: true`     | Checked before the handler runs (request bodies and parameters)     |
| `x-nitr-enforced: "custom"` | Checked, plus a Lua `check` the document can only describe in words |
| `x-nitr-enforced: false`    | **Documentation only**: every response schema                       |

> [!WARNING] Response schemas are never checked
>
> Nitr does not verify what your handler returns. Write a
> [test](../testing) that checks the response shape.

A Lua `check` function cannot be written into the document, so give it
a `description`:

```lua
text = { "string|trim|min_len:1|required",
         description = "The note body; must contain at least one letter",
         check = function(s) return s:match("%a") ~= nil, "must contain a letter" end }
```

## Serving it

The document is built once each time the Lua pool is built, so after a
[reload](../deployment/#zero-downtime-reload) it always matches the
current routes. It is answered to `GET` and `HEAD` with an `ETag`
(`304` on a match) and `Cache-Control: max-age=60` (`no-store` in dev
mode).

Registering your own route at `[openapi] path` while the document is
enabled is a startup error.

## `nitr openapi`

Generates the document without starting the server:

```sh
nitr openapi                        # print it to stdout
nitr openapi --output openapi.json  # write it to a file
nitr openapi --check                # exit 1 if the file is out of date
nitr openapi --ui site/             # a self-contained Swagger UI site
```

This ignores `[openapi] enabled`, which only controls serving. You can
keep the document off in production and still publish it from CI. Logs
go to stderr, so `nitr openapi | jq` works.

### Checking it in CI

Commit the document and let CI fail when it no longer matches the code:

```yaml
- run: nitr check
- run: nitr openapi --check
- run: nitr test
```

```console
$ nitr openapi --check
openapi: openapi.json is out of date: first difference at $.paths./api/notes.post.summary; run `nitr openapi --output openapi.json` and commit the result
```

Formatting and key order are ignored; only real differences fail. The
output is identical between runs, so the check is reliable. `--check`
compares against `--output` if given, then `[openapi] output`, then
`openapi.json`.

### Keeping it current while you work

```toml
[openapi]
enabled = true
output = "openapi.json"
```

In dev mode, Nitr rewrites that file whenever a change alters the
document, so the committed copy stays current. It never writes in
production. The file may not end in `.lua` or sit inside
`[templating] dir`, since the dev watcher would reload on every write.
Inside `[static] dir` it only warns, because it would then be public.

## Where to go next

| Page                                | What is in it                                                   |
| ----------------------------------- | --------------------------------------------------------------- |
| [Documenting routes](./documenting) | `app:doc`, the per-route `doc` table, responses, hiding a route |
| [Swagger UI](./swagger-ui)          | The built-in page, its settings, and a static site              |
| [Validation](../validation/)        | Where the request schemas come from                             |

# OpenAPI

Nitr generates an **OpenAPI 3.1** document from the routes you already
wrote. Nothing in it is maintained by hand: the request schemas come from
each route's [`input`](../validation/route-input), the prose from its
[`doc`](./documenting), and the two cannot drift apart because the same
declaration does both jobs.

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

`nitr init` turns both this and the [Swagger UI page](./swagger-ui) on,
so a scaffolded application answers `/openapi.json` and `/docs` from the
first `nitr dev`.

## Turning it on

```toml
[openapi]
enabled = true
path = "/openapi.json"
servers = ["https://api.example.com"]
```

Off by default. A route map is reconnaissance material — every path,
every parameter, every field name — so publishing one is a decision
rather than something that happens because you upgraded.

Needs the `openapi` [Cargo feature](../../library/cargo-features), which
the released binary has.

| Key                    | Default           | What it does                                                                           |
| ---------------------- | ----------------- | -------------------------------------------------------------------------------------- |
| `enabled`              | `false`           | Serve the document at `path`                                                           |
| `path`                 | `"/openapi.json"` | Where it answers                                                                       |
| `servers`              | _unset_           | The document's `servers` list — a deployment fact, so configuration rather than script |
| `include_undocumented` | `true`            | Routes without a `doc` table still appear, as bare operations                          |
| `output`               | _unset_           | **Dev mode only**: a file rewritten after each rebuild when the document changed       |

## What the document contains

| From                                                    | Becomes                                                                                |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| The route table                                         | `paths`, one operation per method, `:id` rendered as `{id}`                            |
| `input.query` / `input.params` / `input.headers`        | `parameters`, with their types, bounds, formats and defaults                           |
| `input.body`                                            | `requestBody`, with the content types the route accepts                                |
| A schema's `title`                                      | A named entry under `components/schemas`, referenced everywhere it is used             |
| [`app:doc`](./documenting#app-doc)                      | `info`, `tags`, `components/securitySchemes`                                           |
| A route's [`doc`](./documenting#per-route-doc)          | `summary`, `description`, `tags`, `operationId`, `responses`, `security`, `deprecated` |
| A [custom format](../validation/formats#custom-formats) | Its `description`, `example` and — if you gave one — `pattern`                         |

An operation with no `doc` still gets an `operationId`, derived from its
method and path: `GET /api/notes/:id` becomes `get_api_notes_id`. Give
one explicitly when a generated client's method name matters to you.

## What the document claims

Nitr will not describe an enforcement it does not perform. Every
generated schema carries a marker saying which side of that line it is
on:

| Marker                      | Meaning                                                                        |
| --------------------------- | ------------------------------------------------------------------------------ |
| `x-nitr-enforced: true`     | Checked in Rust before the handler. Request bodies and parameters              |
| `x-nitr-enforced: "custom"` | Checked, and a Lua `check` adds a rule the document can only describe in prose |
| `x-nitr-enforced: false`    | **Documentation only.** Every response schema                                  |

> [!WARNING] Response schemas are never checked
>
> `doc.responses[200].schema` says what you intend to return. Nitr does
> not verify that your handler returns it — validating responses would
> mean a schema failure turning a working `200` into a `500`. Treat it
> as a contract you keep, and test it.

That is also why a Lua `check` needs a `description`: a predicate cannot
be serialized, so its description is what the document says, and the
schema is marked `"custom"` so a reader knows there is more enforced
than shown.

```lua
text = { "string|trim|min_len:1|required",
         description = "The note body; must contain at least one letter",
         check = function(s) return s:match("%a") ~= nil, "must contain a letter" end }
```

## Serving it

The document is built **once per pool build**, from the bootstrap state,
and swapped with the pool. A [reload](../deployment/#zero-downtime-reload)
can therefore never serve a document describing the previous routes.

Answering a request for it is a string compare and a buffer clone — no
Lua state, no filesystem:

| Header                   | Value                                                       |
| ------------------------ | ----------------------------------------------------------- |
| `Content-Type`           | `application/json`                                          |
| `ETag`                   | A strong validator over the bytes; `304` on `If-None-Match` |
| `Cache-Control`          | `max-age=60` — `no-store` in dev mode                       |
| `X-Content-Type-Options` | `nosniff`                                                   |

`GET` and `HEAD` only. Any other method falls through to the router and
its `405`, so nothing about the document changes how your own routes
answer.

> [!NOTE] A route may not claim the document's path
>
> With `[openapi] enabled`, registering a route at `[openapi] path` is a
> **startup error naming the setting and the line that registered it** —
> the route could never be reached, and silently shadowed routes are
> exactly the bug this catches. With the section disabled nothing is
> reserved and your route wins.

## `nitr openapi`

The document from the command line, without binding a port. The build is
the one [`nitr check`](../cli#check) performs, so your configuration
script runs once here too.

```sh
nitr openapi                        # print it to stdout
nitr openapi --output openapi.json  # write it to a file
nitr openapi --check                # CI drift gate: exit 1 when it differs
nitr openapi --ui site/             # a self-contained Swagger UI site
```

Generation ignores `[openapi] enabled` — that flag gates **serving**, not
generation. You can keep the document out of production and still
publish it from CI.

Log lines go to **stderr** on this command, because stdout is the
document:

```sh
nitr openapi | jq '.paths | keys'
```

### The CI drift gate

Commit the document, and let CI fail when the code and the committed
copy disagree:

```yaml
- run: nitr check
- run: nitr openapi --check # exits 1 with the first differing path
- run: nitr test
```

```console
$ nitr openapi --check
openapi: openapi.json is out of date: first difference at $.paths./api/notes.post.summary;
run `nitr openapi --output openapi.json` and commit the result
```

Both sides are re-serialized canonically before the comparison, so an
editor's trailing newline or a different key order never fails the
build — only a real difference does, and the message names the first
JSON path where it appears.

`--check` compares against `--output` if you gave one, then
`[openapi] output`, then `openapi.json`.

### Keeping it current while you work

```toml
[openapi]
enabled = true
output = "openapi.json"
```

In **dev mode only**, that file is rewritten after each successful
rebuild whose document changed. Edit a route, save, and the committed
document follows — so `nitr openapi --check` in CI passes without anyone
remembering to regenerate. Production never writes.

The path is checked at startup, because a file the dev watcher reloads
on is an infinite loop:

```text
[openapi] output routes/spec.lua has a `.lua` extension: the dev-mode watcher would reload on every write
[openapi] output templates/spec.json is inside [templating] dir: the watcher would reload on every write
[openapi] output dist/openapi.json is inside [static] dir: the file is served statically, which bypasses `[openapi] enabled`   (a warning)
```

## Determinism

Two runs of the same application produce **byte-identical** documents:
paths sort, methods follow the router's declaration order, every map is
ordered, and custom formats sort by name. That is what makes `--check`
a usable gate rather than a source of spurious diffs — Lua's `pairs`
order differs between states, and none of it reaches the output.

## Where to go next

| Page                                | What is in it                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| [Documenting routes](./documenting) | `app:doc`, the per-route `doc` table, responses, security schemes, hiding a route |
| [Swagger UI](./swagger-ui)          | The page served from the binary, its options, and the static site                 |
| [Validation](../validation/)        | Where the request schemas come from                                               |

# Swagger UI

A browsable page for the [OpenAPI document](./), served **from the
binary**. Swagger UI is compiled in, so the page loads nothing from a
CDN or the network.

```toml
[openapi]
enabled = true

[swagger]
enabled = true
path = "/docs"
try_it_out = true
```

```console
$ nitr dev
INFO openapi: 3 operation(s), spec at /openapi.json, Swagger UI at /docs
INFO listening on http://127.0.0.1:3000 with 4 Lua state(s)
```

`nitr init` writes both sections with `enabled = false`; turn them on
for development. The `nitr` binary includes the `swagger`
[Cargo feature](../../library/cargo-features). It adds about 1.7 MiB,
so a custom build that only needs the document can use `openapi` alone.

## The settings

| Key                           | Default             | What it does                                                     |
| ----------------------------- | ------------------- | ---------------------------------------------------------------- |
| `enabled`                     | `false`             | Serve the page at `path`                                         |
| `path`                        | `"/docs"`           | Where the page is served; its assets live under `<path>/assets/` |
| `title`                       | the `app:doc` title | The page's `<title>`                                             |
| `spec_url`                    | `[openapi] path`    | The document the page loads                                      |
| `allow_external_spec`         | `false`             | Allow a `spec_url` on another origin                             |
| `deep_linking`                | `true`              | Operation anchors in the URL                                     |
| `doc_expansion`               | `"list"`            | `"list"`, `"full"` or `"none"`                                   |
| `filter`                      | `false`             | Show the operation filter box                                    |
| `try_it_out`                  | `false`             | Start with "Try it out" enabled                                  |
| `display_request_duration`    | `false`             | Show how long a request took                                     |
| `persist_authorization`       | `false`             | Keep entered credentials in the browser's `localStorage`         |
| `display_operation_id`        | `false`             | Show each operation's id                                         |
| `default_models_expand_depth` | `1`                 | How deep schemas start expanded                                  |

> [!WARNING] `persist_authorization` stores tokens in the browser
>
> Fine on your own machine against a staging API. Do not turn it on for
> a public `/docs` page.

Any other Swagger UI option goes in `[swagger.options]`, using Swagger
UI's own camelCase names:

```toml
[swagger.options]
showExtensions = true
syntaxHighlight = { theme = "monokai" }
```

It may not repeat a setting from the table above (for example
`docExpansion`), and may not set `url`, `dom_id`, `domNode` or `spec`.
Both are startup errors.

## Security of the page

The page is served with a strict `Content-Security-Policy`: no inline
scripts, no framing by other sites, and it can only fetch from this
server. To load a document from another origin, opt in:

```toml
[swagger]
enabled = true
spec_url = "https://specs.example.com/api.json"
allow_external_spec = true          # allows exactly that origin
```

Without the flag, an external `spec_url` is a startup error.

The page and document are cached for 60 seconds (`no-store` in dev
mode). The assets live under a versioned path and are cached for a
year.

## Paths that would collide

These are startup errors:

- `[openapi] path` and `[swagger] path` are the same, or one is below
  the other.
- Either one equals a `[health]` probe path on the main listener.
- A route registered at either path while the section is enabled.

## A static site

`nitr openapi --ui DIR` writes the page, the document and its assets as
plain files. No server is needed:

```sh
nitr openapi --ui site/
```

```text
site/
├── index.html
├── openapi.json
└── assets/5.32.15/
    ├── init.js
    ├── swagger-ui-bundle.js
    └── swagger-ui.css
```

It opens from `file://` and works on GitHub Pages, S3 or any static
host. This publishes your API docs without exposing `/docs` on the
running server:

```yaml
# Publish the docs from CI, keep them off production.
- run: nitr openapi --ui public/api
- uses: actions/upload-pages-artifact@v3
  with:
    path: public/api
```

## Should `/docs` be public?

The page and document show every path, parameter and field of your API.
That is their purpose, but it also helps anyone probing you. Both are
off by default so that publishing them is your decision:

| Setup                             | How                                                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Public API, public docs           | Both enabled                                                                                             |
| Docs only while developing        | Both enabled in `nitr.toml`; `NITR_OPENAPI_ENABLED=false` and `NITR_SWAGGER_ENABLED=false` in production |
| Public API, docs hosted elsewhere | Both off in production; `nitr openapi --ui` from CI to a static host                                     |
| Docs behind your own login        | Both off; serve the [static site](#a-static-site) from a protected route                                 |

See [Environment variables](../configuration/env).

## Third-party notice

The `swagger` feature embeds
[Swagger UI](https://github.com/swagger-api/swagger-ui) (© SmartBear
Software, Apache License 2.0), with its licence text shipped beside it.
See [License](../../license).

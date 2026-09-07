# Swagger UI

The browsable version of the [OpenAPI document](./): a Swagger UI page
served **from the binary**. No CDN, no network, no `<script src="https://…">`
— the bundle is compiled in and the page's
`Content-Security-Policy` forbids anything else.

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
listening on http://127.0.0.1:3000  (dev mode)
openapi: 7 operation(s) at /openapi.json, Swagger UI at /docs
```

`nitr init` writes exactly that, so a scaffolded application has a
browsable API from the first run.

Needs the `swagger` [Cargo feature](../../library/cargo-features), which
implies `openapi` and which the released binary has. It is the one
feature with real weight — about 1.7 MiB of vendored assets — so a build
that only wants the document can take `openapi` alone.

## The settings

| Key                           | Default             | What it does                                                                   |
| ----------------------------- | ------------------- | ------------------------------------------------------------------------------ |
| `enabled`                     | `false`             | Serve the page at `path`                                                       |
| `path`                        | `"/docs"`           | Where the page answers; its assets live under `<path>/assets/<version>/`       |
| `title`                       | the `app:doc` title | The page's `<title>`                                                           |
| `spec_url`                    | `[openapi] path`    | The document the page loads                                                    |
| `allow_external_spec`         | `false`             | Permit a `spec_url` on another origin, widening the page's `connect-src` to it |
| `deep_linking`                | `true`              | Operation anchors in the URL                                                   |
| `doc_expansion`               | `"list"`            | `"list"`, `"full"` or `"none"`                                                 |
| `filter`                      | `false`             | The operation filter box                                                       |
| `try_it_out`                  | `false`             | Whether "Try it out" starts enabled                                            |
| `display_request_duration`    | `false`             | Show how long a try-it-out request took                                        |
| `persist_authorization`       | `false`             | Keep entered credentials in the browser's `localStorage`                       |
| `display_operation_id`        | `false`             | Show each operation's id                                                       |
| `default_models_expand_depth` | `1`                 | How deep the schema panes start expanded                                       |

> [!WARNING] `persist_authorization` stores tokens in `localStorage`
>
> It is off for that reason. Convenient on a laptop against a staging
> API; a bearer token sitting in browser storage on a shared machine is
> a different proposition. Turn it on deliberately, and not on a
> `/docs` page that is publicly reachable.

### Anything else Swagger UI understands

`[swagger.options]` is passed through verbatim, in Swagger UI's own
camelCase:

```toml
[swagger.options]
showExtensions = true
showCommonExtensions = true
syntaxHighlight = { theme = "monokai" }
```

Two rules, both enforced at startup:

- **It may not repeat a typed setting.** `docExpansion` there is an
  error pointing at `[swagger] doc_expansion` — one setting, one
  spelling, so two of them can never disagree.
- **It may not set `url`, `dom_id`, `domNode` or `spec`.** The page owns
  where it loads the document from and what it mounts into.

## What the page is allowed to do

```text
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self' data:; connect-src 'self';
frame-ancestors 'none'; base-uri 'none'
```

Swagger UI needs inline **styles**; nothing needs inline **script**, so
the policy does not allow any. `frame-ancestors 'none'` keeps the page
out of somebody else's iframe, and `connect-src 'self'` means the only
document it can fetch is one this server serves.

That last one is why pointing the page at a document elsewhere is
opt-in:

```toml
[swagger]
enabled = true
spec_url = "https://specs.example.com/api.json"
allow_external_spec = true          # widens connect-src to exactly that origin
```

Without the flag it is a startup error, and the message says what the
flag would do.

## Caching

| Served                      | `Cache-Control`                       |
| --------------------------- | ------------------------------------- |
| The page and the document   | `max-age=60` (`no-store` in dev mode) |
| `<path>/assets/<version>/…` | `public, max-age=31536000, immutable` |

The asset URLs carry the bundle's version, so the bytes at one never
change and a year-long cache is correct. Everything carries an `ETag`
and answers `304`.

## Paths that would collide

Checked at startup, not discovered later:

- **`[openapi] path` and `[swagger] path` must be distinct**, and
  neither below the other — the page's assets live under its own path.
- **Neither may be a `[health]` probe path** when the probes answer on
  the main listener. The probes answer first, so the document could
  never be served there.
- **A route may not claim either path.** With the section enabled,
  registering one is a startup error naming the setting and the line
  that registered the route.

## A static site

`nitr openapi --ui DIR` writes the page, the document and the assets as
plain files with relative links — no server needed.

```sh
nitr openapi --ui site/
```

```text
site/
├── index.html
├── openapi.json
└── assets/5.32.15/
    ├── swagger-ui-bundle.js
    └── swagger-ui.css
```

It opens from `file://`, and it drops onto GitHub Pages, S3 or any
static host as is. This is the way to publish API documentation without
exposing `/docs` on the running server — the flags gate serving, and a
static copy is not the server.

```yaml
# Publish the docs from CI, keep them off production.
- run: nitr openapi --ui public/api
- uses: actions/upload-pages-artifact@v3
  with:
    path: public/api
```

## Should `/docs` be public?

Both sections are off by default because the answer is not always yes.
Some deployments that work:

| Shape                                         | How                                                                    |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| Public API, public docs                       | Both enabled. What is documented is what is offered                    |
| Internal API, docs on the developer's machine | Both enabled in dev; `NITR_OPENAPI_ENABLED=false` in production        |
| Public API, docs published elsewhere          | Both off in production; `nitr openapi --ui` from CI onto a static host |
| Docs behind your own auth                     | Both off; serve the [static site](#a-static-site) from a gated route   |

The two [environment
variables](../configuration/env) — `NITR_OPENAPI_ENABLED` and
`NITR_SWAGGER_ENABLED` — make the second row one line of deployment
configuration rather than a second `nitr.toml`.

> [!NOTE] The page tells a reader what your API is
>
> Paths, parameter names, field names, bounds, which operations need
> credentials. That is the point, and it is also reconnaissance for
> anyone probing you. It is not a _vulnerability_ — an API you can call
> is an API someone can map — but it does remove the work. Publish it
> because you decided to.

## Third-party notice

The `swagger` feature embeds
[Swagger UI](https://github.com/swagger-api/swagger-ui) (© SmartBear
Software, Apache License 2.0) from the `swagger-ui-dist` npm package,
pinned and checksum-verified at vendoring time, with its licence text
shipped beside it. See [License](../../license).

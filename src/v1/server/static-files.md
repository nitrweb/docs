# Static Files

Static files are served **entirely in Rust**, before a Lua state is
checked out. Content types, `ETag`, `Last-Modified`, `304`, range
requests and traversal protection all come for free.

## From the configuration

```toml
[static]
dir = "public"
mount = "/"
spa = false
cache_control = "public, max-age=3600"
```

| Key             | Default            | Meaning                              |
| --------------- | ------------------ | ------------------------------------ |
| `dir`           | _unset (disabled)_ | Directory to serve                   |
| `mount`         | `"/"`              | URL prefix                           |
| `spa`           | `false`            | Serve `index.html` for unknown paths |
| `cache_control` | _unset_            | `Cache-Control` for served files     |

```
public/
├── index.html      → GET /
├── favicon.ico     → GET /favicon.ico
└── assets/
    └── app.css     → GET /assets/app.css
```

## Extra mounts

Register more from `app.lua` — useful when different directories want
different caching:

```lua
local app = nitr.app()

-- Fingerprinted build output: cache forever.
app:static("/assets", "public/assets", {
    cache_control = "public, max-age=31536000, immutable",
})

-- User uploads: revalidate every time.
app:static("/uploads", "data/uploads", {
    cache_control = "no-cache",
})

return app
```

| Option          | Meaning                                               |
| --------------- | ----------------------------------------------------- |
| `spa`           | Serve `index.html` for paths that do not match a file |
| `cache_control` | The `Cache-Control` header for this mount             |

## What you get without asking

| Behaviour              | Detail                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Content types          | From the file extension                                                                                                             |
| `ETag`                 | Per file; changes when the file does                                                                                                |
| `Last-Modified`        | From the file's mtime                                                                                                               |
| `304 Not Modified`     | For `If-None-Match` / `If-Modified-Since`                                                                                           |
| Range requests         | `206 Partial Content`, `416`, and `If-Range` — video seeking works                                                                  |
| Traversal protection   | Percent-decode → component whitelist → canonicalize-prefix check, symlinks included. Both this and `nitr.path.normalize` are fuzzed |
| Precompressed sidecars | `app.js.br` or `app.js.gz` next to `app.js` is served automatically                                                                 |
| `HEAD`                 | Answered with headers only                                                                                                          |

None of this reaches Lua, so none of it costs you a Lua state.

## Single-page applications

```toml
[static]
dir = "dist"
mount = "/"
spa = true
```

With `spa = true`, a path that matches no file gets `index.html`
instead of `404`, letting the client-side router take over. React, Vue,
Svelte and friends all want this.

Serving an API from the same process:

```lua
local app = nitr.app()

app:get("/api/users", list_users)          -- API routes win: they are routes
app:static("/", "dist", { spa = true })    -- everything else → the SPA

return app
```

## Caching strategy

The pattern that works, in two lines:

```lua
-- Fingerprinted files (app.a1b2c3.js) never change under the same name.
app:static("/assets", "dist/assets", {
    cache_control = "public, max-age=31536000, immutable",
})
```

```toml
# The HTML entry point must be revalidated, or users never see a deploy.
[static]
dir = "dist"
mount = "/"
spa = true
cache_control = "no-cache"
```

`no-cache` does not mean "do not cache" — it means "revalidate before
using". The `ETag` then makes that revalidation a cheap `304`.

## Precompressed assets

Ship `.br` and `.gz` next to the original and the server prefers them
automatically:

```
dist/assets/
├── app.js          (300 KB)
├── app.js.br       ( 60 KB)   ← served to clients accepting br
└── app.js.gz       ( 80 KB)   ← served to clients accepting gzip
```

```sh
brotli -k dist/assets/app.js
gzip   -k dist/assets/app.js
```

This works **regardless of the `[compression]` section and regardless of
the `compression` Cargo feature** — serving an already-compressed file
needs no encoder. It is strictly better than on-the-fly compression:
better ratios (you can afford maximum effort at build time) and zero
per-request CPU.

Use `[compression]` for _dynamic_ responses; use sidecars for static
assets.

## Security

**Path traversal is not your problem.** Requests are percent-decoded,
checked against a component whitelist, then canonicalized and verified
to still be inside the mount — symlinks included. `../` cannot escape,
and the code is fuzzed.

**Only what is in the directory is served.** There is no directory
listing and no dotfile special-casing: if a file is in the mounted
directory, it is public. Do not put `.env`, `.git` or backups there.

```
public/
├── index.html      ✅
├── .env            ❌ this is public — move it out
└── backup.sql      ❌ so is this
```

## Serving a file from a handler

For a file you must gate behind authentication, read and return it
yourself — but note that `io` is not in the Lua stdlib by default, so
the file must come from somewhere Nitr can reach: the database, or a
[Rust extension module](../library/extension-modules).

The usual answer is simpler: put private files behind an authenticated
route that generates a signed, short-lived URL, and serve them from a
separate mount.

## Reverse proxies and CDNs

Nitr serves static files well, but a CDN serves them from closer. A
common split:

- CDN or proxy handles `/assets/*` with long-lived caching;
- Nitr handles the application and, as the origin, still answers
  correctly with `ETag` and ranges when the CDN revalidates.

Nothing special is needed on Nitr's side — correct `ETag` and
`Cache-Control` are exactly what a CDN wants.

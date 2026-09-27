# Static Files

Nitr serves static files itself, without running any Lua. Content
types, `ETag`, `Last-Modified`, `304`, range requests and path-traversal
protection work out of the box.

## From the configuration

```toml
[static]
dir = "public"
mount = "/"
cache_control = "public, max-age=3600"
```

```text
public/
├── index.html      → GET /
├── favicon.ico     → GET /favicon.ico
└── assets/
    └── app.css     → GET /assets/app.css
```

The keys (`dir`, `mount`, `spa`, `cache_control`, `dotfiles`) are listed
in [`[static]`](./configuration/file#static).

## Extra mounts

Add more mounts from `app.lua`, for example to cache directories
differently:

```lua
local app = nitr.app()

-- Fingerprinted build output: cache forever.
app:static("/assets", "public/assets", {
    cache_control = "public, max-age=31536000, immutable",
})

-- User uploads: check for changes every time.
app:static("/uploads", "/var/lib/myapp/uploads", {
    cache_control = "no-cache",
})

return app
```

`app:static(mount, dir, opts)` takes the same options as `[static]`:
`spa`, `cache_control` and `dotfiles`.

- **A relative `dir` is resolved against the handler script's
  directory**, not the working directory. `"public/assets"` next to
  `app.lua` is the same folder wherever the process starts, and a
  [`nitr build`](./deployment/single-file) executable serves the same
  files from anywhere.
- **The directory must exist.** A missing one fails the script load with
  an error naming the mount, instead of answering `404` forever.
  `nitr check` and `nitr test` only warn and skip the mount, so they can
  run before your front-end build; `nitr run` refuses it.
- `[static] dir` in `nitr.toml` keeps its own rules: relative to the
  working directory, checked at startup. See
  [`[static]`](./configuration/file#static).

Routes are matched first. A static mount answers a `GET` or `HEAD` for
a path no route serves with that method, including a path routed only
for other methods (a `POST /items` route does not hide `public/items`).

## What you get

| Behaviour               | Detail                                                                         |
| ----------------------- | ------------------------------------------------------------------------------ |
| Content types           | From the file extension                                                        |
| `ETag`, `Last-Modified` | From the file's size and modification time                                     |
| `304 Not Modified`      | For `If-None-Match` / `If-Modified-Since`                                      |
| Range requests          | `206`, `416` and `If-Range`, so video seeking works                            |
| Precompressed files     | `app.js.br` or `app.js.gz` next to `app.js` is sent when the client accepts it |
| `HEAD`                  | Headers only                                                                   |

A static file is served without a Lua state, so it is answered even
while every state is busy.

## Single-page applications

```toml
[static]
dir = "dist"
mount = "/"
spa = true
```

With `spa = true`, a browser navigation to a path that matches no file
and no route gets `index.html` instead of `404`, so the client-side
router can take over. A path a route serves with other methods still
answers `405`. API routes in the same app still win, because routes are
matched first:

```lua
app:get("/api/users", list_users)          -- a route: always wins
app:static("/", "dist", { spa = true })    -- everything else → the SPA
```

The fallback answers only a request whose `Accept` header names
`text/html`, which is what a browser sends when it navigates. An API
client asking for JSON, or sending `Accept: */*`, gets the `404`, so a
mistyped `/api/userz` fails as JSON instead of returning your HTML
page:

```sh
curl -H 'Accept: text/html' http://127.0.0.1:3000/settings     # index.html
curl http://127.0.0.1:3000/settings                            # 404: curl sends */*
curl -H 'Accept: application/json' http://127.0.0.1:3000/api/userz
# 404 {"code":"NOT_FOUND","message":"Not Found"}
```

You do not need an `/api/*` catch-all route to keep API clients out of
the SPA. See [Built-in rejections](./errors#built-in-rejections) for the
JSON body.

## Caching strategy

Cache fingerprinted files (`app.a1b2c3.js`) forever, and make browsers
check the HTML entry point every time so they see new deploys:

```lua
app:static("/assets", "dist/assets", {
    cache_control = "public, max-age=31536000, immutable",
})
```

```toml
[static]
dir = "dist"
mount = "/"
spa = true
cache_control = "no-cache"
```

`no-cache` means "check before using", not "do not cache". The `ETag`
makes that check a cheap `304`.

## Precompressed assets

Compress at build time and put the files next to the original:

```text
dist/assets/
├── app.js          (300 KB)
├── app.js.br       ( 60 KB)   ← sent to clients accepting br
└── app.js.gz       ( 80 KB)   ← sent to clients accepting gzip
```

```sh
brotli -k dist/assets/app.js
gzip   -k dist/assets/app.js
```

This works without the [`[compression]`](./configuration/file#compression)
section, costs no CPU per request, and compresses better than
on-the-fly compression. Use `[compression]` for dynamic responses.

## Security

- **Path traversal is blocked.** Paths are decoded, checked, and
  resolved (symlinks included) to make sure they stay inside the mount.
- **Dotfiles are hidden.** Any path with a `.`-prefixed part (`.env`,
  `.git/`) gets `404`, unless you set `dotfiles = true`. `.well-known/`
  is always served, for ACME challenges and `security.txt`.
- **Everything else in the directory is public.** There is no directory
  listing, but any other file in it can be downloaded. Keep backups,
  secrets and source code elsewhere.
- **Nitr refuses to serve its own code.** A static `dir` that contains
  the handler script's directory or `[templating] dir` is a startup
  error.

```text
public/
├── index.html      served
├── .env            404, but move it out anyway
└── backup.sql      served: anyone can download it
```

See [Security](./security) for the full model.

## Private files

Static mounts are public. To put a file behind a login, serve it from a
handler after checking the user. The default Lua sandbox has no `io`
library, so the bytes must come from somewhere Nitr can reach, such as
[`nitr.db`](./database) or a
[Rust extension module](../library/extension-modules).

## CDNs and reverse proxies

A CDN or proxy in front can cache `/assets/*` close to users while
Nitr serves the app. As the origin, Nitr's `ETag`, `Cache-Control` and
range support are what the CDN needs; nothing else is required.

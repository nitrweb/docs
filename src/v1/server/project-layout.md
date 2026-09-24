# Project Layout

What `nitr init` creates, and what each file is for.

## The full scaffold

```
my-app/
├── nitr.toml              configuration
├── config.lua             runs once at startup → nitr.cfg
├── app.lua                routes and middleware; returns nitr.app()
├── routes/
│   └── notes.lua          a route module
├── lib/
│   └── notes.lua          plain module (validation schemas)
├── migrations/
│   └── 001_init.sql       SQL, applied by `nitr migrate`
├── templates/
│   └── hello.j2           minijinja templates
├── public/
│   └── index.html         static files
├── tests/
│   ├── notes_test.lua     tests, run by `nitr test`
│   └── helpers/
│       └── notes.lua      test data: require("helpers.notes")
├── data/
│   └── .gitkeep           app.db is created here by `nitr migrate`
├── .gitignore             ignores data/*.db*
└── nitr-types.lua         editor completions
```

The first `nitr dev` also writes **`openapi.json`**, the generated
[API document](./openapi/), and keeps it up to date. Commit it;
`nitr openapi --check` in CI tells you when it is stale.

Every path is set in `nitr.toml`, so you can rename or move any of them:

| Path           | Set by                       | Needed?                          |
| -------------- | ---------------------------- | -------------------------------- |
| `app.lua`      | `handler_script`             | **yes**                          |
| `config.lua`   | `config_script`              | no                               |
| `routes/`      | a `require` in `app.lua`     | no                               |
| `lib/`         | a `require` where it is used | no                               |
| `migrations/`  | `[database] migrations_dir`  | only with a database             |
| `templates/`   | `[templating] dir`           | only for `nitr.template`         |
| `public/`      | `[static] dir` and `mount`   | no                               |
| `tests/`       | `[testing] dir`              | only for `nitr test`             |
| `data/app.db`  | `[database] path`            | only for `nitr.db`               |
| `openapi.json` | `[openapi] output`           | no                               |
| `uploads/`     | `[multipart] upload_dir`     | only to save uploads (see below) |

## `nitr.toml`

Says what the server does: the address, the scripts, the enabled
builtins, and any limits. The scaffolded file:

```toml
listen = "127.0.0.1:3000"
handler_script = "app.lua"
config_script = "config.lua"

[database]
path = "data/app.db"

[templating]
dir = "templates"

[std]
features = ["json", "http", "log", "time", "validate", "base64", "path", "url", "db", "template"]

[static]
dir = "public"
mount = "/"

[openapi]
enabled = true
output = "openapi.json"

[swagger]
enabled = true
try_it_out = true
```

It enables the OpenAPI document and the Swagger UI page at `/docs` for
development. In production you may want them off:
`NITR_OPENAPI_ENABLED=false NITR_SWAGGER_ENABLED=false`. Every key is in
[nitr.toml](./configuration/file).

## `config.lua`

Runs **once** at startup, before any request, and on every reload. Its
returned table becomes `nitr.cfg` in every handler:

```lua
return {
    app_name = "my-app",
    started_at = nitr.time.iso8601(nitr.time.now()),
}
```

With a `[database]`, the connection is passed in as `...`:

```lua
local db = ...
db:execute("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY)")
return { app_name = "my-app" }
```

Use it for work you want to do once: reading environment variables,
building lookup tables, one-off setup. Return plain data only (tables,
strings, numbers, booleans); functions and userdata are an error.
Without a config script, `nitr.cfg` is `nil`.

## `app.lua`

Runs **once per Lua state** (and on every reload). It builds the
application and returns it. The scaffolded file, trimmed:

```lua
local app = nitr.app()

app:doc({ title = "My App", version = "0.1.0" })   -- OpenAPI document info

app:use(function(next)                               -- middleware
    return function(req)
        local started = nitr.time.monotonic()
        local resp = next(req)
        nitr.log.info("request", {
            path = req.path,
            ms = math.floor((nitr.time.monotonic() - started) * 1000),
        })
        return resp
    end
end)

require("routes.notes")(app)                         -- route modules

app:get("/hello/:name", function(req)                -- an inline route
    return nitr.html(nitr.template:render("hello.j2", {
        name = req.params.name,
        app = nitr.cfg.app_name,
    }))
end)

app:on_error(function(err, req)                      -- the error response
    nitr.log.error("handler failed", { error = err.message, kind = err.kind })
    return nitr.error(500, { code = "INTERNAL" })
end)

return app                                           -- required
```

- `app:use` must come before the routes it should wrap.
- Code at the top of the file runs once per state, so compile schemas
  and build tables there. Only handler functions run per request.
- Async builtins such as `nitr.crypto.password_hash` cannot run at the
  top level of `app.lua`; call them inside a handler, or in
  `config.lua`.

See [Routing](./routing), [Middleware](./middleware) and
[Errors](./errors).

## `routes/` and `lib/`

Route files are plain modules, wired with an explicit `require` in
`app.lua`; there is no auto-discovery. A route module is a function that
takes the app:

```lua
-- routes/notes.lua
local notes = require("lib.notes")

return function(app)
    app:post("/api/notes", function(req)
        local data = req.valid.body            -- already validated
        nitr.db:execute(
            "INSERT INTO notes (text, created_at) VALUES (?, ?)",
            { data.text, nitr.time.now() }
        )
        return nitr.json(nitr.db:query_row(
            "SELECT id, text, created_at FROM notes ORDER BY id DESC"
        ), 201)
    end, {
        input = { body = notes.NoteInput },    -- checked before the handler runs
        doc = { summary = "Create a note", tags = { "notes" } },
    })
end
```

Code that does not need `req` goes in `lib/`, where both routes and
tests can `require` it:

```lua
-- lib/notes.lua
local M = {}

M.NoteInput = nitr.validate.schema({
    text = "string|trim|min_len:1|max_len:500|required",
}, { title = "NoteInput" })

return M
```

`require("routes.notes")` loads `routes/notes.lua` relative to
`app.lua`. It can only load `.lua` files inside that directory. See
[Validation](./validation/).

## `migrations/`

SQL files named with a version number (`001_init.sql`), applied in order
by `nitr migrate`. The server refuses to start while one is pending.

```sql
-- migrations/001_init.sql
CREATE TABLE notes (
    id         INTEGER PRIMARY KEY,
    text       TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
```

Never edit an applied migration; add a new one. See
[Database → Migrations](./database#migrations).

## `templates/`

Minijinja templates for `nitr.template:render(name, data)`. See
[Templates](./templates).

::: v-pre

```html
{# templates/hello.j2 #}
<!doctype html>
<h1>Hello, {{ name }}!</h1>
<p>Served by {{ app }}.</p>
```

:::

## `public/`

Static files, served without running Lua. The scaffold mounts the
folder at `/`, so `public/index.html` answers `/`. See
[Static files](./static-files).

## `tests/`

Every `*.lua` file directly inside `tests/` is a test file. Subfolders
are not searched, so `tests/helpers/` holds modules that tests
`require`. Tests can also `require` your app's modules.

```lua
-- tests/notes_test.lua
local t = nitr.test
local notes = require("lib.notes")
local fixtures = require("helpers.notes")

t.describe("lib.notes", function()
    t.it("trims the text", function()
        local data = notes.NoteInput:check({ text = "  hi  " })
        t.expect(data).to_equal({ text = "hi" })
    end)
end)

t.describe("notes API", function()
    local api = t.client({ base = "/api" })
    t.before_each(t.db.reset)

    t.it("creates a note", function()
        t.expect(api:post("/notes", { json = fixtures.note })).to_have_status(201)
    end)
end)
```

Tests run against a separate test database, never the one in
`[database] path`. See [Testing](./testing).

## `data/`

Mutable state, ignored by git. `app.db` appears after the first
`nitr migrate`. Keeping state in one folder makes backups, Docker
volumes and systemd `ReadWritePaths` simple.

> [!WARNING] Back up all three database files
>
> SQLite in WAL mode (the default) uses `app.db`, `app.db-wal` and
> `app.db-shm`. Copying only `app.db` from a running server is not a
> consistent backup; use `VACUUM INTO` or stop the server.

## Uploads

`nitr init` does not create an upload folder. To save uploaded files
with `part:save`, choose one and set it:

```toml
[multipart]
upload_dir = "uploads"
```

It must exist and be writable, and must **not** be inside the directory
of `app.lua` or `[templating] dir` (Nitr refuses to start). See
[`[multipart]`](./configuration/file#multipart) and
[Requests → File uploads](./requests#file-uploads).

## `nitr-types.lua`

Type definitions for the whole `nitr.*` API. Editors using the
[Lua Language Server](https://luals.github.io/) pick it up
automatically for completion and inline docs.

After upgrading Nitr, refresh it by running `nitr init` in an empty
folder and copying the file over (`init` never overwrites files). It is
also published at
[`resources/nitr-types.lua`](https://github.com/nitrweb/nitr/blob/master/resources/nitr-types.lua).

## The minimal layout

`nitr init --minimal` writes only:

```
my-app/
├── nitr.toml
├── app.lua
├── public/index.html
├── tests/app_test.lua
└── nitr-types.lua
```

No database, templates or config script. Add sections to `nitr.toml` as
you need them.

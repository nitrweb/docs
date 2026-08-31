# Project Layout

The conventional layout the `nitr` CLI works with, and what each file
is for. `nitr init` writes all of it.

## The full scaffold

```
my-app/
├── nitr.toml              server + application configuration
├── config.lua             runs once at startup → nitr.cfg
├── app.lua                routes and middleware; returns nitr.app()
├── routes/
│   └── notes.lua          a route module
├── migrations/
│   └── 001_init.sql       plain SQL, applied by `nitr migrate`
├── templates/
│   └── hello.j2           minijinja templates
├── public/
│   └── index.html         static files, served by Rust
├── tests/
│   └── notes_test.lua     *.lua files, run by `nitr test`
├── data/
│   └── .gitkeep           app.db lands here after `nitr migrate`
├── .gitignore             ignores data/*.db*
└── nitr-types.lua         generated editor completions
```

`nitr init` refuses to overwrite: if any of those paths already exists
it writes nothing at all, rather than merging into a directory it did
not create.

Nothing here is magic. Every path is a configuration key you can change:

| Path          | Configured by                             | Required?                       |
| ------------- | ----------------------------------------- | ------------------------------- |
| `app.lua`     | `handler_script`                          | **yes**                         |
| `config.lua`  | `config_script`                           | no                              |
| `routes/`     | nothing — it is `require`d from `app.lua` | no                              |
| `migrations/` | `[database] migrations_dir`               | no                              |
| `templates/`  | `[templating] dir`                        | only if you use `nitr.template` |
| `public/`     | `[static] dir` + `mount`                  | no                              |
| `tests/`      | `[testing] dir`                           | only for `nitr test`            |
| `data/app.db` | `[database] path`                         | only if you use `nitr.db`       |
| `uploads/`    | `[multipart] upload_dir`                  | only if you call `part:save`    |

The last row is the one `nitr init` does _not_ write: uploads need a
directory you chose deliberately, and the section on them below explains
why nothing is guessed for you.

## `nitr.toml`

The one file that says what the server does: the address it binds, the
scripts it loads, the builtins it exposes, and every limit and policy.
It is validated strictly — an unknown key, a contradiction, or a missing
path **refuses to start**.

The scaffolded one is deliberately short; everything else has a default:

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
```

See [Configuration → nitr.toml](./configuration/file) for every
section, and [`nitr check --print-config`](./cli#check) for what the
layering actually produced.

## `config.lua` — the startup script

Runs **exactly once**, before any request is served, in its own state.
The scaffolded version just publishes a couple of values:

```lua
return {
    app_name = "my-app",
    started_at = nitr.time.iso8601(nitr.time.now()),
}
```

When a `[database]` is configured, its connection arrives as the
script's vararg, which is what makes one-off schema work possible here:

```lua
local db = ...

db:execute("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY)")

return {
    app_name = "my-app",
    started_at = nitr.time.iso8601(nitr.time.now()),
    feature_flags = { beta_search = true },
}
```

The returned table becomes `nitr.cfg` in every handler.

> [!WARNING] It must return plain data
>
> Tables, strings, numbers, booleans. The result is **serialized and
> snapshotted** into each pooled state, so a function, a coroutine or a
> userdata in there is an error — not a value that silently behaves
> strangely later.

> [!WARNING] No yielding builtins at this level
>
> This chunk runs outside the async executor, so a builtin that yields
> cannot run in it. That covers the argon2 password functions
> (`nitr.crypto.password_hash`, `password_verify`,
> `password_verify_dummy`), which do their work on the blocking pool.
> Mint hashes with [`nitr hash-password`](./passwords) and store the
> result instead of hashing at boot.

Use it for: one-off schema setup, precomputed lookup tables, values
derived from the environment, anything expensive you want to pay for
once rather than once per state.

Omit it entirely and `nitr.cfg` is `nil`.

## `app.lua` — the handler script

Runs **once per Lua state**, and again on every reload. It builds the
application and returns it. This is the scaffolded file, trimmed:

```lua
local app = nitr.app()

app:use(function(next)
    return function(req)
        local started = nitr.time.monotonic()
        local resp = next(req)
        nitr.log.info("request", {
            path = req.path,
            status = type(resp) == "table" and resp.status or 200,
            ms = math.floor((nitr.time.monotonic() - started) * 1000),
        })
        return resp
    end
end)

require("routes.notes")(app)             -- route modules

app:get("/hello/:name", function(req)    -- inline routes
    return nitr.html(nitr.template:render("hello.j2", {
        name = req.params.name,
        app = nitr.cfg.app_name,
    }))
end)

app:on_error(function(err, req)          -- the app-wide error response
    nitr.log.error("handler failed", {
        error = err.message, kind = err.kind, source = err.source, line = err.line,
    })
    return nitr.error(500, { code = "INTERNAL" })
end)

return app                               -- ← forgetting this is a startup error
```

The order matters: `app:use` must precede the routes it should wrap.
`err` is a structured table — `kind` is one of `"lua"`, `"nitr"`,
`"module"`, `"timeout"`, `"memory"` or `"panic"` — so an error handler
can branch on _why_ the handler failed. See [Errors](./errors).

> [!TIP] Where to put expensive work
>
> The body of `app.lua` runs once per state — compiling a
> [validation schema](./validation), building a lookup table or reading
> `nitr.cfg` all belong here, at file scope. Only the innermost handler
> function runs per request.

## `routes/` — route modules

Route files are wired with an explicit `require` in `app.lua`. There is
no auto-discovery, deliberately: the application's shape stays visible in
one file, and a route module is plain Lua rather than a convention you
have to learn.

A module is just a function that takes the app:

```lua
-- routes/notes.lua
local schema = nitr.validate.schema({
    text = { type = "string", min_len = 1, max_len = 500, required = true },
})

return function(app)
    app:get("/api/notes", function(req)
        return nitr.json(nitr.db:query("SELECT id, text, created_at FROM notes ORDER BY id"))
    end)

    app:post("/api/notes", function(req)
        local data, err = schema:check(req:json())
        if not data then
            return nitr.error(422, { code = "VALIDATION_FAILED", fields = err.fields })
        end
        nitr.db:execute(
            "INSERT INTO notes (text, created_at) VALUES (?, ?)",
            { data.text, nitr.time.now() }
        )
        local note = nitr.db:query_row("SELECT id, text, created_at FROM notes ORDER BY id DESC")
        return nitr.json(note, 201)
    end)
end
```

```lua
-- app.lua
require("routes.notes")(app)
```

Note where the schema lives: at file scope, so it is compiled once per
state rather than once per request.

> [!NOTE] `require` is sandboxed
>
> It resolves only inside the handler script's directory, and it cannot
> load native Lua modules. `routes.notes` means `routes/notes.lua`
> relative to `app.lua` — nothing outside can be reached.

## `migrations/` — schema changes

Plain `.sql` files whose names start with a version number, applied in
numeric order by `nitr migrate`, each inside a transaction. Nitr
**refuses to start while a migration is pending**, so the schema and the
code can never quietly disagree.

```sql
-- migrations/001_init.sql
CREATE TABLE notes (
    id         INTEGER PRIMARY KEY,
    text       TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
```

Never edit an applied migration — write a new one. Nitr checksums what
it applied, so a changed file shows up in `nitr migrate --status` as
`MODIFIED SINCE APPLIED` rather than being silently re-run. See
[Database → Migrations](./database#migrations).

## `templates/` — minijinja templates

Loaded by `nitr.template:render(name, data)` from `[templating] dir`.
Without that key the builtin is unavailable: there is no default
location to guess.

::: v-pre

```html
{# templates/hello.j2 #}
<!doctype html>
<h1>Hello, {{ name }}!</h1>
<p>Served by {{ app }}.</p>
```

:::

See [Templates](./templates).

## `public/` — static files

Served entirely in Rust — content types, ETag, `Last-Modified`, `304`,
range requests and traversal protection included — without running any
Lua. The scaffold mounts it at `/`, so `public/index.html` answers the
root. See [Static files](./static-files).

## `tests/` — the test suite

Every `*.lua` file under `[testing] dir` is a test file. Requests
dispatch through the real router and middleware, against a server built
from the same `nitr.toml` the production run uses:

```lua
-- tests/notes_test.lua
local t = nitr.test

t.before_each(function()
    nitr.db:execute("DELETE FROM notes")
end)

t.describe("notes API", function()
    t.it("creates a note", function()
        local resp = t.request("POST", "/api/notes", { json = { text = "hi" } })
        t.expect(resp.status).to_equal(201)
        t.expect(resp:json().text).to_equal("hi")
    end)
end)
```

Each test file gets a fresh Lua state but shares the server — and its
database — the way real requests do, which is why the scaffold clears
the table in `before_each`. See [Testing](./testing).

## `data/` — mutable state

The SQLite database and its WAL sidecars live here, git-ignored. The
scaffold writes only `data/.gitkeep`; `app.db` appears the first time
you run `nitr migrate`. Keeping mutable state in one directory makes the
systemd `ReadWritePaths` and the Docker volume obvious, and makes it
obvious what a backup has to capture.

> [!WARNING] WAL changes what "copy the database" means
>
> With WAL on (the default), the on-disk set is `app.db`, `app.db-wal`
> and `app.db-shm`. Copying only `app.db` from a running server does
> **not** give you a consistent snapshot — use `VACUUM INTO` or stop the
> server.

## Uploads: where `part:save` may write

`[multipart] upload_dir` is the root every `part:save(path)` resolves
inside. It is not scaffolded, because there is no safe directory to
guess — the same call `[templating] dir` makes. **Unset, `part:save` is
unavailable.**

```toml
[multipart]
upload_dir = "uploads"
```

The directory must exist and be writable at startup. Paths handed to
`part:save` are **relative to it**: an absolute path, or one climbing
out with `..`, is **refused rather than re-rooted**, so where a file
lands always follows from the source you can read.

> [!DANGER] Never point it inside the handler script's directory
>
> `require` is pinned to that directory, so an uploaded `.lua` file
> would be a loadable module — remote code execution by upload. Nitr
> **refuses to boot** on that combination. Pointing it inside
> `[static] dir` only warns, because serving uploads back is a real
> choice; it is just one to make on purpose.

Prefer `part.safe_filename` over the raw `part.filename` when building
the path — it is the client's name reduced to a plain file name, with
no separators and no control characters. See
[Requests → Uploads](./requests).

## `nitr-types.lua` — editor completion

Generated LuaCATS type definitions covering the entire `nitr.*` surface,
written by `nitr init` and generated from the same API description as
the [Lua API reference](../api/) — a test fails if an undocumented
builtin ships. Any editor running the [Lua Language
Server](https://luals.github.io/) picks the file up automatically and
gives you completion, signatures and inline documentation.

Regenerate it after upgrading Nitr by running `nitr init` in a scratch
directory and copying the file over, since `init` refuses to overwrite
existing files. The current copy is also published in the repository at
[`resources/nitr-types.lua`](https://github.com/nitrweb/nitr/blob/master/resources/nitr-types.lua).

## `.gitignore`

One line, `data/*.db*`, so the database, the WAL and the shared-memory
file stay out of version control while `data/.gitkeep` keeps the
directory itself.

## The minimal layout

`nitr init --minimal` writes four application files instead, plus the
same generated types:

```
my-app/
├── nitr.toml
├── app.lua
├── public/index.html
├── tests/app_test.lua
└── nitr-types.lua
```

No database, no templates, no config script — and no migration, so
there is nothing to run before `nitr check`. Good for a single-purpose
JSON endpoint; grow into the full layout by adding the sections you need
to `nitr.toml`.

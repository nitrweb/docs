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
│   └── app.db             the SQLite database (git-ignored)
├── nitr-types.lua         generated editor completions
└── .gitignore             ignores data/*.db*
```

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

## `nitr.toml`

The one file that says what the server does: the address it binds, the
scripts it loads, the builtins it exposes, and every limit and policy.
It is validated strictly — an unknown key, a contradiction, or a missing
path **refuses to start**.

See [Configuration → nitr.toml](./configuration/file) for every
section, and [`nitr check --print-config`](./cli#check) for what the
layering actually produced.

## `config.lua` — the startup script

Runs **exactly once**, before any request is served, in its own state:

```lua
-- The database connection, when one is configured, arrives as the vararg.
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

Use it for: one-off schema setup, precomputed lookup tables, values
derived from the environment, anything expensive you want to pay for
once rather than once per state.

Omit it entirely and `nitr.cfg` is `nil`.

## `app.lua` — the handler script

Runs **once per Lua state**, and again on every reload. It builds the
application and returns it:

```lua
local app = nitr.app()

app:use(logging_middleware)              -- global middleware first
require("routes.notes")(app)             -- route modules
app:get("/hello/:name", hello_handler)   -- inline routes
app:static("/assets", "public/assets")   -- extra static mounts
app:on_error(error_handler)              -- the app-wide error response

return app                               -- ← forgetting this is a startup error
```

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
        return nitr.json(nitr.db:query("SELECT id, text FROM notes ORDER BY id"))
    end)

    app:post("/api/notes", function(req)
        local data, err = schema:check(req:json())
        if not data then
            return nitr.error(422, { code = "VALIDATION_FAILED", fields = err.fields })
        end
        nitr.db:execute("INSERT INTO notes (text) VALUES (?)", { data.text })
        return nitr.json({ ok = true }, 201)
    end)
end
```

```lua
-- app.lua
require("routes.notes")(app)
```

> [!NOTE] `require` is sandboxed
>
> It resolves only inside the handler script's directory, and it cannot
> load native Lua modules. `routes.notes` means `routes/notes.lua`
> relative to `app.lua` — nothing outside can be reached.

## `migrations/` — schema changes

Plain `.sql` files, applied in filename order by `nitr migrate`. Nitr
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

Never edit an applied migration — write a new one. See
[Database → Migrations](./database#migrations).

## `templates/` — minijinja templates

Loaded by `nitr.template:render(name, data)` from `[templating] dir`.
Without that key the builtin is unavailable: there is no default
location to guess. See [Templates](./templates).

## `public/` — static files

Served entirely in Rust — content types, ETag, `Last-Modified`, `304`,
range requests and traversal protection included — **before** a Lua
state is checked out. See [Static files](./static-files).

## `tests/` — the test suite

Every `*.lua` file under `[testing] dir` is a test file. Requests
dispatch through the real router and middleware:

```lua
local t = nitr.test

t.it("greets by name", function()
    local resp = t.request("GET", "/hello?name=nitr")
    t.expect(resp.status).to_equal(200)
    t.expect(resp:json().hello).to_equal("nitr")
end)
```

See [Testing](./testing).

## `data/` — mutable state

The SQLite database and its WAL sidecars live here, git-ignored. Keeping
them in one directory makes the systemd `ReadWritePaths` and the Docker
volume obvious, and makes it obvious what a backup has to capture.

> [!WARNING] WAL changes what "copy the database" means
>
> With WAL on (the default), the on-disk set is `app.db`, `app.db-wal`
> and `app.db-shm`. Copying only `app.db` from a running server does
> **not** give you a consistent snapshot — use `VACUUM INTO` or stop the
> server.

## `nitr-types.lua` — editor completion

Generated LuaCATS type definitions covering the entire `nitr.*` surface,
written by `nitr init`. Any editor running the [Lua Language
Server](https://luals.github.io/) picks it up automatically and gives
you completion, signatures and inline documentation.

Regenerate it after upgrading Nitr by running `nitr init` in a scratch
directory and copying the file over, since `init` refuses to overwrite
existing files.

## The minimal layout

`nitr init --minimal` writes the four-file version instead:

```
my-app/
├── nitr.toml
├── app.lua
├── public/index.html
├── tests/app_test.lua
└── nitr-types.lua
```

No database, no templates, no config script. Good for a single-purpose
JSON endpoint; grow into the full layout by adding the sections you need
to `nitr.toml`.

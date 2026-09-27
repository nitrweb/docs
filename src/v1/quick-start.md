# Quick Start

Build and run a small JSON API backed by SQLite. It takes about ten
minutes, and you do not need to know Lua.

> [!TIP] Before you start
>
> Install the `nitr` binary with Cargo:
>
> ```sh
> cargo install nitr-cli --version 0.0.0-beta.6
> ```
>
> See [Download & Install](./download-install) for other options.

## Step 1 — Scaffold the application

```sh
nitr init my-app && cd my-app
```

`nitr init` writes a complete, working application into the directory
(the current one if you leave it out):

```
my-app/
├── nitr.toml              server + application configuration
├── config.lua             runs at startup (and on reload) → nitr.cfg
├── app.lua                routes and middleware (returns nitr.app())
├── routes/
│   └── notes.lua          the notes API routes
├── lib/
│   └── notes.lua          plain module: the note schemas
├── migrations/
│   └── 001_init.sql       plain SQL, applied by `nitr migrate`
├── templates/
│   └── hello.j2           minijinja templates
├── public/
│   └── index.html         static files
├── tests/
│   ├── notes_test.lua     runs with `nitr test`
│   └── helpers/notes.lua  test data the tests `require`
├── data/
│   └── .gitkeep           the SQLite database will live here
├── .gitignore             ignores data/*.db*
└── nitr-types.lua         editor completion for the whole nitr.* API
```

It ends by printing the next steps, which the rest of this page follows:

```
Next steps:
  nitr migrate
  nitr check
  nitr test
  nitr dev   # then open http://127.0.0.1:3000/docs
```

The `/docs` page is off in the scaffold until you turn it on in
Step 6 below.

`nitr init` never overwrites a file: if any of these paths exists, it
stops without writing anything. For a smaller start, `nitr init --minimal`
writes only `nitr.toml`, `app.lua`, `public/index.html`,
`tests/app_test.lua` and `nitr-types.lua`.

## Step 2 — Create the database

Nitr refuses to start while a migration is pending, so apply the one the
scaffold ships:

```sh
nitr migrate
```

```
ok: applied 1 migration(s)
  001_init.sql
```

`nitr migrate --status` shows what has run and what is pending without
changing anything.

## Step 3 — Check it

```sh
nitr check
```

```
ok: configuration and scripts load cleanly (4 worker(s) configured)
```

`check` loads the configuration and every script, then exits without
opening a port. It catches typos, unknown keys, missing files and syntax
errors, so it is a good step for CI and before each deploy. The worker
count matches your CPU cores.

> [!NOTE] The `Secure` cookie warning
>
> `check` and `test` log a warning that session and CSRF cookies will be
> sent without `Secure`. That is expected while you serve plain HTTP
> locally. In production, enable [`[tls]`](./server/tls), or set
> `[cookies] secure = "always"` behind an HTTPS proxy.

## Step 4 — Run the tests

```sh
nitr test
```

```
notes_test.lua
  ok   lib.notes (unit) > trims the text it accepts  (0 ms)
  ok   lib.notes (unit) > rejects an empty note  (0 ms)
  ok   lib.notes (unit) > rejects a missing note  (0 ms)
  ok   lib.notes (unit) > rejects a long note  (0 ms)
  ok   notes API > starts empty  (3 ms)
  ok   notes API > creates a note  (3 ms)
  ok   notes API > lists what the fixtures seeded  (3 ms)
  ok   notes API > rejects an empty note before the handler runs  (2 ms)
  ok   notes API > bounds the page size  (1 ms)

9 passed, 0 failed (1 file(s), 0.04 s)
```

The `lib.notes (unit)` tests call a plain module directly. The
`notes API` tests send real requests through the router, validation and
middleware, against a private test database. `nitr test --filter notes`
runs only matching tests, and `nitr test --watch` re-runs on save. See
[Testing](./server/testing).

## Step 5 — Start the dev server

```sh
nitr dev
```

Development mode reloads your Lua and templates when you save them, and
shows error details in responses instead of a bare `500`.

Try it from another terminal:

```sh
curl http://127.0.0.1:3000/api/notes
# {}      ← no rows yet; an empty Lua table encodes as an empty object

curl -X POST http://127.0.0.1:3000/api/notes \
  -H 'content-type: application/json' \
  -d '{"text":"hello nitr"}'
# {"id":1,"text":"hello nitr","created_at":1790249137}

curl -X POST http://127.0.0.1:3000/api/notes \
  -H 'content-type: application/json' -d '{}'
# 422 {"code":"VALIDATION_FAILED","message":"validation failed",
#      "fields":{"body.text":"is required"},"errors":[…]}

curl http://127.0.0.1:3000/hello/ada
# <!doctype html>
# <h1>Hello, ada!</h1>
# <p>Served by my-app.</p>

curl http://127.0.0.1:3000/
# public/index.html, served without running Lua
```

The `422` comes from the route's `input` declaration in
`routes/notes.lua`. Nitr checks the request before the handler runs, so
the handler has no validation code:

```lua
app:post("/api/notes", function(req)
    local data = req.valid.body          -- already checked and trimmed
    ...
end, { input = { body = NoteInput } })
```

See [Validation](./server/validation/).

## Step 6 — Open the API docs

The scaffold ships the OpenAPI document and Swagger UI turned off,
because a published route map is something to decide on. Turn both on
in `nitr.toml` for development:

```toml
[openapi]
enabled = true

[swagger]
enabled = true
```

Restart `nitr dev`, then open <http://127.0.0.1:3000/docs> for the
Swagger UI, or fetch the document itself:

```sh
curl -s http://127.0.0.1:3000/openapi.json | jq '.paths | keys'
# [ "/api/notes", "/hello/{name}" ]
```

The request schemas come from each route's `input` and the descriptions
from its `doc`, so the document always matches what the server enforces.
`nitr dev` also keeps an `openapi.json` file in your project up to date
(it does this even while serving is off).
Commit it, and run `nitr openapi --check` in CI: it exits with `1` when
the committed file is out of date. See [OpenAPI](./server/openapi/).

## Step 7 — Add a route

Open `app.lua` and add this before the `return app` line:

```lua
app:get("/api/notes/:id", function(req)
    local note = nitr.db:query_row(
        "SELECT id, text, created_at FROM notes WHERE id = ?",
        { req.valid.params.id }              -- an integer, already checked
    )
    if not note then
        return nitr.error(404, { code = "NOT_FOUND" })
    end
    return nitr.json(note)
end, {
    input = { params = { id = "integer|min:1" } },
    doc   = { summary = "Fetch one note", tags = { "notes" } },
})
```

Save the file. The dev server reloads on its own:

```sh
curl http://127.0.0.1:3000/api/notes/1
curl -i http://127.0.0.1:3000/api/notes/999   # 404 {"code":"NOT_FOUND"}
curl -i http://127.0.0.1:3000/api/notes/abc   # 422 params.id: must be an integer
```

Reload `/docs` and the new operation is there.

## Step 8 — Ship it

```sh
nitr build --output my-app
```

This writes one executable that contains the `nitr` binary,
`nitr.toml`, your Lua, templates, static files and migrations. Copy it
to a server and run it. The SQLite database stays outside the file. See
[Single-file deploys](./server/deployment/single-file).

## What just happened

1. **`config.lua` runs at startup**, and again on every reload. What it
   returns is available to every handler as `nitr.cfg`.
2. **`app.lua` runs once per Lua state**, not once per request. It
   builds the routes and middleware; requests only run your handlers.
3. **Requests run in parallel** across a pool of independent Lua states
   that never share Lua values. [How Nitr works](./how-it-works)
   explains what that means for your code.

## Where to go next

- [How Nitr works](./how-it-works) — the execution model in one page
- [Project layout](./server/project-layout) — what every scaffolded file does
- [Routing & Middleware](./server/routing) — paths, parameters, chains
- [Configuration](./server/configuration/) — `nitr.toml`, env vars, flags
- [Lua API reference](./api/) — every `nitr.*` function

# Quick Start

Build and run a small JSON API backed by SQLite. Ten minutes, start to
finish, no prior Lua required.

> [!TIP] Before you start
>
> You need the `nitr` binary. If you do not have it yet, install it from
> crates.io:
>
> ```sh
> cargo install nitr-cli
> ```
>
> The crate is `nitr-cli`; the binary it installs is `nitr`. See
> [Download & Install](./download-install) for pinning a version,
> trimming the build with Cargo features, or building from a git tag.

## Step 1 — Scaffold the application

```sh
nitr init my-app && cd my-app
```

`nitr init` takes an optional directory (default: the current one) and
creates it if it is missing. It writes a complete, working application:

```
my-app/
├── nitr.toml              server + application configuration
├── config.lua             runs once at startup → nitr.cfg
├── app.lua                routes and middleware (returns nitr.app())
├── routes/
│   └── notes.lua          one route module
├── migrations/
│   └── 001_init.sql       plain SQL, applied by `nitr migrate`
├── templates/
│   └── hello.j2           minijinja templates
├── public/
│   └── index.html         static files, served by Rust
├── tests/
│   └── notes_test.lua     runs with `nitr test`
├── data/
│   └── .gitkeep           the SQLite database will live here
├── .gitignore             ignores data/*.db*
└── nitr-types.lua         editor completion for the whole nitr.* API
```

A twelfth file, `openapi.json`, appears on the first `nitr dev`: the
generated [API document](./server/openapi/), kept current while you
work.

It prints a `created …` line per file and then the path through the rest
of this page:

```
Next steps:
  nitr migrate
  nitr check
  nitr test
  nitr dev   # then open http://127.0.0.1:3000/docs
```

> [!NOTE] `init` never overwrites
>
> If any of those paths already exists, `nitr init` refuses the whole
> scaffold rather than merging into a directory it did not write. Run it
> in an empty directory, or in a scratch one and copy across what you
> want.

> [!TIP] Want the minimal version?
>
> `nitr init --minimal` writes four application files — `nitr.toml`,
> `app.lua`, `public/index.html` and `tests/app_test.lua` — plus
> `nitr-types.lua`. No database, no templates, no config script. The
> full scaffold exists because it is most people's first and most-copied
> example, so it demonstrates the patterns worth copying: middleware,
> validation, `on_error`, a migration, a test.

## Step 2 — Create the database

The scaffold ships a migration, and Nitr **refuses to start while a
migration is pending** — so this step is not optional, it is the server
refusing to let the schema and the code disagree.

```sh
nitr migrate
```

```
ok: applied 1 migration(s)
  001_init.sql
```

`nitr migrate --status` reports what has run and what is pending without
applying anything — including a migration whose file changed after it
was applied, which it flags as `MODIFIED SINCE APPLIED`.

## Step 3 — Check it

```sh
nitr check
```

```
ok: configuration and scripts load cleanly (8 worker(s) configured)
```

`check` loads the configuration and every script, then exits. It catches
typos in `nitr.toml`, missing files, syntax errors and unknown
configuration keys **without binding a port** — which makes it the right
thing to run in CI and right before a deploy. Add `--print-config` to
see the effective configuration after the file, the environment and the
flags have layered.

## Step 4 — Run the tests

```sh
nitr test
```

```
notes_test.lua
  ok   notes API > starts empty
  ok   notes API > creates a note
  ok   notes API > rejects an empty note before the handler runs
  ok   notes API > bounds the page size
  ok   notes API > publishes what it enforces

5 passed, 0 failed (1 file(s))
```

These are real requests: `t.request(...)` dispatches through the actual
router, middleware included. Nothing is mocked, and the tests run
against a real `Server` built from the same `nitr.toml` the production
run uses. `nitr test --filter notes` narrows by test or file name. See
[Testing](./server/testing).

## Step 5 — Start the dev server

```sh
nitr dev
```

Development mode gives you two things: **hot reload** (a file watcher
rebuilds the Lua pool when you save a `.lua` file or anything under the
templates directory) and **error details in the response** instead of a
bare `500`. Static files need no watching — they are read from disk per
request.

Try it:

```sh
curl http://127.0.0.1:3000/api/notes
# {}      ← no rows yet; an empty Lua table encodes as an empty object

curl -X POST http://127.0.0.1:3000/api/notes \
  -H 'content-type: application/json' \
  -d '{"text":"hello nitr"}'
# {"id":1,"text":"hello nitr","created_at":1766400000}

curl -X POST http://127.0.0.1:3000/api/notes \
  -H 'content-type: application/json' -d '{}'
# 422 {"code":"VALIDATION_FAILED","message":"validation failed",
#      "fields":{"body.text":"is required"}, "errors":[…]}

curl http://127.0.0.1:3000/hello/ada
# <!doctype html>
# <h1>Hello, ada!</h1>
# <p>Served by my-app.</p>

curl http://127.0.0.1:3000/
# the static public/index.html, served by Rust without running Lua
```

The `422` is the route's `input` declaration in `routes/notes.lua`,
enforced **in Rust before the handler ran** — so the handler contains no
validation code at all:

```lua
app:post("/api/notes", function(req)
    local data = req.valid.body          -- already checked and trimmed
    ...
end, { input = { body = NoteInput } })
```

See [Validation](./server/validation/).

## Step 6 — Open the API docs

The same declaration that rejected that request also documents it.
While `nitr dev` is running:

```sh
open http://127.0.0.1:3000/docs        # Swagger UI, served from the binary
curl -s http://127.0.0.1:3000/openapi.json | jq '.paths | keys'
# [ "/api/notes", "/hello/{name}" ]
```

Nothing generated that by hand: the request schemas come from each
route's `input`, the prose from its `doc`, and the two cannot drift
apart because the same table does both jobs. The scaffold also sets
`[openapi] output`, so `openapi.json` in your project directory is
rewritten whenever a route changes — commit it, and let
`nitr openapi --check` keep CI honest.

```sh
nitr openapi --check     # exits 1 when the committed document is stale
```

See [OpenAPI](./server/openapi/).

## Step 7 — Add a route

Open `app.lua` and add a route before the `return app` line:

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

Save the file. The dev server reloads on its own — no restart:

```sh
curl http://127.0.0.1:3000/api/notes/1
curl -i http://127.0.0.1:3000/api/notes/999   # 404 {"code":"NOT_FOUND"}
curl -i http://127.0.0.1:3000/api/notes/abc   # 422 params.id: must be an integer
```

Reload `/docs` and the new operation is there, with its parameter, its
type and its bound — because you declared them once.

## Step 8 — Ship it

```sh
nitr build --output my-app
```

One executable containing the binary, `nitr.toml`, every Lua source,
your templates, static files and migrations. Copy it to a server and run
it — the database stays external, on purpose, and so does a TLS private
key. See [Single-file deploys](./server/deployment/single-file).

## What just happened

Three things are worth understanding before you go further:

1. **`app.lua` runs once per Lua state, not once per request.** It
   _builds_ the application. Routes and middleware are compiled at load
   time; only a matching request runs any of your Lua.
2. **`config.lua` runs exactly once**, at startup, before any request.
   Whatever it returns is snapshotted into every state as `nitr.cfg`.
3. **Requests run in parallel across a pool of independent Lua states.**
   Two requests never share a Lua value. [How Nitr
   works](./how-it-works) explains what follows from that.

## Where to go next

- [How Nitr works](./how-it-works) — the execution model in one page
- [Project layout](./server/project-layout) — what every scaffolded file does
- [Routing & Middleware](./server/routing) — paths, parameters, chains
- [Configuration](./server/configuration/) — `nitr.toml`, env vars, flags
- [TLS termination](./server/tls) — serve HTTPS without a proxy
- [Lua API reference](./api/) — every `nitr.*` function

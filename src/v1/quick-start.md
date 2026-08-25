# Quick Start

Build and run a small JSON API backed by SQLite. Ten minutes, start to
finish, no prior Lua required.

> [!TIP] Before you start
>
> You need the `nitr` binary. If you do not have it yet, see
> [Download & Install](./download-install) — for now that means
> `cargo install --git https://github.com/joseluisq/nitr nitr-cli`.

## Step 1 — Scaffold the application

```sh
mkdir my-app && cd my-app
nitr init
```

`nitr init` writes a complete, working application:

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
├── data/                  the SQLite database lives here
└── nitr-types.lua         editor completion for the whole nitr.* API
```

> [!TIP] Want the four-file version?
>
> `nitr init --minimal` writes only `nitr.toml`, `app.lua`,
> `public/index.html` and one test. The full scaffold exists because it
> is most people's first and most-copied example, so it demonstrates the
> patterns worth copying — middleware, validation, `on_error`, a
> migration, a test.

## Step 2 — Create the database

The scaffold ships a migration, and Nitr **refuses to start while a
migration is pending** — so this step is not optional, it is the server
telling you the schema and the code would disagree.

```sh
nitr migrate
```

```
applied 001_init.sql
```

Check what is pending at any time with `nitr migrate --status`.

## Step 3 — Check it

```sh
nitr check
```

`check` loads the configuration and every script, then exits. It catches
typos in `nitr.toml`, missing files, syntax errors and unknown
configuration keys **without binding a port** — which makes it the right
thing to run in CI and right before a deploy.

## Step 4 — Run the tests

```sh
nitr test
```

```
notes API › starts empty            ok
notes API › creates a note          ok
notes API › rejects an empty note   ok

3 passed, 0 failed
```

These are real requests: `t.request(...)` dispatches through the actual
router, middleware included. Nothing is mocked. See
[Testing](./server/testing).

## Step 5 — Start the dev server

```sh
nitr dev
```

Development mode gives you two things: **hot reload** (a file watcher
rebuilds the Lua pool when you save `app.lua`, a route file, or a
template) and **error details in the response** instead of a bare
`500`.

Try it:

```sh
curl http://127.0.0.1:3000/api/notes
# []

curl -X POST http://127.0.0.1:3000/api/notes \
  -H 'content-type: application/json' \
  -d '{"text":"hello nitr"}'
# {"id":1,"text":"hello nitr","created_at":1766400000}

curl http://127.0.0.1:3000/hello/ada
# <h1>Hello, ada!</h1>

curl http://127.0.0.1:3000/
# the static public/index.html, served by Rust before Lua ever runs
```

## Step 6 — Add a route

Open `app.lua` and add a route before the `return app` line:

```lua
app:get("/api/notes/:id", function(req)
    local note = nitr.db:query_row(
        "SELECT id, text, created_at FROM notes WHERE id = ?",
        { req.params.id }
    )
    if not note then
        return nitr.error(404, { code = "NOT_FOUND" })
    end
    return nitr.json(note)
end)
```

Save the file. The dev server reloads on its own — no restart:

```sh
curl http://127.0.0.1:3000/api/notes/1
curl -i http://127.0.0.1:3000/api/notes/999   # 404 {"code":"NOT_FOUND"}
```

## Step 7 — Ship it

```sh
nitr build --output my-app
```

One executable containing the binary, `nitr.toml`, every Lua source,
your templates, static files and migrations. Copy it to a server and run
it — the database stays external, on purpose. See
[Single-file deploys](./server/deployment/single-file).

## What just happened

Three things are worth understanding before you go further:

1. **`app.lua` runs once per Lua state, not once per request.** It
   _builds_ the application. Routes and middleware are compiled at load
   time; only a matching request enters Lua at all.
2. **`config.lua` runs exactly once**, at startup, before any request.
   Whatever it returns is snapshotted into every state as `nitr.cfg`.
3. **Requests run in parallel across a pool of independent Lua states.**
   Two requests never share a Lua value. [How Nitr
   works](./how-it-works) explains what follows from that.

## Where to go next

- [How Nitr works](./how-it-works) — the execution model in one page
- [Routing & Middleware](./server/routing) — paths, parameters, chains
- [Configuration](./server/configuration/) — `nitr.toml`, env vars, flags
- [Lua API reference](./api/) — every `nitr.*` function

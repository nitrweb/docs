# Testing

`nitr test` runs your Lua tests against an **in-process server**: the
real router, middleware, validation and handlers, on a private test
database. Nothing about your application is mocked. The framework
covers three kinds of test:

| Kind                                 | What it exercises                                    | Main tools                                  |
| ------------------------------------ | ---------------------------------------------------- | ------------------------------------------- |
| **Unit** — a plain module            | a function that does not take `req`                  | `require` + `t.expect`                      |
| **Integration** — through the router | protection, routing, validation, middleware, handler | `t.request`, `t.get`/`t.post`/…, `t.client` |
| **Handler in isolation**             | one handler or the middleware chain                  | `t.fake_request`, `t.app()`                 |

Rule of thumb: _if a function does not take `req`, unit test it; if it
does, go through `t.request`._

```sh
nitr test                     # every test
nitr test --filter notes      # by test or file name
nitr test --watch             # re-run on save
```

The command exits non-zero if any test fails, so it drops straight into
CI.

## Where tests live

```toml
[testing]
dir = "tests"      # the default
```

Every `*.lua` file **directly** in that directory is a test file. The
search is not recursive, so subdirectories hold helpers:

```
tests/
├── notes_test.lua        a test file
└── helpers/
    └── notes.lua         a module: require("helpers.notes")
```

A test file can `require` from two roots: the application directory
(`require("lib.notes")`) and the tests directory
(`require("helpers.notes")`). The second root exists only in test states,
never in a state that serves requests. `nitr.test` is likewise available
**only** in test files.

Files and tests run one after another, and each file gets a fresh Lua
state.

## Writing a test

```lua
-- tests/notes_test.lua
local t = nitr.test
local notes = require("lib.notes")        -- the app's own module
local fixtures = require("helpers.notes") -- tests/helpers/notes.lua

-- Unit: no server involved.
t.describe("lib.notes (unit)", function()
    t.it("trims the text it accepts", function()
        local data, err = notes.NoteInput:check({ text = "  hi  " })
        t.expect(err).to_be_nil()
        t.expect(data).to_equal({ text = "hi" })
    end)
end)

-- Integration: through the real router, validation and handler.
t.describe("notes API", function()
    local api = t.client({ base = "/api" })
    t.before_each(t.db.reset)             -- the database as migrated

    t.it("creates a note", function()
        local resp = api:post("/notes", { json = fixtures.note })
        t.expect(resp).to_have_status(201)
        t.expect(resp).to_have_json({ text = "hi" })
    end)
end)
```

```
notes_test.lua
  ok   lib.notes (unit) > trims the text it accepts  (0 ms)
  ok   notes API > creates a note  (3 ms)

2 passed, 0 failed (1 file(s), 0.05 s)
```

A file first **registers** its tests. The runner then runs each one on
its own: it gets its own `[lua] exec_timeout_ms` budget, a duration,
captured logs and fresh [doubles](#test-doubles). A `while true do end`
therefore fails one test, not the whole run.

## Structure

### Groups and hooks

`describe` groups tests. Group names prefix the test names, and groups
nest:

```lua
t.describe("notes API", function()
    t.before_all(function() --[[ once, before the group's first test ]] end)
    t.before_each(function() --[[ before every test in this group ]] end)
    t.after_each(function() --[[ after every test, even a failed one ]] end)
    t.after_all(function() --[[ once, after the group's last test ]] end)

    t.describe("validation", function()
        t.it("rejects an empty note", function() --[[ ... ]] end)
    end)
end)
```

| Hook          | Runs                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `before_each` | Before every test registered **after it** in this group and its nested groups, outer groups first.                                   |
| `after_each`  | After every such test, inner groups first, **even when the test failed**. If the hook itself fails, it fails a test that had passed. |
| `before_all`  | Once, before the group's first test that runs, inside that test's budget.                                                            |
| `after_all`   | Once, after the group's last test that runs.                                                                                         |

A group with no test left to run (all of them filtered or skipped)
runs neither `before_all` nor `after_all`.

If an error is thrown inside a `describe` body, the tests it had
registered so far fail, a `<name> (describe body)` failure is reported,
and the rest of the file still runs.

### Skip, todo, only, fail

```lua
t.skip("exports to CSV", "waiting on #12")   -- reported as skipped, with the reason
t.todo("handles unicode names")              -- a placeholder; --list shows it
t.only("the one I am debugging", function()  -- the file's other tests are skipped
    -- ...
    if something_odd then t.fail("got here with " .. tostring(x)) end
end)
```

> [!WARNING] `t.only` fails the run
>
> While any `t.only` is left in a file, `nitr test` exits `1` even if
> every test passes, so a focused file cannot slip through CI.

### Table-driven tests

`t.each(cases)(name, fn)` registers one test per case.

```lua
-- Positional cases: formatted into the name, unpacked into fn.
t.each({
    { "", "TEXT_REQUIRED" },
    { ("x"):rep(501), "TEXT_TOO_LONG" },
})("rejects %q with %s", function(text, code)
    local ok, err = notes.validate({ text = text })
    t.expect(ok).to_be_false()
    t.expect(err.code).to_equal(code)
end)

-- Named cases: passed whole; the name formats the case's `name` field.
t.each({
    { name = "an empty note", input = { text = "   " }, rule = "min_len" },
    { name = "a missing note", input = {}, rule = "required" },
})("rejects %s", function(case)
    local data, err = notes.NoteInput:check(case.input)
    t.expect(err.errors[1].rule).to_equal(case.rule)
end)
```

## Matchers

```lua
t.expect(value).to_equal(expected)            -- deep equality for tables
t.expect(resp:json()).to_match_object({ id = 1 })  -- a subset, recursively
t.expect(fn).to_throw("not found")            -- plain substring of the message
```

| Group       | Matchers                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------------- |
| Equality    | `to_equal`, `to_not_equal`, `to_match_object(subset)` (extra keys ignored)                         |
| Nil / truth | `to_be_nil`, `to_not_be_nil`, `to_be_truthy`, `to_be_false`                                        |
| Type, size  | `to_be_a(type)` (`"integer"`/`"float"` included), `to_have_length(n)`, `to_have_key(key)`          |
| Comparison  | `to_be_greater_than`, `to_be_greater_than_or_equal`, `to_be_less_than`, `to_be_less_than_or_equal` |
| Strings     | `to_match(pattern)`, `to_not_match(pattern)` (Lua patterns)                                        |
| Containers  | `to_contain(item)`, `to_not_contain(item)`                                                         |
| Errors      | `to_throw(text?)`, `to_not_throw()`                                                                |
| Logs        | `to_contain_log(subset)`, see [Logs](#logs)                                                        |
| Responses   | `to_have_status(n)`, `to_have_header(name, value_or_pattern?)`, `to_have_json(subset)`             |

The response matchers work on a `t.request` response or on a table a
handler returned. On failure, `to_have_status` prints the body and the
handler's error, which is usually all you need to see
([example](#when-a-request-fails)).

Matchers are called with a dot: `t.expect(x).to_equal(y)`.

## Making requests

`t.request(method, path, opts)` dispatches through the full request
path: protection layer, router, middleware, validation, handler. There
is a shortcut for each method: `t.get`, `t.post`, `t.put`, `t.patch`,
`t.delete`, `t.head` and `t.options`.

```lua
t.get("/api/notes", { query = { limit = 10, tag = { "a", "b" } } })
t.post("/api/notes", { json = { text = "hello" } })
t.get("/me", { auth = { bearer = token } })
t.get("/admin", { auth = { basic = { "ada", "secret" } } })
t.get("/dashboard", { cookies = { session = value } })
t.get("/api/notes", { remote_addr = "10.0.0.7" })   -- what [rate_limit] keys by
t.get("/events", { timeout = 2 })                   -- fail instead of hanging
```

| Option        | Meaning                                                                    |
| ------------- | -------------------------------------------------------------------------- |
| `headers`     | Request headers.                                                           |
| `query`       | Appended to the path. A list value repeats the key.                        |
| `cookies`     | A `{ name = value }` table sent as one `Cookie:` header.                   |
| `auth`        | `{ bearer = token }` or `{ basic = { user, password } }`.                  |
| `json`        | Table body, JSON-encoded.                                                  |
| `form`        | Table body, urlencoded.                                                    |
| `multipart`   | Table body, multipart-encoded.                                             |
| `body`        | Raw string body.                                                           |
| `remote_addr` | The peer address the server sees. Default: `127.0.0.1`.                    |
| `timeout`     | Seconds before the whole exchange fails. Default: `[lua] exec_timeout_ms`. |

Give **one** body option at most: two is an error. `json`, `form` and
`multipart` set `Content-Type` unless you set it yourself.

### Request bodies

`form` and `multipart` exist so that a validated form post or an upload
can be tested without a browser. With `json`, these are the three body
shapes a route's
[`input`](./validation/route-input#bodies-and-content-types) accepts.

```lua
-- An HTML form. A sequence value repeats the key, as a browser does.
t.post("/profile", {
    form = { name = "Ada", age = 36, news = true, tags = { "a", "b" } },
})

-- An upload. A string value is a text part; a table is a file part.
t.post("/profile", {
    multipart = {
        name   = "Ada",
        avatar = { filename = "a.png", content_type = "image/png", data = PNG_BYTES },
    },
})
```

Numbers and booleans are encoded as a browser would send them, so
`age = 36` arrives as `"36"` and the schema coerces it back to a number.
That round trip is the thing you want to test. An empty file input
(`{ filename = "", data = "" }`) reproduces a file field left empty.

### The response

```lua
local resp = t.get("/api/notes")
resp.status                       -- 200
resp.headers["content-type"]      -- last value, lowercase name
resp:header("set-cookie")         -- first value
resp.raw_headers                  -- { { name, value }, ... } in order, repeats included
resp.cookies.session.http_only    -- every Set-Cookie, parsed
resp.body                         -- the raw string (streams are collected)
resp:json()                       -- decoded; raises if it is not JSON
resp:sse()                        -- a text/event-stream as { event?, data, id?, retry? } events
resp.error                        -- the handler's error, when it raised
```

## A client with cookies

`t.client(opts)` sets defaults once. With `cookies = true` it keeps a
cookie jar across calls, the way a browser does:

```lua
local web = t.client({ base = "/app", cookies = true, headers = { ["accept"] = "text/html" } })

t.it("logs in and reaches the dashboard", function()
    local login = web:post("/login", { form = { username = "ada", password = "secret" } })
    t.expect(login).to_have_status(303)

    -- The session cookie from the login is sent automatically.
    t.expect(web:get("/dashboard")).to_have_status(200)
    t.expect(web.jar:get("session")).to_not_be_nil()
end)
```

| `t.client` option | Meaning                                 |
| ----------------- | --------------------------------------- |
| `base`            | A path prefix for every call.           |
| `headers`         | Headers merged under every call's own.  |
| `cookies`         | `true` for a cookie jar (`client.jar`). |
| `remote_addr`     | The peer address for every call.        |

The jar follows `Path`, `Max-Age=0` and past `Expires` (deletion), and
expiry uses the [test clock](#clock). It stores `Secure` and `Domain`
but does not enforce them, because there is no transport and only one
host. `jar:get(name)`, `jar:set(name, value, { path? })` and
`jar:clear()` let you inspect and change it.

To skip the login step, forge a session:

```lua
api.jar:set("session", t.session_cookie({ user = "ann" }, { secret = nitr.cfg.session_secret }))
```

`t.session_cookie(data, { secret, name?, max_age? })` returns exactly
the value `session:save` would write. For other signed cookies, use
[`nitr.cookie.sign`](../api/#nitr-cookie).

## When a request fails

When a handler raises, `resp.error` holds the classified error, even
without `--dev`. It is the same table `on_error` receives (`kind`,
`message`, `source`, `line`, `traceback`, …), plus `handled`, which is
`true` when `on_error` produced the response. A real client never
receives it.

```lua
t.it("classifies the failure", function()
    local resp = t.get("/boom")
    t.expect(resp.error.kind).to_equal("lua")
    t.expect(resp.error.handled).to_equal(true)
end)
```

A failed `to_have_status` shows everything together: the assertion,
the body, the handler's error with its traceback, and the logs the test
captured:

```
  FAIL extras > explains a 500  (2 ms)
       tests/extra_test.lua:6: expected status 200, got 500
       body: {"code":"INTERNAL"}
       lua: attempt to index a nil value (local 'x') (app.lua:46) [handled by on_error]
           app.lua:46: in upvalue 'next'
           app.lua:15: in function <app.lua:13>
       logs:
         ERROR lua: handler failed {"error":"attempt to index a nil value (local 'x')", ...}
```

## Test doubles

A test runs in a separate Lua state from the handlers it calls, so
patching a function in the test has no effect on them. Doubles are
therefore configured as data and applied by the runtime. They reset
before every test, so set them in the test itself or in `before_each`.

### Fetch

`t.fetch.mock` gives canned answers to `nitr.fetch` calls made by the
handlers under test:

```lua
t.it("publishes to the webhook once", function()
    t.fetch.mock(
        { method = "POST", url = "https://hooks.example/notes", status = 202 },
        { url = "https://api.example/users/*", json = { name = "Ada" }, times = 1 }
    )
    t.fetch.strict()          -- an unmatched request raises instead of going out

    t.post("/api/notes", { json = { text = "ping" } })

    local calls = t.fetch.calls()
    t.expect(#calls).to_equal(1)
    t.expect(calls[1].json.text).to_equal("ping")
    t.expect(calls[1].mocked).to_be_truthy()
end)
```

| Rule field          | Meaning                                                   |
| ------------------- | --------------------------------------------------------- |
| `url`               | Exact URL, or a prefix ending in `*`. Required.           |
| `method`            | Matches any method when omitted.                          |
| `status`, `headers` | The canned response.                                      |
| `json` or `body`    | The canned body. `json` also sets `content-type`.         |
| `times`             | How many calls the rule answers before it stops matching. |

The first matching rule answers. Matching happens before the `[fetch]`
policy is checked, so a mocked call never leaves the process, and a
test can mock an internal host without widening `[fetch]`. A request no
rule matches goes out as normal, still subject to the policy, unless
`strict()` is on. `t.fetch.calls()` records every outbound call,
answered by a mock or not.

### Clock

`t.clock` moves the standard library's clock. That covers `nitr.time`,
session and JWT expiry, the `after`/`before` validation rules, cache
TTLs and the rate limiter's window:

```lua
-- For an app whose sessions last an hour (max_age = 3600)
t.it("expires the session after an hour", function()
    t.clock.set(1735689600)                 -- 2025-01-01T00:00:00Z
    local api = t.client({ cookies = true })
    api:post("/login", { form = { username = "ada", password = "secret" } })

    t.clock.advance(3601)
    t.expect(api:get("/dashboard")).to_have_status(401)
end)
```

`set(ts)` freezes the wall clock, `advance(secs)` moves it forward,
`now()` reads it and `reset()` returns to real time. The execution
budget and timeouts always use real time.

### Environment

```lua
t.env.set("FEATURE_EXPORT", "on")   -- nitr.env.get answers "on"
t.env.unset("API_TOKEN")            -- reads as unset
```

Overrides apply **after** the `[env] allow` policy, so a variable the
policy hides stays hidden.

### Logs

`t.logs()` returns the log entries captured during the current test,
from the handlers as well as the test itself. `nitr.log.debug` entries
are included whatever the console log level is.

```lua
t.it("logs the request", function()
    t.get("/api/notes")
    t.expect(t.logs()).to_contain_log({ message = "request", fields = { path = "/api/notes" } })
end)
```

Each entry is `{ level, target, message, fields?, request_id? }`.
`t.logs.clear()` drops what has been captured so far. When a test
fails, its logs are printed under the failure. `--nocapture` streams
log lines as they happen instead.

## Unit testing handlers

To test a handler without going through the protection layer and route
validation, build a request by hand:

```lua
local app = t.app()   -- the application, compiled into this test state

t.it("greets by name", function()
    local handler = app:handler("GET", "/hello/:name")
    local req = t.fake_request({ params = { name = "ada" } })
    t.expect(handler(req)).to_have_status(200)
end)

t.it("runs the middleware chain", function()
    local resp = app:dispatch("GET", "/hello/bob", t.fake_request())
    t.expect(resp.body).to_match("bob")
end)

t.it("registers the notes routes", function()
    t.expect(app:routes()[1]).to_match_object({ method = "GET", path = "/api/notes" })
end)
```

- **`t.fake_request(spec)`** returns a real request object:
  `{ method?, path?, params?, valid?, ... }` plus every `t.request`
  option. `nitr.session`, `nitr.csrf.token` and `nitr.auth.*` accept
  it. It skips the protection layer, body limits and route validation,
  so `req.valid` is whatever the spec sets. Multipart parts cannot
  `:save()`.
- **`t.app()`** loads the handler script into the test state once per
  file. `app:handler(method, path)` returns a route's own function
  without its middleware, matched by pattern (`"/notes/:id"`) or by a
  real path. `app:dispatch(method, path, req)` runs the router and the
  middleware chain. `app:routes()` lists `{ method, path, file, line }`
  in registration order.

`app:dispatch` does not run route `input` validation, `on_invalid`,
`on_error` or the protection layer. To cover those, use `t.request`.
To check a validation schema on its own, call
[`schema:check(value)`](./validation/).

## Tests and the database

**`nitr test` never uses `[database] path`.** It creates its own SQLite
file for each run and applies `[database] migrations_dir`, the config
script and `[testing] seed` to it before the first test. It then takes
a snapshot of that state, which the fixtures below restore.

```lua
t.before_each(t.db.reset)                        -- restore the snapshot
t.db.truncate({ "notes" })                       -- empty tables (all app tables with no argument)
t.db.seed({ notes = { { text = "a", created_at = 1 } } })   -- rows, bound parameters
t.db.seed("fixtures/notes.sql")                  -- a SQL file under [testing] dir
t.db.isolate()                                   -- reset after every test in this file
```

| Fixture      | Does                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| `reset()`    | Restores the post-migration (+ seed) snapshot.                                                             |
| `truncate()` | Empties tables in one transaction, checking foreign keys at commit and resetting `AUTOINCREMENT` counters. |
| `seed(spec)` | Loads a SQL file or `{ table = rows }` in one transaction.                                                 |
| `isolate()`  | Calls `reset()` after every test of the file.                                                              |

> [!NOTE] Why not wrap each test in a transaction?
>
> Every Lua state has its own SQLite connection, so a transaction
> opened by the test cannot cover writes made by a handler. Restoring a
> snapshot works across connections.

```toml
[testing]
database = "data/test.db"             # optional: a file to keep for inspection
seed = "tests/fixtures/seed.sql"      # optional: applied after the migrations
```

Without `[testing] database`, the test database is a private file that
is removed after the run, sidecars included. A named file is recreated
at the start of every run and kept afterwards, so you can open it after
a failure. Setting it to the same file as `[database] path` is a
configuration error.

## Running tests

```sh
nitr test --filter checkout --bail                     # matching tests only; stop at the first failure
nitr test --list                                       # every test with its file:line; nothing runs
nitr test --watch                                      # re-run whenever a Lua file or template changes
nitr test --reporter junit --output target/junit.xml   # a report file for CI
nitr test --reporter json                              # one JSON document on stdout
nitr test --nocapture                                  # stream log lines instead of capturing them
```

| Flag                    | Effect                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `--filter <SUBSTRING>`  | Runs only tests whose (composed) name or file name contains the substring.                |
| `--bail`                | Stops at the first failing test.                                                          |
| `--list`                | Prints every test with its `file:line` and `[skip]`/`[todo]`/`[only]` markers, runs none. |
| `--watch`               | Runs again whenever a Lua source, template or test file changes, until Ctrl-C.            |
| `--reporter <FORMAT>`   | `pretty` (default), `json` or `junit`.                                                    |
| `-o`, `--output <FILE>` | Writes the JSON/JUnit report to a file. The pretty lines still go to stdout.              |
| `--nocapture`           | Streams log lines as they happen instead of printing them under a failed test.            |

The pretty report prints each test as it finishes:

```
extra_test.lua
  ok   extras > logs  (2 ms)
  skip extras > later (waiting on #12)
  todo extras > handles unicode
  ok   extras > advances the clock  (1204 ms, slow)

2 passed, 0 failed, 1 skipped, 1 todo, 10 filtered out (2 file(s), 1.31 s)
```

A test that takes longer than `[testing] slow_ms` (default `1000`) is
marked `slow`. Setting `[testing] capture = false` turns log capture
off.

## Testing middleware

Because dispatch is real, middleware needs no special treatment — assert
on its effects:

```lua
t.it("adds security headers to every response", function()
    t.expect(t.get("/")).to_have_header("x-content-type-options", "nosniff")
end)

t.it("rejects an invalid token", function()
    t.expect(t.get("/me", { auth = { bearer = "nonsense" } })).to_have_status(401)
end)

-- With [rate_limit] enabled = true, requests = 10
t.it("rate limits one client, not the others", function()
    for _ = 1, 10 do t.get("/api/notes", { remote_addr = "10.0.0.1" }) end
    t.expect(t.get("/api/notes", { remote_addr = "10.0.0.1" })).to_have_status(429)
    t.expect(t.get("/api/notes", { remote_addr = "10.0.0.2" })).to_have_status(200)
end)
```

## In CI

```yaml
- run: cargo install --git https://github.com/nitrweb/nitr nitr-cli
- run: nitr check # configuration and scripts load
- run: nitr migrate # the real schema is current
- run: nitr test --reporter junit --output junit.xml # behaviour is correct
```

`nitr check` first is worth the second it costs: a configuration error
fails with a clear message rather than as a puzzling test failure.
`nitr migrate` is about your actual database — the test run migrates its
own. Most CI systems can read `junit.xml` to annotate failing tests.

The complete `nitr.test` reference is in the
[Lua API reference](../api/#nitr-test).

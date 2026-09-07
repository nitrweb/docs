# Stability & Versioning

What Nitr promises about each of its surfaces, from strongest to
weakest. One version number covers the whole workspace; the `nitr.*` Lua
API does not get its own — instead the table below states how each
surface is allowed to change.

> [!WARNING] Pre-1.0
>
> Nitr is at `0.0.0-beta.5`. While the version is `0.x`, **a minor bump
> may break anything below**. The rules on this page describe the
> _shape_ of the promise that hardens at 1.0, so you can tell which
> parts are meant to be depended on and which are meant to move.

## The promise per surface

| Surface                                    | Promise                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The `nitr.*` Lua API**                   | The strongest promise: this is what users depend on most and can least easily migrate. Breaking changes need a major version and a migration note in the changelog. The [API reference](./api/) is the authoritative inventory — a test fails if a registered entry is undocumented, so the promised surface is always enumerable. `nitr.ext.*` is reserved for user modules and will never be occupied by a builtin. |
| **`nitr.toml`**                            | Unknown keys are rejected at startup, so a removed key is a loud error, never silence. A renamed key ships with the old name still accepted (and warned about) for one minor cycle before removal.                                                                                                                                                                                                                    |
| **The `nitr` crate (facade)**              | Standard semver. This is the supported Rust entry point for applications and embedders.                                                                                                                                                                                                                                                                                                                               |
| **`nitr-core` / `nitr-std` / `nitr-http`** | Published and usable directly, but **explicitly unstable pre-1.0**: they move as fast as the phases need. Depend on the `nitr` facade unless you are writing an extension crate. The [extension contract](./library/extension-modules) (`ServerBuilder::module`, `nitr_table`, `mount`, `ModuleFn`) is the part expected to settle first.                                                                             |
| **`nitr-cli` flags and output**            | Flags follow the `nitr.toml` policy — deprecate for one minor cycle, then remove. Human-readable _output text_ is not an API; `[log] format = "json"` and process exit codes are.                                                                                                                                                                                                                                     |
| **Generated type definitions**             | `resources/nitr-types.lua` is regenerated from the API description each release. It versions with the crate and carries no independent promise of its own.                                                                                                                                                                                                                                                            |

## Deprecation policy

Deprecations warn for **one minor version** before removal, and the
warning names the replacement (`use nitr.time.format instead of ...`).
Removals and renames are recorded in `CHANGELOG.md` starting with the
first release.

## Breaking changes before the first release

`CHANGELOG.md` starts at the first release, so until then the breaking
changes to the `nitr.*` Lua API are recorded here, **newest first**. Each
one names what broke, what you see when you hit it, and what to write
instead.

### `nitr.validate` grew a great deal — and one call signature changed

**What changed.** The validation vocabulary went from six types and
thirteen formats to **nine types and thirty-six formats**, plus
shorthand rule strings, custom formats, per-field `check` and
`transform`, cross-field rules, schema derivations, file rules with
media-type detection, and messages you can override at four levels. See
[Validation](./server/validation/).

**What breaks.** Almost nothing you already wrote: a rule table is still
a rule table, and `schema:check(value)` still returns
`data, err`. Two adjustments:

- **`err` gained fields.** It is now
  `{ code, message, fields, errors }` — `code` is always
  `"VALIDATION_FAILED"`, and `errors` lists each failure with its rule
  code and parameters. `err.fields` and `err.message` are unchanged, so
  code reading only those keeps working.
- **`nitr.validate.schema` takes a second argument.** Schema options
  (`title`, `strict`, `messages`, the cross-field groups, `checks`) live
  there. Existing one-argument calls are unaffected.

An unknown rule key was already a load-time error; the set of keys that
counts as known is simply much larger now.

### Routes take an options table, and can validate their own input

**What changed.** The trailing table a route registration accepts used
to hold one key, `on_error`. It now holds four: `on_error`,
`on_invalid`, `input` and `doc`.

```lua
app:post("/api/notes", handler, {
    input = { body = NoteInput },      -- checked in Rust before the handler
    doc   = { summary = "Create a note" },
})
```

A route with an `input` gets `req.valid` — the checked, coerced,
stripped request — and a request that fails it answers a JSON `422`
before any Lua runs. See
[Route input validation](./server/validation/route-input).

**What breaks.** Only a route that passed a table with a key that is now
refused: unknown keys are a **load-time error naming the four allowed
ones**, where before anything but `on_error` was ignored. That is the
change: a misspelled `on_errror` used to be silently a route without an
error handler.

Two new statuses can now come from a route you annotated: `415` for a
body in a media type the route does not accept, and `422` for a failed
`input`. Neither can appear on a route without an `input`.

### `nitr.validate.messages` is load-time only

**What changed.** App-wide default messages are set once, at load:

```lua
nitr.validate.messages({ required = "This field is required" })
```

**What breaks.** Calling it after the application has compiled
**raises**. Wording is configuration, not per-request state — one
request must never be able to change what another is told. Put the call
at the top of `app.lua`.

### `part.safe_filename` keeps the extension when it truncates

**What changed.** A name longer than the filesystem allows now gives way
at the **stem**, not the suffix: `<250 chars>.tar.gz` keeps its
`.tar.gz`. Bidirectional overrides and zero-width characters are
stripped too, alongside the control characters that were already
removed — `photo\u{202E}gnp.exe`, which renders as `photoexe.png`, is
reduced to `photognp.exe`.

**What breaks.** Nothing that was correct. Code comparing against an
exact truncated name would see a different string, and it is the shorter
name that was wrong: an `extensions` rule and most handlers decide by
the suffix, so the suffix is what must survive.

### New configuration sections

`[openapi]` and `[swagger]` are **off by default**, so an upgrade
publishes nothing. Turning either on needs its Cargo feature
(`openapi`, `swagger`), which the released binary has; `enabled = true`
on a build without it is a startup error naming the feature, the way
`[tls]` already was. See [OpenAPI](./server/openapi/).

With a section enabled, **a route may not claim its path** — that is a
startup error naming the setting and the line that registered the
route, because the route could never be reached. With the section
disabled nothing is reserved and the route wins.

### Templates HTML-escape by default, and `render` is asynchronous

**What changed.** Auto-escaping used to follow minijinja's own rule,
which escapes only `.html`, `.htm` and `.xml` — so `hello.j2`, the name
the scaffold and every example use, rendered `{{ name }}` verbatim. The
default is now the other way round: **everything escapes**, unless the
name (after stripping a trailing `.j2`, `.jinja` or `.jinja2`) ends in a
plain-text extension — `.txt`, `.text`, `.md`, `.csv`, `.json`, `.yaml`,
`.yml`, `.toml`.

`render` also moved its file read and its rendering off the async
worker, which makes it a **yielding** builtin.

**What breaks.** A template that was emitting HTML it built itself and
relying on the absence of escaping now shows markup as text — add
`| safe` where you meant it. And a template producing a non-HTML format
under a `.j2` name is now escaped: rename it `report.csv.j2`,
`mail.txt.j2`. In the other direction, an HTML template named `.txt.j2`
for an editor's benefit silently loses its escaping, which is worth a
grep.

Because `render` yields, calling it at a script's **top level** now
fails the same way the argon2 functions do — with an error naming the
builtin, not the VM's `attempt to yield from outside a coroutine`. Move
it into a handler.

See [Templates](./server/templates#escaping-read-this-one).

### Static mounts hide dotfiles

**What changed.** A request whose path has any `.`-prefixed component
answers `404` before the filesystem is touched. `.well-known/` is
exempt.

**What breaks.** A deployment that deliberately served a dotfile from
`[static] dir` or `app:static(...)`. Set `dotfiles = true` on that mount
— and check what else is beside it, because the flag is per-mount, not
per-file.

### `nitr test` never uses the configured database

**What changed.** The runner substitutes its own SQLite file:
`[testing] database` when you set one, otherwise a private file created
for the run and deleted afterwards. Either way the migrations run
against it first.

**What breaks.** A workflow that pointed `NITR_DATABASE_PATH` at a
throwaway database before `nitr test` — now unnecessary, and ignored.
A test suite that expected to read rows seeded into the configured
database sees an empty, migrated schema instead; seed from
`before_each`. See [Testing](./server/testing#tests-and-the-database).

### `nitr.db:query` is bounded, and `query_row` answers `nil`

**What changed.** A `query` returning more than `[database] max_rows`
(default 10 000) raises instead of materializing the result. And
`query_row` on a query that matches nothing now returns `nil`, which is
what it always documented — it used to raise instead
(`query_row failed (stmt …): Query returned no rows`).

**What breaks.** A `pcall` around `query_row` written to catch the empty
case still works, but the plain `if not row then` form now works too and
is the shape to use. An unbounded `SELECT *` over a large table becomes
an error; page it, or raise `max_rows` deliberately.

`query_one` is unchanged in behaviour but was **documented wrongly**
before: it returns the whole row as a column→value table and raises
unless the query returns exactly one, so
`tx:query_one("SELECT last_insert_rowid()")` was never a number. Write
`tx:query_one("SELECT last_insert_rowid() AS id").id`.

### Cookie names and values must be legal cookie text

**What changed.** `res.cookies:set` (and everything built on it)
enforces RFC 6265's grammar and raises otherwise: the name is a token,
and the value may not contain control characters, whitespace, `"`, `,`,
`;` or `\`. `path` and `domain` may not contain `;`.

**What breaks.** A handler passing a value straight from a request —
`res.cookies:set("lang", req.query.lang)` — which is exactly the shape
that could otherwise append `; Domain=…; SameSite=None` to its own
`Set-Cookie` header. Encode first with `nitr.base64.encode`, or use
`:set_signed`, whose payload is already base64.

### Strings that are not UTF-8 are refused by the JSON serializers

**What changed.** `nitr.json:encode`, JSON responses, `nitr.cache`,
sessions, JWT claims, SSE data and `fetch` bodies raise on a Lua string
holding raw bytes, instead of emitting an array of byte values.

**What breaks.** The bug this closes: a session field set to
`nitr.crypto.random_bytes(16)` used to save without complaint and come
back on the next request as a table of sixteen integers. Encode binary
with `nitr.base64.encode` before it reaches any of those.

### A per-call `fetch` timeout can only lower the configured one

**What changed.** `[fetch] timeout` is a ceiling. A per-call
`{ timeout = ... }` above it takes the configured value instead of
extending it, and a non-finite value (`math.huge`, `NaN`) is refused
rather than becoming an unbounded wait.

**What breaks.** A handler that raised its own timeout past the
operator's budget. Raise `[fetch] timeout` if that was intended.

### The rate limiter keys by the last `X-Forwarded-For` entry

**What changed.** With `trust_forwarded_for = true` the budget keys by
the **last** entry of the **last** `X-Forwarded-For` header line — the
address the nearest proxy appended — rather than the first. IPv6 clients
are keyed by their /64.

**What breaks.** Nothing behind a proxy that overwrites the header. It
**fixes** the append case, which every mainstream proxy does by default
and where the old rule let a client mint a fresh budget per request with
one header. With more than one hop the budget now keys by the nearest
hop's client.

### An outbound proxy needs an explicit `fetch` trust decision

**What changed.** With `"fetch"` in `[std] features` and a proxy in play
— `[fetch] proxy`, or `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` in the
environment — the server refuses to start unless one of
`allowed_hosts`, `allow_private_networks = true` or `no_proxy = true` is
set. A proxy resolves the target itself, so the guarded resolver that
makes the SSRF policy hold cannot run.

**What breaks.** A deployment that inherited a proxy variable from its
image or CI environment now fails at boot with a message naming which
source introduced it.

### Sessions carry their expiry, and `_exp` is reserved

**What changed.** With a `max_age`, `session:save` writes the expiry
inside the signed payload and enforces it on load: a cookie presented
past it starts an empty session. `_exp` joins `save` and `clear` as a
reserved field name.

**What breaks.** A session that stored a field called `_exp`. Rename it.

### CSRF refuses browser-flagged cross-site requests

**What changed.** An unsafe request carrying
`Sec-Fetch-Site: cross-site` is rejected before the token is compared,
unless `cookie_opts.same_site = "None"`.

**What breaks.** A genuine cross-site form post that was passing on the
token alone. Set `cookie_opts = { same_site = "None" }`, which is what
that configuration already means.

### Lua bytecode cannot be loaded

**What changed.** Every chunk the runtime compiles is text only — the
handler and config scripts, `require`d modules, test files, and `load`
whatever mode it is handed. `string.dump` and `package.searchpath` are
removed, and `require` resolves through a searcher that owns the script
directory rather than reading `package.path`.

**What breaks.** A precompiled `.lua` artifact, or a script calling
`load(chunk, name, "b")` or `string.dump`. Lua 5.4 does not verify
bytecode, so a hand-patched chunk is arbitrary memory access inside the
process — past every bound the sandbox enforces.

### New startup refusals

Each of these was previously a deployment that came up and did the wrong
thing:

- `[static] dir` enclosing the handler script's directory or
  `[templating] dir` — it would serve `app.lua` and `nitr.toml`.
- `[multipart] upload_dir` inside `[templating] dir` — an upload could
  replace a template.
- `workers` above 4096, or either `max_connections` above 1 048 576 —
  previously a panic after the port was already bound.
- A `pidfile` that already names a **running** process: the server
  refuses to start as a second instance. A stale file from a crash is
  replaced as before. `nitr reload` likewise refuses to signal a pid
  that cannot be, or does not look like, a nitr server.

### A bundled artifact extracts into the user's cache

**What changed.** `nitr build` artifacts unpack into
`$XDG_CACHE_HOME/nitr/apps` (else `~/.cache/nitr/apps`, mode `0700`)
instead of the shared temp directory. The old path was computable by
anyone who could read the executable, so on a shared `/tmp` another
local user could pre-create it and have the next start run their
application.

**What breaks.** A unit with `ProtectHome=true`, or a container user
with no `HOME`, has no cache directory: the bundle re-extracts into a
fresh private temporary directory on every start and warns on stderr.
Give the service a cache directory to keep the reuse — see
[Single-file deploys](./server/deployment/single-file).

### The three argon2 entry points are asynchronous

**What changed.** `nitr.crypto.password_hash`, `password_verify` and
`password_verify_dummy` run their hashing on the blocking thread pool
instead of inline, so all three are now asynchronous Lua functions.

**Why.** Argon2 is ~19 MiB and tens of milliseconds of uninterruptible
synchronous Rust. Run inline it holds a Tokio _worker_ for its whole
duration — neither the instruction hook nor the async timeout can
interrupt it, because no Lua executes and nothing yields — so a handful
of concurrent logins could stop the server answering anything at all,
health probes included.

**What breaks.** Nothing in a handler or a middleware: the call site is
unchanged. The one shape that stops working is calling them from a
script's **top level**, which runs once at startup, outside the async
executor:

```lua
-- No longer works: evaluated at load time, nothing to suspend into.
local users = { ada = nitr.crypto.password_hash("lovelace") }
```

**What you see.** Not the VM's `attempt to yield from outside a
coroutine`, which names neither the call nor the fix, but:

```text
script error: `password_hash` is asynchronous and cannot be called here.
A script's top level runs once at startup, outside the async executor, …
Call it from inside a handler or a middleware instead. … `nitr
hash-password` mints a password hash to paste into a table, for instance
  --> app.lua:3
```

**What to write instead.** Store a hash rather than computing one at
boot — which is what a deployment should do anyway, since hashing per
start burns argon2 for something a migration does once:

```sh
printf %s "$PASSWORD" | nitr hash-password
```

```lua
local users = { ada = "$argon2id$v=19$m=19456,t=2,p=1$..." }
```

The same explanation covers every asynchronous builtin — `nitr.fetch`,
the `nitr.db` methods, the request-body readers — because it lives in
error classification rather than in any one of them. Those were always
asynchronous; the argon2 change is simply what made an author likely to
meet the rule. See [Passwords](./server/passwords).

### Cookies Nitr builds carry `Secure` on a TLS server

**What changed.** `[cookies] secure` (default `"auto"`) decides the
attribute for the session and CSRF cookies and for `res.cookies:set` /
`:set_signed`. `"auto"` follows `[tls] enabled`.

**What breaks.** A cookie that previously shipped without `Secure` on a
TLS-terminating server now carries it, which browsers will not return
over plain `http`. An explicit `secure` in the caller's own options
table still wins in both directions, so a script that set it sees no
change.

**Behind a proxy.** `"auto"` cannot see a terminating proxy in front of
a loopback bind, so a configuration resolving to _not_ secure warns at
boot and names the lever: `[cookies] secure = "always"`. See [Cookies &
sessions](./server/cookies-sessions).

### `nitr.csrf`'s `cookie_opts` extends the defaults instead of replacing them

**What changed.** A partial `cookie_opts` used to _replace_ the module
defaults, so `cookie_opts = { path = "/admin" }` silently issued the
token cookie with no `HttpOnly` and no `SameSite`. It now merges,
matching what `nitr.session` always did, and `http_only` can no longer
be un-set.

**What breaks.** Only a caller who was relying on the attributes being
dropped. `same_site` stays overridable, because a legitimate cross-site
form needs `None`.

### Database errors no longer contain the statement

**What changed.** A failing query's error is now
`execute failed (stmt a1b2c3d4): no such table: users` — the statement
text is gone, replaced by a per-process correlator that groups repeated
failures of the same query.

**What breaks.** A handler that parsed the SQL back out of an error
message (via `nitr.errinfo` or `on_error`) no longer can. That was the
point: the message reaches the operator's log, and statements embed
secrets.

## Minimum supported Rust version

The MSRV is declared as `rust-version` in the workspace manifest and
checked by a pinned CI matrix entry. **Bumping the MSRV is a minor
change, not a breaking one**, and is called out in the changelog.

The current MSRV is **1.88.0**.

## Publishing order

The five crates version together and publish in dependency order:

```text
nitr-core → nitr-std → nitr-http → nitr → nitr-cli
```

## What is deliberately not promised

- The internal module layout of any crate — `pub(crate)` boundaries move
  freely.
- The `#[doc(hidden)]` fuzzing seams (`nitr_std::fuzzing`,
  `nitr_http::fuzzing`) and the items they re-export, which are `pub`
  only so the fuzz targets can reach them.
- Benchmark names and numbers, the test framework's failure text, and
  the dev-mode `500` page's markup.
- Behavior reachable only through `Server::builder().setup()` — the
  documented low-level escape hatch is sharp by design.

## How to depend on Nitr safely today

- **Pin a version.** The crates are published on crates.io, so an
  ordinary version requirement is enough:

  ```sh
  cargo install nitr-cli --version 0.0.0-beta.5
  ```

  ```toml
  # Cargo.toml
  nitr = { version = "0.0.0-beta.5", features = ["db"] }
  ```

  That requirement is a caret, so it will also accept a later
  `0.0.0-beta.N`. Write `"=0.0.0-beta.5"` for an exact pin, and commit
  `Cargo.lock` in an application either way — the lockfile, not the
  requirement, is what makes two builds identical.

- **Or pin a git revision** — the option for tracking work that is not
  released yet. Released betas lag the default branch:

  ```toml
  nitr = { git = "https://github.com/nitrweb/nitr", rev = "…", features = ["db"] }
  ```

- **Run `nitr check` in CI.** Unknown or removed configuration keys fail
  loudly there rather than on a deploy. `nitr check --print-config`
  prints the effective configuration after file, environment and flag
  layering, which is the answer to "which value actually won?".
- **Run `nitr test` in CI.** Requests dispatch through the real router,
  so a behavioural change in routing or middleware shows up as a test
  failure.
- **Branch on `err.kind`, never on message text.** [Error
  kinds](./server/errors#the-error-value) are a closed set; messages are
  not an API — as the database-error change above demonstrates.

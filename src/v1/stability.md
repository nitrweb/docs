# Stability & Versioning

What Nitr promises about each part of its surface. One version number
covers the whole workspace.

> [!WARNING] Pre-1.0
>
> Nitr is at `0.0.0-beta.5`. Until 1.0, **a minor release may break
> anything on this page**. The rules below show which parts are meant to
> be depended on once 1.0 ships, and which are meant to keep moving.

## The promise per surface

| Surface                                    | Promise                                                                                                                                                                                                                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The `nitr.*` Lua API**                   | The strongest promise. Breaking changes need a major version and a migration note. The [API reference](./api/) is the complete list (a test fails if a builtin is undocumented). `nitr.ext.*` is reserved for your modules and will never hold a builtin. |
| **`nitr.toml`**                            | Unknown keys are rejected at startup, so a removed key fails loudly. A renamed key keeps working, with a warning, for one minor release before removal.                                                                                                   |
| **The `nitr` crate (facade)**              | Standard semver. This is the supported Rust entry point.                                                                                                                                                                                                  |
| **`nitr-core` / `nitr-std` / `nitr-http`** | Published, but **unstable before 1.0**. Depend on `nitr` unless you are writing an extension crate. The [extension contract](./library/extension-modules) (`ServerBuilder::module`, `nitr_table`, `mount`, `ModuleFn`) is expected to settle first.       |
| **`nitr-cli` flags and output**            | Flags follow the `nitr.toml` policy: deprecated for one minor release, then removed. Human-readable output is not an API; JSON logs (`[log] format = "json"`) and exit codes are.                                                                         |
| **Generated type definitions**             | `nitr-types.lua` is regenerated from the API description and versions with the crate.                                                                                                                                                                     |

## Deprecation policy

A deprecated feature warns for **one minor release** before it is
removed, and the warning names the replacement. From the first release,
removals and renames are recorded in `CHANGELOG.md`.

## Breaking changes before the first release

Until `CHANGELOG.md` exists, breaking changes are listed here, **newest
first**, with what to do about each.

### Route options and validation

- A route's trailing options table now accepts `on_error`, `on_invalid`,
  `input` and `doc`. **Any other key is a load-time error**, so a typo
  such as `on_errror` is no longer silently ignored. A route with an
  `input` answers `415` or `422` before the handler runs. See [Route
  input validation](./server/validation/route-input).
- `nitr.validate` grew to nine types and 36 formats. `schema:check(v)`
  still returns `data, err`; `err` now also has `code`
  (`"VALIDATION_FAILED"`) and `errors`, while `err.fields` and
  `err.message` are unchanged. `nitr.validate.schema` takes an optional
  second argument for schema options. See [Validation](./server/validation/).
- `nitr.validate.messages(...)` raises if called after the app has
  loaded. Call it at the top of `app.lua`.

### `[openapi]` and `[swagger]` sections

Both are **off by default**, so upgrading publishes nothing. When one is
enabled, a route registered on its path is a startup error. See
[OpenAPI](./server/openapi/).

### Templates escape HTML by default

Every template is now HTML-escaped unless its name (minus a trailing
`.j2`, `.jinja` or `.jinja2`) ends in a plain-text extension: `.txt`,
`.text`, `.md`, `.csv`, `.json`, `.yaml`, `.yml` or `.toml`.

**What to do:** add `| safe` where a template outputs HTML it built
itself, and name non-HTML templates accordingly (`report.csv.j2`). See
[Templates](./server/templates#escaping-read-this-one).

### Some builtins cannot run at the top level of `app.lua`

`nitr.template:render` and the argon2 functions
(`nitr.crypto.password_hash`, `password_verify`,
`password_verify_dummy`) now run on a background thread pool, so the
server keeps answering other requests while they work. Like `nitr.fetch`
and `nitr.db`, they can no longer be called at the top level of
`app.lua` or a module it `require`s. That fails with:

```text
script error: `password_hash` is asynchronous and cannot be called here. …
```

**What to do:** call them from a handler or middleware. For a stored
password hash, create it once and paste it in:

```sh
printf %s "$PASSWORD" | nitr hash-password
```

See [Passwords](./server/passwords).

### Static mounts hide dotfiles

Any path with a `.`-prefixed component answers `404`, except
`.well-known/`. **What to do:** to serve dotfiles on purpose, set
`dotfiles = true` on that mount.

### `nitr test` uses its own database, and hooks are scoped

- `nitr test` never touches `[database] path`. It uses
  `[testing] database` if set (recreated at the start of each run), or
  a private file deleted afterwards, with migrations applied. Seed test
  data with `[testing] seed` or `t.db.seed`.
- `before_each` and `after_each` apply only to tests registered after
  them in the same `describe` (and nested ones). Put file-wide hooks at
  the top of the file.

See [Testing](./server/testing#tests-and-the-database).

### `RuntimeOpts` has a new field

`RuntimeOpts` gained `extra_package_dirs`. Code that builds it by hand
must add `extra_package_dirs: Vec::new()`. See
[Runtime](./library/runtime#runtimeopts).

### `nitr.db:query` is bounded, and `query_row` returns `nil`

- `query` raises when a result has more than `[database] max_rows` rows
  (default 10 000). Page the query, or raise the limit.
- `query_row` returns `nil` when nothing matches, instead of raising.
  Use `if not row then`.
- `query_one` returns a row table, not a single value, and raises unless
  exactly one row comes back. Write
  `tx:query_one("SELECT last_insert_rowid() AS id").id`.

### Cookie names and values must be valid cookie text

`res.cookies:set` raises on a name that is not a token, or a value
containing control characters, whitespace, `"`, `,`, `;` or `\`.
**What to do:** encode untrusted values with `nitr.base64.encode`, or use
`:set_signed`.

### JSON output refuses non-UTF-8 strings

`nitr.json:encode`, JSON responses, `nitr.cache`, sessions, JWT claims,
SSE data and `fetch` bodies raise on a string of raw bytes instead of
turning it into an array of numbers. **What to do:** pass binary data
through `nitr.base64.encode` first.

### A per-call `fetch` timeout can only lower `[fetch] timeout`

A larger per-call `timeout` is capped at the configured value, and
`math.huge` or `NaN` is refused. Raise `[fetch] timeout` if you need
longer.

### The rate limiter uses the last `X-Forwarded-For` entry

With `trust_forwarded_for = true`, the client is the **last** address in
the **last** `X-Forwarded-For` header (the one your nearest proxy
added), and IPv6 clients are grouped by /64. Nothing changes behind a
proxy that overwrites the header.

### An outbound proxy needs an explicit `fetch` decision

With `"fetch"` enabled and a proxy configured (`[fetch] proxy`, or
`HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` in the environment), the
server refuses to start unless you set `allowed_hosts`,
`allow_private_networks = true` or `no_proxy = true`.

### Sessions store their expiry, and `_exp` is reserved

With a `max_age`, the expiry is signed into the session and an expired
cookie starts an empty session. Rename any session field called `_exp`.

### CSRF protection and cookies

- Unsafe requests with `Sec-Fetch-Site: cross-site` are refused unless
  `cookie_opts.same_site = "None"`.
- A partial `cookie_opts` now adds to the defaults instead of replacing
  them, so `HttpOnly` and `SameSite` stay set. `http_only` can no longer
  be turned off.

### Cookies carry `Secure` on a TLS server

`[cookies] secure` (default `"auto"`, which follows `[tls] enabled`)
sets `Secure` on session, CSRF and `res.cookies` cookies. An explicit
`secure` in your own options still wins. Behind an HTTPS proxy, set
`[cookies] secure = "always"`. See [Cookies &
sessions](./server/cookies-sessions).

### Lua bytecode cannot be loaded

Every chunk is compiled from source; `load(chunk, name, "b")`,
`string.dump` and `package.searchpath` are gone. **What to do:** ship
`.lua` source, not precompiled files.

### New startup refusals

The server now refuses to start when:

- `[static] dir` contains the scripts or templates directory (it would
  serve your source and `nitr.toml`);
- `[multipart] upload_dir` is inside `[templating] dir`;
- `workers` is above 4096, or a `max_connections` is above 1 048 576;
- the `pidfile` names a running process. A stale file from a crash is
  still replaced.

### Bundled apps extract into the user's cache

`nitr build` artifacts unpack into `$XDG_CACHE_HOME/nitr/apps` (or
`~/.cache/nitr/apps`) instead of the shared temp directory. Without a
cache directory (for example with `ProtectHome=true`), they extract to
a fresh temporary directory on every start and warn. See [Single-file
deploys](./server/deployment/single-file).

### Database errors no longer include the SQL

A failed query reads `execute failed (stmt a1b2c3d4): no such table: users`.
The statement text is replaced by an id, because statements can contain
secrets. Do not parse SQL out of error messages.

## Minimum supported Rust version

The MSRV is **1.88.0**. It is set as `rust-version` in the workspace
manifest and tested in CI. Raising it is a minor change, not a breaking
one, and is noted in the changelog.

## Publishing order

The five crates share one version and publish in dependency order:

```text
nitr-core → nitr-std → nitr-http → nitr → nitr-cli
```

## What is deliberately not promised

- The internal module layout of any crate.
- The hidden `fuzzing` modules (`nitr_std::fuzzing`,
  `nitr_http::fuzzing`), which are public only for the fuzz targets.
- Benchmark names and numbers, the test runner's failure text, and the
  dev-mode `500` page.
- Behaviour reachable only through `Server::builder().setup()`, the
  low-level escape hatch.

## How to depend on Nitr safely today

- **Pin a version.**

  ```sh
  cargo install nitr-cli --version 0.0.0-beta.5
  ```

  ```toml
  # Cargo.toml
  nitr = { version = "0.0.0-beta.5", features = ["db"] }
  ```

  That requirement also accepts later `0.0.0-beta.N` releases. Use
  `"=0.0.0-beta.5"` for an exact pin, and commit `Cargo.lock`.

- **Or pin a git revision** to use unreleased work:

  ```toml
  nitr = { git = "https://github.com/nitrweb/nitr", rev = "…", features = ["db"] }
  ```

- **Run `nitr check` and `nitr test` in CI.** `check` catches unknown or
  removed configuration keys, and tests go through the real router.
- **Branch on `err.kind`, never on message text.** [Error
  kinds](./server/errors#the-error-value) are a fixed set; messages can
  change.

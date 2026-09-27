# Database

`nitr.db` is SQLite, built into the binary. WAL mode, a busy timeout and
foreign keys are on by default. Queries run on a background thread pool,
so a slow query delays its own request, not the server.

## Enabling it

```toml
[database]
path = "data/app.db"

[std]
features = ["json", "http", "log", "db"]     # ← "db"
```

You need both. Listing `"db"` without a `[database]` section fails at
startup.

## Querying

Four methods, differing only in what they return:

```lua
-- All rows: an array of column→value tables
local users = nitr.db:query("SELECT id, name FROM users ORDER BY id")
for _, u in ipairs(users) do
    print(u.id, u.name)
end

-- The first row, or nil when there are none
local user = nitr.db:query_row("SELECT * FROM users WHERE id = ?", { 42 })

-- Exactly one row: raises on none, and on more than one
local total = nitr.db:query_one("SELECT count(*) AS n FROM users").n

-- A statement: returns the number of affected rows
local n = nitr.db:execute("UPDATE users SET active = 0 WHERE last_seen < ?", { cutoff })
```

> [!WARNING] `query_one` returns a row, not a value
>
> The result is a column→value table, so read the column out and give
> expressions an alias (`count(*) AS n`). Use it where a missing row is a
> bug. Where "none" is a normal answer, use `query_row` and check for
> `nil`.

`query` raises, rather than truncating, when a result has more rows than
`[database] max_rows` (10 000 by default). Page with `LIMIT`/`OFFSET`, or
raise the setting.

Because a row is a column→value table, a result with two columns of the
same name raises (`SELECT a.id, b.id ...`). Give one an alias:
`b.id AS b_id`.

## Parameters

Always pass values as parameters. Never build SQL by joining strings.

```lua
-- ✅
nitr.db:query_row("SELECT * FROM users WHERE email = ?", { email })

-- ❌ SQL injection
nitr.db:query_row("SELECT * FROM users WHERE email = '" .. email .. "'")
```

Parameters are positional `?` placeholders, passed as an array. `nil`
and JSON `null` bind SQL `NULL`, including a trailing one
(`{ name, nil }`). Passing an empty list, or no list, for a statement
with placeholders raises. A `LIKE` pattern is a parameter too: build it
in Lua and pass the finished string.

```lua
nitr.db:query("SELECT * FROM users WHERE name LIKE ?", { "%" .. q .. "%" })
```

## Transactions

```lua
local order_id = nitr.db:transaction(function(tx)
    tx:execute("INSERT INTO orders (user_id, total) VALUES (?, ?)", { user_id, total })
    local id = tx:query_one("SELECT last_insert_rowid() AS id").id

    for _, item in ipairs(items) do
        tx:execute(
            "INSERT INTO order_items (order_id, sku, qty) VALUES (?, ?, ?)",
            { id, item.sku, item.qty }
        )
    end

    return id
end)
```

The block commits when it returns and **rolls back on any error**, even
one raised deep inside a helper. Whatever the block returns is the
result of `transaction(...)`. Transactions nest (as savepoints), so a
helper that opens its own transaction works inside a larger one.

> [!WARNING] Use `tx`, not `nitr.db`
>
> While the block runs, a statement on `nitr.db` raises instead of
> quietly joining the transaction. The `tx` handle only works inside its
> block; keeping it and using it later raises too.

## Concurrent queries

`query_async` returns an unsent query that `nitr.await_all` can run
alongside outbound requests:

```lua
local user, profile = nitr.await_all(
    nitr.db:query_async("SELECT * FROM users WHERE id = ?", { id }, "query_row"),
    nitr.fetch("GET", "https://api.example.com/profile/" .. id)
)
```

The third argument picks the result shape: `"query"` (the default),
`"query_row"`, `"query_one"` or `"execute"`. Inside a transaction, build
the handle from `tx`. See
[Outbound HTTP](./fetch#running-requests-concurrently).

## Migrations

Migrations are plain SQL files. There is no DSL and no down-migrations.

```text
migrations/
├── 001_init.sql
├── 002_add_email_index.sql
└── 003_orders.sql
```

A migration is a `.sql` file whose name **starts with a number**. They
run in numeric order, each in its own transaction, and each is recorded
in a `_nitr_migrations` table so it never runs twice. Two files with the
same number are an error. Nitr looks in `migrations/` unless
`[database] migrations_dir` says otherwise.

### Applying them

```sh
nitr migrate            # apply everything pending
nitr migrate --status   # report, apply nothing
```

```text
$ nitr migrate --status
  applied    001_init.sql
  applied    002_add_email_index.sql
  pending    003_orders.sql
2 applied, 1 pending, 0 modified
```

**The server (and `nitr check`) refuses to start while a migration is
pending.** Migrations never run on boot, so in a rolling deploy two
instances cannot race to change the schema: run `nitr migrate` once,
then start the new instances. `nitr test` applies them to its own
scratch database; see [Testing](./testing#tests-and-the-database).

### Never edit an applied migration

Each applied migration is stored with a checksum of its contents.
Editing a file that already ran shows up as modified:

```text
  MODIFIED SINCE APPLIED 001_init.sql
```

A modified migration is not re-run, and the server will not start until
you restore the file. To change the schema, write a new migration.

## Configuration

```toml
[database]
path = "data/app.db"
journal_mode = "wal"      # or "delete"; "keep" leaves the existing mode
busy_timeout = 5000       # ms to wait on a lock instead of failing
synchronous = "normal"    # the right pairing with WAL
foreign_keys = true       # SQLite itself defaults this to off
cache_size = -2000        # negative = KiB, per connection
max_rows = 10000          # most rows one query may return
migrations_dir = "migrations"
```

These are the defaults; only `path` is required. See
[`[database]`](./configuration/file#database) for the full reference.

### Why WAL matters here specifically

Each pooled Lua state has its own connection. With SQLite's default
journal, every writer blocks every reader. WAL lets readers and one
writer work at the same time.

> [!WARNING] Back up with `VACUUM INTO`, not `cp`
>
> In WAL mode the database is three files (`app.db`, `app.db-wal`,
> `app.db-shm`). Copying only `app.db` while the server runs does not give
> a consistent snapshot.
>
> ```sh
> sqlite3 data/app.db "VACUUM INTO 'backup.db'"     # safe while running
> ```

## Startup setup in `config.lua`

The config script receives the database connection as its argument.
It runs once per startup and reload, not once per Lua state, so keep it
idempotent:

```lua
-- config.lua
local db = ...

db:execute("PRAGMA optimize")

return {
    settings = db:query_row("SELECT * FROM settings WHERE id = 1"),
}
```

## Performance

- **Use parameters.** Prepared statements are cached per connection, so
  the same SQL text is cheap to run again. Inlining values changes the
  text and skips the cache.
- **Index what you filter and sort on.**
  `CREATE INDEX idx_notes_created_at ON notes (created_at DESC);`
- **Measure.** At `debug` level each statement logs a `db_query` span
  with its kind and duration, never the SQL or its values. See
  [Logging](./logging#spans).

## When SQLite is the wrong fit

SQLite suits a single server process with mostly-read or moderate write
traffic. It is the wrong tool when several machines must write to the
same data. Nitr ships no other database client, but you can add one as
an [extension module](../library/extension-modules) in Rust (for
example, `nitr.ext.pg`).

For every method and its signature, see the
[API reference](../api/#nitr-db).

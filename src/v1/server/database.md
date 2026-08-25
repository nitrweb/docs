# Database

`nitr.db` is SQLite — bundled, not linked from the system — with WAL, a
busy timeout and foreign keys on by default. Queries run on a blocking
thread pool with a prepared-statement cache, so they never block the
async runtime.

## Enabling it

```toml
[database]
path = "data/app.db"

[std]
features = ["json", "http", "log", "db"]     # ← "db"
```

Both are needed. Listing `"db"` without a `[database]` section is a
startup error, not a surprise at the first query.

## Querying

Four methods, differing only in what they give back:

```lua
-- All rows: an array of column→value tables
local users = nitr.db:query("SELECT id, name FROM users ORDER BY id")
for _, u in ipairs(users) do
    print(u.id, u.name)
end

-- The first row, or nil
local user = nitr.db:query_row("SELECT * FROM users WHERE id = ?", { 42 })

-- The first column of the first row
local count = nitr.db:query_one("SELECT count(*) FROM users")

-- A statement: returns the affected row count
local n = nitr.db:execute("UPDATE users SET active = 0 WHERE last_seen < ?", { cutoff })
```

## Parameters

Always pass values as parameters. Never build SQL by concatenation.

```lua
-- ✅
nitr.db:query_row("SELECT * FROM users WHERE email = ?", { email })

-- ❌ SQL injection
nitr.db:query_row("SELECT * FROM users WHERE email = '" .. email .. "'")
```

Parameters are positional `?` placeholders, supplied as an array:

```lua
nitr.db:execute(
    "INSERT INTO notes (text, author, created_at) VALUES (?, ?, ?)",
    { data.text, req.user, nitr.time.now() }
)
```

> [!TIP] `LIKE` patterns are parameters too
>
> ```lua
> nitr.db:query("SELECT * FROM users WHERE name LIKE ?", { "%" .. q .. "%" })
> ```
>
> Build the pattern in Lua; pass the finished string as a parameter.

## Transactions

```lua
local id = nitr.db:transaction(function(tx)
    tx:execute("INSERT INTO orders (user_id, total) VALUES (?, ?)", { user_id, total })
    local order_id = tx:query_one("SELECT last_insert_rowid()")

    for _, item in ipairs(items) do
        tx:execute(
            "INSERT INTO order_items (order_id, sku, qty) VALUES (?, ?, ?)",
            { order_id, item.sku, item.qty }
        )
    end

    return order_id
end)
```

The block commits when it returns and **rolls back on any error** —
including one raised deep inside a helper function. Whatever the block
returns becomes the value of `transaction(...)`.

> [!WARNING] Use `tx`, not the outer `nitr.db`
>
> ```lua
> nitr.db:transaction(function(tx)
>     tx:execute(...)          -- ✅ inside the transaction
>     nitr.db:execute(...)     -- ❌ refused while a transaction is open
> end)
> ```
>
> The outer handle **refuses to run** rather than silently joining the
> transaction — which is how you get half-committed writes in systems
> that allow it.

Transactions nest via savepoints, so a helper that opens its own
transaction composes correctly inside a larger one.

## Concurrent queries

`query_async` returns an unsent query that `nitr.await_all` can run
alongside a `fetch` — turning a series of waits into one:

```lua
local results = nitr.await_all({
    nitr.db:query_async("SELECT * FROM users WHERE id = ?", { id }, "query_row"),
    nitr.fetch("GET", "https://api.example.com/profile/" .. id),
})

local user    = results[1]
local profile = results[2]:json()
```

The optional third argument is the shape you want back —
`"query"`, `"query_row"`, `"query_one"` or `"execute"` — matching the
four synchronous methods.

Concurrency is capped by `[fetch] max_concurrent`. See
[Outbound HTTP](./fetch#running-requests-concurrently).

## Migrations

Plain SQL files. No DSL, no ORM, no down-migrations — rolling a
production schema back by script is a decision, not something a
framework should do on your behalf.

```
migrations/
├── 001_init.sql
├── 002_add_email_index.sql
└── 003_orders.sql
```

A migration is a `.sql` file whose name **starts with a number**. They
run in numeric order, each inside a transaction, and each is recorded in
a `_nitr_migrations` table so it never runs twice.

```sql
-- migrations/002_add_email_index.sql
CREATE UNIQUE INDEX idx_users_email ON users (email);
```

### Applying them

```sh
nitr migrate            # apply everything pending
nitr migrate --status   # report, apply nothing
```

```
$ nitr migrate --status
  applied    001_init.sql
  applied    002_add_email_index.sql
  pending    003_orders.sql
2 applied, 1 pending, 0 modified
```

**The server refuses to start while a migration is pending.** That is
what keeps the schema and the code from quietly disagreeing.

> [!NOTE] Why `migrate` is a separate command
>
> Applying schema changes at boot means a rolling deployment has two
> instances racing to change the same schema, each believing it is
> alone. Run `nitr migrate` once, then start the new instances.

### Never edit an applied migration

Each applied migration is recorded with a **SHA-256 checksum of its
contents**. Editing a file that already ran shows up as `MODIFIED`:

```
  MODIFIED SINCE APPLIED    001_init.sql
```

A modified migration is **not re-run**. Restore the file, or write a new
migration that makes the change you wanted. The checksum exists because
editing an applied file is the single easiest way to make two
deployments disagree about what the schema is — and it is invisible
without one.

## Configuration and pragmas

```toml
[database]
path = "data/app.db"
journal_mode = "wal"      # or "delete"; "keep" leaves the existing mode
busy_timeout = 5000       # ms to wait on a lock instead of failing
synchronous = "normal"    # the right pairing with WAL
foreign_keys = true       # SQLite leaves this off, which surprises everyone
cache_size = -2000        # KiB per connection
migrations_dir = "migrations"
```

### Why WAL matters here specifically

There is **one connection per pooled Lua state**. SQLite's default
rollback journal serializes every writer and fails fast on contention —
with eight states that is eight writers taking turns badly. WAL lets
readers and a writer proceed concurrently.

> [!WARNING] WAL changes what "copy the database" means
>
> The on-disk set becomes `app.db`, `app.db-wal` and `app.db-shm`.
> Copying only `app.db` while the server runs does **not** give a
> consistent snapshot.
>
> ```sh
> sqlite3 data/app.db "VACUUM INTO 'backup.db'"     # safe while running
> ```

## Startup setup in `config.lua`

The database connection arrives as the config script's vararg, so
one-off setup happens once rather than once per state:

```lua
-- config.lua
local db = ...

db:execute("PRAGMA optimize")

return {
    settings = db:query_row("SELECT * FROM settings WHERE id = 1"),
}
```

## Performance notes

**Statements are cached.** Prepared statements are reused per
connection, so repeating the same SQL text is cheap. Varying the SQL
text (by inlining values) defeats that — another reason to use
parameters.

**Queries run off the async threads.** A slow query blocks its own
request, not the runtime.

**`db_query` spans show the cost.** At debug level each statement emits
a span with its kind and `elapsed_ms`:

```
db_query{kind=query elapsed_ms=3} close
```

No SQL text and no bind values are ever logged — statements embed
secrets, and logs outlive them. See [Logging → Redaction
rules](./logging#redaction-rules).

**Index what you filter on.** SQLite is fast and small, not magic:

```sql
CREATE INDEX idx_notes_created_at ON notes (created_at DESC);
```

## When SQLite is the wrong answer

Be honest about the fit. SQLite is excellent for a single-process
application with a read-heavy or moderate write load. It is the wrong
tool when you need multiple machines writing to one dataset, or a
write throughput a single file cannot sustain.

Nitr does not ship a client for anything else — but the [extension
boundary](../library/extension-modules) is exactly how you add one:
mount a Postgres or Redis client as `nitr.ext.pg` from Rust.

## Quick reference

| Method                                     | Returns                                        |
| ------------------------------------------ | ---------------------------------------------- |
| `nitr.db:query(sql, params?)`              | All rows, each a column→value table            |
| `nitr.db:query_row(sql, params?)`          | The first row, or `nil`                        |
| `nitr.db:query_one(sql, params?)`          | The first column of the first row              |
| `nitr.db:execute(sql, params?)`            | Affected row count                             |
| `nitr.db:transaction(fn)`                  | Whatever `fn(tx)` returns; rolls back on error |
| `nitr.db:query_async(sql, params?, kind?)` | An unsent handle for `nitr.await_all`          |

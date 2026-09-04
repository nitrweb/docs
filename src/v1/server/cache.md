# Cache

`nitr.cache` is a bounded TTL + LRU cache **shared by every Lua state**
in the process. It is owned by Rust, and entries are stored as plain
serialized data — so no Lua value ever crosses between states.

## Enabling it

```toml
[std]
features = ["json", "http", "log", "cache"]   # ← "cache"

[cache]
max_entries = 10000
max_bytes = 33554432      # 32 MiB
default_ttl = 300         # seconds; 0 means no expiry
```

## Reading and writing

```lua
nitr.cache:set("user:42", { id = 42, name = "Ada" }, { ttl = 600 })  -- seconds
local user = nitr.cache:get("user:42")                   -- nil if absent or expired

nitr.cache:delete("user:42")     -- returns whether the key was there
nitr.cache:clear()
```

> [!WARNING] The TTL is a table field, not a third argument
>
> `set` takes an **options table** — `{ ttl = seconds }` — not a bare
> number. A number in that position raises. Omit the table entirely to
> take `[cache] default_ttl`.

## `remember` — the one you will actually use

Get it, or compute and store it:

```lua
local user = nitr.cache:remember("user:" .. id, { ttl = 300 }, function()
    return nitr.db:query_row("SELECT * FROM users WHERE id = ?", { id })
end)
```

The function runs only on a miss. This collapses the usual
get / check / compute / set dance into one line, and keeps the key in
one place.

Both call shapes work — `remember(key, fn)` uses `[cache] default_ttl`,
`remember(key, { ttl = seconds }, fn)` sets its own:

```lua
-- An expensive aggregate, refreshed at most once a minute
local stats = nitr.cache:remember("stats:dashboard", { ttl = 60 }, function()
    return {
        users   = nitr.db:query_one("SELECT count(*) AS n FROM users").n,
        orders  = nitr.db:query_one("SELECT count(*) AS n FROM orders").n,
        revenue = nitr.db:query_one("SELECT sum(total) AS total FROM orders").total,
    }
end)
```

```lua
-- An upstream response you should not fetch on every request
local rates = nitr.cache:remember("fx:rates", { ttl = 300 }, function()
    return nitr.fetch("GET", "https://api.example.com/rates"):send():json()
end)
```

## Statistics

```lua
app:get("/admin/cache", require_admin, function(req)
    return nitr.json(nitr.cache:stats())    -- hit/miss/entry counters
end)
```

Watch the hit rate. A cache with a poor hit rate is pure overhead —
either the TTL is too short, or the keys are too specific.

## What belongs here — and what does not

| ✅ Good                 | ❌ Wrong                                            |
| ----------------------- | --------------------------------------------------- |
| Expensive query results | **Sessions** — see below                            |
| Upstream API responses  | **Exact counters** — two processes count separately |
| Rendered fragments      | **Rate-limit state** — use `[rate_limit]`           |
| Configuration lookups   | Anything that must survive a restart                |
| Computed aggregates     | Anything that must be consistent across machines    |

> [!DANGER] It is per-process, and it is a cache
>
> - A **restart empties it.**
> - **Two Nitr processes have two independent caches.** Behind a load
>   balancer, a value cached by one is invisible to the other.
> - Entries may be **evicted before their TTL** when `max_entries` or
>   `max_bytes` is reached.
>
> Anything whose _absence_ breaks correctness does not belong in a
> cache. Sessions in particular: use a [signed-cookie
> session](./cookies-sessions#sessions), or a session row in
> [`nitr.db`](./database).

## Plain data only

Entries are serialized, which is what makes sharing them across states
safe. Store tables, strings, numbers and booleans — a function, a
coroutine or userdata is an error, not a value that misbehaves later.

```lua
nitr.cache:set("k", { a = 1, b = { 2, 3 } })      -- ✅
nitr.cache:set("k", function() end)               -- ❌
nitr.cache:set("k", nitr.crypto.random_bytes(16)) -- ❌ not UTF-8 text
```

Serialization is JSON, so a string holding raw bytes is refused rather
than coming back as an array of numbers. Encode it first with
`nitr.base64.encode`.

## Key naming

Namespace your keys. Collisions across a codebase are otherwise a matter
of time:

```lua
"user:42"
"user:42:permissions"
"article:slug:hello-world"
"stats:dashboard"
"fx:rates"
```

Include everything that varies the value:

```lua
-- ❌ every user sees the first user's feed
nitr.cache:remember("feed", load_feed)

-- ✅
nitr.cache:remember("feed:" .. user_id .. ":page:" .. page, { ttl = 60 }, function()
    return load_feed(user_id, page)
end)
```

> [!WARNING] A key built from request data needs a bound
>
> Keys are capped at 1024 bytes, and a key counts toward
> `[cache] max_bytes` alongside its value — otherwise a key derived from
> a query string is a way to fill the cache with keys. Where the varying
> part is unbounded, hash it:
> `"search:" .. nitr.crypto.sha256(q)`.

## Invalidation

Delete on write:

```lua
app:put("/api/users/:id", function(req)
    local id = req.params.id
    nitr.db:execute("UPDATE users SET name = ? WHERE id = ?", { req:json().name, id })

    nitr.cache:delete("user:" .. id)
    nitr.cache:delete("user:" .. id .. ":permissions")

    return nitr.json({ ok = true })
end)
```

> [!TIP] Prefer a short TTL to precise invalidation
>
> Remember that a second process's cache still holds the old value —
> `delete` only clears the local one. A 60-second TTL bounds the
> staleness everywhere, without needing every write path to know every
> key. Reach for explicit deletion only where stale data is genuinely
> unacceptable.

## Sizing

```toml
[cache]
max_entries = 10000
max_bytes = 33554432
default_ttl = 300
```

Both bounds apply — whichever is reached first triggers LRU eviction.
`max_bytes` is the one that protects the process: 10 000 entries of one
kilobyte each is fine, 10 000 entries of one megabyte each is not.

`default_ttl` applies when `set` is called without one. `0` means no
expiry, which makes eviction the only way an entry ever leaves.

## Quick reference

| Method                                | Description                                               |
| ------------------------------------- | --------------------------------------------------------- |
| `nitr.cache:get(key)`                 | The cached value, or `nil`                                |
| `nitr.cache:set(key, value, opts?)`   | Store a value; `opts` is `{ ttl = seconds }`              |
| `nitr.cache:delete(key)`              | Remove a key; answers whether it was there                |
| `nitr.cache:clear()`                  | Empty the cache                                           |
| `nitr.cache:remember(key, opts?, fn)` | The cached value, or `fn()`'s result, stored and returned |
| `nitr.cache:stats()`                  | Hit / miss / entry counters                               |

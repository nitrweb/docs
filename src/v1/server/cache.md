# Cache

`nitr.cache` is an in-memory cache with a TTL and least-recently-used
eviction, **shared by every Lua state** in the process. Values are stored
as plain data (JSON), so no Lua object is ever shared between states.

## Enabling it

```toml
[std]
features = ["json", "http", "log", "cache"]   # ← "cache"

[cache]
max_entries = 10000
max_bytes = 33554432      # 32 MiB
default_ttl = 300         # seconds; 0 means no expiry
```

These are the defaults. When either `max_entries` or `max_bytes` is
reached, the least recently used entries are evicted. `max_bytes` is the
one that protects memory, and keys count toward it too.

## Reading and writing

```lua
nitr.cache:set("user:42", { id = 42, name = "Ada" }, { ttl = 600 })  -- seconds
local user = nitr.cache:get("user:42")    -- nil if absent or expired

nitr.cache:delete("user:42")              -- returns whether the key was there
nitr.cache:clear()
```

The TTL goes in an options table, `{ ttl = seconds }`; `0` never
expires. A bare number in that position raises. Leave the table out to
use `[cache] default_ttl`. Setting `nil` removes the key, like `delete`.

## `remember`

Get the cached value, or compute it, store it and return it:

```lua
local user = nitr.cache:remember("user:" .. id, { ttl = 300 }, function()
    return nitr.db:query_row("SELECT * FROM users WHERE id = ?", { id })
end)
```

The function runs only on a miss. `remember(key, fn)` uses the default
TTL. A `nil` result is returned but not cached, so the function runs
again next time.

```lua
-- An upstream response you should not fetch on every request
local rates = nitr.cache:remember("fx:rates", { ttl = 300 }, function()
    return nitr.fetch("GET", "https://api.example.com/rates"):send():json()
end)
```

## What belongs here

| ✅ Good                 | ❌ Wrong                                           |
| ----------------------- | -------------------------------------------------- |
| Expensive query results | **Sessions**                                       |
| Upstream API responses  | **Exact counters**: two processes count separately |
| Rendered fragments      | **Rate-limit state**: use `[rate_limit]`           |
| Computed aggregates     | Anything that must survive a restart               |

> [!DANGER] It is per-process, and entries can vanish
>
> A restart empties it. Two Nitr processes have two separate caches, and
> `delete` clears only the local one. Entries can be evicted before their
> TTL. Keep sessions in a [signed cookie](./cookies-sessions#sessions) or
> in [`nitr.db`](./database).

## Plain data only

Store tables, strings, numbers and booleans. A function, userdata or a
string of raw bytes (not valid UTF-8) raises. Encode binary data first
with `nitr.base64.encode`.

## Keys

Namespace your keys and include everything the value depends on:

```lua
-- ❌ every user sees the first user's feed
nitr.cache:remember("feed", load_feed)

-- ✅
nitr.cache:remember("feed:" .. user_id .. ":page:" .. page, { ttl = 60 }, function()
    return load_feed(user_id, page)
end)
```

Keys are limited to 1024 bytes. When part of a key comes from the
request, hash it so its size is fixed: `"search:" .. nitr.crypto.sha256(q)`.

## Invalidation

Delete the key when you write the data it caches:

```lua
nitr.db:execute("UPDATE users SET name = ? WHERE id = ?", { name, id })
nitr.cache:delete("user:" .. id)
```

Because other processes keep their own copy, a short TTL is often the
simpler choice: a 60-second TTL limits how stale any copy can get,
without every write path knowing every key.

## Statistics

`nitr.cache:stats()` returns `entries`, `bytes`, `hits`, `misses`,
`evictions`, `max_entries` and `max_bytes`. A low hit rate means the TTL
is too short or the keys are too specific.

## Testing

TTLs follow the test clock, so a test can expire an entry with
`t.clock.advance(seconds)` instead of sleeping. See
[Testing](./testing#clock).

For every method and its signature, see the
[API reference](../api/#nitr-cache).

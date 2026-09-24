# Extension Modules

Extension modules let Lua call your own Rust functions, without forking
Nitr.

```rust
Server::builder().module("greet", |lua| {
    let t = lua.create_table()?;
    t.set("hello", lua.create_function(|_, name: String| {
        Ok(format!("Hello, {name}!"))
    })?)?;
    Ok(t)
})
```

```lua
nitr.ext.greet.hello("world")     -- "Hello, world!"
```

Modules live under `nitr.ext`, so their names never clash with current
or future `nitr.*` builtins. Registering two modules with the same name
fails at build time.

## Depending on `mlua`

A module closure receives an `&mlua::Lua` and returns an `mlua::Table`.
The `nitr` crate does not re-export `mlua`, so add it yourself, at the
same version Nitr uses:

```toml
[dependencies]
nitr = "0.0.0-beta.5"
mlua = { version = "0.12", features = ["lua54", "vendored", "async", "send"] }
```

`send` is required for the closure's `Send + Sync + 'static` bounds, and
`async` for [async functions](#async-modules).

## How modules run

A module is a closure `Fn(&Lua) -> mlua::Result<Table> + Send + Sync + 'static`.
It runs **once per Lua state** (once per worker) and again on every
reload. With four workers you get four separate Lua tables, so any state
they must share has to live on the Rust side (see [Stateful
modules](#stateful-modules)).

## Stateless module

```rust
use mlua::{Lua, Table};

fn slug_module(lua: &Lua) -> mlua::Result<Table> {
    let table = lua.create_table()?;
    table.set(
        "slugify",
        lua.create_function(|_, input: String| {
            let slug: Vec<String> = input
                .split(|c: char| !c.is_alphanumeric())
                .filter(|w| !w.is_empty())
                .map(str::to_lowercase)
                .collect();
            Ok(slug.join("-"))
        })?,
    )?;
    Ok(table)
}
```

```rust
Server::builder().module("slug", slug_module)
```

## Stateful modules

Give every Lua state a handle to the same Rust object:

```rust
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use mlua::{Lua, Table};

/// A counter store shared by every Lua state.
#[derive(Clone, Default)]
struct Kv(Arc<Mutex<HashMap<String, i64>>>);

impl Kv {
    fn get(&self, key: &str) -> i64 {
        self.0.lock().map(|m| *m.get(key).unwrap_or(&0)).unwrap_or(0)
    }

    fn add(&self, key: &str, delta: i64) -> i64 {
        let Ok(mut map) = self.0.lock() else { return 0 };
        let entry = map.entry(key.to_string()).or_insert(0);
        *entry += delta;
        *entry
    }
}

fn kv_module(kv: Kv) -> impl Fn(&Lua) -> mlua::Result<Table> + Send + Sync + 'static {
    move |lua| {
        let table = lua.create_table()?;

        let store = kv.clone();
        table.set("get", lua.create_function(move |_, key: String| {
            Ok(store.get(&key))
        })?)?;

        let store = kv.clone();
        table.set("add", lua.create_function(move |_, (key, delta): (String, Option<i64>)| {
            Ok(store.add(&key, delta.unwrap_or(1)))
        })?)?;

        Ok(table)
    }
}
```

```rust
Server::builder().module("kv", kv_module(Kv::default()))
```

```lua
app:get("/inventory/:sku", function(req)
    return nitr.json({ count = nitr.ext.kv.get(req.params.sku) })
end)

app:put("/inventory/:sku", function(req)
    return nitr.json({ count = nitr.ext.kv.add(req.params.sku, tonumber(req:text())) })
end)
```

Unlike `nitr.cache`, which stores copies, this shares the real object.
It is the right place for a database pool, a Redis client or metrics.

> [!WARNING] Do not hold a lock across an `.await`
>
> It blocks every Lua state waiting for that lock. Lock, do the small
> thing, release.

## Async modules

`create_async_function` pauses the Lua code while the Rust future runs,
without blocking a thread or using up the execution budget:

```rust
.module("time", |lua| {
    let t = lua.create_table()?;
    t.set("sleep", lua.create_async_function(|_, ms: u64| async move {
        tokio::time::sleep(std::time::Duration::from_millis(ms)).await;
        Ok(())
    })?)?;
    Ok(t)
})
```

```lua
nitr.ext.time.sleep(1000)
```

This is how you pace an [SSE stream](../server/streaming#pacing-a-stream).

> [!WARNING] Call async functions from handlers only
>
> At the top level of a script, an async function fails the build.
> Call it from a handler or middleware. See
> [Errors](./errors#async-builtins-outside-the-executor).

## Error handling

Return an `mlua::Result`. A plain error reaches Lua with
`kind = "nitr"`, so an `on_error` handler cannot tell which module
failed. To report it as `kind = "module"` with `err.module` set, wrap
the error with the context `"module <name>"`, using your module's name:

```rust
t.set("parse", lua.create_function(|_, input: String| {
    input.parse::<i64>().map_err(|e| mlua::Error::WithContext {
        context: "module parse".into(), // "module " + module name
        cause: std::sync::Arc::new(mlua::Error::external(e)),
    })
})?)?;
```

```lua
app:on_error(function(err, req)
    if err.kind == "module" then
        nitr.log.error("extension failed", { module = err.module, error = err.message })
    end
    return nitr.error(500, { code = "INTERNAL" })
end)
```

Return errors rather than panicking; a panic becomes a `500` and the Lua
state is replaced. See [Errors](./errors#panics).

## Types across the boundary

mlua converts common types automatically:

| Rust                   | Lua             |
| ---------------------- | --------------- |
| `String`, `&str`       | `string`        |
| `i64`, `f64`, `u32`, … | `number`        |
| `bool`                 | `boolean`       |
| `Option<T>`            | `T` or `nil`    |
| `Vec<T>`               | array table     |
| `HashMap<String, T>`   | table           |
| `mlua::Table`          | `table`         |
| `()`                   | no return value |

Use a tuple for several arguments or return values, and `Option<T>` for
optional arguments:

```rust
lua.create_function(|_, (a, b): (String, Option<i64>)| {
    Ok((a.len() as i64, b.unwrap_or(0))) // two return values
})
```

For your own structs, implement `IntoLua` / `FromLua`, or build a table.

## Publishing an extension crate

An extension crate exports a function shaped like `kv_module` above:

```rust
// nitr-redis/src/lib.rs
pub fn module(client: RedisClient)
    -> impl Fn(&Lua) -> mlua::Result<Table> + Send + Sync + 'static
{
    move |lua| { /* … */ }
}
```

```rust
// the application's main.rs
Server::builder().module("redis", nitr_redis::module(client))
```

For crates that need to mount values themselves, the `nitr` crate also
exports:

| Item                            | Purpose                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `nitr::nitr_table(lua)`         | The global `nitr` table, created if missing                                  |
| `nitr::mount(lua, name, value)` | Mounts any Lua value at `nitr.ext.<name>`; an `Error::Script` if taken       |
| `nitr::ModuleFn`                | The module closure type: `dyn Fn(&Lua) -> mlua::Result<Table> + Send + Sync` |

Both functions return `nitr::Result`. For lower-level changes to each
state, see [`setup`](./server-builder#setup).

## Security

> [!DANGER] Modules are not sandboxed
>
> Module code runs as your process: it can read files, open connections
> and start threads. The sandbox applies to Lua only. Review extension
> crates like any other dependency. See [Security](../server/security).

Validate what Lua passes in, since it may come from a request:

```rust
t.set("read_asset", lua.create_function(|_, name: String| {
    if name.contains("..") || name.contains('/') {
        return Err(mlua::Error::RuntimeError("invalid asset name".into()));
    }
    std::fs::read_to_string(format!("assets/{name}"))
        .map_err(mlua::Error::external)
})?)?;
```

## Runnable example

The [`extension` example](../examples#extension) has a stateful `kv`
module and a stateless `slug` module, with four workers sharing one
counter:

```sh
cargo run --example extension

curl 'http://127.0.0.1:3000/inventory/widgets'
curl -X PUT 'http://127.0.0.1:3000/inventory/widgets' -d '7'
curl 'http://127.0.0.1:3000/slugify?title=Hello%20World'
```

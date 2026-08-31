# Extension Modules

The boundary that lets you build _Nitr + your own domain functions_
without forking Nitr.

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
nitr.ext.greet.hello("world")     -- → "Hello, world!"
```

## Depending on `mlua`

A module closure takes an `&mlua::Lua` and returns an `mlua::Table`, and
the `nitr` facade does **not** re-export `mlua`. Add it yourself, at the
version Nitr compiled against — a different major version is a different
crate, and its `Lua` will not be the one the builder expects:

```toml
[dependencies]
nitr = "0.0.0-beta.3"
mlua = { version = "0.12", features = ["lua54", "vendored", "async", "send"] }
```

`vendored` builds Lua from source rather than looking for a system one,
`send` is what makes the closure bounds (`Send + Sync + 'static`)
satisfiable, and `async` is needed for
[`create_async_function`](#async-modules).

## Why `nitr.ext.*`

Modules mount **one level below** the standard library, and that
placement is the whole design:

- **No builtin can ever collide with your module.** `nitr.*` may grow
  new names in any release; `nitr.ext.*` is reserved for you, forever.
- **The call site tells you whose code it is.** `nitr.time` is Nitr's,
  `nitr.ext.time` is your application's.
- **Two modules sharing a name fail at build time**, so extensions
  cannot silently shadow each other.

## What a module is

A closure `Fn(&Lua) -> mlua::Result<Table> + Send + Sync + 'static`, run
**once per pooled Lua state** and again on every reload. The table it
returns is mounted at `nitr.ext.<name>`.

The `Send + Sync + 'static` half is what lets the builder keep the
closure and apply it to every state, on whichever thread builds them —
so anything the closure captures must be shareable too. (The lower-level
[`Runtime::register_module`](./runtime) runs the closure immediately on
one state and asks for none of that.)

That per-state lifecycle is the thing to internalise: with four workers,
the closure runs four times, producing four independent Lua tables. If
they must share something, share it on the **Rust** side — see
[Stateful modules](#stateful-modules).

## Stateless module

Work that would be slow or awkward in Lua belongs on the Rust side of
the boundary:

```rust
use mlua::{Lua, Table};

fn slug_module(lua: &Lua) -> mlua::Result<Table> {
    let table = lua.create_table()?;
    table.set(
        "slugify",
        lua.create_function(|_, input: String| {
            let mut slug = String::with_capacity(input.len());
            let mut pending_dash = false;
            for ch in input.chars() {
                if ch.is_alphanumeric() {
                    if pending_dash && !slug.is_empty() {
                        slug.push('-');
                    }
                    pending_dash = false;
                    slug.extend(ch.to_lowercase());
                } else {
                    pending_dash = true;
                }
            }
            Ok(slug)
        })?,
    )?;
    Ok(table)
}
```

```rust
Server::builder().module("slug", slug_module)
```

> [!TIP] Mind the name
>
> `nitr.text` is already a builtin response helper — but that does not
> matter here, because your module lands at `nitr.ext.text`, not
> `nitr.text`. What _is_ refused is registering two of **your** modules
> under the same name.

## Stateful modules

The pooled states are isolated from each other, but a module can hand
them all a common Rust-side handle:

```rust
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use mlua::{Lua, Table};

/// A counter store shared by *every* Lua state.
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

/// This is the shape an extension crate (`nitr-postgres`, `nitr-redis`, …)
/// would export.
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

This is genuinely shared, unlike anything in Lua: `nitr.cache` holds
serialized copies, while a Rust handle is the real object. It is also
where a database pool, a Redis client or a metrics registry belongs.

> [!WARNING] Do not hold a lock across a suspension
>
> A `Mutex` held while an async operation awaits will stall every state
> that wants it. Lock, do the small thing, drop.

## Async modules

`create_async_function` suspends the state's coroutine on the tokio
runtime — costing no execution budget and blocking nothing:

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
nitr.ext.time.sleep(1000)      -- suspends, does not spin
```

This is how you pace an [SSE stream](../server/streaming#pacing-a-stream)
without burning the execution budget.

> [!WARNING] An async module function cannot be called at load time
>
> Suspending needs a coroutine the async executor is driving, and a
> script's **top level** does not have one — it is evaluated once at
> startup, outside the executor. Calling `nitr.ext.time.sleep(1000)`
> there fails the build with the same explanation Nitr gives for its own
> async builtins. Call it from a handler or a middleware. See
> [Errors](./errors#async-builtins-outside-the-executor).

## Error handling

Return an `mlua::Result`. A plain error propagates to Lua as an ordinary
error and is classified as `kind = "nitr"` — correct, but anonymous: the
handler cannot tell which extension failed.

```rust
// Works, but every failure looks like Nitr's.
t.set("parse", lua.create_function(|_, input: String| {
    input.parse::<i64>()
        .map_err(|e| mlua::Error::RuntimeError(format!("not a number: {e}")))
})?)?;
```

To be attributed, wrap the cause in an `mlua::Error::WithContext` whose
context is the literal string `module ` followed by your mount name.
That prefix is what the classifier looks for, and it is the only thing
that produces `kind = "module"` with `err.module` filled in:

```rust
t.set("parse", lua.create_function(|_, input: String| {
    input.parse::<i64>().map_err(|e| mlua::Error::WithContext {
        context: "module parse".into(),          // "module " + mount name
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

> [!TIP] Attribute your errors, or they become everyone's problem
>
> A module that returns an opaque string makes its failures
> indistinguishable from the server's. The wrapper costs two lines and
> turns "something in Nitr broke" into "your `parse` module broke, on
> this line".

## Types across the boundary

mlua converts the obvious things automatically:

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

Multiple returns use a tuple; optional arguments use `Option<T>`:

```rust
lua.create_function(|_, (a, b): (String, Option<i64>)| {
    Ok((a.len() as i64, b.unwrap_or(0)))       // returns two values
})
```

For your own structs, implement `IntoLua` / `FromLua`, or build a table
by hand.

## Publishing an extension crate

A third-party extension is nothing more than a public function shaped
like `kv_module` above:

```rust
// nitr-redis/src/lib.rs
pub fn module(client: RedisClient)
    -> impl Fn(&Lua) -> mlua::Result<Table> + Send + Sync + 'static
{
    move |lua| { /* … */ }
}
```

```rust
// the user's main.rs
Server::builder().module("redis", nitr_redis::module(client))
```

No fork, no patch, no upstream coordination. The extension contract —
`ServerBuilder::module`, `nitr_table`, `mount`, `ModuleFn` — is the part
of the pre-1.0 API expected to settle first.

## The low-level helpers

Exported for extension crates that need to mount something themselves:

| Item                            | Purpose                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `nitr::nitr_table(lua)`         | The global `nitr` namespace table, created on first use                      |
| `nitr::mount(lua, name, value)` | Mounts a value at `nitr.ext.<name>`, failing when the name is taken          |
| `nitr::ModuleFn`                | The module closure type: `dyn Fn(&Lua) -> mlua::Result<Table> + Send + Sync` |

Both functions return `nitr::Result`, not `mlua::Result` — mounting is a
Nitr-level operation, and a collision is an `Error::Script` naming the
key that was already taken.

`mount` takes anything that is `IntoLua`, not only a table, so a module
can expose a callable userdata or a single function if a table would be
ceremony. The table is the Lua module convention, and what
`ServerBuilder::module` requires.

### `setup()`, one level lower still

`ServerBuilder::setup(f)` is the escape hatch behind `module()`: an
`Fn(&Lua) -> mlua::Result<()>` that runs once per pooled state, **before**
the configuration script and the handler are loaded. It touches the state
directly, so nothing stops it from writing outside `nitr.ext` — which is
also why `module()` is the one to reach for first.

```rust
Server::builder().setup(|lua| {
    // Anything the state needs before any script sees it.
    lua.set_named_registry_value("my.build_id", env!("CARGO_PKG_VERSION"))?;
    Ok(())
})
```

## Security

> [!DANGER] A module is not sandboxed
>
> `ServerBuilder::module` code **is your process**. It can open files,
> spawn threads, make network calls and read anything. The sandbox
> exists for Lua, not for Rust.
>
> This is a deliberate boundary, and it is documented as one in the
> [threat model](../server/security#what-it-does-not-defend-against): a
> malicious extension module is out of scope. Vet the extension crates
> you depend on the way you vet any dependency that runs in-process.

What you _should_ do at that boundary is validate what Lua hands you.
A module receiving a path or a URL from a handler is receiving something
that may have originated in a request:

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

The repository's [`extension` example](./examples#extension) is the full
version of everything on this page — a stateful `kv` module, a stateless
`slug` module, and the Lua that uses both. It runs with `.workers(4)`,
so the shared counter demonstrably lives on the Rust side rather than in
one state's Lua table:

```sh
cargo run --example extension

curl 'http://127.0.0.1:3000/inventory/widgets'
curl -X PUT 'http://127.0.0.1:3000/inventory/widgets' -d '7'
curl 'http://127.0.0.1:3000/slugify?title=Hello%20World'
```

The source is at
[`crates/nitr/examples/extension`](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples/extension).

# The Lua Runtime

`nitr::Runtime` is the sandboxed Lua state **without any HTTP**. Use it
when you want Nitr's safety properties — memory ceiling, execution
budget, restricted stdlib, confined `require` — for scripting that has
nothing to do with serving requests.

> [!TIP] You probably want `Server` instead
>
> If you are building a web server, use
> [`Server::builder()`](./server-builder). `Runtime` is the layer
> underneath it, for embedding scripting in something that is not a
> server: a job runner, a rules engine, a plugin host.

## Creating one

```rust
use nitr::{Runtime, RuntimeOpts};

let rt = Runtime::new()?;                     // sensible defaults
```

```rust
let rt = Runtime::new_with(RuntimeOpts {
    memory_limit: Some(8 * 1024 * 1024),      // bytes
    exec_timeout: Some(std::time::Duration::from_secs(30)),
    script_dir: Some("scripts".into()),       // where `require` is confined
    dev_mode: false,
    ..Default::default()
})?;
```

## `RuntimeOpts`

| Field          | Meaning                                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `stdlib`       | Which Lua standard libraries to load. `io` and `os` are excluded by default                                                                                                    |
| `memory_limit` | Lua memory limit in bytes                                                                                                                                                      |
| `exec_timeout` | Budget per invocation, enforced by an instruction-count hook (CPU-bound loops) **and** an outer async timeout (slow I/O). `None` disables both                                 |
| `script_dir`   | The directory `require` is confined to: `package.path` is pinned to it and `package.cpath` is cleared, so no native modules can load. `None` leaves the Lua defaults untouched |
| `dev_mode`     | Reload the script before each call, and include Lua tracebacks in errors                                                                                                       |

> [!WARNING] `exec_timeout: None` removes the CPU-exhaustion defense
>
> An infinite loop then runs forever. Only disable it for scripts you
> fully control.

## Methods

| Method                                    | Purpose                                                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `register_module(name, f)`                | Mounts a table at `nitr.ext.<name>`, as [`ServerBuilder::module`](./extension-modules) does               |
| `register_cfg_fn(path, args)`             | Loads and runs a configuration script, with varargs                                                       |
| `call_function(...)`                      | Calls a Lua function under the execution budget                                                           |
| `call_function_streaming(...)`            | The same, for a function producing a stream                                                               |
| `lua()`                                   | The underlying `mlua::Lua`                                                                                |
| `cfg()`                                   | The configuration table, if a config script ran                                                           |
| `cfg_snapshot()` / `set_cfg_snapshot(..)` | Serialize the config table, and restore it into another state — how a snapshot reaches every pooled state |
| `deadline_handle()`                       | A [`DeadlineHandle`](#extending-the-budget-mid-stream) for extending the budget                           |
| `is_poisoned()` / `poison()`              | Whether the state is unfit for reuse                                                                      |

## Poisoning

A state that hit its memory limit, or was running when a panic was
caught, is **poisoned**: its heap sits at the ceiling, or its invariants
are unknown, so the next call would inherit the problem.

```rust
if rt.is_poisoned() {
    // rebuild it; do not reuse
}
```

Ordinary script errors are **not** damage — Lua unwinds cleanly and the
state is fine. `Error::poisons_state()` makes the distinction:

```rust
match result {
    Err(e) if e.poisons_state() => rebuild(),
    Err(e) => log_and_continue(e),
    Ok(v) => v,
}
```

The `RuntimePool` inside `Server` does exactly this for you.

## Extending the budget mid-stream

A streaming response would otherwise have to finish within one execution
budget. `DeadlineHandle::extend()` grants another full budget from now,
so the limit applies **per chunk-production slice** rather than to the
whole stream's lifetime:

```rust
let deadline = rt.deadline_handle();
// …each time a chunk is handed to the client:
deadline.extend();
```

A no-op when the runtime has no execution timeout configured. This is
what keeps a legitimately long stream from being killed while still
bounding any single slice of Lua work.

## The state pool

`RuntimePool` manages the fixed set of independent states a server
checks out from. `Server::pool()` exposes it. Building your own pool is
possible but rarely what you want — the server already does the
checkout, the poisoning check and the rebuild.

## A worked example: a sandboxed job runner

```rust
use nitr::{Runtime, RuntimeOpts};

async fn run_user_script(source: &str, input: serde_json::Value) -> nitr::Result<String> {
    let rt = Runtime::new_with(RuntimeOpts {
        memory_limit: Some(4 * 1024 * 1024),
        exec_timeout: Some(std::time::Duration::from_secs(5)),
        script_dir: None,                 // no require at all
        ..Default::default()
    })?;

    // Give the script exactly the capabilities you intend it to have.
    rt.register_module("io", |lua| {
        let t = lua.create_table()?;
        t.set("emit", lua.create_function(|_, line: String| {
            tracing::info!(%line, "script output");
            Ok(())
        })?)?;
        Ok(t)
    })?;

    let f: mlua::Function = rt.lua().load(source).eval()?;
    rt.call_function(f, input_to_lua(input)?).await
}
```

The script gets a 4 MiB heap, five seconds, no filesystem, no process
access, no `require`, and exactly one function you chose to expose.
A `while true do end` in it stops on schedule.

## The stability caveat

`Runtime`, `RuntimeOpts`, `RuntimePool` and friends are re-exported by
the `nitr` facade, but they come from `nitr-core`, which is
[explicitly unstable pre-1.0](../stability). The `Server` layer above
them is the surface expected to settle first.

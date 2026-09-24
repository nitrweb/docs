# The Lua Runtime

`nitr::Runtime` is Nitr's sandboxed Lua state **without HTTP**: a memory
limit, an execution time limit, a reduced standard library and a
restricted `require`. Use it to run scripts in something that is not a
web server, such as a job runner, a rules engine or a plugin host. For a
web server, use [`Server::builder()`](./server-builder).

## Creating one

`Runtime::new()` gives an 8 MiB heap, a 30-second execution limit, and
the `math`, `table`, `string`, `utf8` and `coroutine` libraries on top
of the base library. It does not include `package`, so `require` is not
available.

```rust
use nitr::Runtime;

let mut rt = Runtime::new()?;
```

For anything else, use `Runtime::new_with`:

```rust
use std::time::Duration;

use mlua::StdLib;
use nitr::{Runtime, RuntimeOpts};

let mut rt = Runtime::new_with(RuntimeOpts {
    libs: StdLib::MATH
        | StdLib::TABLE
        | StdLib::STRING
        | StdLib::COROUTINE
        | StdLib::PACKAGE,
    memory_limit: 8 * 1024 * 1024,               // bytes
    exec_timeout: Some(Duration::from_secs(30)),
    package_dir: Some("scripts".into()),         // where `require` looks
    extra_package_dirs: Vec::new(),              // more `require` directories
    dev_mode: false,
})?;
```

`RuntimeOpts` has no `Default`, so every field must be set explicitly.
You need `mlua` as a dependency to name `StdLib`; see [Depending on
`mlua`](./extension-modules#depending-on-mlua).

## `RuntimeOpts`

| Field                | Type               | Meaning                                                                                                                                 |
| -------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `libs`               | `mlua::StdLib`     | Lua standard libraries to load. Nitr's own defaults leave out `io`, `os`, `debug` and `package`.                                        |
| `memory_limit`       | `usize`            | Lua heap limit in bytes.                                                                                                                |
| `exec_timeout`       | `Option<Duration>` | Time limit per call, for both CPU loops and slow I/O. `None` disables it.                                                               |
| `package_dir`        | `Option<PathBuf>`  | The only directory `require` loads from.                                                                                                |
| `extra_package_dirs` | `Vec<PathBuf>`     | More directories for `require`, searched after `package_dir`. Ignored without `package_dir`. `nitr test` adds its tests directory here. |
| `dev_mode`           | `bool`             | Reload the handler script before each call and include Lua tracebacks in errors.                                                        |

Whatever the options, every state:

- has no `collectgarbage`;
- has no `dofile` or `loadfile`, unless `StdLib::IO` is loaded;
- cannot load native (C) modules, even with `StdLib::PACKAGE`.

> [!WARNING] `exec_timeout: None` allows infinite loops
>
> A script that never ends then runs forever. Only use it for scripts
> you fully control.

## Methods

| Method                                    | Purpose                                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| `register_module(name, f)`                | Mounts a table at `nitr.ext.<name>`, like [`ServerBuilder::module`](./extension-modules) |
| `register_cfg_fn(path, args).await`       | Runs a configuration script, passing `args` as its `...`                                 |
| `eval_script(path)`                       | Loads and runs a script file and returns its value                                       |
| `call_function(f, args).await`            | Calls a Lua function within the time limit                                               |
| `call_function_streaming(f, args).await`  | The same for streaming output; time spent waiting on the client is not limited           |
| `lua()`                                   | The underlying `mlua::Lua`                                                               |
| `cfg()`                                   | The configuration table, if a config script ran                                          |
| `cfg_snapshot()` / `set_cfg_snapshot(..)` | Copy the configuration table out of one state and into another                           |
| `deadline_handle()`                       | A [`DeadlineHandle`](#extending-the-time-limit) to extend the time limit                 |
| `dev_mode()`                              | Whether the state runs in development mode                                               |
| `is_poisoned()` / `poison()`              | Whether the state should be discarded, and how to mark it                                |

Async builtins (such as `nitr.fetch` or `password_hash`) work inside
`call_function`, but not in code run by `eval_script` at the top level.
See [Errors](./errors#async-builtins-outside-the-executor).

## Poisoning

A state that hit its memory limit, or was running when a Rust panic was
caught, is **poisoned** and must not be reused. Ordinary Lua errors do
not poison a state.

```rust
match result {
    Err(e) if e.poisons_state() => { /* discard the state and build a new one */ }
    Err(e) => { /* log it; the state is fine */ }
    Ok(v) => { /* use v */ }
}
```

`call_function` marks the state for you, so `rt.is_poisoned()` is
already `true` when you see the error. Inside a `Server`, the pool
replaces poisoned states automatically.

## Extending the time limit

For long streams, call `DeadlineHandle::extend()` each time you send a
chunk. It restarts the time limit, so the limit applies to each chunk
rather than the whole stream. It does nothing when there is no
`exec_timeout`. `DeadlineHandle` is `Clone`.

```rust
let deadline = rt.deadline_handle();
// each time a chunk is sent:
deadline.extend();
```

## The state pool

`RuntimePool` is the fixed set of states a server uses. `Server::pool()`
returns it.

| Method                      | Purpose                                                                |
| --------------------------- | ---------------------------------------------------------------------- |
| `new(runtimes)`             | A pool of the given states                                             |
| `with_rebuild(runtimes, f)` | The same, plus a function to replace a poisoned state                  |
| `size()` / `available()`    | Total states, and how many are free now                                |
| `get().await`               | Waits for a free state (first come, first served)                      |
| `get_timeout(wait).await`   | The same, but returns `None` after `wait`; a zero `wait` waits forever |

Both return a `RuntimeGuard`, which gives access to the `Runtime` and
returns it to the pool when dropped. You rarely need to build a pool
yourself.

## Example: a sandboxed job runner

```rust
use std::time::Duration;

use mlua::StdLib;
use nitr::{Runtime, RuntimeOpts};

async fn run_user_script(source: &str, input: String) -> nitr::Result<String> {
    let mut rt = Runtime::new_with(RuntimeOpts {
        libs: StdLib::MATH | StdLib::TABLE | StdLib::STRING | StdLib::COROUTINE,
        memory_limit: 4 * 1024 * 1024,
        exec_timeout: Some(Duration::from_secs(5)),
        package_dir: None, // no PACKAGE, so no `require`
        extra_package_dirs: Vec::new(),
        dev_mode: false,
    })?;

    // The only capability the script gets: nitr.ext.out.emit(line)
    rt.register_module("out", |lua| {
        let t = lua.create_table()?;
        t.set("emit", lua.create_function(|_, line: String| {
            tracing::info!(%line, "script output");
            Ok(())
        })?)?;
        Ok(t)
    })?;

    let f: mlua::Function = rt.lua().load(source).eval()?;
    rt.call_function(f, input).await
}
```

The script gets a 4 MiB heap, five seconds, no file or process access,
and one function you chose. A `while true do end` in it stops after five
seconds.

`Runtime` and the pool types come from `nitr-core`, which is [unstable
before 1.0](../stability).

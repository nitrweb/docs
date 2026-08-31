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

`Runtime::new()` is the safe default: an 8 MiB heap, a 30-second
execution budget, and `math`/`table`/`string`/`utf8`/`coroutine` on top
of the base library.

```rust
use nitr::Runtime;

let mut rt = Runtime::new()?;
```

`package` is **not** among the defaults, so `require` is unavailable.
That is not an oversight: confining `require` needs a directory to pin
it to, and a no-argument constructor has no way to name one. A default
that is safe but less capable is the right default for a library — opt
in through `new_with`.

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
    memory_limit: 8 * 1024 * 1024,                 // bytes
    exec_timeout: Some(Duration::from_secs(30)),
    package_dir: Some("scripts".into()),           // confines `require`
    dev_mode: false,
})?;
```

> [!NOTE] `RuntimeOpts` has no `Default`
>
> Every field must be spelled out. Each one is a security decision —
> which libraries a script can reach, how much heap it may take, whether
> a loop can run forever — and a struct-update `..Default::default()`
> would let a new field arrive silently with a value nobody chose.

`mlua` is not re-exported by the `nitr` facade, so a program that names
`StdLib` (or writes an [extension module](./extension-modules)) depends
on it directly. It has to be the same crate Nitr compiled against, or
the `Lua` and `Table` types will not be the ones the API expects:

```toml
[dependencies]
nitr = "0.0.0-beta.3"
mlua = { version = "0.12", features = ["lua54", "vendored", "async", "send"] }
```

## `RuntimeOpts`

| Field          | Type               | Meaning                                                                                                                                        |
| -------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs`         | `mlua::StdLib`     | Which Lua standard libraries to load. `io`, `os`, `debug` and `package` are simply not in the set Nitr's own defaults use                      |
| `memory_limit` | `usize`            | Lua heap ceiling in bytes, enforced by the allocator                                                                                           |
| `exec_timeout` | `Option<Duration>` | Budget per invocation, enforced by an instruction-count hook (CPU-bound loops) **and** an outer async timeout (slow I/O). `None` disables both |
| `package_dir`  | `Option<PathBuf>`  | The directory `require` is pinned to. `None` skips only the pinning — see below                                                                |
| `dev_mode`     | `bool`             | Development mode: reload the handler script before each call and include Lua tracebacks in errors                                              |

### What is scrubbed regardless of the options

Three things happen to every state Nitr builds, whatever you pass:

- **`collectgarbage` is removed.** The memory limit is enforced by the
  allocator, not the collector, so `collectgarbage("stop")` cannot
  escape it — it only reaches the ceiling sooner and poisons the state.
  It goes because no script has business pacing the collector, and
  `collectgarbage("count")` is a heap oracle.
- **`dofile` and `loadfile` are removed unless `StdLib::IO` was
  requested.** They live in the always-loaded base library, and reading
  and executing an arbitrary file is exactly the ambient authority `io`
  gates. They follow the same opt-in.
- **No `package`-bearing state can load native modules.**
  `package.loadlib` is cleared and `package.cpath` is emptied whenever
  `StdLib::PACKAGE` is present, confined directory or not. mlua's safe
  constructor already stubs those, so this is defense in depth — the
  scrub Nitr owns and tests.

Only the `package.path` pinning is conditional: with no `package_dir`
there is nothing to pin to.

> [!WARNING] `exec_timeout: None` removes the CPU-exhaustion defense
>
> An infinite loop then runs forever. Only disable it for scripts you
> fully control.

## Methods

| Method                                    | Purpose                                                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `register_module(name, f)`                | Mounts a table at `nitr.ext.<name>`, as [`ServerBuilder::module`](./extension-modules) does               |
| `register_cfg_fn(path, args).await`       | Loads and runs a configuration script, passing `args` as its varargs                                      |
| `eval_script(path)`                       | Loads and evaluates a script file, returning its value — the caller decides what shape to expect          |
| `call_function(f, args).await`            | Calls a Lua function under the execution budget                                                           |
| `call_function_streaming(f, args).await`  | The same, for a function producing a stream (no outer async timeout)                                      |
| `lua()`                                   | The underlying `mlua::Lua`                                                                                |
| `cfg()`                                   | The configuration table, if a config script ran                                                           |
| `cfg_snapshot()` / `set_cfg_snapshot(..)` | Serialize the config table, and restore it into another state — how a snapshot reaches every pooled state |
| `deadline_handle()`                       | A [`DeadlineHandle`](#extending-the-budget-mid-stream) for extending the budget                           |
| `dev_mode()`                              | Whether this state was built in development mode                                                          |
| `is_poisoned()` / `poison()`              | Whether the state is unfit for reuse, and how to mark it so                                               |

`call_function`, `call_function_streaming`, `register_cfg_fn`,
`set_cfg_snapshot` and `poison` take `&mut self`: a state is used
exclusively by one caller at a time, which is exactly what the pool
hands out.

## Async builtins run on the call's coroutine

`call_function` runs `f` on a coroutine the async executor drives, and
that coroutine is what an asynchronous builtin suspends into. It is a
**cached** coroutine, reset and reused between calls rather than
allocated per invocation, and the instruction-count hook is installed on
the state globally — so a `coroutine.create` the script makes itself
inherits the budget instead of escaping it.

`eval_script` is the other shape: it calls the chunk **synchronously**.
Nothing is driving a coroutine there, so an async builtin evaluated at a
script's top level has nothing to suspend into and fails.

The VM's own words for that are `attempt to yield from outside a
coroutine`, which name neither the call nor the fix. Nitr replaces them:

```text
script error: `password_hash` is asynchronous and cannot be called here.
A script's top level runs once at startup, outside the async executor, …
Call it from inside a handler or a middleware instead.
  --> app.lua:3
```

The translation lives in the error classifier, not in any one builtin,
so every async builtin reports the same way. See
[Errors](./errors#async-builtins-outside-the-executor).

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

`call_function` applies this itself: a failing call that poisons marks
the state before returning, so `is_poisoned()` is already true by the
time you see the error. The `RuntimePool` inside `Server` then acts on
it for you.

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
bounding any single slice of Lua work. `DeadlineHandle` is `Clone`, so
the streaming task can own one while the runtime goes on working.

`call_function_streaming` is the matching call: it sets the
instruction-hook deadline but installs **no** outer async timeout, so
time spent suspended waiting on a slow client is deliberately unbounded
— it is the client's pace, not the script's CPU.

## The state pool

`RuntimePool` is the fixed set of independent states a server checks out
from, over an MPMC channel. `Server::pool()` exposes it.

| Method                      | Purpose                                                                      |
| --------------------------- | ---------------------------------------------------------------------------- |
| `new(runtimes)`             | A pool over the given states                                                 |
| `with_rebuild(runtimes, f)` | The same, plus how to replace a state a request left poisoned                |
| `size()` / `available()`    | Total states, and how many are idle right now                                |
| `get().await`               | Check one out, waiting fairly (FIFO) until one is free                       |
| `get_timeout(wait).await`   | The same, giving up after `wait` and returning `None` so the caller can shed |

The channel **is** the backpressure mechanism: when every state is busy,
`get()` queues. `get_timeout` is what turns an overloaded server into a
503 instead of an unbounded queue — a zero duration disables the bound
and waits like `get()`.

Checkout returns a `RuntimeGuard`, which derefs to the `Runtime` and
sends it back on drop. A guard dropped mid-unwind is treated as damaged
even though nothing marked it: the panic escaped before any code could,
and recycling a state that was in fact fine costs one rebuild.

Building your own pool is possible but rarely what you want — the server
already does the checkout, the poisoning check and the rebuild.

## A worked example: a sandboxed job runner

```rust
use std::time::Duration;

use mlua::StdLib;
use nitr::{Runtime, RuntimeOpts};

async fn run_user_script(source: &str, input: String) -> nitr::Result<String> {
    let mut rt = Runtime::new_with(RuntimeOpts {
        libs: StdLib::MATH | StdLib::TABLE | StdLib::STRING | StdLib::COROUTINE,
        memory_limit: 4 * 1024 * 1024,
        exec_timeout: Some(Duration::from_secs(5)),
        // No PACKAGE above, so there is no `require` to confine.
        package_dir: None,
        dev_mode: false,
    })?;

    // Give the script exactly the capabilities you intend it to have.
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

The script gets a 4 MiB heap, five seconds, no filesystem, no process
access, no `require`, and exactly one function you chose to expose —
reachable as `nitr.ext.out.emit(...)`, because modules mount one level
below the standard library. A `while true do end` in it stops on
schedule.

## The stability caveat

`Runtime`, `RuntimeOpts`, `RuntimePool`, `RuntimeGuard` and
`DeadlineHandle` are re-exported by the `nitr` facade, but they come
from `nitr-core`, which is [explicitly unstable
pre-1.0](../stability). The `Server` layer above them is the surface
expected to settle first.

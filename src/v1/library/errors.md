# Errors (Library)

Nitr's Rust API returns a typed `nitr::Error` and the alias
`nitr::Result`.

```rust
#[tokio::main]
async fn main() -> nitr::Result {
    Server::builder().handler_script("app.lua").build().await?.serve().await
}
```

`nitr::Result` is `Result<(), nitr::Error>`; `nitr::Result<T>` carries a
value.

## `nitr::Error`

| Variant              | Meaning                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `Lua(mlua::Error)`   | An error raised by the Lua runtime or a script                                                                                      |
| `Config(String)`     | An invalid or missing configuration value                                                                                           |
| `Script(String)`     | A script file could not be loaded or evaluated                                                                                      |
| `Io(std::io::Error)` | An I/O error                                                                                                                        |
| `Http(http::Error)`  | An HTTP protocol error                                                                                                              |
| `Timeout`            | The handler exceeded its execution budget                                                                                           |
| `PoolBusy`           | No Lua state became available within the pool wait budget; the request was shed rather than queued indefinitely                     |
| `Panic(String)`      | A panic was caught while running a request. **Always a bug in Rust code** — Nitr's or an extension module's — never in a Lua script |
| `ShutdownTimeout`    | The drain deadline expired with connections still in flight, so they were aborted                                                   |

`Lua`, `Io` and `Http` carry `#[from]` conversions, so `?` works on
`mlua::Error`, `std::io::Error` and `http::Error` inside a function
returning `nitr::Result`.

```rust
use nitr::Error;

match server.serve().await {
    Ok(()) => {}
    Err(Error::ShutdownTimeout) => {
        tracing::error!("drain truncated: a client request was cut");
        std::process::exit(1);
    }
    Err(e) => return Err(e),
}
```

> [!NOTE] `ShutdownTimeout` is surfaced, not swallowed
>
> A truncated shutdown means a client's request was cut. Exiting `0`
> there would hide it from a supervisor — which is why the binary exits
> non-zero, and why your program should too.

## `poisons_state()`

Whether an error leaves the Lua state unfit for reuse. Exactly two
things qualify:

| Error                            | Poisons | Why                                                                       |
| -------------------------------- | ------- | ------------------------------------------------------------------------- |
| `Panic(_)`                       | yes     | The state was mid-call when the stack unwound; its invariants are unknown |
| `Lua(_)` wrapping a memory error | yes     | The allocator refused and the heap sits at its ceiling                    |
| everything else                  | no      | Lua unwound cleanly and the state is fine                                 |

```rust
if err.poisons_state() {
    // the state's heap is at its ceiling, or its invariants are unknown
}
```

The memory case is checked by walking the mlua error chain, because a
`MemoryError` is routinely wrapped in `CallbackError`/`WithContext`
layers by the time it surfaces. A `Timeout` deliberately does **not**
poison: a script that ran too long left nothing broken behind it.

The pool inside `Server` already acts on this — poisoned states are
dropped and rebuilt, never handed to another request. See
[`Runtime`](./runtime#poisoning).

## `ErrorInfo` — the classified view

`ErrorInfo` is the structured form of a failure: what broke, where, and
why, as separate fields instead of one interpolated string. It is what a
Lua `on_error` handler receives, and what the structured log line
carries.

> [!NOTE] `ErrorInfo` lives in `nitr-core`
>
> The `nitr` facade re-exports `Error` and `Result`, but not
> `ErrorInfo`, `message_token` or `source_snippet`. A program that names
> them adds `nitr-core = "0.0.0-beta.5"` and writes
> `nitr_core::ErrorInfo`. That crate is
> [explicitly unstable pre-1.0](../stability); most embedders never need
> the type, because the same fields reach Lua as a plain table.

| Field       | Type             | Meaning                                                                              |
| ----------- | ---------------- | ------------------------------------------------------------------------------------ |
| `kind`      | `&'static str`   | `"lua"`, `"nitr"`, `"module"`, `"timeout"`, `"memory"`, `"panic"` — a **closed set** |
| `message`   | `String`         | The message, with any position prefix and traceback stripped                         |
| `source`    | `Option<String>` | The failing chunk — the script path, when it was loaded from a file                  |
| `line`      | `Option<u32>`    | The failing line within `source`                                                     |
| `module`    | `Option<String>` | The failing module (`"nitr.db"`, or an extension's mount name)                       |
| `traceback` | `Option<String>` | Bounded Lua call stack, innermost first — at most 12 frames                          |
| `cause`     | `Vec<String>`    | Bounded underlying error chain — at most 5 entries                                   |

Two constructors and two renderers:

| Item                          | Purpose                                                             |
| ----------------------------- | ------------------------------------------------------------------- |
| `ErrorInfo::from_error(&err)` | Classifies a `nitr::Error`, keeping its full Rust cause chain       |
| `ErrorInfo::from_message(s)`  | Classifies bare text — what a Lua `pcall` catches from an `error()` |
| `info.concise()`              | `kind: message (source:line)` — the production single-line form     |
| `info.concise_colored()`      | The same with ANSI color, for a terminal only                       |

Three design notes worth knowing:

**It is built on the error path only.** The happy path never constructs
one. Classification parses what mlua already captured at raise time —
position-prefixed messages and tracebacks — so it adds no capture cost.

**Everything is bounded.** Deep stacks repeat the same application
frames, and an error firing in a loop must not turn each failure into a
page of output.

**The kinds are a closed set.** Lua cannot forge a `kind`, so branching
on it is stable in a way matching on message text never is.

### How a kind is decided

| Error                                | `kind`    |
| ------------------------------------ | --------- |
| `Timeout`, or the budget hook firing | `timeout` |
| a Lua memory error                   | `memory`  |
| `Panic(_)`                           | `panic`   |
| `PoolBusy`, and every other variant  | `nitr`    |
| an error crossing the Rust boundary  | `nitr`    |
| a `module <name>` context wrapper    | `module`  |
| anything else raised by a script     | `lua`     |

The execution-budget hook fires _inside_ the VM, so its failure arrives
as an ordinary Lua error and is reclassified by its message — which is
why a runaway loop reports `kind = "timeout"` rather than `"lua"`.

## Async builtins outside the executor

Every builtin that awaits — `nitr.fetch`, the `nitr.db` methods,
`nitr.crypto.password_hash` and its two siblings, `req:multipart`,
`req:text` — is a Lua function that **yields**, and a yield needs a
coroutine the async executor is driving. A script's top level does not
have one: it is evaluated once at startup, outside the executor.

```lua
-- Does NOT work at the top level of a handler script.
local users = { ada = nitr.crypto.password_hash("lovelace") }
```

The VM's own words for this are `attempt to yield from outside a
coroutine`, which name neither the call nor the fix. Classification
replaces them, naming the builtin from the traceback where it can:

```text
script error: `password_hash` is asynchronous and cannot be called here.
A script's top level runs once at startup, outside the async executor, …
Call it from inside a handler or a middleware instead. … `nitr
hash-password` mints a password hash to paste into a table, for instance
  --> app.lua:3
```

It is classified as `kind = "nitr"`, and it stops the **build**: the
handler script is evaluated during `Server::build()`, so this never
reaches a request.

> [!TIP] Compute it ahead of time, not at boot
>
> A value the script needs at load time has to come from somewhere that
> is not an async builtin. For a credential that means
> [`nitr hash-password`](../server/passwords), whose whole reason to
> exist is minting a hash to paste into a table.

A script that raises those exact words itself through `error()` keeps
them: its traceback shows the `error` call where the genuine failure's
shows the yield.

## Panic containment

A panic in Rust code is caught at the **request boundary**:

- the response is `500`;
- the Lua state that was in use is recycled, not reused;
- the process and every other connection survive.

This is a last-resort safety net for genuine bugs, not something an
application can or should trigger deliberately. If you write an
[extension module](./extension-modules), a panic in it is _your_ bug and
will surface as `Error::Panic` and `kind = "panic"`.

Prefer returning `mlua::Error` from module functions:

```rust
// ❌ panics on bad input — becomes a contained 500 and a poisoned state
t.set("parse", lua.create_function(|_, s: String| {
    Ok(s.parse::<i64>().unwrap())
})?)?;

// ✅ a normal error, classified as kind = "module"
t.set("parse", lua.create_function(|_, s: String| {
    s.parse::<i64>().map_err(|e| mlua::Error::RuntimeError(format!("not a number: {e}")))
})?)?;
```

## Errors from `build()`

Everything that can be validated is validated in `build()` — a missing
script, an unknown configuration key, a contradictory setting, a builtin
that was not compiled in, a pending migration, an async builtin at a
script's top level. They arrive as `Error::Config` or `Error::Script`
with a message naming the problem, before a port is bound.

```rust
match Server::builder().config(cfg).build().await {
    Ok(server) => server.serve().await,
    Err(e) => {
        eprintln!("cannot start: {e}");
        std::process::exit(1);
    }
}
```

An `Error::Script` from a load failure already carries its own
diagnostic: the message, an annotated source snippet with a caret under
the offending token, and the traceback when there is one. Printing `{e}`
is enough.

## Rendering diagnostics

`nitr::diag` is the painting layer the CLI uses — coloured source
snippets and tracebacks on a terminal, byte-clean plain text through a
pipe. Error values themselves carry **plain text everywhere**, because
the same strings serve HTTP dev-page bodies, log files and `err.message`
in Lua; colour is added only at a print boundary.

| Item                          | Purpose                                                         |
| ----------------------------- | --------------------------------------------------------------- |
| `set_console_colors(bool)`    | Declare, once, whether console output may carry ANSI            |
| `console_colors()`            | What that switch is set to                                      |
| `paint(text)`                 | Paint a whole multi-line diagnostic                             |
| `paint_line(line)`            | Paint one line, recognized by shape                             |
| `console_ok` / `console_fail` | Success and failure markers, painted only when the switch is on |

```rust
nitr::diag::set_console_colors(std::io::IsTerminal::is_terminal(&std::io::stdout()));
```

Call it from wherever you initialize the logging subscriber — that is
the one place that knows the log format (JSON must never carry ANSI),
the destination, and the user's `NO_COLOR` preference. An embedder that
installs no such formatter gets plain text everywhere, which is the
right default: nobody should receive escape codes they did not ask for.

## What the Lua side sees

The Rust `Error` and the Lua error table are two views of the same
failure. The table mirrors `ErrorInfo` field for field — `kind`,
`message`, `source`, `line`, `module`, `traceback`, `cause` — plus a
`pretty` string, and it stringifies (and concatenates) as the concise
`kind: message (source:line)` form:

```lua
app:on_error(function(err, req)
    -- err.kind is the same closed set as ErrorInfo.kind
    if err.kind == "timeout" then
        return nitr.error(504, { code = "TIMEOUT" })
    end
    nitr.log.error(tostring(err))       -- the concise form, plain text
    return nitr.error(500, { code = "INTERNAL" })
end)
```

`nitr.errinfo(caught)` runs the same classifier over an error a `pcall`
caught, so a handler can inspect a failure it chose to contain rather
than propagate.

See [Server → Errors](../server/errors) for the application-side story.

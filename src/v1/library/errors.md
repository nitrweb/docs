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

Whether an error leaves the Lua state unfit for reuse:

```rust
if err.poisons_state() {
    // the state's heap is at its ceiling, or its invariants are unknown
}
```

A memory-limit hit is the clear case: the allocator refused, the heap
sits at the ceiling, and the next request would inherit the problem.
Ordinary script errors are **not** damage — Lua unwinds cleanly and the
state is fine.

The pool inside `Server` already acts on this: poisoned states are
dropped and rebuilt, never handed to another request.

## `ErrorInfo` — the classified view

`nitr::diag::ErrorInfo` is the structured form of a failure: what broke,
where, and why, as separate fields instead of one interpolated string.
It is what a Lua `on_error` handler receives, and what the structured
log line carries.

| Field       | Meaning                                                                              |
| ----------- | ------------------------------------------------------------------------------------ |
| `kind`      | `"lua"`, `"nitr"`, `"module"`, `"timeout"`, `"memory"`, `"panic"` — a **closed set** |
| `message`   | The message, with any position prefix and traceback stripped                         |
| `source`    | The failing chunk, when known                                                        |
| `line`      | The failing line, when known                                                         |
| `module`    | The failing module, when attributed                                                  |
| `traceback` | Bounded Lua call stack, innermost first                                              |
| `cause`     | Bounded underlying error chain                                                       |

Two design notes worth knowing:

**It is built on the error path only.** The happy path never constructs
one. Classification parses what mlua already captured at raise time —
position-prefixed messages and tracebacks — so it adds no capture cost.

**Everything is bounded.** Deep stacks repeat the same application
frames, and an error firing in a loop must not turn each failure into a
page of output.

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
that was not compiled in, a pending migration. They arrive as
`Error::Config` or `Error::Script` with a message naming the problem,
before a port is bound.

```rust
match Server::builder().config(cfg).build().await {
    Ok(server) => server.serve().await,
    Err(e) => {
        eprintln!("cannot start: {e}");
        std::process::exit(1);
    }
}
```

## Rendering diagnostics

`nitr::diag` carries the same painting the CLI uses — coloured source
snippets and tracebacks on a terminal, byte-clean plain text through a
pipe:

```rust
nitr::diag::set_console_colors(std::io::IsTerminal::is_terminal(&std::io::stdout()));
```

Honour `NO_COLOR`, and never emit ANSI alongside JSON logs.

## What the Lua side sees

The Rust `Error` and the Lua error table are two views of the same
failure. From Lua:

```lua
app:on_error(function(err, req)
    -- err.kind is the same closed set as ErrorInfo.kind
    if err.kind == "timeout" then
        return nitr.error(504, { code = "TIMEOUT" })
    end
    return nitr.error(500, { code = "INTERNAL" })
end)
```

See [Server → Errors](../server/errors) for the application-side story.

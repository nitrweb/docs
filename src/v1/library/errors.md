# Errors (Library)

Nitr's Rust API returns `nitr::Result`, with errors of type
`nitr::Error`. `nitr::Result` alone is `Result<(), nitr::Error>`, and
`nitr::Result<T>` carries a value.

```rust
#[tokio::main]
async fn main() -> nitr::Result {
    Server::builder().handler_script("app.lua").build().await?.serve().await
}
```

## `nitr::Error`

| Variant              | Meaning                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `Lua(mlua::Error)`   | An error from the Lua runtime or a script                                                       |
| `Config(String)`     | An invalid or missing configuration value                                                       |
| `Script(String)`     | A script could not be loaded or run                                                             |
| `Io(std::io::Error)` | An I/O error                                                                                    |
| `Http(http::Error)`  | An HTTP protocol error                                                                          |
| `Timeout`            | The handler ran past its time limit                                                             |
| `PoolBusy`           | No Lua state became free in time, so the request was rejected                                   |
| `Panic(String)`      | A Rust panic was caught during a request: a bug in Nitr or in an extension module, never in Lua |
| `ShutdownTimeout`    | The shutdown time ran out with requests still running, so they were cut off                     |

`?` converts `mlua::Error`, `std::io::Error` and `http::Error` into
`nitr::Error`.

```rust
use nitr::Error;

match server.serve().await {
    Ok(()) => {}
    Err(Error::ShutdownTimeout) => {
        tracing::error!("shutdown cut off running requests");
        std::process::exit(1);
    }
    Err(e) => return Err(e),
}
```

`err.poisons_state()` tells you whether the Lua state that produced the
error must be discarded. It is true only for `Panic` and for a Lua
out-of-memory error; a `Timeout` does not poison. See
[Poisoning](./runtime#poisoning).

## Errors from `build()`

`build()` checks everything it can before binding a port: missing
scripts, unknown configuration keys, conflicting settings, builtins not
compiled in, pending migrations, and async builtins at a script's top
level. These come back as `Error::Config` or `Error::Script`, with a
message that names the problem. A script error includes the source line
and a caret under the failing token, so printing it is enough:

```rust
match Server::builder().config(cfg).build().await {
    Ok(server) => server.serve().await,
    Err(e) => {
        eprintln!("cannot start: {e}");
        std::process::exit(1);
    }
}
```

## `ErrorInfo`

`nitr::ErrorInfo` is the structured form of an error: what failed,
where and why, in separate fields. It is what a Lua `on_error` handler
receives (as the [error table](../api/types#the-error-table)), what the
log records, and what [`TestResponse::error`](./testing#why-a-request-failed)
carries.

| Field       | Type             | Meaning                                                             |
| ----------- | ---------------- | ------------------------------------------------------------------- |
| `kind`      | `&'static str`   | `"lua"`, `"nitr"`, `"module"`, `"timeout"`, `"memory"` or `"panic"` |
| `message`   | `String`         | The message, without position prefix or traceback                   |
| `source`    | `Option<String>` | The script that failed, when known                                  |
| `line`      | `Option<u32>`    | The line in `source`                                                |
| `module`    | `Option<String>` | The module that failed (`"nitr.db"`, or an extension's name)        |
| `traceback` | `Option<String>` | The Lua call stack, innermost first, at most 12 frames              |
| `cause`     | `Vec<String>`    | The underlying error chain, at most 5 entries                       |

| Item                          | Purpose                                                  |
| ----------------------------- | -------------------------------------------------------- |
| `ErrorInfo::from_error(&err)` | Classifies a `nitr::Error`                               |
| `ErrorInfo::from_message(s)`  | Classifies error text, such as what a Lua `pcall` caught |
| `info.concise()`              | One line: `kind: message (source:line)`                  |
| `info.concise_colored()`      | The same with terminal colors                            |

### How `kind` is decided

| Error                                                   | `kind`    |
| ------------------------------------------------------- | --------- |
| `Timeout`, or the time limit hit inside Lua             | `timeout` |
| A Lua out-of-memory error                               | `memory`  |
| `Panic(_)`                                              | `panic`   |
| An extension error with a `module <name>` context       | `module`  |
| `PoolBusy`, other variants, other errors raised in Rust | `nitr`    |
| Anything else raised by a script                        | `lua`     |

Scripts cannot set `kind` themselves, so branching on it is reliable.
See [Error handling](./extension-modules#error-handling) for how an
extension reports `kind = "module"`.

## Async builtins outside the executor

Builtins that wait on I/O or heavy work (for example `nitr.fetch`, the
`nitr.db` methods, `nitr.template:render`, and
`nitr.crypto.password_hash`) only work inside a handler or middleware.
A script's top level runs once at startup, where they cannot wait, so
this fails:

```lua
-- Fails at the top level of a handler script.
local users = { ada = nitr.crypto.password_hash("lovelace") }
```

Nitr reports which builtin was called and where, and `build()` fails:

```text
script error: `password_hash` is asynchronous and cannot be called here.
A script's top level runs once at startup, outside the async executor, …
Call it from inside a handler or a middleware instead.
  --> app.lua:3
```

For a password hash needed at startup, create it once with
[`nitr hash-password`](../server/passwords) and paste the result.

## Panics

A panic in Rust code is caught at the request:

- the response is `500`;
- the Lua state is replaced, not reused;
- the process and other connections keep running.

A panic in an [extension module](./extension-modules) is a bug in that
module and shows up as `Error::Panic` and `kind = "panic"`. Return an
error instead:

```rust
// Panics on bad input: a 500 and a discarded Lua state.
t.set("parse", lua.create_function(|_, s: String| {
    Ok(s.parse::<i64>().unwrap())
})?)?;

// Returns a normal Lua error.
t.set("parse", lua.create_function(|_, s: String| {
    s.parse::<i64>().map_err(|e| mlua::Error::RuntimeError(format!("not a number: {e}")))
})?)?;
```

## Colored diagnostics

`nitr::diag` adds terminal colors to diagnostics, as the CLI does.
Error values themselves are always plain text, because they also end up
in HTTP responses and log files.

| Item                          | Purpose                                                  |
| ----------------------------- | -------------------------------------------------------- |
| `set_console_colors(bool)`    | Turns colored console output on or off (off by default)  |
| `console_colors()`            | The current setting                                      |
| `paint(text)`                 | Colors a multi-line diagnostic                           |
| `paint_line(line)`            | Colors one line                                          |
| `console_ok` / `console_fail` | Success and failure markers, colored only when turned on |

```rust
nitr::diag::set_console_colors(std::io::IsTerminal::is_terminal(&std::io::stdout()));
```

Call it where you set up logging. Leave colors off for JSON logs or when
`NO_COLOR` is set.

See [Server → Errors](../server/errors) for handling errors in Lua.

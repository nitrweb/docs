# Examples

All of Nitr's runnable examples, with run commands and `curl` calls to
try, are on the **[Examples](../examples)** page. The sources are in
[crates/nitr/examples](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples).

Almost every example is a `main.rs` plus the Lua it serves. These four
are the most useful for embedding:

| Example                                  | What it shows                                                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [`hello`](../examples#hello)             | The smallest working `Server::builder()`, with one module at `nitr.ext.hello`. Start here.                                                  |
| [`extension`](../examples#extension)     | A **stateful** module sharing one Rust object across all Lua states, and a **stateless** one. See [Extension modules](./extension-modules). |
| [`sse`](../examples#sse)                 | An **async** module (`create_async_function`) used to pace a stream.                                                                        |
| [`app-package`](../examples#app-package) | For comparison: an application with no `main.rs`, run by the `nitr` binary.                                                                 |

Examples that need an optional builtin declare their Cargo features, and
Cargo tells you which ones are missing. `--features all` runs any of
them; the per-example list is on the [Examples page](../examples#run-them).
See [Cargo features](./cargo-features).

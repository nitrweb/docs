# Examples

The full catalogue of Nitr's runnable examples — all 15, with what each
one demonstrates, its exact run command and the `curl` calls to try
against it — lives on one page:

**[Examples →](../examples)**

Sources:
[crates/nitr/examples](https://github.com/nitrweb/nitr/tree/master/crates/nitr/examples).

## The ones that matter for embedding

Most examples are a `main.rs` plus the Lua it serves, so nearly every one
is an embedding example. These four teach the **crate** rather than the
`nitr.*` API:

| Example                                  | What it teaches                                                                                                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`hello`](../examples#hello)             | The smallest `Server::builder()` that works, with one module mounted at `nitr.ext.hello`. Start here.                                                                           |
| [`extension`](../examples#extension)     | The extension boundary in full: a **stateful** module sharing one Rust handle across every pooled state, and a **stateless** one. See [Extension modules](./extension-modules). |
| [`sse`](../examples#sse)                 | An **async** module — `create_async_function` suspending on the tokio timer — which is how you pace a stream without burning the execution budget.                              |
| [`app-package`](../examples#app-package) | The contrast: no `main.rs` at all. What an application looks like when the CLI owns the process instead of your code.                                                           |

> [!TIP] Read `hello`, then `extension`
>
> Between them they cover the whole embedding surface: build a server,
> mount your own Rust, and hand Lua something it could not do alone.
> Everything else in the catalogue exercises the `nitr.*` API, which is
> identical whether the process is `nitr` or your own binary.

## Cargo features

The library ships with `default = []`, so an example needing an optional
builtin declares it and Cargo refuses to run it otherwise, naming what is
missing. The per-example table is on the
[catalogue page](../examples#run-them); `--features all` works for every
one of them.

See [Cargo features](./cargo-features) for what each one pulls in.

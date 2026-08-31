# License

Nitr is dual-licensed under either of:

- **[Apache License, Version
  2.0](https://github.com/nitrweb/nitr/blob/master/LICENSE-APACHE)** —
  ([summary](https://choosealicense.com/licenses/apache-2.0/))
- **[MIT
  License](https://github.com/nitrweb/nitr/blob/master/LICENSE-MIT)** —
  ([summary](https://choosealicense.com/licenses/mit/))

at your option.

This is the conventional Rust-ecosystem dual license: you may use Nitr
under whichever of the two suits you, and you do not have to choose in
advance.

## SPDX headers on every source file

The workspace manifest declares `license = "MIT OR Apache-2.0"`, and
every source file repeats it in a four-line header so the license
travels with the file rather than only with the repository:

```rust
// SPDX-License-Identifier: MIT OR Apache-2.0
// This file is part of Nitr.
// See https://nitrweb.com/ for more information
// Copyright (C) 2024-present Jose Quintana <joseluisq.net>
```

Lua sources use `--` and the `Makefile` uses `#`; the text is otherwise
identical. `MIT OR Apache-2.0` is the [SPDX](https://spdx.org/licenses/)
spelling of "either one, at your option" — the same expression a machine
reads out of `Cargo.toml`, so a scanner walking a vendored copy of the
tree reaches the same answer as one reading the manifest.

New files are expected to carry the header — see
[Contributions](./contributions#every-new-source-file-carries-an-spdx-header).

## Contributions

Unless you explicitly state otherwise, any contribution you
intentionally submit for inclusion in the work, as defined in the
Apache-2.0 license, shall be dual licensed as above, without any
additional terms or conditions. See [Contributions](./contributions).

## Third-party licenses

Nitr embeds and links a number of open-source projects, each under its
own license. What ends up in your binary depends on the [Cargo
features](./library/cargo-features) you enable.

Always compiled in:

| Component                       | Why it is there                                        |
| ------------------------------- | ------------------------------------------------------ |
| **Lua 5.4** (MIT)               | The interpreter itself, vendored and built from source |
| `mlua`                          | The Rust ↔ Lua binding                                 |
| `hyper`, `hyper-util`, `http`   | The HTTP/1.1 and HTTP/2 implementation                 |
| `tokio`                         | The async runtime                                      |
| `serde`, `serde_json`, `toml`   | Configuration and the JSON boundary                    |
| `tracing`, `tracing-subscriber` | Structured logging                                     |

Pulled in by a feature:

| Feature       | Notable dependencies                                                         |
| ------------- | ---------------------------------------------------------------------------- |
| `db`          | `rusqlite`, which bundles **SQLite** (public domain)                         |
| `fetch`       | `reqwest` — by far the heaviest, over half the full dependency graph         |
| `template`    | `minijinja`                                                                  |
| `crypto`      | `argon2`, `chacha20poly1305`, `hmac`, `sha2`, `subtle` (RustCrypto)          |
| `compression` | `brotli`, `flate2`                                                           |
| `multipart`   | `multer`                                                                     |
| `tls`         | `rustls` and `tokio-rustls` over the **`ring`** provider, `rustls-pki-types` |

> [!NOTE] `tls` adds less than it looks like
>
> `ring` is already in the dependency graph whenever `fetch` is enabled,
> because `reqwest` is configured with `rustls-tls-native-roots` rather
> than `native-tls`. Terminating TLS with the same provider therefore
> costs no new crate on an `all` build — it was picked partly for that,
> and partly because rustls needs nothing from the target sysroot,
> which is what makes the cross-compiled release matrix buildable at
> all.

### Getting the exact list for your build

Feature-dependent lists are worth generating rather than copying:

```sh
cargo license --features all   # cargo install cargo-license
cargo deny check               # cargo install cargo-deny
```

`deny.toml` in the repository pins the licenses CI will accept —
`0BSD`, `Apache-2.0`, `Apache-2.0 WITH LLVM-exception`, `BSD-3-Clause`,
`BSL-1.0`, `CC0-1.0`, `ISC`, `MIT`, `Unicode-3.0`, `Unlicense` and
`Zlib`. Everything the tree uses is permissive; a dependency arriving
under anything else fails the `audit` workflow, so it becomes a
deliberate decision instead of a silent import.

---

© 2024-present [Jose Quintana](https://joseluisq.net)

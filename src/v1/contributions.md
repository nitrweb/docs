# Contributions

Contributions are welcome. Nitr is in early development, so the most
valuable thing you can do is **use it and report what breaks**.

## Ways to help

|                            |                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **File an issue**          | [github.com/joseluisq/nitr/issues](https://github.com/joseluisq/nitr/issues) — bugs, rough edges, confusing errors |
| **Open a pull request**    | [github.com/joseluisq/nitr/pulls](https://github.com/joseluisq/nitr/pulls)                                         |
| **Improve these docs**     | Every page has an _Edit this page on GitHub_ link at the bottom                                                    |
| **Report a vulnerability** | Privately, please — see [Report Security Issues](./report-security-issues)                                         |

## Before opening a pull request

```sh
cargo test --workspace --features all
cargo clippy --workspace --all-targets
cargo fmt --check
```

CI runs the same commands. The workspace treats warnings as errors and
forbids `unsafe_code`, so anything that builds cleanly locally will
build cleanly there.

A few conventions that will save you a review round:

- **A new `nitr.*` builtin must be documented.** The API description is
  the single source for the [reference page](./api/), the generated
  `nitr-types.lua` completions and the docs — and a test fails if a
  registered builtin is undocumented.
- **New configuration keys are rejected unless declared.** Unknown keys
  in `nitr.toml` are a startup error by design; add yours to the config
  types and to [the file reference](./server/configuration/file).
- **Log fields are a closed vocabulary.** No SQL text, no bind values,
  no full URLs, no header, cookie or session material. See [Logging →
  Redaction rules](./server/logging#redaction-rules) before adding a
  span field.
- **Behaviour changes need a test that dispatches through the real
  router** — the in-process test client exists precisely so nothing has
  to be mocked.

## Documentation contributions

These docs live in a separate repository:
[joseluisq/nitr-docs](https://github.com/joseluisq/nitr-docs).

```sh
git clone https://github.com/joseluisq/nitr-docs
cd nitr-docs
yarn install
yarn docs:dev
```

| Command             | What it does                               |
| ------------------- | ------------------------------------------ |
| `yarn docs:dev`     | live-reloading dev server                  |
| `yarn docs:build`   | production build                           |
| `yarn docs:preview` | serve the production build locally         |
| `yarn run check`    | typecheck + markdown lint + Prettier check |
| `yarn format:fix`   | apply Prettier formatting                  |

## Licensing of contributions

Unless you explicitly state otherwise, any contribution you
intentionally submit for inclusion in the work, as defined in the
Apache-2.0 license, shall be dual licensed as described in
[License](./license), without any additional terms or conditions.

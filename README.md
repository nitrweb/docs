# Nitr Documentation

The source of the [Nitr](https://github.com/nitrweb/nitr) documentation
site, built with [VitePress](https://vitepress.dev/).

> Nitr is a Rust web server embedding Lua for fast, efficient and safe
> lightweight dynamic backends.
> See [github.com/nitrweb/nitr](https://github.com/nitrweb/nitr) for the main repository.

## Development

```sh
yarn install
yarn docs:dev        # live-reloading dev server
```

| Command             | What it does                                                |
| ------------------- | ----------------------------------------------------------- |
| `yarn docs:dev`     | Dev server with hot reload                                  |
| `yarn docs:build`   | Production build into `.vitepress/dist`                     |
| `yarn docs:preview` | Serve the production build locally                          |
| `yarn run check`    | Typecheck + markdown lint + Prettier check                  |
| `yarn format:fix`   | Apply Prettier formatting                                   |
| `make typos`        | Spell-check with [typos](https://github.com/crate-ci/typos) |

## Layout

```
src/
├── index.md                  the landing page (renders theme/components/Home.vue)
└── v1/                       the versioned documentation set
    ├── index.md              introduction
    ├── quick-start.md
    ├── download-install.md
    ├── how-it-works.md
    ├── examples.md            catalogue of the repo's runnable examples
    ├── building-from-source.md
    ├── stability.md
    ├── report-security-issues.md
    ├── contributions.md
    ├── license.md
    ├── server/               the `nitr` binary: config + writing Lua apps
    │   ├── configuration/    the nitr.toml file, env vars, CLI flags
    │   ├── deployment/       single-file, systemd, Docker
    │   ├── validation/       schemas, route input, uploads, messages
    │   ├── openapi/          the generated document and Swagger UI
    │   ├── passwords.md      argon2id hashing and Basic auth
    │   ├── jwt.md            signing and verifying JWTs
    │   ├── tls.md            in-process HTTPS termination
    │   └── …                 routing, requests, responses, database, …
    ├── api/                  the `nitr.*` Lua API reference
    └── library/              the `nitr` Rust crate: embedding and extending

.vitepress/
├── config.mts                site configuration
├── config.v1.mts             the v1 nav + sidebar
└── theme/
    ├── components/           Home page, nav items, badges
    └── styles/               brand variables and landing-page styles
```

The docs are split deliberately:

- **Server** — for people writing a Nitr application in Lua.
- **Library** — for people embedding the `nitr` crate in Rust, or
  exposing their own Rust modules as `nitr.ext.*`.
- **API reference** — the exhaustive `nitr.*` inventory.

## Writing conventions

- Prose is wrapped at ~72 columns; Prettier's `proseWrap` is `preserve`,
  so existing wrapping is respected.
- Use VitePress
  [GitHub-flavored alerts](https://vitepress.dev/guide/markdown#github-flavored-alerts)
  for asides — `> [!TIP]`, `> [!NOTE]`, `> [!WARNING]`, `> [!DANGER]` —
  each with a short title on the same line as the marker.
- Code blocks with Vue-style `{{ … }}` (Jinja templates) **must** be
  wrapped in a `::: v-pre` container, or the Vue compiler will try to
  evaluate them.
- Internal links are relative and extension-less (`./quick-start`,
  `../api/`); the build fails on a dead one.

## Branding

Colours come from the Nitr branding set (`ui/ui-ux/branding` in the main
repository): violet `#8B5CF6`, light `#C4B5FD`, deep `#6D28D9`, magenta
`#E879F9`, ink `#0E0C18`. They are defined once in
[`.vitepress/theme/styles/vars.css`](.vitepress/theme/styles/vars.css).

## License

Documentation content is dual-licensed with Nitr itself under
[MIT](https://github.com/nitrweb/nitr/blob/master/LICENSE-MIT) /
[Apache-2.0](https://github.com/nitrweb/nitr/blob/master/LICENSE-APACHE).

© 2024-present [Jose Quintana](https://joseluisq.net)

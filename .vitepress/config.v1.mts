import { DefaultTheme } from 'vitepress'

// The v1 documentation set. Nitr is pre-1.0, so this is the development
// line: `/v1/` is where the docs for the first stable release are built up.
export const v1: DefaultTheme.Config = {
  nav: [
    {
      text: 'v1 (dev)',
      link: '/v1/',
      activeMatch: '^/v1/'
    }
  ],
  sidebar: {
    '/v1/': [
      {
        text: 'Getting Started',
        items: [
          { text: 'Introduction', link: '/v1/' },
          { text: 'Quick Start', link: '/v1/quick-start' },
          { text: 'Download & Install', link: '/v1/download-install' },
          { text: 'How Nitr Works', link: '/v1/how-it-works' },
          { text: 'Examples', link: '/v1/examples' },
          { text: 'Building from Source', link: '/v1/building-from-source' }
        ]
      },
      {
        text: 'Server',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/v1/server/' },
          { text: 'Project Layout', link: '/v1/server/project-layout' },
          { text: 'CLI Commands', link: '/v1/server/cli' },
          {
            text: 'Configuration',
            collapsed: true,
            items: [
              { text: 'Overview', link: '/v1/server/configuration/' },
              {
                text: 'The nitr.toml File',
                link: '/v1/server/configuration/file'
              },
              {
                text: 'Environment Variables',
                link: '/v1/server/configuration/env'
              },
              {
                text: 'Command-Line Flags',
                link: '/v1/server/configuration/cli'
              }
            ]
          },
          { text: 'Server Defaults', link: '/v1/server/defaults' }
        ]
      },
      {
        text: 'Writing Handlers',
        collapsed: false,
        items: [
          { text: 'Routing', link: '/v1/server/routing' },
          { text: 'Middleware', link: '/v1/server/middleware' },
          { text: 'Requests', link: '/v1/server/requests' },
          { text: 'Responses', link: '/v1/server/responses' },
          { text: 'Cookies & Sessions', link: '/v1/server/cookies-sessions' },
          { text: 'Streaming & SSE', link: '/v1/server/streaming' },
          { text: 'Error Handling', link: '/v1/server/errors' }
        ]
      },
      {
        text: 'Standard Library',
        collapsed: false,
        items: [
          { text: 'Database', link: '/v1/server/database' },
          { text: 'Templates', link: '/v1/server/templates' },
          { text: 'Static Files', link: '/v1/server/static-files' },
          {
            text: 'Validation',
            collapsed: true,
            items: [
              { text: 'Overview', link: '/v1/server/validation/' },
              { text: 'Rules & Types', link: '/v1/server/validation/rules' },
              {
                text: 'String Formats',
                link: '/v1/server/validation/formats'
              },
              {
                text: 'Route Input',
                link: '/v1/server/validation/route-input'
              },
              { text: 'File Uploads', link: '/v1/server/validation/files' },
              {
                text: 'Messages & Errors',
                link: '/v1/server/validation/messages'
              },
              {
                text: 'Composition',
                link: '/v1/server/validation/composition'
              }
            ]
          },
          {
            text: 'OpenAPI & Swagger UI',
            collapsed: true,
            items: [
              { text: 'Overview', link: '/v1/server/openapi/' },
              {
                text: 'Documenting Routes',
                link: '/v1/server/openapi/documenting'
              },
              { text: 'Swagger UI', link: '/v1/server/openapi/swagger-ui' }
            ]
          },
          { text: 'Outbound HTTP', link: '/v1/server/fetch' },
          { text: 'Cache', link: '/v1/server/cache' },
          { text: 'Crypto & Auth', link: '/v1/server/crypto-auth' },
          { text: 'Passwords & Basic Auth', link: '/v1/server/passwords' },
          { text: 'JWT', link: '/v1/server/jwt' },
          { text: 'Testing', link: '/v1/server/testing' },
          { text: 'Logging', link: '/v1/server/logging' }
        ]
      },
      {
        text: 'Operations',
        collapsed: false,
        items: [
          { text: 'Deployment', link: '/v1/server/deployment/' },
          {
            text: 'Single-File Deploys',
            link: '/v1/server/deployment/single-file'
          },
          { text: 'systemd', link: '/v1/server/deployment/systemd' },
          { text: 'Docker', link: '/v1/server/deployment/docker' },
          { text: 'TLS', link: '/v1/server/tls' },
          { text: 'Security & the Sandbox', link: '/v1/server/security' }
        ]
      },
      {
        text: 'Lua API Reference',
        collapsed: false,
        items: [
          { text: 'The nitr.* Namespace', link: '/v1/api/' },
          { text: 'Types', link: '/v1/api/types' }
        ]
      },
      {
        text: 'Library (Rust crate)',
        collapsed: false,
        items: [
          { text: 'Overview', link: '/v1/library/' },
          { text: 'Getting Started', link: '/v1/library/getting-started' },
          { text: 'Cargo Features', link: '/v1/library/cargo-features' },
          { text: 'ServerBuilder', link: '/v1/library/server-builder' },
          {
            text: 'Extension Modules',
            link: '/v1/library/extension-modules'
          },
          { text: 'The Lua Runtime', link: '/v1/library/runtime' },
          { text: 'Errors', link: '/v1/library/errors' },
          { text: 'Testing', link: '/v1/library/testing' },
          { text: 'Examples', link: '/v1/library/examples' }
        ]
      },
      {
        text: 'Project',
        collapsed: false,
        items: [
          { text: 'Stability & Versioning', link: '/v1/stability' },
          {
            text: 'Changelog',
            link: 'https://github.com/nitrweb/nitr/releases',
            target: '_blank',
            rel: 'noopener noreferrer'
          },
          {
            text: 'Report Security Issues',
            link: '/v1/report-security-issues'
          },
          { text: 'Contributions', link: '/v1/contributions' },
          { text: 'License', link: '/v1/license' }
        ]
      }
    ]
  }
}

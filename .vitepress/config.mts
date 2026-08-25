import { defineConfig } from 'vitepress'
import { v1 } from './config.v1.mjs'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  srcDir: 'src',

  title: 'Nitr',
  description:
    'Nitr — A Rust web server embedding Lua for fast, efficient and safe smaller dynamic backends.',

  cleanUrls: true,
  lastUpdated: true,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/assets/nitr.svg' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    [
      'link',
      {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossorigin: ''
      }
    ],
    [
      'link',
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fira+Code:wght@300..700&display=swap'
      }
    ],
    ['meta', { name: 'theme-color', content: '#8B5CF6' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Nitr' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'A Rust web server embedding Lua for fast, efficient and safe smaller dynamic backends.'
      }
    ]
  ],

  themeConfig: {
    logo: { light: '/assets/nitr.svg', dark: '/assets/nitr_white.svg' },
    siteTitle: 'Nitr',

    search: {
      provider: 'local'
    },

    nav: [...(v1.nav || [])],

    sidebar: {
      ...v1.sidebar
    },

    outline: { level: [2, 3], label: 'On this page' },

    socialLinks: [{ icon: 'github', link: 'https://github.com/joseluisq/nitr' }],

    editLink: {
      pattern: 'https://github.com/joseluisq/nitr-docs/edit/main/src/:path',
      text: 'Edit this page on GitHub'
    },

    footer: {
      message:
        'Dual-licensed under <a href="https://github.com/joseluisq/nitr/blob/master/LICENSE-MIT">MIT</a> / <a href="https://github.com/joseluisq/nitr/blob/master/LICENSE-APACHE">Apache-2.0</a>.',
      copyright:
        'Copyright © 2024-present <a href="https://joseluisq.net">Jose Quintana</a>'
    }
  }
})

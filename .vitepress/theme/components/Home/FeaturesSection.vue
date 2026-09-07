<script setup lang="ts">
/**
 * The feature grid. `body` is rendered as HTML so the entries can mark
 * up identifiers with <code> — the strings are authored here, never
 * user input.
 */
const FEATURES = [
  {
    title: 'Rust-side routing',
    icon: 'M4 7h6M14 7h6M4 17h6M14 17h6 M10 7a2 2 0 1 0 4 0 2 2 0 1 0-4 0M10 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0',
    body: 'Path parameters, middleware composed at load, 404/405 answered without entering Lua.'
  },
  {
    title: 'SQLite that behaves',
    icon: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3ZM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
    body: 'WAL, busy timeout and foreign keys on; plain-SQL migrations, checksummed.'
  },
  {
    title: 'Templates',
    icon: 'M4 4h16v4H4zM4 11h7v9H4zM14 11h6v9h-6z',
    body: 'minijinja rendering, HTML-escaped by default whatever the file is called.'
  },
  {
    title: 'Outbound HTTP',
    icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3Z',
    body: 'Shared pool, timeouts, opt-in retries, and an SSRF policy DNS rebinding cannot slip past.'
  },
  {
    title: 'Static files',
    icon: 'M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10zM13 3v7h7',
    body: 'ETag, 304, range requests, traversal protection, dotfiles hidden, precompressed sidecars.'
  },
  {
    title: 'Compression &amp; CORS',
    icon: 'M12 3v7M12 21v-7M8 7l4-4 4 4M8 17l4 4 4-4M4 12h16',
    body: 'brotli/gzip on demand; preflights answered before Lua runs.'
  },
  {
    title: 'Uploads out of the heap',
    icon: 'M12 16V4M8 8l4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
    body: 'Multipart parts stream straight to disk, in Rust.'
  },
  {
    title: 'Streaming &amp; SSE',
    icon: 'M4 8h10M4 12h16M4 16h7M18 8l3 4-3 4',
    body: 'Writer callbacks and coroutine bodies, with real backpressure.'
  },
  {
    title: 'TLS in-process',
    icon: 'M6 11V8a6 6 0 1 1 12 0v3M5 11h14v10H5zM12 15v3',
    body: 'Terminate HTTPS with rustls — three lines of <code>[tls]</code>, no proxy required, renewals picked up on reload.'
  },
  {
    title: 'Crypto &amp; auth',
    icon: 'M15 7a4 4 0 1 1-3.9 5H8v3H5v-3H3l4.1-3A4 4 0 0 1 15 7ZM15 10h.01',
    body: 'argon2id, HMAC, AEAD, JWTs that cannot accept <code>alg: none</code>.'
  },
  {
    title: 'Sessions &amp; CSRF',
    icon: 'M12 3l8 3v6c0 4.4-3.2 8.3-8 9-4.8-.7-8-4.6-8-9V6zM9 12l2 2 4-4',
    body: 'Signed cookies, stateless sessions, double-submit CSRF middleware.'
  },
  {
    title: 'Validation',
    icon: 'M9 12l2 2 4-4M12 3l8 3v6c0 4.4-3.2 8.3-8 9-4.8-.7-8-4.6-8-9V6z',
    body: 'Declare a route’s input once: checked in Rust before the handler, undeclared fields stripped.'
  },
  {
    title: 'OpenAPI &amp; Swagger UI',
    icon: 'M4 4h16v16H4zM8 9h8M8 13h8M8 17h5',
    body: 'A 3.1 document generated from your routes, and the page to browse it — served from the binary, no CDN.'
  },
  {
    title: 'Uploads it can vouch for',
    icon: 'M12 16V4M8 8l4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M9 12h6',
    body: 'A file’s type comes from its bytes, not its header. Presets for images, documents, archives.'
  },
  {
    title: 'Structured logs',
    icon: 'M4 5h16M4 10h10M4 15h16M4 20h7',
    body: 'JSON with real keys, request spans, and strict redaction rules.'
  },
  {
    title: 'A test framework',
    icon: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3',
    body: '<code>describe</code>/<code>it</code>/<code>expect</code>, dispatching through the real router, against a throwaway database.'
  },
  {
    title: 'Hot reload',
    icon: 'M20 11A8 8 0 1 0 12 20a8 8 0 0 0 7-4M20 5v6h-6',
    body: '<code>nitr dev</code> rebuilds on save; <code>SIGHUP</code> reloads the pool and re-reads TLS certificates, without dropping connections.'
  },
  {
    title: 'Health &amp; graceful drain',
    icon: 'M3 12h4l2-5 3 10 2-5h7',
    body: 'Rust-owned <code>/healthz</code> and <code>/readyz</code>; readiness flips before a drain can fail a request.'
  },
  {
    title: 'Editor completion',
    icon: 'M8 8l-4 4 4 4M16 8l4 4-4 4M13 5l-2 14',
    body: 'Generated LuaCATS types for the whole <code>nitr.*</code> surface.'
  }
]
</script>

<template>
  <section id="features" class="nitr-section nitr-alt">
    <div class="nitr-container">
      <header class="nitr-head">
        <p class="nitr-kicker">Batteries included</p>
        <h2>The tedious parts of HTTP are already written</h2>
        <p class="nitr-sub">
          And they run in Rust, before a Lua state is even checked out.
        </p>
      </header>

      <div class="nitr-grid nitr-grid-4">
        <div v-for="(feature, i) in FEATURES" :key="feature.title" class="nitr-feature" data-reveal
          :style="{ '--i': i % 4 }">
          <h3>
            <span class="nitr-feature-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
                stroke-linejoin="round">
                <path :d="feature.icon" />
              </svg>
            </span>
            <span v-html="feature.title"></span>
          </h3>
          <p v-html="feature.body"></p>
        </div>
      </div>

      <br />
      <p>
        <a class="nitr-link-arrow" href="/v1/api/">See the full API reference →</a>
      </p>
    </div>
  </section>
</template>

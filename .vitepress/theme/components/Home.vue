<script setup lang="ts">
import { useData } from 'vitepress'

const { isDark } = useData()

function handleCopy(event: MouseEvent) {
  const btn = event.currentTarget as HTMLButtonElement
  const pre = btn.parentElement?.querySelector('.install-cmd') as HTMLElement | null
  if (!pre) return
  const raw = pre.textContent ?? ''
  const text = raw.replace(/^[ \t]+/gm, '').replace(/^\n+|\n+$/g, '')

  const showSuccess = () => {
    btn.classList.add('ok')
    const span = btn.querySelector('span')
    if (span) span.textContent = 'Copied'
    setTimeout(() => {
      btn.classList.remove('ok')
      if (span) span.textContent = 'Copy'
    }, 1400)
  }

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(showSuccess).catch(() => fallbackCopy(text, showSuccess))
  } else {
    fallbackCopy(text, showSuccess)
  }
}

function fallbackCopy(text: string, onSuccess: () => void) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  document.body.appendChild(ta)
  ta.select()
  try {
    document.execCommand('copy')
    onSuccess()
  } catch (err) {
    console.error('Fallback copy failed:', err)
  }
  document.body.removeChild(ta)
}
</script>

<template>
  <div class="nitr-page" :data-theme="isDark ? 'dark' : 'light'">
    <main>
      <!-- HERO -->
      <section id="top" class="nitr-hero">
        <div class="nitr-container nitr-hero-grid">
          <div class="nitr-hero-text">
            <h1>Write lean <span class="nitr-accent">Lua</span> dynamic backends powered by <span class="nitr-accent">Rust</span> </h1>

            <p class="nitr-lead">
              Nitr serves HTTP with embedded Lua 5.4. You write the dynamic logic parts.
              The routing, SQLite, templates, crypto and the rest of HTTP are already Rust and every script runs inside a sandbox.
            </p>

            <div class="nitr-actions">
              <a class="nitr-btn nitr-btn-primary" href="/v1/quick-start">Get started</a>
              <a class="nitr-btn nitr-btn-ghost" href="https://github.com/nitrweb/nitr" target="_blank"
                rel="noopener">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor">
                  <path
                    d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.69-3.87-1.54-3.87-1.54-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.04 1.78 2.72 1.27 3.38.97.1-.76.4-1.27.73-1.56-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.2-3.1-.12-.3-.52-1.48.11-3.09 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.18-1.18 3.18-1.18.63 1.61.23 2.79.11 3.09.75.81 1.2 1.84 1.2 3.1 0 4.43-2.69 5.41-5.25 5.69.41.36.78 1.06.78 2.14v3.18c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
                </svg>
                GitHub
              </a>
            </div>

            <ul class="nitr-meta">
              <li>One binary</li>
              <li>Lua 5.4, sandboxed</li>
              <li>MIT / Apache-2.0</li>
            </ul>
          </div>

          <div class="nitr-hero-art">
            <figure class="nitr-window">
              <figcaption class="nitr-window-bar">
                <span class="nitr-window-name">app.lua</span>
                <span class="nitr-window-controls" aria-hidden="true">
                  <span class="nitr-win-btn">—</span>
                  <span class="nitr-win-btn">▢</span>
                  <span class="nitr-win-btn nitr-win-close">✕</span>
                </span>
              </figcaption>
              <pre class="nitr-code"><code><span class="nitr-t-key">local</span> app = <span class="nitr-t-cmd">nitr</span>.<span class="nitr-t-flag">app</span>()

<span class="nitr-t-comment">-- Middleware: composed once, not per request.</span>
app:<span class="nitr-t-flag">use</span>(<span class="nitr-t-key">function</span>(next)
    <span class="nitr-t-key">return</span> <span class="nitr-t-key">function</span>(req)
        <span class="nitr-t-cmd">nitr</span>.log.<span class="nitr-t-flag">info</span>(<span class="nitr-t-str">"request"</span>, { path = req.path })
        <span class="nitr-t-key">return</span> next(req)
    <span class="nitr-t-key">end</span>
<span class="nitr-t-key">end</span>)

app:<span class="nitr-t-flag">get</span>(<span class="nitr-t-str">"/users/:id"</span>, <span class="nitr-t-key">function</span>(req)
    <span class="nitr-t-key">local</span> user = <span class="nitr-t-cmd">nitr</span>.db:<span class="nitr-t-flag">query_row</span>(
        <span class="nitr-t-str">"SELECT id, name FROM users WHERE id = ?"</span>,
        { req.params.id })

    <span class="nitr-t-key">if</span> <span class="nitr-t-key">not</span> user <span class="nitr-t-key">then</span>
        <span class="nitr-t-key">return</span> <span class="nitr-t-cmd">nitr</span>.<span class="nitr-t-flag">error</span>(<span class="nitr-t-num">404</span>, { code = <span class="nitr-t-str">"NOT_FOUND"</span> })
    <span class="nitr-t-key">end</span>

    <span class="nitr-t-key">return</span> <span class="nitr-t-cmd">nitr</span>.<span class="nitr-t-flag">json</span>(user)
<span class="nitr-t-key">end</span>)

<span class="nitr-t-key">return</span> app</code></pre>
            </figure>
          </div>
        </div>
      </section>

      <!-- WHY -->
      <section id="why" class="nitr-section nitr-alt">
        <div class="nitr-container">
          <header class="nitr-head">
            <p class="nitr-kicker">Why Nitr</p>
            <h2>A scripting language where it helps, Rust where it matters</h2>
            <p class="nitr-sub">
              Dynamic handlers should be quick to write and easy to change. Nitr combines the simplicity of Lua with the performance, safety, and reliability of Rust; so the infrastructure stays out of your way.
            </p>
          </header>

          <div class="nitr-grid nitr-grid-4">
            <article class="nitr-card">
              <span class="nitr-card-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="20" height="20">
                  <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" fill="currentColor" />
                </svg>
              </span>
              <h3>Parallel by construction</h3>
              <p>A fixed pool of independent Lua states, one per CPU core. No global lock,
                because there is no global interpreter.</p>
            </article>

            <article class="nitr-card">
              <span class="nitr-card-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="20" height="20">
                  <path d="M12 2 4 5v7c0 5 3.4 9.3 8 10 4.6-.7 8-5 8-10V5l-8-3z" fill="currentColor" />
                </svg>
              </span>
              <h3>Safe by default</h3>
              <p>No <code>io</code> or <code>os</code>, an 8&nbsp;MiB heap cap, and an
                execution budget that actually stops <code>while true do end</code>.</p>
            </article>

            <article class="nitr-card">
              <span class="nitr-card-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="20" height="20">
                  <path
                    d="M12 2 3 6.5v11L12 22l9-4.5v-11L12 2Zm0 2.2 6.8 3.3L12 10.8 5.2 7.5 12 4.2Zm-7 5.1 6 2.9v8.2l-6-3v-8.1Zm14 0v8.1l-6 3v-8.2l6-2.9Z"
                    fill="currentColor" />
                </svg>
              </span>
              <h3>One-file deploys</h3>
              <p><code>nitr build</code> packs config, Lua, templates, static files and
                migrations into a single executable.</p>
            </article>

            <article class="nitr-card">
              <span class="nitr-card-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="20" height="20">
                  <path d="M3 5h18v3H3zM3 10h12v3H3zM3 15h18v3H3z" fill="currentColor" />
                </svg>
              </span>
              <h3>One namespace</h3>
              <p>Everything lives under <code>nitr.*</code>, and your own Rust modules mount
                at <code>nitr.ext.*</code>, where no builtin can collide.</p>
            </article>
          </div>
        </div>
      </section>

      <!-- FEATURES -->
      <section id="features" class="nitr-section">
        <div class="nitr-container">
          <header class="nitr-head">
            <p class="nitr-kicker">Batteries included</p>
            <h2>The tedious parts of HTTP are already written</h2>
            <p class="nitr-sub">
              And they run in Rust, before a Lua state is even checked out.
            </p>
          </header>

          <div class="nitr-grid nitr-grid-4">
            <div class="nitr-feature">
              <h3>Rust-side routing</h3>
              <p>Path parameters, middleware composed at load, 404/405 answered without
                entering Lua.</p>
            </div>
            <div class="nitr-feature">
              <h3>SQLite that behaves</h3>
              <p>WAL, busy timeout and foreign keys on; plain-SQL migrations, checksummed.</p>
            </div>
            <div class="nitr-feature">
              <h3>Templates</h3>
              <p>minijinja rendering, with escaping on by default.</p>
            </div>
            <div class="nitr-feature">
              <h3>Outbound HTTP</h3>
              <p>Shared pool, timeouts, opt-in retries, and an SSRF policy DNS rebinding
                cannot slip past.</p>
            </div>

            <div class="nitr-feature">
              <h3>Static files</h3>
              <p>ETag, 304, range requests, traversal protection, precompressed sidecars.</p>
            </div>
            <div class="nitr-feature">
              <h3>Compression &amp; CORS</h3>
              <p>brotli/gzip on demand; preflights answered before Lua runs.</p>
            </div>
            <div class="nitr-feature">
              <h3>Uploads out of the heap</h3>
              <p>Multipart parts stream straight to disk, in Rust.</p>
            </div>
            <div class="nitr-feature">
              <h3>Streaming &amp; SSE</h3>
              <p>Writer callbacks and coroutine bodies, with real backpressure.</p>
            </div>

            <div class="nitr-feature">
              <h3>TLS in-process</h3>
              <p>Terminate HTTPS with rustls — three lines of <code>[tls]</code>, no proxy
                required.</p>
            </div>
            <div class="nitr-feature">
              <h3>Crypto &amp; auth</h3>
              <p>argon2id, HMAC, AEAD, JWTs that cannot accept <code>alg: none</code>.</p>
            </div>
            <div class="nitr-feature">
              <h3>Sessions &amp; CSRF</h3>
              <p>Signed cookies, stateless sessions, double-submit CSRF middleware.</p>
            </div>
            <div class="nitr-feature">
              <h3>Validation</h3>
              <p>Schemas compiled once, checked in Rust, undeclared fields stripped.</p>
            </div>
            <div class="nitr-feature">
              <h3>Structured logs</h3>
              <p>JSON with real keys, request spans, and strict redaction rules.</p>
            </div>

            <div class="nitr-feature">
              <h3>A test framework</h3>
              <p><code>describe</code>/<code>it</code>/<code>expect</code>, dispatching
                through the real router.</p>
            </div>
            <div class="nitr-feature">
              <h3>Hot reload</h3>
              <p><code>nitr dev</code> rebuilds on save; <code>SIGHUP</code> reloads without
                dropping connections.</p>
            </div>
            <div class="nitr-feature">
              <h3>Health &amp; graceful drain</h3>
              <p>Rust-owned <code>/healthz</code> and <code>/readyz</code>; readiness flips
                before a drain can fail a request.</p>
            </div>
            <div class="nitr-feature">
              <h3>Editor completion</h3>
              <p>Generated LuaCATS types for the whole <code>nitr.*</code> surface.</p>
            </div>
          </div>
          <br />
          <p>
            <a class="nitr-link-arrow" href="/v1/api/">
              See the full API reference →
            </a>
          </p>
        </div>
      </section>

      <!-- CONFIG -->
      <section id="config" class="nitr-section nitr-alt">
        <div class="nitr-container nitr-two-col">
          <div>
            <p class="nitr-kicker">Configuration</p>
            <h2>One file, validated before it runs.</h2>
            <p class="nitr-sub">
              Describe the server in readable TOML, override any of it with
              <code>NITR_*</code> variables or flags, and let unknown keys fail loudly
              instead of silently.
            </p>
            <ul class="nitr-check-list">
              <li>Flags &gt; environment &gt; file &gt; defaults, in that order.</li>
              <li>Typos, contradictions and missing paths refuse to start.</li>
              <li><code>nitr check --print-config</code> shows which value won.</li>
            </ul>
            <a class="nitr-link-arrow" href="/v1/server/configuration/file">
              See all options →
            </a>
          </div>

          <figure class="nitr-window">
            <figcaption class="nitr-window-bar">
              <span class="nitr-window-name">nitr.toml</span>
              <span class="nitr-window-controls" aria-hidden="true">
                <span class="nitr-win-btn">—</span>
                <span class="nitr-win-btn">▢</span>
                <span class="nitr-win-btn nitr-win-close">✕</span>
              </span>
            </figcaption>
            <pre class="nitr-code"><code><span class="nitr-t-key">listen</span> = <span class="nitr-t-str">"127.0.0.1:3000"</span>
<span class="nitr-t-key">handler_script</span> = <span class="nitr-t-str">"app.lua"</span>
<span class="nitr-t-key">config_script</span> = <span class="nitr-t-str">"config.lua"</span>

<span class="nitr-t-comment"># SQLite: WAL, busy timeout, foreign keys on</span>
<span class="nitr-t-num">[database]</span>
<span class="nitr-t-key">path</span> = <span class="nitr-t-str">"data/app.db"</span>

<span class="nitr-t-comment"># Which nitr.* modules scripts may use</span>
<span class="nitr-t-num">[std]</span>
<span class="nitr-t-key">features</span> = [<span class="nitr-t-str">"json"</span>, <span class="nitr-t-str">"http"</span>, <span class="nitr-t-str">"log"</span>, <span class="nitr-t-str">"db"</span>]

<span class="nitr-t-comment"># The sandbox</span>
<span class="nitr-t-num">[lua]</span>
<span class="nitr-t-key">memory_limit</span>    = <span class="nitr-t-num">8388608</span>
<span class="nitr-t-key">exec_timeout_ms</span> = <span class="nitr-t-num">30000</span></code></pre>
          </figure>
        </div>
      </section>

      <!-- EXTEND -->
      <section id="extend" class="nitr-section">
        <div class="nitr-container nitr-two-col">
          <figure class="nitr-window">
            <figcaption class="nitr-window-bar">
              <span class="nitr-window-name">main.rs</span>
              <span class="nitr-window-controls" aria-hidden="true">
                <span class="nitr-win-btn">—</span>
                <span class="nitr-win-btn">▢</span>
                <span class="nitr-win-btn nitr-win-close">✕</span>
              </span>
            </figcaption>
            <pre class="nitr-code"><code><span class="nitr-t-key">use</span> nitr::{Builtins, Server};

<span class="nitr-t-flag">#[tokio::main]</span>
<span class="nitr-t-key">async fn</span> <span class="nitr-t-cmd">main</span>() -&gt; nitr::Result {
    Server::builder()
        .listen(([<span class="nitr-t-num">127</span>, <span class="nitr-t-num">0</span>, <span class="nitr-t-num">0</span>, <span class="nitr-t-num">1</span>], <span class="nitr-t-num">3000</span>).into())
        .handler_script(<span class="nitr-t-str">"app.lua"</span>)
        .builtins(Builtins::JSON | Builtins::HTTP)
        <span class="nitr-t-comment">// Your Rust, mounted as nitr.ext.greet</span>
        .module(<span class="nitr-t-str">"greet"</span>, |lua| {
            <span class="nitr-t-key">let</span> t = lua.create_table()?;
            t.set(<span class="nitr-t-str">"hello"</span>, lua.create_function(
                |_, name: String| Ok(<span class="nitr-t-cmd">format!</span>(<span class="nitr-t-str">"Hello, {name}!"</span>)))?)?;
            Ok(t)
        })
        .build().<span class="nitr-t-key">await</span>?
        .serve().<span class="nitr-t-key">await</span>
}</code></pre>
          </figure>

          <div>
            <p class="nitr-kicker">Extensible</p>
            <h2>Bring your own Rust modules.</h2>
            <p class="nitr-sub">
              Nitr is also a library crate. Mount your own Rust modules into every Lua
              state at <code>nitr.ext.*</code> — one level below the standard library, so
              no future builtin can ever collide with them.
            </p>
            <ul class="nitr-check-list">
              <li>Rust owns what happens inside: shared state, I/O, native speed.</li>
              <li>Lua only composes it, still under its memory and time budget.</li>
              <li>Third-party extension crates need no fork.</li>
            </ul>
            <a class="nitr-link-arrow" href="/v1/library/extension-modules">
              How extension modules work →
            </a>
          </div>
        </div>
      </section>

      <!-- INSTALL -->
      <section id="install" class="nitr-section nitr-alt">
        <div class="nitr-container">
          <header class="nitr-head nitr-center">
            <p class="nitr-kicker">Get started</p>
            <h2>An application in three commands</h2>
            <p class="nitr-sub">
              Nitr is in <b>early development</b> and not ready for production. Install
              the CLI from crates.io with a Rust toolchain; pre-built binaries are not
              published yet.
            </p>
          </header>

          <div class="nitr-install-line nitr-install-no-space" role="group" aria-label="Quick install">
            <pre
              class="install-cmd nitr-code"><span class="nitr-t-cmd">cargo</span> <span class="nitr-t-dim">install</span> <span class="nitr-t-str">nitr-cli</span></pre>
            <button class="nitr-copy-btn" type="button" aria-label="Copy install command" @click="handleCopy">
              <svg class="nitr-i-copy" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8" />
                <rect x="4" y="4" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8" />
              </svg>
              <svg class="nitr-i-check" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path d="M5 12l5 5 9-11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"
                  stroke-linejoin="round" />
              </svg>
              <span>Copy</span>
            </button>
          </div>

          <div class="nitr-head nitr-center">
            <p class="nitr-sub">Then scaffold, migrate and run:</p>
          </div>

          <div class="nitr-install-line" role="group" aria-label="Scaffold and run">
            <pre
              class="install-cmd nitr-code"><span class="nitr-t-cmd">nitr</span> <span class="nitr-t-dim">init</span> <span class="nitr-t-num">&amp;&amp;</span> <span class="nitr-t-cmd">nitr</span> <span class="nitr-t-dim">migrate</span> <span class="nitr-t-num">&amp;&amp;</span> <span class="nitr-t-cmd">nitr</span> <span class="nitr-t-dim">dev</span></pre>
            <button class="nitr-copy-btn" type="button" aria-label="Copy scaffold command" @click="handleCopy">
              <svg class="nitr-i-copy" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8" />
                <rect x="4" y="4" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8" />
              </svg>
              <svg class="nitr-i-check" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path d="M5 12l5 5 9-11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"
                  stroke-linejoin="round" />
              </svg>
              <span>Copy</span>
            </button>
          </div>

          <div class="nitr-actions nitr-center">
            <a class="nitr-btn nitr-btn-primary" href="/v1/quick-start">Read the Quick Start</a>
            <a class="nitr-btn nitr-btn-ghost" href="/v1/download-install">Installation options</a>
          </div>
        </div>
      </section>
    </main>

    <!-- FOOTER -->
    <footer class="nitr-footer">
      <div class="nitr-container nitr-footer-row">
        <a class="nitr-brand" href="#top" aria-label="Nitr — home">
          <img class="nitr-logo nitr-logo-dark" src="/assets/nitr_white.svg" alt="" width="22" height="22" />
          <img class="nitr-logo nitr-logo-light" src="/assets/nitr.svg" alt="" width="22" height="22" />
          <span>Nitr</span>
        </a>

        <nav class="nitr-footer-nav" aria-label="Footer">
          <a href="/v1/">Docs</a>
          <a href="/v1/api/">API</a>
          <a href="/v1/library/">Library</a>
          <a href="https://github.com/nitrweb/nitr" target="_blank" rel="noopener">GitHub</a>
          <a href="https://github.com/nitrweb/nitr/releases" target="_blank" rel="noopener">Releases</a>
        </nav>

        <p class="nitr-footer-meta">
          Copyright &copy; 2024-present <a href="https://joseluisq.net" target="_blank" rel="noopener">Jose
            Quintana</a> | Dual-licensed
          <a href="https://github.com/nitrweb/nitr/blob/master/LICENSE-MIT" target="_blank" rel="noopener">MIT</a> /
          <a href="https://github.com/nitrweb/nitr/blob/master/LICENSE-APACHE" target="_blank"
            rel="noopener">Apache-2.0</a>.
        </p>
      </div>
    </footer>

  </div>
</template>

<style scoped>
  /*  */
</style>

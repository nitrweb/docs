<script setup lang="ts">
/**
 * The landing page's own footer. Which logo shows is decided in CSS from
 * the theme (see styles/header.css) rather than from `isDark`, so the
 * right one is already painted on the server-rendered HTML.
 */
</script>

<template>
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
        <a href="/v1/examples">Examples</a>
        <a href="https://github.com/nitrweb/nitr" target="_blank" rel="noopener">GitHub</a>
        <a href="https://github.com/nitrweb/nitr/releases" target="_blank" rel="noopener">Releases</a>
      </nav>

      <p class="nitr-footer-meta">
        Copyright &copy; 2024-present
        <a href="https://joseluisq.net" target="_blank" rel="noopener">Jose Quintana</a>
        | Dual-licensed
        <a href="https://github.com/nitrweb/nitr/blob/master/LICENSE-MIT" target="_blank" rel="noopener">MIT</a> /
        <a href="https://github.com/nitrweb/nitr/blob/master/LICENSE-APACHE" target="_blank"
          rel="noopener">Apache-2.0</a>.
      </p>
    </div>
  </footer>
</template>

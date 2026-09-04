<script setup lang="ts">
import CopyLine from './CopyLine.vue'
</script>

<template>
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

      <CopyLine label="install" tight>
        <span class="nitr-t-cmd">cargo</span> <span class="nitr-t-dim">install</span> <span
          class="nitr-t-str">nitr-cli</span>
      </CopyLine>

      <div class="nitr-head nitr-center">
        <p class="nitr-sub">Then scaffold, migrate and run:</p>
      </div>

      <CopyLine label="scaffold and run">
        <span class="nitr-t-cmd">nitr</span> <span class="nitr-t-dim">init</span> <span
          class="nitr-t-num">&amp;&amp;</span> <span class="nitr-t-cmd">nitr</span> <span
          class="nitr-t-dim">migrate</span> <span class="nitr-t-num">&amp;&amp;</span> <span
          class="nitr-t-cmd">nitr</span> <span class="nitr-t-dim">dev</span>
      </CopyLine>

      <div class="nitr-actions nitr-center">
        <a class="nitr-btn nitr-btn-primary" href="/v1/quick-start">Read the Quick Start</a>
        <a class="nitr-btn nitr-btn-ghost" href="/v1/download-install">Installation options</a>
      </div>
    </div>
  </section>
</template>

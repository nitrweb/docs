<script setup lang="ts">
/**
 * The four pillars. Icons are inline paths so they inherit
 * `--nitr-text-strong` from the chip and stay legible in both themes.
 */
const CARDS = [
  {
    title: 'Parallel by construction',
    path: 'M13 2 4 14h6l-1 8 9-12h-6l1-8z',
    body: 'A fixed pool of independent Lua states, one per CPU core. No global lock, because there is no global interpreter.'
  },
  {
    title: 'Safe by default',
    path: 'M12 2 4 5v7c0 5 3.4 9.3 8 10 4.6-.7 8-5 8-10V5l-8-3z',
    body: 'No <code>io</code> or <code>os</code>, an 8 MiB heap cap, and an execution budget that actually stops a runaway loop.'
  },
  {
    title: 'One-file deploys',
    path: 'M12 2 3 6.5v11L12 22l9-4.5v-11L12 2Zm0 2.2 6.8 3.3L12 10.8 5.2 7.5 12 4.2Zm-7 5.1 6 2.9v8.2l-6-3v-8.1Zm14 0v8.1l-6 3v-8.2l6-2.9Z',
    body: '<code>nitr build</code> packs config, Lua, templates, static files and migrations into a single executable.'
  },
  {
    title: 'One namespace',
    path: 'M3 5h18v3H3zM3 10h12v3H3zM3 15h18v3H3z',
    body: 'Everything lives under <code>nitr.*</code>, and your own Rust modules mount at <code>nitr.ext.*</code>, where no builtin can collide.'
  }
]
</script>

<template>
  <section id="why" class="nitr-section">
    <div class="nitr-container">
      <header class="nitr-head">
        <p class="nitr-kicker">Why Nitr</p>
        <h2>A scripting language where it helps, Rust where it matters</h2>
        <p class="nitr-sub">
          Dynamic handlers should be quick to write and easy to change. Nitr combines
          the simplicity of Lua with the performance, safety, and reliability of Rust;
          so the infrastructure stays out of your way.
        </p>
      </header>

      <div class="nitr-grid nitr-grid-4">
        <article v-for="(card, i) in CARDS" :key="card.title" class="nitr-card" data-reveal :style="{ '--i': i }">
          <div class="nitr-card-head">
            <span class="nitr-card-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path :d="card.path" fill="currentColor" />
              </svg>
            </span>
            <h3>{{ card.title }}</h3>
          </div>
          <p v-html="card.body"></p>
        </article>
      </div>
    </div>
  </section>
</template>

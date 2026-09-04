<script setup lang="ts">
import RequestFlow from './RequestFlow.vue'
import LifecycleFlow from './LifecycleFlow.vue'
</script>

<template>
  <section id="how" class="nitr-section nitr-alt">
    <div class="nitr-container">
      <header class="nitr-head">
        <p class="nitr-kicker">How it works</p>
        <h2>Rust answers the request. Lua answers the interesting ones.</h2>
        <p class="nitr-sub">
          A request crosses the Rust core first. Static files, redirects, CORS
          preflights, 404s and every size limit are settled there — a Lua state is
          only checked out when a dynamic route actually matches.
        </p>
      </header>

      <RequestFlow />

      <header class="nitr-head nitr-head-mid">
        <h2>Work happens once, not per request</h2>
        <p class="nitr-sub">
          Three scripts, three frequencies. Routes and middleware are compiled when
          a state loads, so dispatching a request is just: match, call.
        </p>
      </header>

      <LifecycleFlow />

      <br />
      <p>
        <a class="nitr-link-arrow" href="/v1/how-it-works">
          Read the full execution model →
        </a>
      </p>
    </div>
  </section>
</template>

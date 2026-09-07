<script setup lang="ts">
import CodeWindow from './CodeWindow.vue'

const k = (t: string) => `<span class="nitr-t-key">${t}</span>`
const s = (t: string) => `<span class="nitr-t-str">${t}</span>`
const n = (t: string) => `<span class="nitr-t-num">${t}</span>`
const c = (t: string) => `<span class="nitr-t-comment">${t}</span>`

const CODE = `${k('listen')} = ${s('"127.0.0.1:3000"')}
${k('handler_script')} = ${s('"app.lua"')}
${k('config_script')} = ${s('"config.lua"')}

${c('# SQLite: WAL, busy timeout, foreign keys on')}
${n('[database]')}
${k('path')} = ${s('"data/app.db"')}

${c('# Which nitr.* modules scripts may use')}
${n('[std]')}
${k('features')} = [${s('"json"')}, ${s('"http"')}, ${s('"log"')}, ${s('"db"')}]

${c('# The API document, generated from your routes')}
${n('[openapi]')}
${k('enabled')} = ${k('true')}

${c('# Swagger UI, served from this binary')}
${n('[swagger]')}
${k('enabled')} = ${k('true')}

${c('# The sandbox')}
${n('[lua]')}
${k('memory_limit')}    = ${n('8388608')}
${k('exec_timeout_ms')} = ${n('30000')}`
</script>

<template>
  <section id="config" class="nitr-section">
    <div class="nitr-container nitr-two-col">
      <div data-reveal>
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
        <p class="nitr-callout">
          <svg class="nitr-callout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 8h.01M11 12h1v4h1M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z" />
          </svg>
          <span>
            Every setting is optional. With no <code>nitr.toml</code> at all, Nitr
            listens on <code>127.0.0.1:3000</code> and runs
            <code>scripts/handler.lua</code>.
          </span>
        </p>
        <a class="nitr-link-arrow" href="/v1/server/configuration/file">
          See all options →
        </a>
      </div>

      <div class="nitr-two-col-code" data-reveal style="--i: 1">
        <CodeWindow name="nitr.toml" lang="toml" :code="CODE" />
      </div>
    </div>
  </section>
</template>

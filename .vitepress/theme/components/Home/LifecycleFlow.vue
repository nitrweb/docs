<script setup lang="ts">
import CodeWindow from './CodeWindow.vue'

/**
 * config.lua → app.lua → your handler: what runs once, what runs per
 * state, and the only thing that runs per request.
 *
 * No interaction — the whole block carries `data-reveal` and plays its
 * entrance once when it scrolls into view (styles/diagram.css).
 */
const k = (t: string) => `<span class="nitr-t-key">${t}</span>`
const s = (t: string) => `<span class="nitr-t-str">${t}</span>`
const c = (t: string) => `<span class="nitr-t-comment">${t}</span>`
const f = (t: string) => `<span class="nitr-t-flag">${t}</span>`
const N = `<span class="nitr-t-cmd">nitr</span>`

const STEPS = [
  {
    key: 'config',
    when: 'Once, at startup',
    dots: 1,
    countLabel: 'runs once',
    file: 'config.lua',
    title: 'Prepare',
    summary:
      'Runs a single time before any request. Whatever it returns is snapshotted into every state as <code>nitr.cfg</code>.',
    code: `${c('-- The db connection arrives as the vararg.')}
${k('local')} db = ...
db:${f('execute')}(${s('"PRAGMA optimize"')})

${k('return')} {
    app_name   = ${s('"notes"')},
    started_at = ${N}.time.${f('now')}(),
}`
  },
  {
    key: 'app',
    when: 'Once per state',
    dots: 4,
    countLabel: 'runs once per worker',
    file: 'app.lua',
    title: 'Build',
    summary:
      'Describes the application. Middleware and the router are composed here — at load, not on the hot path.',
    code: `${k('local')} app = ${N}.${f('app')}()

app:${f('use')}(logging)
app:${f('get')}(${s('"/notes/:id"')}, show_note)

${c('-- Compiled once; from here on: match, call.')}
${k('return')} app`
  },
  {
    key: 'handler',
    when: 'Per request',
    dots: 8,
    countLabel: 'runs on every request',
    file: 'show_note',
    title: 'Answer',
    summary:
      'The only code that runs per request — inside a memory cap and an execution budget that stops a runaway loop.',
    code: `${k('local')} ${k('function')} show_note(req)
    ${k('local')} note = ${N}.db:${f('query_row')}(
        ${s('"SELECT * FROM notes WHERE id = ?"')},
        { req.params.id })
    ${k('return')} ${N}.${f('json')}(note)
${k('end')}`
  }
]

// All three windows share the tallest sample's height, so the row keeps
// a flat baseline instead of stair-stepping.
const MAX_LINES = Math.max(
  ...STEPS.map((step) => step.code.replace(/<[^>]+>/g, '').split('\n').length)
)
</script>

<template>
  <div class="nitr-lc" data-reveal>
    <template v-for="(step, i) in STEPS" :key="step.key">
      <div class="nitr-lc-node" :class="`nitr-lc-${i + 1}`">
        <span class="nitr-lc-when">
          {{ step.when }}
          <span class="nitr-lc-count" :class="{ 'is-many': step.dots > 4 }" role="img"
            :aria-label="step.countLabel">
            <i v-for="d in step.dots" :key="d"></i>
          </span>
        </span>
        <h3 class="nitr-lc-title">{{ step.title }}</h3>
        <CodeWindow :name="step.file" lang="lua" :code="step.code" :min-lines="MAX_LINES" compact />
        <p class="nitr-lc-sum" v-html="step.summary"></p>
      </div>

      <span v-if="i < STEPS.length - 1" class="nitr-lc-link" :class="`nitr-lc-l${i + 1}`" aria-hidden="true">
        <svg viewBox="0 0 42 24">
          <path class="nitr-lc-line" d="M2 12h34" />
          <path class="nitr-lc-head" d="M30 6l7 6-7 6" />
        </svg>
      </span>
    </template>
  </div>
</template>

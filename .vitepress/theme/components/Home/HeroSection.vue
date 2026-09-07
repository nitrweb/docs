<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import CodeWindow from './CodeWindow.vue'

/**
 * The hero, with a rotating set of short `app.lua` samples on the right.
 *
 * Each sample is a complete, correct handler script — nothing here is a
 * pseudo-code sketch — and each shows one or two builtins the reader
 * might not guess Nitr has. The rotation pauses while the pointer or
 * keyboard focus is on the window, and does not run at all under
 * `prefers-reduced-motion`.
 */

// Token helpers so the samples read as code rather than as markup soup.
const k = (t: string) => `<span class="nitr-t-key">${t}</span>`
const s = (t: string) => `<span class="nitr-t-str">${t}</span>`
const n = (t: string) => `<span class="nitr-t-num">${t}</span>`
const c = (t: string) => `<span class="nitr-t-comment">${t}</span>`
const ns = (t: string) => `<span class="nitr-t-cmd">${t}</span>`
const f = (t: string) => `<span class="nitr-t-flag">${t}</span>`
const N = ns('nitr')

interface Example {
  id: string
  label: string
  file: string
  code: string
}

const EXAMPLES: Example[] = [
  {
    id: 'hello',
    label: 'Simple',
    file: 'app.lua',
    code: `${k('local')} app = ${N}.${f('app')}()

${c('-- A route. Path parameters arrive in req.params.')}
app:${f('get')}(${s('"/hello/:name"')}, ${k('function')}(req)
    ${k('return')} ${N}.${f('json')}({ hello = req.params.name })
${k('end')})

${c('-- That is a complete application.')}
${k('return')} app`
  },
  {
    id: 'validate',
    label: 'Validation',
    file: 'app.lua',
    code: `${k('local')} app = ${N}.${f('app')}()

${c('-- Compiled once, checked in Rust.')}
${k('local')} User = ${N}.validate.${f('schema')}({
    email = ${s('"string|trim|case:lower|format:email|required"')},
    age   = ${s('"integer|min:0|max:150"')},
    tags  = { ${s('"array|max_items:5|unique"')}, items = ${s('"string|format:slug"')} },
})

${c('-- Checked BEFORE the handler runs. A bad body')}
${c('-- never gets here; it gets a 422 naming every field.')}
app:${f('post')}(${s('"/users"')}, ${k('function')}(req)
    ${k('return')} ${N}.${f('json')}(create_user(req.valid.body), ${n('201')})
${k('end')}, { input = { body = User } })

${k('return')} app`
  },
  {
    id: 'openapi',
    label: 'OpenAPI',
    file: 'app.lua',
    code: `${k('local')} app = ${N}.${f('app')}()

app:${f('doc')}({ title = ${s('"Notes"')}, version = ${s('"1.0.0"')} })

${c('-- `input` enforces, `doc` describes. The document')}
${c('-- at /openapi.json is generated from both.')}
app:${f('post')}(${s('"/api/notes"')}, create_note, {
    input = { body = NoteInput },
    doc = {
        summary = ${s('"Create a note"')},
        tags = { ${s('"notes"')} },
        responses = { [${n('201')}] = { description = ${s('"Created"')} } },
    },
})

${c('-- Swagger UI at /docs, served from the binary.')}
${k('return')} app`
  },
  {
    id: 'static',
    label: 'Static files',
    file: 'app.lua',
    code: `${k('local')} app = ${N}.${f('app')}()

${c('-- Served entirely in Rust: content types, ETag,')}
${c('-- 304s, range requests, traversal protection.')}
app:${f('static')}(${s('"/assets"')}, ${s('"public/assets"')}, {
    cache_control = ${s('"public, max-age=31536000, immutable"')},
})

${c('-- An SPA falls back to index.html for unknown paths.')}
app:${f('static')}(${s('"/"')}, ${s('"dist"')}, { spa = ${k('true')} })

${k('return')} app`
  },
  {
    id: 'db',
    label: 'Database',
    file: 'app.lua',
    code: `${k('local')} app = ${N}.${f('app')}()

${c('-- Middleware: composed once, not per request.')}
app:${f('use')}(${k('function')}(next)
    ${k('return')} ${k('function')}(req)
        ${N}.log.${f('info')}(${s('"request"')}, { path = req.path })
        ${k('return')} next(req)
    ${k('end')}
${k('end')})

app:${f('get')}(${s('"/users/:id"')}, ${k('function')}(req)
    ${k('local')} user = ${N}.db:${f('query_row')}(
        ${s('"SELECT id, name FROM users WHERE id = ?"')},
        { req.params.id }
    )
    ${k('if')} ${k('not')} user ${k('then')}
        ${k('return')} ${N}.${f('error')}(${n('404')}, { code = ${s('"NOT_FOUND"')} })
    ${k('end')}
    ${k('return')} ${N}.${f('json')}(user)
${k('end')})

${k('return')} app`
  },
  {
    id: 'auth',
    label: 'Basic auth',
    file: 'app.lua',
    code: `${k('local')} app = ${N}.${f('app')}()

${c('-- Minted with: nitr hash-password')}
${k('local')} users = { ada = ${s('"$argon2id$v=19$m=19456,…"')} }

app:${f('get')}(${s('"/private"')}, ${k('function')}(req)
    ${k('local')} user, pass = ${N}.auth.${f('basic')}(req)
    ${k('local')} hash = user ${k('and')} users[user]
    ${k('local')} ok = ${k('false')}
    ${k('if')} hash ${k('then')}
        ok = ${N}.crypto.${f('password_verify')}(pass, hash)
    ${k('else')}
        ${c('-- Same cost for unknown users: no timing oracle.')}
        ${N}.crypto.${f('password_verify_dummy')}(pass ${k('or')} ${s('""')})
    ${k('end')}
    ${k('if')} ${k('not')} ok ${k('then')}
        ${k('return')} ${N}.${f('error')}(${n('401')}, ${s('"Unauthorized"')})
    ${k('end')}
    ${k('return')} ${N}.${f('text')}(${s('"hello, "')} .. user)
${k('end')})

${k('return')} app`
  },
  {
    id: 'sse',
    label: 'SSE',
    file: 'app.lua',
    code: `${k('local')} app = ${N}.${f('app')}()

${c('-- A streaming text/event-stream response.')}
app:${f('get')}(${s('"/events"')}, ${k('function')}(req)
    ${k('return')} ${N}.${f('sse')}(${k('function')}(send)
        ${k('for')} i = ${n('1')}, ${n('5')} ${k('do')}
            ${c('-- Tables are JSON-encoded.')}
            send(${s('"tick"')}, { count = i })
        ${k('end')}
        send(${s('"done"')}, ${s('"stream finished"')})
    ${k('end')})
${k('end')})

${k('return')} app`
  },
  {
    id: 'session',
    label: 'Sessions',
    file: 'app.lua',
    code: `${k('local')} app = ${N}.${f('app')}()

${c('-- A stateless, signed-cookie session: no store to run.')}
app:${f('post')}(${s('"/login"')}, ${k('function')}(req)
    ${k('local')} form = req:${f('form')}()
    ${k('local')} user = login(form.username, form.password)
    ${k('if')} ${k('not')} user ${k('then')}
        ${k('return')} ${N}.${f('error')}(${n('401')}, { code = ${s('"BAD_LOGIN"')} })
    ${k('end')}

    ${k('local')} session = ${N}.${f('session')}(req,
        { secret = ${N}.cfg.session_secret })
    session.user_id = user.id

    ${k('local')} res = ${N}.${f('redirect')}(${s('"/dashboard"')}, ${n('303')})
    session:${f('save')}(res)
    ${k('return')} res
${k('end')})

${k('return')} app`
  }
]

// Reserve the tallest sample's height so the window never resizes as
// examples rotate through it.
const MAX_LINES = Math.max(
  ...EXAMPLES.map((e) => e.code.replace(/<[^>]+>/g, '').split('\n').length)
)

const INTERVAL_MS = 7000

const index = ref(0)
const counting = ref(false)
const current = computed(() => EXAMPLES[index.value])

// Hovering pauses without changing the visitor's own play/pause choice,
// so moving the pointer away resumes only if they had not stopped it.
const hovering = ref(false)
const stopped = ref(false)
const paused = computed(() => hovering.value || stopped.value)

let timer: ReturnType<typeof setTimeout> | undefined
let autoplay = false

function clearTimer() {
  clearTimeout(timer)
  timer = undefined
}

function arm() {
  clearTimer()
  if (!autoplay || paused.value) {
    counting.value = false
    return
  }
  counting.value = true
  timer = setTimeout(() => {
    if (paused.value) return
    index.value = (index.value + 1) % EXAMPLES.length
    arm()
  }, INTERVAL_MS)
}

function select(i: number) {
  index.value = i
  arm()
}

function hover(on: boolean) {
  hovering.value = on
  if (!on && !stopped.value) arm()
}

function toggle() {
  stopped.value = !stopped.value
  if (stopped.value) clearTimer()
  else arm()
}

onMounted(() => {
  const reduced =
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  autoplay = !reduced
  arm()
})

onUnmounted(clearTimer)
</script>

<template>
  <section id="top" class="nitr-hero">
    <div class="nitr-container nitr-hero-grid">
      <div class="nitr-hero-text">
        <h1 data-reveal style="--i: 0">
          Write lean <span class="nitr-accent">Lua</span> dynamic backends powered by
          <span class="nitr-accent">Rust</span>
        </h1>

        <p class="nitr-lead" data-reveal style="--i: 1">
          Nitr serves HTTP with embedded Lua 5.4. You write the dynamic logic parts.
          The routing, SQLite, templates, crypto and the rest of HTTP are already Rust
          and every script runs inside a sandbox.
        </p>

        <div class="nitr-actions" data-reveal style="--i: 2">
          <a class="nitr-btn nitr-btn-primary" href="/v1/quick-start">Get started</a>
          <a class="nitr-btn nitr-btn-ghost" href="https://github.com/nitrweb/nitr" target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor">
              <path
                d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.69-3.87-1.54-3.87-1.54-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.04 1.78 2.72 1.27 3.38.97.1-.76.4-1.27.73-1.56-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.2-3.1-.12-.3-.52-1.48.11-3.09 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.18-1.18 3.18-1.18.63 1.61.23 2.79.11 3.09.75.81 1.2 1.84 1.2 3.1 0 4.43-2.69 5.41-5.25 5.69.41.36.78 1.06.78 2.14v3.18c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
            </svg>
            GitHub
          </a>
        </div>

        <ul class="nitr-meta" data-reveal style="--i: 3">
          <li>One binary</li>
          <li>Lua 5.4, sandboxed</li>
          <li>MIT / Apache-2.0</li>
        </ul>
      </div>

      <div class="nitr-hero-art" data-reveal style="--i: 2" @mouseenter="hover(true)" @mouseleave="hover(false)"
        @focusin="hover(true)" @focusout="hover(false)">
        <CodeWindow :name="current.file" lang="lua" :code="current.code" :min-lines="MAX_LINES" />

        <div class="nitr-tabs-row">
          <button type="button" class="nitr-play" :aria-label="stopped ? 'Play the example rotation' : 'Pause the example rotation'"
            @click="toggle">
            <svg v-if="stopped" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
              <path d="M3 1.6v8.8L10 6z" />
            </svg>
            <svg v-else viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
              <rect x="2.2" y="1.8" width="3" height="8.4" rx="0.7" />
              <rect x="6.8" y="1.8" width="3" height="8.4" rx="0.7" />
            </svg>
          </button>

          <ul class="nitr-tabs" role="tablist" aria-label="Example applications">
            <li v-for="(ex, i) in EXAMPLES" :key="ex.id" role="presentation">
            <button type="button" role="tab" class="nitr-tab" :class="{
              'is-active': i === index,
              'is-counting': counting && i === index,
              'is-paused': paused
            }" :aria-selected="i === index" :style="{ '--nitr-tab-ms': `${INTERVAL_MS}ms` }" @click="select(i)">
              {{ ex.label }}
            </button>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import CodeWindow from './CodeWindow.vue'

/**
 * The developer loop, one stage at a time: scaffold, develop, test,
 * check, ship. Each stage explains itself on the left and plays a
 * terminal transcript on the right, line by line, so the reader sees
 * what the tool actually says back rather than a paragraph about it.
 *
 * Playback starts when the section scrolls into view, then follows the
 * reader's clicks. Under `prefers-reduced-motion` every transcript is
 * shown complete, at once.
 */

type Kind = 'cmd' | 'out' | 'ok' | 'err' | 'dim' | 'blank'

interface Line {
  kind: Kind
  text: string
}

interface Stage {
  id: string
  label: string
  icon: string
  title: string
  blurb: string
  points: string[]
  lines: Line[]
}

const STAGES: Stage[] = [
  {
    id: 'init',
    label: 'Scaffold',
    icon: 'M4 5a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM12 10v6M9 13h6',
    title: 'A working app in one command',
    blurb:
      '<code>nitr init</code> writes the layout the CLI expects — routes, a migration, a template, a test — and the pieces already fit together.',
    points: [
      '<code>nitr-types.lua</code> gives your editor completion and inline docs for every <code>nitr.*</code> call.',
      '<code>--minimal</code> for a four-file version when you only need one endpoint.',
      'It refuses to overwrite: running it in a non-empty directory is safe.'
    ],
    lines: [
      { kind: 'cmd', text: 'nitr init' },
      { kind: 'out', text: 'created nitr.toml' },
      { kind: 'out', text: 'created config.lua' },
      { kind: 'out', text: 'created app.lua' },
      { kind: 'out', text: 'created routes/notes.lua' },
      { kind: 'out', text: 'created migrations/001_init.sql' },
      { kind: 'out', text: 'created tests/notes_test.lua' },
      { kind: 'out', text: 'created nitr-types.lua' },
      { kind: 'blank', text: '' },
      { kind: 'dim', text: 'Next steps:' },
      { kind: 'dim', text: '  nitr migrate' },
      { kind: 'dim', text: '  nitr check' },
      { kind: 'dim', text: '  nitr test' },
      { kind: 'dim', text: '  nitr dev' }
    ]
  },
  {
    id: 'dev',
    label: 'Develop',
    icon: 'M13 2 4 14h6l-1 8 9-12h-6l1-8z',
    title: 'Save the file, hit refresh',
    blurb:
      '<code>nitr dev</code> watches your Lua and templates and rebuilds the state pool on save — no restart, no dropped connections.',
    points: [
      'A failing handler answers with the source line, traceback and cause chain, in the browser.',
      'Debug-level spans show where a request spent its time: pool wait, Lua, database, upstream.',
      'Static files, the database and editor swap files are ignored, so one save is one rebuild.'
    ],
    lines: [
      { kind: 'cmd', text: 'nitr dev' },
      { kind: 'ok', text: 'listening on http://127.0.0.1:3000  (dev mode)' },
      { kind: 'out', text: 'watching app.lua, routes/, templates/' },
      { kind: 'blank', text: '' },
      { kind: 'dim', text: 'request{id=018f… method=GET path=/api/notes status=200} 3.2ms' },
      { kind: 'blank', text: '' },
      { kind: 'ok', text: 'routes/notes.lua changed — pool rebuilt in 11ms' },
      { kind: 'blank', text: '' },
      { kind: 'err', text: 'lua error: attempt to index a nil value (local \'note\')' },
      { kind: 'dim', text: '  --> routes/notes.lua:14' },
      { kind: 'dim', text: '   |     return nitr.json(note.text)' },
      { kind: 'dim', text: '   |                      ^ shown in the response, too' }
    ]
  },
  {
    id: 'test',
    label: 'Test',
    icon: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3',
    title: 'Tests that go through the real router',
    blurb:
      '<code>nitr test</code> runs your Lua tests against an in-process server. Requests dispatch through the actual middleware chain — nothing is mocked.',
    points: [
      '<code>describe</code> / <code>it</code> / <code>expect</code>, with <code>before_each</code> and <code>after_each</code> per file.',
      'A failure names the assertion, both values, and the <code>file:line</code>.',
      '<code>--filter</code> runs one test while you iterate.'
    ],
    lines: [
      { kind: 'cmd', text: 'nitr test --filter notes' },
      { kind: 'ok', text: 'notes API › starts empty              ok' },
      { kind: 'ok', text: 'notes API › creates a note            ok' },
      { kind: 'err', text: 'notes API › rejects an empty note     FAILED' },
      { kind: 'dim', text: '  tests/notes_test.lua:22: expected 422, got 201' },
      { kind: 'blank', text: '' },
      { kind: 'out', text: '2 passed, 1 failed' }
    ]
  },
  {
    id: 'check',
    label: 'Check',
    icon: 'M12 3l8 3v6c0 4.4-3.2 8.3-8 9-4.8-.7-8-4.6-8-9V6zM9 12l2 2 4-4',
    title: 'Fail in CI, not at startup',
    blurb:
      '<code>nitr check</code> loads the configuration and every script without binding a port. Typos, missing paths and pending migrations stop right there.',
    points: [
      'Unknown or renamed keys in <code>nitr.toml</code> are errors, never silently ignored.',
      '<code>--print-config</code> shows the effective value after file, environment and flags.',
      'A pending migration is caught before a deploy, not after.'
    ],
    lines: [
      { kind: 'cmd', text: 'nitr check' },
      { kind: 'err', text: 'error: unknown configuration key `hander_script`' },
      { kind: 'dim', text: '  --> nitr.toml:2   did you mean `handler_script`?' },
      { kind: 'blank', text: '' },
      { kind: 'cmd', text: 'NITR_WORKERS=8 nitr check --print-config' },
      { kind: 'out', text: 'handler_script = "app.lua"' },
      { kind: 'out', text: 'listen = "127.0.0.1:3000"' },
      { kind: 'ok', text: 'workers = 8' },
      { kind: 'dim', text: '…' }
    ]
  },
  {
    id: 'ship',
    label: 'Ship',
    icon: 'M12 2 3 6.5v11L12 22l9-4.5v-11L12 2ZM12 22V12M12 12 3 6.5M12 12l9-5.5',
    title: 'One file to copy',
    blurb:
      '<code>nitr build</code> appends your whole application to the binary. Copy one executable to a server; the database stays external, on purpose.',
    points: [
      'Config, Lua, templates, static files and migrations travel together.',
      '<code>dev_mode</code> is forced off in the artifact — no tracebacks leak from a shipped build.',
      '<code>SIGHUP</code> or <code>nitr reload</code> rebuilds the pool with zero downtime.'
    ],
    lines: [
      { kind: 'cmd', text: 'nitr build --output myapp' },
      { kind: 'out', text: 'bundled 14 files (nitr.toml, app.lua, routes/, templates/, …)' },
      { kind: 'ok', text: 'wrote ./myapp' },
      { kind: 'blank', text: '' },
      { kind: 'cmd', text: 'scp myapp server: && ssh server ./myapp run' },
      { kind: 'ok', text: 'listening on 0.0.0.0:3000' },
      { kind: 'blank', text: '' },
      { kind: 'cmd', text: 'ssh server ./myapp reload' },
      { kind: 'ok', text: 'sent SIGHUP: the server is rebuilding its runtime pool' }
    ]
  }
]

// The tallest transcript decides the terminal's height, so switching
// stages — or typing one in — never resizes the section below it.
const MAX_ROWS = Math.max(
  ...STAGES.map((st) =>
    st.lines.reduce((a, l) => a + (l.kind === 'blank' ? 0.36 : 1), 0)
  )
)

const LINE_MS = 240
const CMD_MS = 520

const index = ref(0)
// Starts complete, so the server-rendered page shows the whole transcript
// with JavaScript off; the client empties it on mount and types it back
// in once the section scrolls into view.
const shown = ref(STAGES[0].lines.length)
const playing = ref(false)
const stopped = ref(false)
const started = ref(false)
const root = ref<HTMLElement | null>(null)
const stage = computed(() => STAGES[index.value])
const lines = computed(() => stage.value.lines.slice(0, shown.value))
const finished = computed(() => shown.value >= stage.value.lines.length)

let timer: ReturnType<typeof setTimeout> | undefined
let observer: IntersectionObserver | null = null

const reduced = () =>
  typeof matchMedia === 'function' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches

function clearTimer() {
  clearTimeout(timer)
  timer = undefined
}

function step() {
  if (finished.value) {
    playing.value = false
    return
  }
  const next = stage.value.lines[shown.value]
  shown.value += 1
  // A command line lands with a beat before its output starts.
  timer = setTimeout(step, next.kind === 'cmd' ? CMD_MS : LINE_MS)
}

function play(i = index.value) {
  clearTimer()
  index.value = i
  shown.value = 0
  if (reduced()) {
    shown.value = stage.value.lines.length
    playing.value = false
    return
  }
  playing.value = true
  stopped.value = false
  timer = setTimeout(step, 180)
}

function toggle() {
  if (playing.value) {
    clearTimer()
    playing.value = false
    stopped.value = true
    return
  }
  stopped.value = false
  if (finished.value) return play()
  playing.value = true
  timer = setTimeout(step, LINE_MS)
}

onMounted(() => {
  if (typeof IntersectionObserver === 'undefined' || reduced()) {
    started.value = true
    shown.value = stage.value.lines.length
    return
  }
  shown.value = 0
  observer = new IntersectionObserver(
    (entries, obs) => {
      if (!entries.some((e) => e.isIntersecting)) return
      obs.disconnect()
      started.value = true
      play(0)
    },
    { threshold: 0.35 }
  )
  if (root.value) observer.observe(root.value)
})

onUnmounted(() => {
  clearTimer()
  observer?.disconnect()
})
</script>

<template>
  <section id="devx" class="nitr-section">
    <div class="nitr-container">
      <header class="nitr-head">
        <p class="nitr-kicker">Developer experience</p>
        <h2>A tight loop, from <code>nitr init</code> to one binary</h2>
        <p class="nitr-sub">
          Five commands cover the whole cycle, and each one tells you exactly what went
          wrong the moment it does — at the terminal, in the browser, or in CI.
        </p>
      </header>

      <div ref="root" class="nitr-dx">
        <!-- Stepper -->
        <ol class="nitr-dx-steps" role="tablist" aria-label="Developer loop">
          <li v-for="(s, i) in STAGES" :key="s.id" role="presentation">
            <button type="button" role="tab" class="nitr-dx-step" :class="{
              'is-active': i === index,
              'is-done': i < index
            }" :aria-selected="i === index" @click="play(i)">
              <span class="nitr-dx-step-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
                  stroke-linejoin="round">
                  <path :d="s.icon" />
                </svg>
              </span>
              <span class="nitr-dx-step-num" aria-hidden="true">{{ i + 1 }}</span>
              <span class="nitr-dx-step-label">{{ s.label }}</span>
            </button>
          </li>
        </ol>

        <div class="nitr-dx-body">
          <!-- Explanation -->
          <Transition name="nitr-dx-fade" mode="out-in">
            <div :key="stage.id" class="nitr-dx-text">
              <h3>{{ stage.title }}</h3>
              <p class="nitr-dx-blurb" v-html="stage.blurb"></p>
              <ul class="nitr-check-list">
                <li v-for="p in stage.points" :key="p" v-html="p"></li>
              </ul>
            </div>
          </Transition>

          <!-- Terminal -->
          <div class="nitr-dx-term">
            <CodeWindow :name="`~/my-app — ${stage.label.toLowerCase()}`" lang="sh">
              <pre class="nitr-code nitr-terminal" aria-live="polite" :style="{ '--nitr-term-rows': MAX_ROWS }"><TransitionGroup name="nitr-dx-line"><span
                  v-for="(l, i) in lines" :key="`${stage.id}-${i}`" class="nitr-term-line"
                  :data-kind="l.kind"><span v-if="l.kind === 'cmd'" class="nitr-t-prompt">$ </span>{{ l.text || ' ' }}</span></TransitionGroup><span
                  v-if="playing" class="nitr-term-cursor" aria-hidden="true"></span></pre>
            </CodeWindow>

            <div class="nitr-dx-controls">
              <button type="button" class="nitr-play" :aria-label="playing ? 'Pause the transcript' : 'Play the transcript'"
                @click="toggle">
                <svg v-if="playing" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                  <rect x="2.2" y="1.8" width="3" height="8.4" rx="0.7" />
                  <rect x="6.8" y="1.8" width="3" height="8.4" rx="0.7" />
                </svg>
                <svg v-else viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                  <path d="M3 1.6v8.8L10 6z" />
                </svg>
              </button>
              <button type="button" class="nitr-dx-replay" @click="play()">Replay</button>
              <span class="nitr-dx-progress" aria-hidden="true">
                <i :style="{ width: `${(shown / stage.lines.length) * 100}%` }"></i>
              </span>
            </div>
          </div>
        </div>

        <!-- The inner loop -->
        <div class="nitr-dx-loop" aria-label="Edit, save, reload, request">
          <span class="nitr-dx-loop-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
              stroke-linejoin="round" aria-hidden="true">
              <path d="M4 20h4l10-10-4-4L4 16zM13 7l4 4" />
            </svg>
            Edit
          </span>
          <span class="nitr-dx-loop-arrow" aria-hidden="true"></span>
          <span class="nitr-dx-loop-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
              stroke-linejoin="round" aria-hidden="true">
              <path d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6" />
            </svg>
            Save
          </span>
          <span class="nitr-dx-loop-arrow" aria-hidden="true"></span>
          <span class="nitr-dx-loop-item nitr-dx-loop-hot">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
              stroke-linejoin="round" aria-hidden="true">
              <path d="M20 11A8 8 0 1 0 12 20a8 8 0 0 0 7-4M20 5v6h-6" />
            </svg>
            Reload <b>~10 ms</b>
          </span>
          <span class="nitr-dx-loop-arrow" aria-hidden="true"></span>
          <span class="nitr-dx-loop-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
              stroke-linejoin="round" aria-hidden="true">
              <path d="M3 12h18M13 6l6 6-6 6" />
            </svg>
            Request
          </span>
          <span class="nitr-dx-loop-note">
            Only the Lua pool is rebuilt; the listener and every keep-alive connection survive.
          </span>
        </div>
      </div>

      <br />
      <p>
        <a class="nitr-link-arrow" href="/v1/server/cli">All CLI commands →</a>
      </p>
    </div>
  </section>
</template>

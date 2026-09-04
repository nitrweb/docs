<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'

/**
 * An interactive model of Nitr's request path.
 *
 * The point it exists to make is the one that is hard to believe from
 * prose alone: of six ordinary requests, only one reaches Lua. Firing
 * them and watching where each stops makes that concrete — and the
 * "Lua states used" counter keeps the score.
 *
 * Every scenario below is grounded in the documented lifecycle
 * (/v1/how-it-works) and the status table in /v1/server/errors.
 */

type StageId = 'client' | 'guard' | 'core' | 'pool' | 'lua'

interface Stage {
  id: StageId
  title: string
  lang?: string
  sub: string
}

interface Scenario {
  id: string
  method: string
  path: string
  /** Extra precondition shown on the chip, e.g. a saturated pool. */
  note?: string
  stopAt: StageId
  status: number
  /** Short label for where it was answered. */
  answer: string
  why: string
  reachesLua: boolean
}

const STAGES: Stage[] = [
  {
    id: 'client',
    title: 'Client',
    sub: 'Browser, mobile app, curl, another service'
  },
  {
    id: 'guard',
    title: 'Connection guard',
    lang: 'Rust',
    sub: 'TLS handshake, header/URI/body caps, per-IP rate limit'
  },
  {
    id: 'core',
    title: 'Nitr core',
    lang: 'Rust',
    sub: 'Health probes, CORS, static files, route matching'
  },
  {
    id: 'pool',
    title: 'State pool',
    lang: 'Rust',
    sub: 'Checks out one of the pooled Lua states'
  },
  {
    id: 'lua',
    title: 'Your handler',
    lang: 'Lua',
    sub: 'Middleware chain, then the route you registered'
  }
]

const SCENARIOS: Scenario[] = [
  {
    id: 'dynamic',
    method: 'GET',
    path: '/users/42',
    stopAt: 'lua',
    status: 200,
    answer: 'Your handler ran',
    reachesLua: true,
    why: 'The router matched a dynamic route, so a Lua state was checked out and your middleware chain and handler ran. This is the only request here that costs one.'
  },
  {
    id: 'static',
    method: 'GET',
    path: '/assets/app.css',
    stopAt: 'core',
    status: 200,
    answer: 'Served from disk, in Rust',
    reachesLua: false,
    why: 'A static mount matched. Nitr answered with the right content type, an <code>ETag</code> and <code>Last-Modified</code> — and the next request gets a <code>304</code> for even less.'
  },
  {
    id: 'preflight',
    method: 'OPTIONS',
    path: '/api/notes',
    note: 'CORS preflight',
    stopAt: 'core',
    status: 204,
    answer: 'Preflight answered',
    reachesLua: false,
    why: 'The configured <code>[cors]</code> policy answered it in Rust. Your handler never sees a preflight, so there is no CORS middleware to forget to install.'
  },
  {
    id: 'notfound',
    method: 'GET',
    path: '/nope',
    stopAt: 'core',
    status: 404,
    answer: 'Nothing matched',
    reachesLua: false,
    why: 'No route and no static mount matched, so Nitr answered <code>404</code> itself. A wrong method on a real path gets <code>405</code> with <code>Allow</code> the same way.'
  },
  {
    id: 'toobig',
    method: 'POST',
    path: '/api/notes',
    note: '2 MB body',
    stopAt: 'guard',
    status: 413,
    answer: 'Over the body cap',
    reachesLua: false,
    why: '<code>[limits] max_body_bytes</code> defaults to 1 MiB and is counted as the body arrives, not trusted from <code>Content-Length</code>. It is refused before routing even happens.'
  },
  {
    id: 'shed',
    method: 'GET',
    path: '/users/42',
    note: 'pool saturated',
    stopAt: 'pool',
    status: 503,
    answer: 'Shed with Retry-After',
    reachesLua: false,
    why: 'Every state stayed busy longer than <code>[limits] pool_wait_ms</code>, so the request was shed with <code>503</code> and <code>Retry-After: 1</code> — deliberate backpressure, applied before any Lua runs.'
  }
]

/** Time the request spends crossing each stage. */
const STEP_MS = 950
/** Time for the response to travel back. */
const RETURN_MS = 750

type Status = 'idle' | 'running' | 'paused' | 'done'

const current = ref<Scenario>(SCENARIOS[0])
const status = ref<Status>('idle')
/** Index of the stage the request has reached; -1 before it departs. */
const cursor = ref(-1)
const returning = ref(false)
const statesUsed = ref(0)
const requestsSent = ref(0)

let timer: ReturnType<typeof setTimeout> | undefined

const stopIndex = computed(() =>
  STAGES.findIndex((s) => s.id === current.value.stopAt)
)
const done = computed(() => status.value === 'done')
const inFlight = computed(
  () => status.value === 'running' || status.value === 'paused'
)

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches

function clearTimer() {
  clearTimeout(timer)
  timer = undefined
}

function settle() {
  clearTimer()
  status.value = 'done'
  requestsSent.value += 1
  if (current.value.reachesLua) statesUsed.value += 1
}

/**
 * One tick of the simulation. Each tick schedules the next, which is
 * what makes pausing trivial: clear the pending timer, and resuming is
 * just calling `step` again from wherever the cursor stopped.
 */
function step() {
  const stop = stopIndex.value
  if (cursor.value < stop) {
    cursor.value += 1
    timer = setTimeout(step, STEP_MS)
    return
  }
  if (!returning.value) {
    returning.value = true
    timer = setTimeout(step, RETURN_MS)
    return
  }
  settle()
}

function run(scenario: Scenario) {
  clearTimer()
  current.value = scenario
  cursor.value = -1
  returning.value = false

  // Reduced motion: no travel, just the answer.
  if (prefersReducedMotion()) {
    cursor.value = stopIndex.value
    settle()
    return
  }

  status.value = 'running'
  timer = setTimeout(step, 140)
}

function pause() {
  clearTimer()
  status.value = 'paused'
}

function resume() {
  status.value = 'running'
  timer = setTimeout(step, STEP_MS / 2)
}

/** A chip plays its scenario; pressing the one in flight pauses it. */
function onChip(scenario: Scenario) {
  const isCurrent = current.value.id === scenario.id
  if (isCurrent && status.value === 'running') return pause()
  if (isCurrent && status.value === 'paused') return resume()
  run(scenario)
}

function chipLabel(scenario: Scenario) {
  const what = `${scenario.method} ${scenario.path}${scenario.note ? ` (${scenario.note})` : ''}`
  if (current.value.id !== scenario.id) return `Send ${what}`
  if (status.value === 'running') return `Pause ${what}`
  if (status.value === 'paused') return `Resume ${what}`
  return `Send ${what} again`
}

function reset() {
  clearTimer()
  cursor.value = -1
  returning.value = false
  status.value = 'idle'
  statesUsed.value = 0
  requestsSent.value = 0
}

function stageState(index: number) {
  const stop = stopIndex.value
  return {
    'is-reached': cursor.value >= index,
    'is-active': cursor.value === index && !done.value,
    'is-stop': done.value && index === stop,
    // Stages the request never got to stay dimmed once it has settled.
    'is-skipped': done.value && index > stop
  }
}

function linkState(index: number) {
  return {
    'is-flowing': cursor.value > index,
    'is-return': returning.value && index < stopIndex.value
  }
}

onUnmounted(clearTimer)
</script>

<template>
  <div class="nitr-rf">
    <!-- Controls -->
    <div class="nitr-rf-bar">
      <p class="nitr-rf-hint" id="nitr-rf-hint">
        Send a request and watch where it is answered:
      </p>
      <div class="nitr-rf-chips" role="group" aria-labelledby="nitr-rf-hint">
        <button v-for="s in SCENARIOS" :key="s.id" type="button" class="nitr-rf-chip" :class="{
          'is-current': current.id === s.id,
          'is-playing': current.id === s.id && status === 'running'
        }" :aria-label="chipLabel(s)" @click="onChip(s)">
          <span class="nitr-rf-chip-icon" aria-hidden="true">
            <!-- Pause while this one is in flight; play otherwise. -->
            <svg v-if="current.id === s.id && status === 'running'" viewBox="0 0 10 10" fill="currentColor">
              <rect x="1" y="1" width="3" height="8" rx="0.6" />
              <rect x="6" y="1" width="3" height="8" rx="0.6" />
            </svg>
            <svg v-else viewBox="0 0 10 10" fill="currentColor">
              <path d="M2.2 1.2v7.6L8.4 5z" />
            </svg>
          </span>
          <span class="nitr-rf-method">{{ s.method }}</span>
          <span class="nitr-rf-path">{{ s.path }}</span>
          <span v-if="s.note" class="nitr-rf-note">{{ s.note }}</span>
        </button>
      </div>
    </div>

    <!-- The track -->
    <ol class="nitr-rf-track">
      <li v-for="(stage, i) in STAGES" :key="stage.id" class="nitr-rf-stage" :class="stageState(i)">
        <div class="nitr-rf-stage-head">
          <span class="nitr-rf-num" aria-hidden="true">{{ i + 1 }}</span>
          <h3 class="nitr-rf-title">{{ stage.title }}</h3>
          <span v-if="stage.lang" class="nitr-rf-lang">{{ stage.lang }}</span>
        </div>
        <p class="nitr-rf-sub">{{ stage.sub }}</p>

        <span v-if="done && i === stopIndex" class="nitr-rf-badge">
          {{ current.status }} — answered here
        </span>

        <!-- Connector to the next stage. -->
        <span v-if="i < STAGES.length - 1" class="nitr-rf-link" :class="linkState(i)" aria-hidden="true"></span>
      </li>
    </ol>

    <!-- Outcome -->
    <div class="nitr-rf-result" role="status" aria-live="polite">
      <template v-if="done">
        <div class="nitr-rf-result-head">
          <span class="nitr-rf-status" :data-kind="current.status < 300 ? 'ok' : current.status < 500 ? 'warn' : 'err'">
            {{ current.status }}
          </span>
          <strong>{{ current.answer }}</strong>
          <span class="nitr-rf-lua" :data-hit="current.reachesLua">
            {{ current.reachesLua ? 'Lua state used' : 'No Lua state used' }}
          </span>
        </div>
        <p class="nitr-rf-why" v-html="current.why"></p>
      </template>
      <p v-else-if="inFlight" class="nitr-rf-why">
        <span class="nitr-rf-method">{{ current.method }}</span>
        {{ current.path }} —
        {{ status === 'paused' ? 'paused' : 'in flight…' }}
      </p>
      <p v-else class="nitr-rf-why nitr-rf-idle">
        Pick a request above. Five of the six never reach Lua at all.
      </p>
    </div>

    <!-- Score -->
    <div class="nitr-rf-score">
      <span>
        Requests sent <b>{{ requestsSent }}</b>
      </span>
      <span>
        Lua states used <b>{{ statesUsed }}</b>
      </span>
      <button v-if="requestsSent > 0" type="button" class="nitr-rf-reset" @click="reset">
        Reset
      </button>
    </div>
  </div>
</template>

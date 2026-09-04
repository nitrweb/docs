<script setup lang="ts">
import { ref } from 'vue'

/**
 * A single shell command with a copy button.
 *
 * The command markup is passed as a slot so it can keep its syntax
 * spans; the text actually copied is read back off the DOM, with the
 * leading indentation the template introduces stripped out.
 */
defineProps<{
  /** Accessible name for the group and the button. */
  label: string
  /** Drops the bottom margin when another line follows immediately. */
  tight?: boolean
}>()

const line = ref<HTMLElement | null>(null)
const copied = ref(false)
let resetTimer: ReturnType<typeof setTimeout> | undefined

function commandText(): string {
  return (line.value?.textContent ?? '')
    .replace(/^[ \t]+/gm, '')
    .replace(/^\n+|\n+$/g, '')
}

function flash() {
  copied.value = true
  clearTimeout(resetTimer)
  resetTimer = setTimeout(() => {
    copied.value = false
  }, 1400)
}

function fallbackCopy(text: string) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  document.body.appendChild(ta)
  ta.select()
  try {
    document.execCommand('copy')
    flash()
  } catch (err) {
    console.error('Fallback copy failed:', err)
  }
  document.body.removeChild(ta)
}

function copy() {
  const text = commandText()
  if (!text) return

  if (navigator.clipboard?.writeText) {
    navigator.clipboard
      .writeText(text)
      .then(flash)
      .catch(() => fallbackCopy(text))
  } else {
    fallbackCopy(text)
  }
}
</script>

<template>
  <div class="nitr-install-line" :class="{ 'nitr-install-no-space': tight }" role="group" :aria-label="label">
    <pre ref="line" class="install-cmd nitr-code"><slot /></pre>
    <button class="nitr-copy-btn" :class="{ ok: copied }" type="button" :aria-label="`Copy the ${label} command`"
      @click="copy">
      <svg class="nitr-i-copy" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8" />
        <rect x="4" y="4" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8" />
      </svg>
      <svg class="nitr-i-check" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path d="M5 12l5 5 9-11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"
          stroke-linejoin="round" />
      </svg>
      <span>{{ copied ? 'Copied' : 'Copy' }}</span>
    </button>
  </div>
</template>

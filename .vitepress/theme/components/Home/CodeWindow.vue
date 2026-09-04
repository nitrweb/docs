<script setup lang="ts">
import { computed } from 'vue'

/**
 * The faux editor window used around every code sample.
 *
 * Pass the sample as `code` — pre-highlighted HTML with the `nitr-t-*`
 * token spans — and it is rendered as numbered lines, with a crossfade
 * whenever the content changes. The default slot is still available for
 * content that does not want a gutter.
 *
 * `minLines` reserves vertical room for that many lines. Give a rotating
 * set of samples the line count of the longest one and the window keeps
 * a single height throughout, instead of resizing on every switch.
 *
 * The chrome is dark in both themes, which is why it takes its colours
 * from the fixed `--nitr-code-*` set rather than the theme's text
 * variables (see styles/code_window.css).
 */
const props = defineProps<{
  /** File name shown in the title bar. */
  name: string
  /** Language badge, e.g. "lua". */
  lang?: string
  /** Highlighted HTML. Spans must not cross line breaks. */
  code?: string
  /** Rows of vertical space to reserve, so height stays constant. */
  minLines?: number
  /** Smaller chrome and type, for windows used as diagram nodes. */
  compact?: boolean
}>()

// Split on newlines only — every token span is authored within one line,
// so this cannot cut a tag in half.
const lines = computed(() =>
  (props.code ?? '').replace(/\n$/, '').split('\n')
)
</script>

<template>
  <figure class="nitr-window" :class="{ 'nitr-window-compact': compact }">
    <figcaption class="nitr-window-bar">
      <span class="nitr-window-dots" aria-hidden="true">
        <span class="nitr-window-dot"></span>
        <span class="nitr-window-dot"></span>
        <span class="nitr-window-dot"></span>
      </span>
      <span class="nitr-window-name">{{ name }}</span>
      <span v-if="lang" class="nitr-window-lang">{{ lang }}</span>
    </figcaption>

    <Transition name="nitr-code-fade" mode="out-in">
      <pre v-if="code" :key="code" class="nitr-code"
        :style="minLines ? { '--nitr-code-lines': minLines } : undefined"><code class="nitr-code-lines"><span
          v-for="(line, i) in lines" :key="i" class="nitr-line" v-html="line"></span></code></pre>
      <div v-else>
        <slot />
      </div>
    </Transition>
  </figure>
</template>

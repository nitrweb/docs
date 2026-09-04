<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vitepress'

/**
 * Section links for the landing page, with the one for the section
 * currently on screen highlighted.
 *
 * This lives in the nav-bar slot, outside the Home component, so it
 * watches the document rather than receiving state. It only observes
 * while the route is `/`; the sections do not exist anywhere else.
 */
const route = useRoute()

const SECTIONS = [
  { id: 'why', label: 'Why' },
  { id: 'how', label: 'How' },
  { id: 'features', label: 'Features' },
  { id: 'config', label: 'Configure' },
  { id: 'extend', label: 'Extend' },
  { id: 'devx', label: 'DevEx' },
  { id: 'install', label: 'Install' }
]

const active = ref('')
let observer: IntersectionObserver | null = null

function stop() {
  observer?.disconnect()
  observer = null
  active.value = ''
}

function start() {
  stop()
  if (route.path !== '/' || typeof IntersectionObserver === 'undefined') return

  // A band across the middle of the viewport: whichever section crosses
  // it is the one the visitor is reading, which is a steadier answer than
  // "topmost visible" while scrolling through long sections.
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) active.value = entry.target.id
      }
    },
    { rootMargin: '-38% 0px -55% 0px', threshold: 0 }
  )

  for (const { id } of SECTIONS) {
    const el = document.getElementById(id)
    if (el) observer.observe(el)
  }
}

onMounted(start)
// VitePress keeps the nav bar mounted across client-side navigation.
watch(() => route.path, start)
onUnmounted(stop)
</script>

<template>
  <nav v-if="route.path === '/'" class="home-nav-items" aria-label="Home page sections">
    <a v-for="s in SECTIONS" :key="s.id" :href="`/#${s.id}`" :class="{ 'is-active': active === s.id }"
      :aria-current="active === s.id ? 'location' : undefined">
      {{ s.label }}
    </a>
  </nav>
</template>

<style scoped>
.home-nav-items {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  margin-left: 1.75rem;
  margin-right: 0.5rem;
}

.home-nav-items a {
  position: relative;
  padding-block: 4px;
  font-size: 0.92rem;
  font-weight: 500;
  color: var(--vp-c-text-2);
  text-decoration: none;
  transition: color 0.15s;
  white-space: nowrap;
}

/* Underline that grows in from the centre on the active item. */
.home-nav-items a::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -2px;
  height: 2px;
  border-radius: 2px;
  background: var(--vp-c-brand-1);
  transform: scaleX(0);
  transform-origin: center;
  transition: transform 0.2s ease;
}

.home-nav-items a:hover {
  color: var(--vp-c-brand-1);
}

.home-nav-items a.is-active {
  color: var(--vp-c-brand-1);
}

.home-nav-items a.is-active::after {
  transform: scaleX(1);
}

@media (max-width: 900px) {
  .home-nav-items {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .home-nav-items a::after {
    transition: none;
  }
}
</style>

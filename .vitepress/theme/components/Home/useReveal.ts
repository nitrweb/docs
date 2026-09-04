import { onMounted, onUnmounted, type Ref } from 'vue'

/**
 * Staggered scroll reveal for anything marked `data-reveal` inside
 * `root`.
 *
 * Motion is opt-in from JavaScript: the styles that hide the targets are
 * scoped under `.nitr-motion`, a class this adds on mount. With JS off —
 * or in the server-rendered HTML, before hydration — nothing is hidden
 * and the page reads in full. See styles/motion.css.
 */
export function useReveal(root: Ref<HTMLElement | null>) {
  let observer: IntersectionObserver | null = null

  onMounted(() => {
    const el = root.value
    if (!el) return

    const targets = Array.from(el.querySelectorAll<HTMLElement>('[data-reveal]'))
    if (!targets.length) return

    el.classList.add('nitr-motion')

    const reduced =
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches

    // No observer available, or the visitor asked for less motion: show
    // everything at once rather than tying visibility to scrolling.
    if (reduced || typeof IntersectionObserver === 'undefined') {
      targets.forEach((t) => t.classList.add('is-in'))
      return
    }

    observer = new IntersectionObserver(
      (entries, obs) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('is-in')
          // One-shot: nothing re-hides on the way back up.
          obs.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.1 }
    )

    targets.forEach((t) => observer!.observe(t))
  })

  onUnmounted(() => {
    observer?.disconnect()
    observer = null
  })
}

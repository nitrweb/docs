<script setup lang="ts">
import { ref } from 'vue'
import { useData } from 'vitepress'

import HeroSection from './HeroSection.vue'
import HowItWorksSection from './HowItWorksSection.vue'
import WhySection from './WhySection.vue'
import FeaturesSection from './FeaturesSection.vue'
import ConfigSection from './ConfigSection.vue'
import ExtendSection from './ExtendSection.vue'
import DevExperienceSection from './DevExperienceSection.vue'
import InstallSection from './InstallSection.vue'
import SiteFooter from './SiteFooter.vue'
import { useReveal } from './useReveal'

/**
 * The landing page: one section per component, in the order they appear.
 *
 * Only two things live here — the theme attribute the scoped palette
 * keys off, and the scroll-reveal observer, which has to run over the
 * whole subtree and so belongs to the root rather than to any section.
 */
const { isDark } = useData()

const root = ref<HTMLElement | null>(null)
useReveal(root)
</script>

<template>
  <div class="nitr-page" ref="root" :data-theme="isDark ? 'dark' : 'light'">
    <main>
      <HeroSection />
      <WhySection />
      <HowItWorksSection />
      <FeaturesSection />
      <ConfigSection />
      <ExtendSection />
      <DevExperienceSection />
      <InstallSection />
    </main>

    <SiteFooter />
  </div>
</template>

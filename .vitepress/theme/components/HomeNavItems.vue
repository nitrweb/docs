<script setup lang="ts">
import { useRoute } from 'vitepress'

const route = useRoute()
</script>

<template>
  <nav v-if="route.path === '/'" class="home-nav-items" aria-label="Home page sections">
    <a href="/#why">Why Nitr</a>
    <a href="/#features">Features</a>
    <a href="/#config">Configure</a>
    <a href="/#extend">Extend</a>
    <a href="/#install">Install</a>
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
  font-size: 0.92rem;
  font-weight: 500;
  color: var(--vp-c-text-2);
  text-decoration: none;
  transition: color 0.15s;
  white-space: nowrap;
}

.home-nav-items a:hover {
  color: var(--vp-c-brand-1);
}

@media (max-width: 900px) {
  .home-nav-items {
    display: none;
  }
}
</style>

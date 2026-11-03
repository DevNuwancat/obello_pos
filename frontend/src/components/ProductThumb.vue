<!--
  ProductThumb.vue — a small product picture.
  Shows the image when there is one. If there is NO image, or the link is
  broken (file missing / fails to load), it shows the same grey placeholder
  icon that Product List uses, so we never see the ugly "broken image" icon.
-->
<script setup lang="ts">
import { ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  src?: string | null
  size?: number   // width and height in px
}>(), { src: null, size: 44 })

// Turns true if the browser could not load the picture
const failed = ref(false)
// A new picture gets a fresh chance
watch(() => props.src, () => { failed.value = false })
</script>

<template>
  <img
    v-if="src && !failed"
    class="thumb"
    :src="src"
    :style="{ width: size + 'px', height: size + 'px' }"
    @error="failed = true"
  />
  <div v-else class="thumb thumb-ph" :style="{ width: size + 'px', height: size + 'px' }">
    <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" :style="{ width: Math.round(size * 0.4) + 'px', height: Math.round(size * 0.4) + 'px' }">
      <rect x="3" y="3" width="18" height="18" rx="3"/>
      <path d="M3 9l4-4 4 4 4-4 4 4"/>
      <path d="M3 15l4 4 4-4 4 4 4-4"/>
    </svg>
  </div>
</template>

<style scoped>
.thumb {
  flex-shrink: 0;
  display: block;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-card, var(--surface2));
}
.thumb-ph {
  display: grid;
  place-items: center;
  color: var(--text-muted, var(--text-sub));
}
</style>

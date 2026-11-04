<!--
  TagChips.vue — the small coloured tag labels shown next to a customer.
  Each chip uses the tag's own colour. If there are many, only the first few
  show and a "+2" chip tells you there are more.
-->
<script setup lang="ts">
import { computed } from 'vue'
import type { CustomerTag } from '../composables/useCustomerTags'

const props = withDefaults(defineProps<{ tags: CustomerTag[]; max?: number }>(), { max: 3 })
const shown = computed(() => props.tags.slice(0, props.max))
const extra = computed(() => props.tags.length - shown.value.length)
</script>

<template>
  <span v-if="tags.length" class="tag-chips">
    <span
      v-for="t in shown"
      :key="t.id"
      class="tag-chip"
      :style="{ '--c': t.color }"
    >{{ t.name }}</span>
    <span v-if="extra > 0" class="tag-chip tag-more" :title="tags.slice(max).map(t => t.name).join(', ')">+{{ extra }}</span>
  </span>
</template>

<style scoped>
.tag-chips { display: inline-flex; flex-wrap: wrap; gap: 5px; vertical-align: middle; }

/* Small frosted-glass chip, tinted by the tag's colour (--c) */
.tag-chip {
  display: inline-block; padding: 2px 10px; border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--c) 40%, transparent);
  background: linear-gradient(135deg, color-mix(in srgb, var(--c) 22%, transparent), color-mix(in srgb, var(--c) 7%, transparent));
  backdrop-filter: blur(8px) saturate(150%);
  -webkit-backdrop-filter: blur(8px) saturate(150%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.14);
  color: var(--c);
  font-family: 'DM Sans', sans-serif; font-size: 11px; font-weight: 600; letter-spacing: .01em; line-height: 1.6; white-space: nowrap;
}
.tag-more { --c: var(--text-sub, #888); color: var(--text-sub, #888); background: transparent; box-shadow: none; border-color: var(--border, rgba(128,128,128,.3)); }
</style>

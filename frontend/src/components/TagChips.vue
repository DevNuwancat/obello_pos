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
      :style="{ color: t.color, background: t.color + '22', borderColor: t.color + '66' }"
    >{{ t.name }}</span>
    <span v-if="extra > 0" class="tag-chip tag-more" :title="tags.slice(max).map(t => t.name).join(', ')">+{{ extra }}</span>
  </span>
</template>

<style scoped>
.tag-chips { display: inline-flex; flex-wrap: wrap; gap: 4px; vertical-align: middle; }
.tag-chip {
  display: inline-block; padding: 1px 8px; border-radius: 999px; border: 1px solid;
  font-family: 'DM Sans', sans-serif; font-size: 10.5px; font-weight: 600; line-height: 1.55; white-space: nowrap;
}
.tag-more { color: var(--text-sub, #888); background: transparent; border-color: var(--border, rgba(128,128,128,.3)); }
</style>

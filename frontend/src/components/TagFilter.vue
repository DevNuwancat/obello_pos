<!--
  TagFilter.vue — a row of tag "pills" used to filter a customer list.
  Click a pill to show only that tag's customers; click it again (or "All") to clear.
  Each pill can show a small second line (for Pay Later: how much that tag owes).

  v-model = the chosen tag id, null for "All", or NO_TAG for "no tag".
-->
<script setup lang="ts">
import { NO_TAG } from '../composables/useCustomerTags'

export interface TagFilterOption {
  id: string
  name: string
  color: string
  count: number
  sub?: string        // optional small text under the name, e.g. "Rs. 120,000"
}

defineProps<{
  options: TagFilterOption[]
  allCount: number
  noTagCount?: number
}>()
const selected = defineModel<string | null>({ default: null })

function pick(id: string | null) {
  selected.value = selected.value === id ? null : id
}
</script>

<template>
  <div class="tf">
    <button class="tf-pill" :class="{ active: selected === null }" @click="selected = null">
      All <span class="tf-count">{{ allCount }}</span>
    </button>
    <button
      v-for="o in options"
      :key="o.id"
      class="tf-pill"
      :class="{ active: selected === o.id }"
      :style="selected === o.id
        ? { background: o.color, borderColor: o.color, color: '#fff' }
        : { borderColor: o.color + '66' }"
      @click="pick(o.id)"
    >
      <span class="tf-dot" :style="{ background: selected === o.id ? '#fff' : o.color }"></span>
      <span class="tf-text">
        <span class="tf-name">{{ o.name }} <span class="tf-count">{{ o.count }}</span></span>
        <span v-if="o.sub" class="tf-sub">{{ o.sub }}</span>
      </span>
    </button>
    <button v-if="noTagCount" class="tf-pill tf-none" :class="{ active: selected === NO_TAG }" @click="pick(NO_TAG)">
      No tag <span class="tf-count">{{ noTagCount }}</span>
    </button>
  </div>
</template>

<style scoped>
.tf { display: flex; flex-wrap: wrap; gap: 8px; }
.tf-pill {
  display: inline-flex; align-items: center; gap: 7px; padding: 6px 13px; border-radius: 999px;
  border: 1px solid var(--border-mid, var(--border)); background: var(--bg-card, var(--bg)); color: var(--text-sub);
  font-family: 'DM Sans', sans-serif; font-size: 12px; cursor: pointer; transition: transform .15s, background .15s, border-color .15s;
}
.tf-pill:hover { transform: translateY(-1px); color: var(--text); }
.tf-pill.active { background: var(--accent, var(--accent-bg, #222)); border-color: var(--accent, var(--accent-bg, #222)); color: var(--accent-fg, var(--accent-text, #fff)); font-weight: 600; }
.tf-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.tf-text { display: flex; flex-direction: column; line-height: 1.25; text-align: left; }
.tf-sub { font-size: 10.5px; opacity: .8; font-family: 'DM Mono', monospace; }
.tf-count { font-size: 10.5px; opacity: .65; margin-left: 2px; }
.tf-none { border-style: dashed; }
</style>

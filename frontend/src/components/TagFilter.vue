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
  compact?: boolean   // smaller pills, for tight spaces like the Customer Book
}>()
const selected = defineModel<string | null>({ default: null })

function pick(id: string | null) {
  selected.value = selected.value === id ? null : id
}
</script>

<template>
  <div class="tf" :class="{ compact }">
    <button class="tf-pill" :class="{ active: selected === null }" @click="selected = null">
      All <span class="tf-count">{{ allCount }}</span>
    </button>
    <button
      v-for="o in options"
      :key="o.id"
      class="tf-pill"
      :class="{ active: selected === o.id }"
      :style="{ '--c': o.color }"
      @click="pick(o.id)"
    >
      <span class="tf-dot"></span>
      <span class="tf-text">
        <span class="tf-name"><span class="tf-name-text">{{ o.name }}</span> <span class="tf-count">{{ o.count }}</span></span>
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

/* Frosted-glass pill: tinted by the tag's colour (--c), soft blur, light top edge */
.tf-pill {
  --c: var(--text-sub, #888);
  display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--c) 38%, transparent);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--c) 20%, transparent), color-mix(in srgb, var(--c) 6%, transparent));
  backdrop-filter: blur(10px) saturate(150%);
  -webkit-backdrop-filter: blur(10px) saturate(150%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.14), 0 2px 8px rgba(0,0,0,.12);
  color: var(--text);
  font-family: 'DM Sans', sans-serif; font-size: 12.5px; font-weight: 500; letter-spacing: .01em;
  cursor: pointer;
  transition: transform .18s ease, box-shadow .18s ease, background .18s ease, border-color .18s ease;
}
.tf-pill:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--c) 60%, transparent);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.2), 0 6px 16px color-mix(in srgb, var(--c) 22%, transparent);
}
.tf-pill:active { transform: translateY(0) scale(.98); }

/* Selected: solid glowing colour */
.tf-pill.active {
  background: linear-gradient(135deg, var(--c), color-mix(in srgb, var(--c) 72%, #000));
  border-color: color-mix(in srgb, var(--c) 80%, #fff);
  color: #fff; font-weight: 600;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.3), 0 6px 18px color-mix(in srgb, var(--c) 40%, transparent);
}

/* "All" has no colour of its own, so it uses the page's accent when selected */
.tf-pill:not([style]).active {
  background: var(--accent, var(--accent-bg, #222));
  border-color: transparent;
  color: var(--accent-fg, var(--accent-text, #fff));
  box-shadow: 0 4px 14px rgba(0,0,0,.25);
}

.tf-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: var(--c); box-shadow: 0 0 8px color-mix(in srgb, var(--c) 70%, transparent); }
.tf-pill.active .tf-dot { background: #fff; box-shadow: 0 0 8px rgba(255,255,255,.7); }
.tf-text { display: flex; flex-direction: column; line-height: 1.3; text-align: left; }
.tf-sub { font-size: 10.5px; opacity: .75; font-family: 'DM Mono', monospace; letter-spacing: 0; }
.tf-count { font-size: 11px; font-weight: 500; opacity: .6; margin-left: 3px; font-variant-numeric: tabular-nums; }
.tf-none { border-style: dashed; }

/* Compact size: smaller text, tighter padding, long names get "…" instead of wrapping */
.tf.compact { gap: 6px; }
.tf.compact .tf-pill { gap: 6px; padding: 3px 10px; font-size: 11.5px; box-shadow: inset 0 1px 0 rgba(255,255,255,.12); }
.tf.compact .tf-dot { width: 6px; height: 6px; }
.tf.compact .tf-count { font-size: 10px; margin-left: 2px; }
.tf.compact .tf-text { line-height: 1.2; }
.tf.compact .tf-sub { font-size: 9.5px; opacity: .7; }
.tf.compact .tf-name { display: flex; align-items: baseline; gap: 4px; }
.tf.compact .tf-name-text { max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>

<!--
  CalendarPicker.vue — our own month / day picker, styled like the calendar in
  Today Business. Replaces the browser's plain <input type="month"> and
  <input type="date"> boxes.

  Pass `marked` (a Set of "YYYY-MM" or "YYYY-MM-DD" strings) and every matching
  month / day gets a small green dot — used to show where payments came in.
-->
<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  modelValue: string          // "YYYY-MM" in month mode, "YYYY-MM-DD" in day mode
  mode: 'month' | 'day'
  max: string                 // latest value that can be picked (same format)
  marked?: Set<string>        // values that get a green dot
}>()

const emit = defineEmits<{ (e: 'update:modelValue', val: string): void }>()

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number) => String(n).padStart(2, '0')

// ── OPEN / CLOSE ──
const open = ref(false)

// Which year (month mode) or month (day mode) the pop-up is currently showing
const viewYear  = ref(0)
const viewMonth = ref(0)   // 0–11, only used in day mode

function openPop() {
  const [y, m] = props.modelValue.split('-').map(Number)
  viewYear.value  = y
  viewMonth.value = m - 1
  open.value = true
}
function toggle() { open.value ? (open.value = false) : openPop() }

// ── BUTTON LABEL ──
const label = computed(() => {
  const [y, m, d] = props.modelValue.split('-').map(Number)
  if (props.mode === 'month') return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
})

const maxYear  = computed(() => Number(props.max.split('-')[0]))
const maxMonth = computed(() => Number(props.max.split('-')[1]) - 1)

// ── HEADER (arrows + title) ──
const title = computed(() =>
  props.mode === 'month'
    ? String(viewYear.value)
    : new Date(viewYear.value, viewMonth.value, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
)

const canPrev = computed(() => viewYear.value > 2000)
const canNext = computed(() =>
  props.mode === 'month'
    ? viewYear.value < maxYear.value
    : viewYear.value < maxYear.value || (viewYear.value === maxYear.value && viewMonth.value < maxMonth.value)
)

function step(delta: number) {
  if (props.mode === 'month') { viewYear.value += delta; return }
  const d = new Date(viewYear.value, viewMonth.value + delta, 1)
  viewYear.value  = d.getFullYear()
  viewMonth.value = d.getMonth()
}

// ── MONTH GRID (12 months of the viewed year) ──
const monthCells = computed(() =>
  MONTHS_SHORT.map((name, i) => {
    const key = `${viewYear.value}-${pad(i + 1)}`
    return { name, key, disabled: key > props.max, marked: !!props.marked?.has(key) }
  })
)

// ── DAY GRID (blank cells first so day 1 lands on the right weekday) ──
const dayCells = computed(() => {
  const first = new Date(viewYear.value, viewMonth.value, 1).getDay()
  const count = new Date(viewYear.value, viewMonth.value + 1, 0).getDate()
  const cells: { key: string | null; day: number | null; disabled: boolean; marked: boolean }[] = []
  for (let i = 0; i < first; i++) cells.push({ key: null, day: null, disabled: true, marked: false })
  for (let d = 1; d <= count; d++) {
    const key = `${viewYear.value}-${pad(viewMonth.value + 1)}-${pad(d)}`
    cells.push({ key, day: d, disabled: key > props.max, marked: !!props.marked?.has(key) })
  }
  return cells
})

function pick(key: string | null, disabled: boolean) {
  if (!key || disabled) return
  emit('update:modelValue', key)
  open.value = false
}
</script>

<template>
  <div class="cp">
    <button type="button" class="cp-btn" @click="toggle">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      <span>{{ label }}</span>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>

    <!-- Backdrop closes the pop-up on outside click -->
    <div v-if="open" class="cp-backdrop" @click="open = false"></div>

    <div v-if="open" class="cp-pop">
      <div class="cp-nav">
        <button type="button" class="cp-nav-btn" :disabled="!canPrev" @click="step(-1)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span class="cp-title">{{ title }}</span>
        <button type="button" class="cp-nav-btn" :disabled="!canNext" @click="step(1)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>

      <!-- MONTH MODE -->
      <div v-if="mode === 'month'" class="cp-months">
        <button
          v-for="m in monthCells"
          :key="m.key"
          type="button"
          class="cp-cell cp-month"
          :class="{ selected: m.key === modelValue, disabled: m.disabled, current: m.key === max }"
          :disabled="m.disabled"
          @click="pick(m.key, m.disabled)"
        >
          {{ m.name }}
          <i v-if="m.marked" class="cp-dot"></i>
        </button>
      </div>

      <!-- DAY MODE -->
      <template v-else>
        <div class="cp-weekdays"><span v-for="(d, i) in ['S','M','T','W','T','F','S']" :key="i">{{ d }}</span></div>
        <div class="cp-days">
          <button
            v-for="(c, idx) in dayCells"
            :key="idx"
            type="button"
            class="cp-cell cp-day"
            :class="{ empty: !c.day, selected: c.key === modelValue, disabled: !!c.day && c.disabled, current: c.key === max }"
            :disabled="!c.day || c.disabled"
            @click="pick(c.key, c.disabled)"
          >
            {{ c.day || '' }}
            <i v-if="c.marked" class="cp-dot"></i>
          </button>
        </div>
      </template>

      <div class="cp-legend"><i class="cp-dot cp-dot-static"></i> Payments received</div>
    </div>
  </div>
</template>

<style scoped>
.cp { position: relative; display: inline-block; }

.cp-btn {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 12px; border-radius: 8px;
  background: var(--bg); border: 1px solid var(--border);
  color: var(--text); font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500;
  cursor: pointer; transition: background .15s;
}
.cp-btn:hover { background: var(--surface2); }
.cp-btn svg { flex-shrink: 0; color: var(--text-sub); }

.cp-backdrop { position: fixed; inset: 0; z-index: 40; }

.cp-pop {
  position: absolute; top: calc(100% + 8px); left: 0; z-index: 41;
  width: 280px; padding: 14px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
  box-shadow: var(--shadow-lg);
  animation: cpIn .15s ease both;
}
@keyframes cpIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }

.cp-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.cp-title { font-size: 13px; font-weight: 600; color: var(--text); }
.cp-nav-btn {
  width: 26px; height: 26px; border-radius: 7px; border: 1px solid var(--border);
  background: var(--bg); color: var(--text); cursor: pointer;
  display: flex; align-items: center; justify-content: center; transition: background .15s;
}
.cp-nav-btn:hover:not(:disabled) { background: var(--surface2); }
.cp-nav-btn:disabled { opacity: .3; cursor: not-allowed; }

.cp-months { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.cp-weekdays { display: grid; grid-template-columns: repeat(7, 1fr); font-size: 10.5px; color: var(--text-muted); text-align: center; margin-bottom: 4px; }
.cp-days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }

.cp-cell {
  position: relative; border: none; background: transparent; color: var(--text);
  border-radius: 8px; cursor: pointer; font-family: inherit;
  transition: background .12s, color .12s;
}
.cp-month { padding: 12px 0; font-size: 13px; font-weight: 500; }
.cp-day { aspect-ratio: 1; font-size: 12px; font-family: 'DM Mono', monospace; }
.cp-cell:hover:not(.disabled):not(.empty) { background: var(--surface2); }
.cp-cell.empty { cursor: default; }
.cp-cell.disabled { color: var(--text-muted); opacity: .35; cursor: not-allowed; }
.cp-cell.current:not(.selected) { border: 1px solid var(--text-sub); }
.cp-cell.selected { background: var(--accent); color: var(--accent-fg); font-weight: 700; }

/* The green "a payment came in" dot, tucked under the label */
.cp-dot { position: absolute; left: 50%; bottom: 4px; width: 6px; height: 6px; margin-left: -3px; border-radius: 50%; background: var(--green); }
.cp-day .cp-dot { bottom: 3px; width: 5px; height: 5px; margin-left: -2.5px; }

.cp-legend {
  display: flex; align-items: center; gap: 7px;
  margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border);
  font-size: 10.5px; color: var(--text-muted);
}
.cp-dot-static { position: static; margin: 0; display: inline-block; width: 7px; height: 7px; }
</style>

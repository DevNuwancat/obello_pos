<!--
  ╔═══════════════════════════════════════════════════════════════════╗
  ║  BarcodePrint.vue — Review the barcode print queue, then print    ║
  ║  a sheet of cut-out labels onto A4.                                ║
  ║  Queue comes from the "barcodePrint" Pinia store (filled in by     ║
  ║  the barcode button on ProductListView.vue).                      ║
  ║  Same Slidebar + light/dark theme + card/table look as             ║
  ║  ProductListView.vue / TodayBusinessView.vue                       ║
  ╚═══════════════════════════════════════════════════════════════════╝
-->

<script setup lang="ts">
// ──────────────────────────────────────────────
// 1. IMPORTS
// ──────────────────────────────────────────────
import { ref, computed } from 'vue'
import JsBarcode from 'jsbarcode'
import Slidebar from '../components/Slidebar.vue'
import Toast from '../components/Toast.vue'
import { useBarcodePrintStore } from '../store/barcodePrint'
import obelloLogo from '../assets/obello_mini.png'


// ──────────────────────────────────────────────
// 2. THEME — same pattern as ProductListView
// ──────────────────────────────────────────────
const isLight = ref(localStorage.getItem('theme') === 'light')


// ──────────────────────────────────────────────
// 3. STORE — the print queue lives here, not in this component,
//    so it survives navigating away and back (and even a refresh,
//    since the store saves itself to localStorage)
// ──────────────────────────────────────────────
const store = useBarcodePrintStore()

const LABELS_PER_PAGE = 50 // 5 columns x ~10 rows fit in A4's ~285mm usable height (297mm - 6mm top/bottom margin)

const statTotalItems   = computed(() => store.queue.length)
const statTotalLabels  = computed(() => store.totalLabels)
const statEstPages     = computed(() => Math.max(1, Math.ceil(store.totalLabels / LABELS_PER_PAGE)))


// ──────────────────────────────────────────────
// 4. TABLE ACTIONS
// ──────────────────────────────────────────────
function updateQty(id: string, value: number) {
  store.updateQty(id, Number.isFinite(value) ? value : 0)
}

function removeItem(id: string) {
  store.removeFromQueue(id)
}

function toggleKeep(id: string, value: boolean) {
  store.toggleKeep(id, value)
}

const keptCount = computed(() => store.queue.filter((i) => i.keep).length)

// "Clear All" — wipes everything EXCEPT items the user ticked "Keep" on
function clearAll() {
  if (store.queue.length === 0) return
  const msg = keptCount.value > 0
    ? `Clear the print queue? ${keptCount.value} kept item(s) will stay. This cannot be undone.`
    : 'Clear the entire barcode print queue? This cannot be undone.'
  if (!confirm(msg)) return
  store.clearQueue(false)
  showToastMsg(keptCount.value > 0 ? 'Print queue cleared (kept items stayed)' : 'Print queue cleared')
}

// "Clear All (Incl. Kept)" — ignores the keep flag and wipes literally everything
function clearAllIncludingKept() {
  if (store.queue.length === 0) return
  if (!confirm('Clear the ENTIRE print queue, including kept items? This cannot be undone.')) return
  store.clearQueue(true)
  showToastMsg('Print queue fully cleared')
}


// ──────────────────────────────────────────────
// 5. PRINT
// Uses the browser's own print dialog ("Save as PDF" or real printer) —
// the @media print rules in <style> hide everything except the label
// grid below, which only becomes visible while printing.
// ──────────────────────────────────────────────
function printLabels() {
  if (store.queue.length === 0) {
    showToastMsg('Your print queue is empty')
    return
  }
  // 'afterprint' fires once the browser's print dialog closes — whether the
  // user actually printed/saved a PDF or just hit Cancel. The browser gives
  // us no way to tell those two apart, so once it closes we ask the user
  // ourselves via the confirm modal below.
  window.addEventListener('afterprint', onAfterPrint, { once: true })
  window.print()
}

function onAfterPrint() {
  showClearModal.value = true
}

// ──────────────────────────────────────────────
// 5c. "CLEAR PRINTED ITEMS?" MODAL — shown after the print dialog closes
// ──────────────────────────────────────────────
const showClearModal = ref(false)

function confirmClearPrinted() {
  const hadKept = keptCount.value > 0
  store.clearQueue(false) // kept items are protected here too
  showClearModal.value = false
  showToastMsg(hadKept ? 'Print queue cleared (kept items stayed)' : 'Print queue cleared')
}

function cancelClearPrinted() {
  showClearModal.value = false
}

// Flatten the queue into one entry PER LABEL COPY (qty=3 → 3 entries),
// so the print grid below can just v-for over a flat list of cards
const printLabelsList = computed(() => {
  const list: { key: string; name: string; sku: string | null; barcode: string | null; selling_price: number }[] = []
  for (const item of store.queue) {
    for (let i = 0; i < item.qty; i++) {
      list.push({ key: `${item.id}-${i}`, name: item.name, sku: item.sku, barcode: item.barcode, selling_price: item.selling_price })
    }
  }
  return list
})

function fmtPrice(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ──────────────────────────────────────────────
// 5b. REAL, SCANNABLE BARCODES
// JsBarcode draws bars onto an <svg> element for us — it needs a real
// DOM element to draw into, so we build one in memory (never attached
// to the page), hand it to JsBarcode, then grab the finished markup
// as a string with .outerHTML so we can drop it into the template
// with v-html. Many labels share the same barcode value (qty > 1), so
// we cache each value's SVG string and only draw it once.
// ──────────────────────────────────────────────
const barcodeSvgCache = new Map<string, string>()

function barcodeSvgFor(value: string): string {
  const key = value || '0000000000'
  const cached = barcodeSvgCache.get(key)
  if (cached) return cached

  const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  try {
    JsBarcode(svgEl, key, {
      format: 'CODE128',
      displayValue: false, // we render our own text line below the barcode
      margin: 0,
      width: 1.4,
      height: 40,
      background: '#ffffff',
      lineColor: '#000000',
    })
  } catch {
    // JsBarcode throws if the value has characters CODE128 can't encode —
    // fall back to a blank svg rather than breaking the whole print sheet
  }
  const svg = svgEl.outerHTML
  barcodeSvgCache.set(key, svg)
  return svg
}


// ──────────────────────────────────────────────
// 6. TOAST
// ──────────────────────────────────────────────
const toastMsg     = ref('')
const toastVisible = ref(false)

function showToastMsg(msg: string) {
  toastMsg.value     = msg
  toastVisible.value = true
  setTimeout(() => { toastVisible.value = false }, 2600)
}
</script>


<!-- ════════════════════════════════════════════ -->
<!--             TEMPLATE (the HTML)             -->
<!-- ════════════════════════════════════════════ -->
<template>
  <div class="page-wrap" :class="{ light: isLight }">

    <!-- ── SIDEBAR ── -->
    <Slidebar v-model:isLight="isLight" />

    <!-- ══════════════════════════════════════ -->
    <!--              MAIN CONTENT             -->
    <!-- ══════════════════════════════════════ -->
    <main class="main">

      <!-- ── PAGE HEADER ── -->
      <div class="page-header">
        <h1 class="page-title">Barcode Print</h1>
        <p class="page-sub">Review your print queue, then print labels onto A4</p>
      </div>

      <!-- ── STATS BAR ── -->
      <div class="stats-bar">
        <div class="stat-card">
          <div class="stat-label">Total Items</div>
          <div class="stat-value">{{ statTotalItems }}</div>
          <div class="stat-sub">distinct products queued</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Labels</div>
          <div class="stat-value">{{ statTotalLabels }}</div>
          <div class="stat-sub">copies to print</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Estimated Pages</div>
          <div class="stat-value">{{ statEstPages }}</div>
          <div class="stat-sub">{{ LABELS_PER_PAGE }} labels per A4 sheet</div>
        </div>
      </div>

      <!-- ── TOOLBAR ── -->
      <div class="toolbar">

        <!-- actions -->
        <div class="toolbar-row toolbar-actions">
          <div class="toolbar-right" style="margin-left:0">
            <button class="btn btn-outline" @click="clearAll" title="Empty the print queue (keeps ticked items)">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path stroke-linecap="round" d="M10 11v6M14 11v6"/></svg>
              Clear All
            </button>
            <button v-if="keptCount > 0" class="btn btn-outline" @click="clearAllIncludingKept" title="Empty the print queue, including kept items">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path stroke-linecap="round" d="M10 11v6M14 11v6"/></svg>
              Clear All (Incl. Kept)
            </button>
          </div>
          <div class="toolbar-right">
            <button class="btn btn-primary" @click="printLabels" title="Print / Save as PDF">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z"/></svg>
              Print Labels
            </button>
          </div>
        </div>
      </div>

      <!-- ══════════════════════════════════════ -->
      <!--          REVIEW TABLE (on-screen)     -->
      <!-- ══════════════════════════════════════ -->
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th class="center">Image</th>
              <th>Name</th>
              <th>SKU</th>
              <th>Barcode</th>
              <th class="center">Qty (labels)</th>
              <th class="center" title="Ticked items are skipped by Clear All">Keep</th>
              <th style="text-align:right; padding-right:20px;">Actions</th>
            </tr>
          </thead>

          <tbody>
            <tr v-if="store.queue.length === 0">
              <td colspan="8" class="empty-row">
                No items in your print queue — go to Product List and click the barcode icon on any product.
              </td>
            </tr>

            <tr
              v-for="(item, index) in store.queue"
              :key="item.id"
              :style="{ animationDelay: (index * 0.03) + 's' }"
            >
              <td>{{ index + 1 }}</td>
              <td class="center-cell">
                <img v-if="item.image_url" :src="item.image_url" class="product-thumb" />
                <div v-else class="thumb-placeholder">
                  <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9l4-4 4 4 4-4 4 4"/><path d="M3 15l4 4 4-4 4 4 4-4"/></svg>
                </div>
              </td>
              <td class="name-cell">{{ item.name }}</td>
              <td class="sku-cell">{{ item.sku || '—' }}</td>
              <td class="sku-cell">{{ item.barcode || '—' }}</td>
              <td class="center-cell">
                <input
                  type="number"
                  min="0"
                  class="qty-input"
                  :value="item.qty"
                  @input="updateQty(item.id, Number(($event.target as HTMLInputElement).value))"
                />
              </td>
              <td class="center-cell">
                <input
                  type="checkbox"
                  class="keep-checkbox"
                  :checked="item.keep"
                  title="Keep this item when clearing the queue"
                  @change="toggleKeep(item.id, ($event.target as HTMLInputElement).checked)"
                />
              </td>
              <td style="text-align:right; padding-right:20px;">
                <button class="action-btn danger" title="Remove from queue" @click="removeItem(item.id)">
                  <svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path stroke-linecap="round" d="M10 11v6M14 11v6"/></svg>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </main>

    <!-- ══════════════════════════════════════ -->
    <!--   PRINT-ONLY LABEL GRID (hidden on    -->
    <!--   screen, shown only by @media print) -->
    <!-- ══════════════════════════════════════ -->
    <div class="label-sheet">
      <div v-for="label in printLabelsList" :key="label.key" class="print-label">
        <!-- top-left brand mark -->
        <img :src="obelloLogo" class="label-logo" alt="obello" />

        <!-- price runs top-to-bottom along the right edge of the label -->
        <div class="label-price-vert">Rs {{ fmtPrice(label.selling_price) }}</div>

        <!-- everything else stacks centered under the logo, clear of the price strip -->
        <div class="label-body">
          <div class="label-product-name">{{ label.name }}</div>
          <!-- real, scanner-readable CODE128 barcode drawn by JsBarcode -->
          <div class="label-barcode-wrap" v-html="barcodeSvgFor(label.barcode || '')"></div>
          <div class="label-barcode-num">{{ label.barcode || '000-000-000' }}</div>
          <div class="label-sku">{{ label.sku }}</div>
        </div>
      </div>
    </div>

    <!-- ── TOAST ── -->
    <Toast :message="toastMsg" :show="toastVisible" />

    <!-- ══════════════════════════════════════ -->
    <!--   "CLEAR PRINTED ITEMS?" MODAL         -->
    <!--   Shown once the print dialog closes  -->
    <!-- ══════════════════════════════════════ -->
    <div v-if="showClearModal" class="modal-overlay" @click.self="cancelClearPrinted">
      <div class="modal-box">
        <h3 class="modal-title">Clear printed items?</h3>
        <p class="modal-text">Do you want to remove all items from the print queue now that they've been printed?</p>
        <p v-if="keptCount > 0" class="modal-note">
          {{ keptCount }} item(s) are ticked "Keep" and will stay in the queue either way.
        </p>
        <div class="modal-actions">
          <button class="btn btn-outline" @click="cancelClearPrinted">No</button>
          <button class="btn btn-primary" @click="confirmClearPrinted">Yes, clear</button>
        </div>
      </div>
    </div>

  </div>
</template>


<!-- ════════════════════════════════════════════ -->
<!--                SCOPED STYLES               -->
<!--   (copied from ProductListView.vue so all   -->
<!--    three pages look and feel identical)     -->
<!-- ════════════════════════════════════════════ -->
<style scoped>
/* ──────────────────────────────────────────────
   CSS VARIABLES — Dark theme (default)
   ────────────────────────────────────────────── */
.page-wrap {
  --bg:        #111110;
  --surface:   #1c1c1b;
  --surface2:  #242423;
  --border:    rgba(255,255,255,0.07);
  --text:      #F5F2EE;
  --text-sub:  #888884;
  --text-muted:#555551;
  --accent:    #F5F2EE;
  --accent-fg: #111110;
  --red:       #f87171;
  --red-bg:    rgba(220,38,38,.18);
  --green:     #4ade80;
  --green-bg:  rgba(22,163,74,.15);
  --shadow:    0 1px 3px rgba(0,0,0,.5);
  --shadow-lg: 0 8px 32px rgba(0,0,0,0.6);
  --radius:    12px;
}

/* ── LIGHT THEME ── */
.page-wrap.light {
  --bg:        #F7F5F2;
  --surface:   #ffffff;
  --surface2:  #f7f5f2;
  --border:    rgba(0,0,0,0.08);
  --text:      #1a1a1a;
  --text-sub:  #6b6660;
  --text-muted:#B0ADA5;
  --accent:    #1a1a1a;
  --accent-fg: #ffffff;
  --red:       #dc2626;
  --red-bg:    #fee2e2;
  --green:     #16a34a;
  --green-bg:  #dcfce7;
  --shadow:    0 1px 3px rgba(0,0,0,.08), 0 4px 16px rgba(0,0,0,.04);
  --shadow-lg: 0 8px 32px rgba(0,0,0,0.1);
}


/* ── RESET ── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

.page-wrap {
  display: flex;
  min-height: 100vh;
  width: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: 'DM Sans', sans-serif;
  transition: background .3s, color .3s;
}

::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 99px; }


/* ══════════════════════════════════
   MAIN CONTENT AREA
   ══════════════════════════════════ */
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  overflow-y: auto;
}

.page-header { padding: 32px 32px 0; }
.page-title  { font-size: 26px; font-weight: 600; letter-spacing: -.02em; color: var(--text); }
.page-sub    { font-size: 13px; color: var(--text-sub); margin-top: 2px; }


/* ══════════════════════════════════
   STATS BAR
   ══════════════════════════════════ */
.stats-bar {
  display: flex; gap: 16px;
  padding: 24px 32px 4px;
  flex-wrap: wrap;
}

.stat-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 20px;
  flex: 1; min-width: 160px;
  box-shadow: var(--shadow);
}

.stat-label { font-size: 11px; color: var(--text-sub); text-transform: uppercase; letter-spacing: .06em; font-weight: 500; }
.stat-value { font-size: 22px; font-weight: 600; margin-top: 4px; letter-spacing: -.02em; font-family: 'DM Mono', monospace; color: var(--text); }
.stat-sub { font-size: 11px; color: var(--text-sub); margin-top: 2px; }


/* ══════════════════════════════════
   TOOLBAR
   ══════════════════════════════════ */
.toolbar {
  padding: 20px 32px 0;
  display: flex; flex-direction: column;
  gap: 10px;
}

.toolbar-row {
  display: flex; align-items: center;
  justify-content: space-between;
  gap: 12px; flex-wrap: wrap;
}
.toolbar-filters { justify-content: flex-start; }

.select-wrap { position: relative; }
.select-wrap select {
  appearance: none;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  font-family: 'DM Sans', sans-serif;
  font-size: 13px;
  padding: 8px 36px 8px 12px;
  border-radius: 8px;
  cursor: pointer; outline: none;
  transition: border-color .15s;
  min-width: 140px;
}
.select-wrap select:focus { border-color: var(--text-sub); }
.select-wrap::after {
  content: '';
  position: absolute; right: 12px; top: 50%;
  transform: translateY(-50%);
  width: 0; height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid var(--text-sub);
  pointer-events: none;
}

.search-box {
  display: flex; align-items: center; gap: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  flex: 1; min-width: 200px; max-width: 360px;
}
.search-box svg { width: 15px; height: 15px; color: var(--text-sub); flex-shrink: 0; }
.search-box input {
  border: none; background: transparent;
  font-family: 'DM Sans', sans-serif;
  font-size: 13px; color: var(--text);
  outline: none; width: 100%;
}
.search-box input::placeholder { color: var(--text-sub); }

.btn-clear-filters {
  padding: 8px 14px; border-radius: 8px;
  border: 1px dashed var(--border); background: transparent;
  color: var(--text-sub); font-size: 12.5px; font-family: 'DM Sans', sans-serif;
  cursor: pointer; transition: color .15s, border-color .15s;
}
.btn-clear-filters:hover { color: var(--red); border-color: var(--red); }

.btn {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 8px;
  font-family: 'DM Sans', sans-serif;
  font-size: 13px; font-weight: 500;
  cursor: pointer; border: 1px solid transparent;
  transition: opacity .15s, background .15s;
}
.btn svg { width: 14px; height: 14px; }
.btn-primary { background: var(--accent); color: var(--accent-fg); }
.btn-primary:hover { opacity: .85; }
.btn-outline { background: var(--surface); border-color: var(--border); color: var(--text); }
.btn-outline:hover { background: var(--surface2); }
.toolbar-right { display: flex; gap: 8px; }


/* ══════════════════════════════════
   REVIEW TABLE
   ══════════════════════════════════ */
.table-wrap {
  margin: 20px 32px 32px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
}

table { width: 100%; border-collapse: collapse; font-size: 13px; }

thead tr { background: var(--surface2); border-bottom: 1px solid var(--border); }
thead th {
  padding: 11px 14px; text-align: left;
  font-weight: 600; font-size: 12px;
  letter-spacing: .04em; color: var(--text-sub);
  white-space: nowrap;
}
thead th:first-child { padding-left: 20px; width: 44px; }
thead th.center { text-align: center; }

tbody tr {
  border-bottom: 1px solid var(--border);
  transition: background .12s;
  animation: rowIn .3s ease both;
}
tbody tr:last-child { border-bottom: none; }
tbody tr:hover { background: var(--surface2); }

tbody td { padding: 12px 14px; vertical-align: middle; color: var(--text); }
tbody td:first-child { padding-left: 20px; color: var(--text-sub); font-family: 'DM Mono', monospace; font-size: 12px; }

.empty-row { text-align: center; color: var(--text-muted); padding: 40px 14px !important; }

@keyframes rowIn {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
}

.sku-cell  { font-family: 'DM Mono', monospace; font-size: 11.5px; font-weight: 500; }
.name-cell { font-weight: 500; }
.center-cell { text-align: center; }

.product-thumb {
  width: 40px; height: 40px; object-fit: cover;
  border-radius: 8px; border: 1px solid var(--border);
  background: var(--surface2); display: inline-block;
}
.thumb-placeholder {
  width: 40px; height: 40px; border-radius: 8px;
  border: 1px solid var(--border); background: var(--surface2);
  display: inline-flex; align-items: center; justify-content: center; color: var(--text-sub);
}
.thumb-placeholder svg { width: 16px; height: 16px; }

.qty-input {
  width: 64px;
  padding: 6px 8px;
  text-align: center;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-family: 'DM Mono', monospace;
  font-size: 12.5px;
  outline: none;
}
.qty-input:focus { border-color: var(--text-sub); }

.action-btn {
  width: 32px; height: 32px;
  display: inline-grid; place-items: center;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: var(--surface);
  cursor: pointer; color: var(--text-sub);
  transition: background .12s, color .12s, border-color .12s;
}
.action-btn:hover { background: var(--surface2); color: var(--text); }
.action-btn.danger:hover { background: var(--red-bg); color: var(--red); border-color: var(--red); }
.action-btn svg { width: 14px; height: 14px; }


/* ══════════════════════════════════
   PRINT-ONLY LABEL SHEET
   Hidden on screen — only shown by @media print below.
   Each label reuses the same look as AddClothModal's "Label Preview".
   ══════════════════════════════════ */
.label-sheet { display: none; }

.print-label {
  position: relative;
  background: #ffffff;
  border: 1px solid #eae8e8;
  /* height still hugs content, not forced to match width — but we set a
     min-height so the vertical price text always has room to sit centered
     instead of overflowing/clipping at the top or bottom. */
  min-height: 106px;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  /* right padding reserves room for the vertical price strip */
  padding: 5px 13% 5px 4%;
  break-inside: avoid;
  overflow: hidden;
}

.label-logo {
  /* no align-self override — the flex column above already centers
     children horizontally, so the logo sits centered like the name below */
  height: 26px;
  width: auto;
  display: block;
}

/* Price reads top-to-bottom along the right edge of the label, centered
   in the full height of the card. writing-mode flips the text 90°.
   NOTE: a flex box (align-items:center) does NOT reliably center text
   once writing-mode is rotated — the flex main/cross axes get confused
   by the rotation. top:50% + translateY(-50%) centers it correctly
   regardless of writing-mode, which is why the price looked stuck near
   the top before. */
.label-price-vert {
  position: absolute;
  top: 50%;
  right: 3%;
  transform: translateY(-50%) rotate(180deg);
  writing-mode: vertical-rl;
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 800;
  font-size: 11px;
  color: #111110;
  white-space: nowrap;
}

.label-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  margin-top: 2px;
  width: 100%;
}

.label-product-name {
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 9px;
  color: #111110;
  text-align: center;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* the actual <svg> here comes from JsBarcode via v-html, so scoped CSS
   can't reach it directly — :deep() punches through that boundary */
.label-barcode-wrap { width: 85%; margin-top: 1px; }
.label-barcode-wrap :deep(svg) { width: 100%; height: 27px; display: block; }

.label-barcode-num {
  font-size: 6.5px;
  font-family: monospace;
  color: #333;
  letter-spacing: 0.05em;
}

.label-sku {
  font-size: 8px;
  font-weight: 700;
  font-family: 'Space Grotesk', monospace;
  color: #888;
  letter-spacing: 0.02em;
}


/* ══════════════════════════════════
   "CLEAR PRINTED ITEMS?" MODAL
   ══════════════════════════════════ */
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 100;
}
.modal-box {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 24px;
  width: 100%; max-width: 360px;
}
.modal-title { font-size: 16px; font-weight: 600; color: var(--text); }
.modal-text { font-size: 13px; color: var(--text-sub); margin-top: 8px; line-height: 1.5; }
.modal-note {
  font-size: 12px; color: var(--text); margin-top: 12px;
  padding: 8px 10px; border-radius: 8px;
  background: var(--surface2); border: 1px solid var(--border);
}
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }

.keep-checkbox {
  width: 16px; height: 16px;
  accent-color: var(--accent);
  cursor: pointer;
}


/* ══════════════════════════════════
   PRINT MODE
   ══════════════════════════════════ */
@media print {
  @page { size: A4 portrait; margin: 6mm; }

  :deep(.sidebar) { display: none !important; }
  .page-header, .stats-bar, .toolbar, .table-wrap, .modal-overlay { display: none !important; }

  /* min-height: 100vh (used for normal on-screen layout) reserves a full
     blank page before the label sheet if left in place while printing —
     force both containers back to their natural content height instead. */
  .page-wrap {
    display: block !important;
    min-height: 0 !important;
    height: auto !important;
    background: #fff !important;
  }
  .main {
    display: block !important;
    min-height: 0 !important;
    height: auto !important;
    overflow: visible !important;
  }

  .label-sheet {
    display: grid !important;
    grid-template-columns: repeat(5, 1fr);
    grid-auto-rows: auto; /* each row is only as tall as its label content needs */
    row-gap: 0;
    column-gap: 0;
    /* "stretch" (the grid default) would spread any leftover page height
       across the rows as extra gaps — align-content: start pins every
       row flush against the one above it instead, so cards touch exactly
       at their borders with nothing in between. */
    align-content: start;
  }
}
</style>

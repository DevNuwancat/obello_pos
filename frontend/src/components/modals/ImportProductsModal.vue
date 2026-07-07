<!--
  ImportProductsModal.vue — Bulk-add products from a CSV file.
  Flow: download a sample CSV → fill it in → upload it here → preview →
  import row by row with a live progress bar → summary of what succeeded/failed.
-->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { supabase } from '../../lib/supabase'

interface Supplier { id: string; name: string; code: string }

const props = defineProps<{
  modelValue: boolean
  isLight: boolean
  suppliers: Supplier[]   // passed in from the parent, already loaded there
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void
  (e: 'imported'): void
}>()

// ── SAMPLE CSV ──
const SAMPLE_HEADERS = [
  'Name', 'Main Category', 'Sub Category', 'Size',
  'Cost Price', 'Selling Price', 'Discount %', 'Super Discount %',
  'Stock', 'Barcode', 'Lot No', 'Design No', 'Color', 'Supplier Code', 'Owner', 'SKU',
]

const SAMPLE_ROWS = [
  ['Oversize T-Shirt', 'Clothing & Accessories', 'Oversize T-Shirt', 'L', '800', '1500', '0', '10', '25', '', '12', '04', 'Red', '', 'Obello', ''],
  ['Knife Set', 'Kitchen Essentials', 'Knife', '', '450', '900', '5', '0', '10', '', '01', '', '', '', 'Obello', ''],
]

function csvCell(v: string): string {
  return `"${v.replace(/"/g, '""')}"`
}

function downloadSampleCSV() {
  const csv = [SAMPLE_HEADERS, ...SAMPLE_ROWS]
    .map(r => r.map(csvCell).join(','))
    .join('\n')
  const a = Object.assign(document.createElement('a'), {
    href: 'data:text/csv,' + encodeURIComponent(csv),
    download: 'obello-products-sample.csv',
  })
  a.click()
}

// ── CSV PARSER ── (handles quoted fields with commas / escaped quotes)
function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      rows.push(row); row = []
    } else {
      field += c
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }

  return rows.filter(r => r.some(cell => cell.trim() !== ''))
}

// ── STATE MACHINE ──
type Step = 'idle' | 'preview' | 'importing' | 'done'
const step = ref<Step>('idle')

interface ParsedRow {
  name: string
  main_category: string | null
  sub_category: string | null
  size: string | null
  cost_price: number
  selling_price: number
  discount: number
  super_discount: number
  stock: number
  barcode: string | null
  lot_no: string | null
  design_no: string | null
  color: string | null
  supplier_code: string
  owner: string | null
  sku: string | null
  rowError: string | null   // set if this row can't be imported (e.g. missing name)
}

const parsedRows  = ref<ParsedRow[]>([])
const fileName    = ref('')
const parseError  = ref('')

function num(v: string | undefined): number {
  const n = parseFloat((v || '').trim())
  return isNaN(n) ? 0 : n
}
function str(v: string | undefined): string | null {
  const t = (v || '').trim()
  return t === '' ? null : t
}

async function onFilePick(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return

  fileName.value   = file.name
  parseError.value = ''

  const text = await file.text()
  const rows = parseCSV(text)

  if (rows.length < 2) {
    parseError.value = 'No data rows found in that file.'
    return
  }

  // Match the header row loosely (case/space-insensitive) to our expected columns
  const header = rows[0].map(h => h.trim().toLowerCase())
  const col = (label: string) => header.indexOf(label.toLowerCase())

  const idx = {
    name:           col('Name'),
    main_category:  col('Main Category'),
    sub_category:   col('Sub Category'),
    size:           col('Size'),
    cost_price:     col('Cost Price'),
    selling_price:  col('Selling Price'),
    discount:       col('Discount %'),
    super_discount: col('Super Discount %'),
    stock:          col('Stock'),
    barcode:        col('Barcode'),
    lot_no:         col('Lot No'),
    design_no:      col('Design No'),
    color:          col('Color'),
    supplier_code:  col('Supplier Code'),
    owner:          col('Owner'),
    sku:            col('SKU'),
  }

  if (idx.name === -1) {
    parseError.value = 'Could not find a "Name" column — use the sample CSV as a starting point.'
    return
  }

  parsedRows.value = rows.slice(1).map((r) => {
    const name = str(r[idx.name])
    return {
      name:           name || '',
      main_category:  idx.main_category  >= 0 ? str(r[idx.main_category])  : null,
      sub_category:   idx.sub_category   >= 0 ? str(r[idx.sub_category])   : null,
      size:           idx.size           >= 0 ? str(r[idx.size])           : null,
      cost_price:     idx.cost_price     >= 0 ? num(r[idx.cost_price])     : 0,
      selling_price:  idx.selling_price  >= 0 ? num(r[idx.selling_price])  : 0,
      discount:       idx.discount       >= 0 ? num(r[idx.discount])       : 0,
      super_discount: idx.super_discount >= 0 ? num(r[idx.super_discount]) : 0,
      stock:          idx.stock          >= 0 ? num(r[idx.stock])          : 0,
      barcode:        idx.barcode        >= 0 ? str(r[idx.barcode])        : null,
      lot_no:         idx.lot_no         >= 0 ? str(r[idx.lot_no])         : null,
      design_no:      idx.design_no      >= 0 ? str(r[idx.design_no])      : null,
      color:          idx.color          >= 0 ? str(r[idx.color])          : null,
      supplier_code:  idx.supplier_code  >= 0 ? (str(r[idx.supplier_code]) || '') : '',
      owner:          idx.owner          >= 0 ? str(r[idx.owner])          : null,
      sku:            idx.sku            >= 0 ? str(r[idx.sku])           : null,
      rowError:       name ? null : 'Missing product name',
    }
  })

  step.value = 'preview'
}

const validCount   = computed(() => parsedRows.value.filter(r => !r.rowError).length)
const invalidCount = computed(() => parsedRows.value.length - validCount.value)

// ── IMPORT ──
const importedCount = ref(0)
const importErrors  = ref<{ name: string; message: string }[]>([])

async function startImport() {
  step.value = 'importing'
  importedCount.value = 0
  importErrors.value  = []

  for (const row of parsedRows.value) {
    if (row.rowError) continue

    const supplier = row.supplier_code
      ? props.suppliers.find(s => s.code.toLowerCase() === row.supplier_code.toLowerCase())
      : undefined

    const { error } = await supabase.from('products').insert({
      name:           row.name,
      main_category:  row.main_category,
      sub_category:   row.sub_category,
      size:           row.size,
      cost_price:     row.cost_price,
      selling_price:  row.selling_price,
      discount:       row.discount,
      super_discount: row.super_discount,
      stock:          row.stock,
      barcode:        row.barcode,
      lot_no:         row.lot_no,
      design_no:      row.design_no,
      color:          row.color,
      supplier_id:    supplier?.id || null,
      owner:          row.owner,
      sku:            row.sku,
    })

    if (error) importErrors.value.push({ name: row.name, message: error.message })
    importedCount.value++
  }

  step.value = 'done'
  emit('imported')
}

const progressPct = computed(() => {
  if (parsedRows.value.length === 0) return 0
  return Math.round((importedCount.value / validCount.value) * 100)
})

// ── RESET / CLOSE ──
function reset() {
  step.value        = 'idle'
  parsedRows.value  = []
  fileName.value    = ''
  parseError.value  = ''
  importedCount.value = 0
  importErrors.value  = []
}

function close() {
  emit('update:modelValue', false)
  reset()
}
</script>

<template>
  <Transition name="fade">
    <div v-if="modelValue" class="modal-overlay" :class="{ light: isLight }" @click.self="step !== 'importing' && close()">
      <div class="modal-box">

        <!-- Header -->
        <div class="modal-header">
          <div>
            <div class="modal-title">Import Products from CSV</div>
            <div class="modal-sub">Download the sample, fill it in, then upload it here</div>
          </div>
          <button v-if="step !== 'importing'" class="modal-close" @click="close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div class="modal-body">

          <!-- STEP: idle — download sample + pick a file -->
          <template v-if="step === 'idle'">
            <button class="sample-btn" @click="downloadSampleCSV">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
              <div>
                <div class="sample-btn-title">Download Sample CSV</div>
                <div class="sample-btn-sub">Starting template with the right columns</div>
              </div>
            </button>

            <label class="drop-zone">
              <input type="file" accept=".csv" class="file-input" @change="onFilePick" />
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <span class="drop-zone-title">Click to choose your filled-in CSV</span>
              <span class="drop-zone-sub">.csv file only</span>
            </label>

            <span v-if="parseError" class="form-error">{{ parseError }}</span>
          </template>

          <!-- STEP: preview — show what was found before importing -->
          <template v-else-if="step === 'preview'">
            <div class="preview-summary">
              <div class="preview-file">{{ fileName }}</div>
              <div class="preview-counts">
                <span class="count-ok">{{ validCount }} ready to import</span>
                <span v-if="invalidCount" class="count-bad">{{ invalidCount }} skipped (missing name)</span>
              </div>
            </div>

            <div class="preview-table-wrap">
              <table class="preview-table">
                <thead>
                  <tr><th>Name</th><th>Category</th><th>Stock</th><th>Selling</th><th></th></tr>
                </thead>
                <tbody>
                  <tr v-for="(r, i) in parsedRows.slice(0, 8)" :key="i" :class="{ bad: r.rowError }">
                    <td>{{ r.name || '—' }}</td>
                    <td>{{ r.sub_category || r.main_category || '—' }}</td>
                    <td>{{ r.stock }}</td>
                    <td>{{ r.selling_price.toFixed(2) }}</td>
                    <td class="row-status">
                      <span v-if="r.rowError" class="bad-tag" :title="r.rowError">skip</span>
                      <span v-else class="ok-tag">✓</span>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div v-if="parsedRows.length > 8" class="preview-more">+ {{ parsedRows.length - 8 }} more row(s)</div>
            </div>
          </template>

          <!-- STEP: importing — filling progress bar -->
          <template v-else-if="step === 'importing'">
            <div class="progress-wrap">
              <div class="progress-track">
                <div class="progress-fill" :style="{ width: progressPct + '%' }"></div>
              </div>
              <div class="progress-text">Importing {{ importedCount }} of {{ validCount }}…</div>
            </div>
          </template>

          <!-- STEP: done — summary -->
          <template v-else-if="step === 'done'">
            <div class="done-summary">
              <div class="done-icon" :class="{ warn: importErrors.length }">
                <svg v-if="!importErrors.length" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                <svg v-else width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              </div>
              <div class="done-title">
                {{ importedCount - importErrors.length }} product(s) imported
                <span v-if="importErrors.length">· {{ importErrors.length }} failed</span>
              </div>
            </div>

            <div v-if="importErrors.length" class="error-list">
              <div v-for="(e, i) in importErrors" :key="i" class="error-row">
                <strong>{{ e.name }}</strong> — {{ e.message }}
              </div>
            </div>
          </template>

        </div>

        <!-- Footer -->
        <div class="modal-footer">
          <template v-if="step === 'idle'">
            <button class="modal-cancel" @click="close">Close</button>
          </template>
          <template v-else-if="step === 'preview'">
            <button class="modal-cancel" @click="reset">Back</button>
            <button class="modal-save" :disabled="validCount === 0" @click="startImport">
              Import {{ validCount }} Product{{ validCount === 1 ? '' : 's' }}
            </button>
          </template>
          <template v-else-if="step === 'done'">
            <button class="modal-cancel" @click="reset">Import Another File</button>
            <button class="modal-save" @click="close">Done</button>
          </template>
        </div>

      </div>
    </div>
  </Transition>
</template>

<style scoped>
.modal-overlay {
  --bg-panel:    #181817;
  --bg-card:     #1f1f1e;
  --bg-hover:    #252524;
  --border:      rgba(255,255,255,0.07);
  --border-mid:  rgba(255,255,255,0.12);
  --text:        #F5F2EE;
  --text-sub:    #888884;
  --text-muted:  #555551;
  --accent-bg:   #F5F2EE;
  --accent-text: #111110;
  --green:       #4ade80;
  --green-bg:    rgba(22,163,74,.15);
  --red:         #f87171;
  --red-bg:      rgba(220,38,38,.18);
  --shadow-lg:   0 8px 32px rgba(0,0,0,0.6);

  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
}

.modal-overlay.light {
  --bg-panel:    #FFFFFF;
  --bg-card:     #FAFAF8;
  --bg-hover:    #F0EDE9;
  --border:      rgba(0,0,0,0.07);
  --border-mid:  rgba(0,0,0,0.12);
  --text:        #141412;
  --text-sub:    #7A776F;
  --text-muted:  #B0ADA5;
  --accent-bg:   #141412;
  --accent-text: #F7F5F2;
  --green:       #16a34a;
  --green-bg:    #dcfce7;
  --red:         #dc2626;
  --red-bg:      #fee2e2;
  --shadow-lg:   0 8px 32px rgba(0,0,0,0.12);
}

.modal-box {
  width: 480px;
  max-height: 85vh;
  background: var(--bg-panel);
  border: 1px solid var(--border-mid);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 20px 24px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.modal-title { font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 16px; color: var(--text); }
.modal-sub { font-size: 12px; color: var(--text-muted); margin-top: 3px; }
.modal-close { width: 28px; height: 28px; border-radius: 6px; background: var(--bg-card); border: 1px solid var(--border); cursor: pointer; display: flex; align-items: center; justify-content: center; color: var(--text-muted); transition: color 0.15s, background 0.15s; flex-shrink: 0; }
.modal-close:hover { background: var(--bg-hover); color: var(--text); }

.modal-body { padding: 24px; display: flex; flex-direction: column; gap: 16px; overflow-y: auto; }

/* ── SAMPLE DOWNLOAD BUTTON ── */
.sample-btn {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px; border-radius: 12px;
  background: var(--bg-card); border: 1px solid var(--border);
  color: var(--text); cursor: pointer; text-align: left; width: 100%;
  transition: background .15s, border-color .15s;
}
.sample-btn:hover { background: var(--bg-hover); border-color: var(--border-mid); }
.sample-btn-title { font-size: 13.5px; font-weight: 600; }
.sample-btn-sub { font-size: 11.5px; color: var(--text-muted); margin-top: 2px; }

/* ── DROP ZONE ── */
.drop-zone {
  position: relative;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; padding: 28px 16px;
  border: 1.5px dashed var(--border-mid); border-radius: 12px;
  color: var(--text-muted); cursor: pointer;
  transition: border-color .15s, background .15s;
}
.drop-zone:hover { border-color: var(--text-sub); background: var(--bg-card); }
.file-input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.drop-zone-title { font-size: 13px; color: var(--text); font-weight: 500; }
.drop-zone-sub { font-size: 11px; color: var(--text-muted); }

.form-error { font-size: 12px; color: var(--red); }

/* ── PREVIEW ── */
.preview-summary { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.preview-file { font-size: 12.5px; font-weight: 600; color: var(--text); font-family: 'DM Mono', monospace; }
.preview-counts { display: flex; gap: 10px; font-size: 11.5px; }
.count-ok { color: var(--green); font-weight: 600; }
.count-bad { color: var(--red); font-weight: 600; }

.preview-table-wrap { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.preview-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.preview-table thead tr { background: var(--bg-card); }
.preview-table th { padding: 8px 10px; text-align: left; font-size: 10.5px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; }
.preview-table td { padding: 7px 10px; border-top: 1px solid var(--border); color: var(--text); }
.preview-table tr.bad td { color: var(--text-muted); }
.row-status { text-align: center; width: 30px; }
.ok-tag { color: var(--green); font-weight: 700; }
.bad-tag { color: var(--red); font-size: 10px; font-weight: 700; text-transform: uppercase; }
.preview-more { padding: 8px 10px; font-size: 11px; color: var(--text-muted); background: var(--bg-card); }

/* ── PROGRESS BAR ── */
.progress-wrap { padding: 20px 0; display: flex; flex-direction: column; gap: 10px; align-items: center; }
.progress-track { width: 100%; height: 10px; border-radius: 99px; background: var(--bg-card); border: 1px solid var(--border); overflow: hidden; }
.progress-fill { height: 100%; background: var(--accent-bg); border-radius: 99px; transition: width .25s ease; }
.progress-text { font-size: 12.5px; color: var(--text-sub); }

/* ── DONE SUMMARY ── */
.done-summary { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 12px 0; }
.done-icon { width: 48px; height: 48px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--green-bg); color: var(--green); }
.done-icon.warn { background: var(--red-bg); color: var(--red); }
.done-title { font-size: 13.5px; font-weight: 600; color: var(--text); text-align: center; }

.error-list { display: flex; flex-direction: column; gap: 6px; max-height: 160px; overflow-y: auto; }
.error-row { font-size: 11.5px; color: var(--red); background: var(--red-bg); padding: 7px 10px; border-radius: 7px; }

/* ── FOOTER ── */
.modal-footer { display: flex; gap: 10px; justify-content: flex-end; padding: 16px 24px; border-top: 1px solid var(--border); flex-shrink: 0; }
.modal-cancel { padding: 10px 20px; border-radius: 9px; border: 1px solid var(--border); background: transparent; color: var(--text-sub); font-size: 13px; font-family: 'DM Sans', sans-serif; cursor: pointer; transition: background 0.15s, color 0.15s; }
.modal-cancel:hover { background: var(--bg-hover); color: var(--text); }
.modal-save { padding: 10px 24px; border-radius: 9px; border: none; background: var(--accent-bg); color: var(--accent-text); font-size: 13px; font-weight: 600; font-family: 'DM Sans', sans-serif; cursor: pointer; transition: opacity 0.15s; }
.modal-save:hover { opacity: 0.85; }
.modal-save:disabled { opacity: 0.5; cursor: not-allowed; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>

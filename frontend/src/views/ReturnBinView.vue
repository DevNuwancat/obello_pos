<!--
  ╔═══════════════════════════════════════════════════════════════════╗
  ║  ReturnBinView.vue — Items customers brought back, one by one      ║
  ║  Data: "product_returns" table                                    ║
  ║  "Return" button restocks the item (products.stock) and removes   ║
  ║  it from the bin. "Delete" just removes it (discarded item).      ║
  ║  Entries older than 2 months are auto-purged by a Supabase cron   ║
  ║  job — this page only ever shows what's still pending.            ║
  ╚═══════════════════════════════════════════════════════════════════╝
-->

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import Slidebar from '../components/Slidebar.vue'
import Toast from '../components/Toast.vue'
import ConfirmModal from '../components/ConfirmModal.vue'
import AddReturnModal from '../components/modals/AddReturnModal.vue'
import { supabase } from '../lib/supabase'
import { markConnected, markError } from '../lib/connectionStatus'

// ── TYPES ──
interface ReturnEntry {
  id: string
  product_id: string | null
  invoice_no: string | null
  product_name: string
  sku: string | null
  image_url: string | null
  qty: number
  sold_at: string | null
  returned_at: string
  note: string | null
}

// ── THEME ──
const isLight = ref(localStorage.getItem('theme') === 'light')

// ── DATA ──
const returns    = ref<ReturnEntry[]>([])
const loading    = ref(false)
const fetchError = ref('')

async function fetchReturns() {
  loading.value    = true
  fetchError.value = ''
  try {
    const { data, error } = await supabase
      .from('product_returns')
      .select('*')
      .order('returned_at', { ascending: false })
    if (error) { fetchError.value = error.message; markError(); return }
    returns.value = data ?? []
    markConnected()
  } catch {
    fetchError.value = 'Could not load the return bin.'
    markError()
  } finally {
    loading.value = false
  }
}

// ── SEARCH ──
const searchQuery = ref('')
const filteredReturns = computed(() => {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return returns.value
  return returns.value.filter(r =>
    r.product_name.toLowerCase().includes(q) ||
    (r.sku || '').toLowerCase().includes(q) ||
    (r.invoice_no || '').toLowerCase().includes(q)
  )
})

// ── HELPERS ──
function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ── ADD RETURN MODAL ──
const showAddModal = ref(false)
function onAddSaved() { fetchReturns() }

// ── RETURN TO STOCK ──
const actingId = ref<string | null>(null)

async function returnToStock(entry: ReturnEntry) {
  actingId.value = entry.id
  try {
    const { data: product, error: fetchErr } = await supabase
      .from('products')
      .select('stock')
      .eq('id', entry.product_id!)
      .single()

    if (fetchErr) { showMsg('Could not restock: ' + fetchErr.message); return }

    const { error: updateErr } = await supabase
      .from('products')
      .update({ stock: (product?.stock ?? 0) + entry.qty })
      .eq('id', entry.product_id!)

    if (updateErr) { showMsg('Could not restock: ' + updateErr.message); return }

    const { error: deleteErr } = await supabase.from('product_returns').delete().eq('id', entry.id)
    if (deleteErr) { showMsg('Restocked, but could not remove it from the bin: ' + deleteErr.message); return }

    returns.value = returns.value.filter(r => r.id !== entry.id)
    showMsg(`${entry.product_name} restocked (+${entry.qty})`)
  } catch {
    showMsg('Something went wrong. Please try again.')
  } finally {
    actingId.value = null
  }
}

// ── DELETE (discard, no restock) ──
async function deleteReturn(entry: ReturnEntry) {
  actingId.value = entry.id
  try {
    const { error } = await supabase.from('product_returns').delete().eq('id', entry.id)
    if (error) { showMsg('Delete failed: ' + error.message); return }
    returns.value = returns.value.filter(r => r.id !== entry.id)
    showMsg('Removed from return bin')
  } catch {
    showMsg('Something went wrong. Please try again.')
  } finally {
    actingId.value = null
  }
}


// ── CONFIRM MODAL — replaces the native browser confirm() popup ──
const showConfirm      = ref(false)
const confirmTitle     = ref('')
const confirmMessage   = ref('')
const confirmIsDanger  = ref(false)
const confirmText      = ref('Confirm')
const pendingAction    = ref<(() => void) | null>(null)

function askReturnToStock(entry: ReturnEntry) {
  if (!entry.product_id) {
    showMsg('This item is no longer linked to a product — cannot restock automatically. Delete it instead.')
    return
  }
  confirmTitle.value    = 'Return to stock?'
  confirmMessage.value  = `Add ${entry.qty} unit(s) of "${entry.product_name}" back to stock.`
  confirmText.value     = 'Return to Stock'
  confirmIsDanger.value = false
  pendingAction.value   = () => returnToStock(entry)
  showConfirm.value     = true
}

function askDeleteReturn(entry: ReturnEntry) {
  confirmTitle.value    = 'Remove from bin?'
  confirmMessage.value  = `"${entry.product_name}" will be removed from the return bin without restocking.`
  confirmText.value     = 'Delete'
  confirmIsDanger.value = true
  pendingAction.value   = () => deleteReturn(entry)
  showConfirm.value     = true
}

function runPendingAction() {
  pendingAction.value?.()
  pendingAction.value = null
}

// ── TOAST ──
const toastMsg     = ref('')
const toastVisible = ref(false)
function showMsg(msg: string) {
  toastMsg.value     = msg
  toastVisible.value = true
  setTimeout(() => { toastVisible.value = false }, 2800)
}

onMounted(fetchReturns)
</script>

<template>
  <div class="page-wrap" :class="{ light: isLight }">

    <Slidebar v-model:isLight="isLight" />

    <main class="main">

      <!-- ── PAGE HEADER ── -->
      <div class="page-header">
        <div>
          <h1 class="page-title">Return Bin</h1>
          <p class="page-sub">Items customers brought back · pending restock or discard</p>
        </div>
      </div>

      <!-- ── TOOLBAR ── -->
      <div class="toolbar">
        <div class="search-box">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path stroke-linecap="round" d="m21 21-4.35-4.35"/></svg>
          <input v-model="searchQuery" type="text" placeholder="Search by product, SKU, or invoice…" />
        </div>
        <div class="toolbar-right">
          <button class="btn btn-outline" @click="fetchReturns" title="Refresh">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.08-6.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Refresh
          </button>
          <button class="btn btn-primary" @click="showAddModal = true">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
            Add Return
          </button>
        </div>
      </div>

      <!-- ══════════════════════════════════════ -->
      <!--     LIST — one entry at a time, card-style  -->
      <!-- ══════════════════════════════════════ -->
      <div class="list-wrap">
        <div v-if="loading" class="state-msg">Loading return bin…</div>
        <div v-else-if="fetchError" class="state-error">{{ fetchError }}</div>
        <div v-else-if="filteredReturns.length === 0" class="state-msg">
          {{ searchQuery ? 'No returns match your search.' : 'Return bin is empty — nothing pending.' }}
        </div>

        <div v-else class="return-list">
          <div
            v-for="(r, index) in filteredReturns"
            :key="r.id"
            class="return-card"
            :style="{ animationDelay: (index * 0.03) + 's' }"
          >
            <img v-if="r.image_url" :src="r.image_url" class="return-img" />
            <div v-else class="return-img return-img-placeholder">
              <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" width="20" height="20"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9l4-4 4 4 4-4 4 4"/><path d="M3 15l4 4 4-4 4 4 4-4"/></svg>
            </div>

            <div class="return-info">
              <div class="return-name">{{ r.product_name }} <span class="return-qty">×{{ r.qty }}</span></div>
              <div class="return-meta">
                <span class="return-sku">{{ r.sku || '—' }}</span>
                <span class="return-dot">·</span>
                <span>Invoice {{ r.invoice_no || '—' }}</span>
              </div>
              <div class="return-dates">
                <span>Sold {{ fmtDate(r.sold_at) }}</span>
                <span class="return-dot">·</span>
                <span>Returned {{ fmtDate(r.returned_at) }}</span>
              </div>
              <div v-if="r.note" class="return-note">{{ r.note }}</div>
            </div>

            <div class="return-actions">
              <button
                class="btn-restock"
                :disabled="actingId === r.id"
                title="Add back to stock"
                @click="askReturnToStock(r)"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                Return
              </button>
              <button
                class="btn-discard"
                :disabled="actingId === r.id"
                title="Discard without restocking"
                @click="askDeleteReturn(r)"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>

    </main>

    <AddReturnModal v-model="showAddModal" :isLight="isLight" @saved="onAddSaved" />

    <ConfirmModal
      v-model="showConfirm"
      :isLight="isLight"
      :title="confirmTitle"
      :message="confirmMessage"
      :confirmText="confirmText"
      :danger="confirmIsDanger"
      @confirm="runPendingAction"
    />

    <Toast :message="toastMsg" :show="toastVisible" />

  </div>
</template>

<style scoped>
/* ── CSS VARIABLES — same as other pages ── */
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

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

.page-wrap { display: flex; min-height: 100vh; width: 100%; background: var(--bg); color: var(--text); font-family: 'DM Sans', sans-serif; transition: background .3s, color .3s; }

::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 99px; }

.main { flex: 1; display: flex; flex-direction: column; min-height: 100vh; overflow-y: auto; }

.page-header { padding: 32px 32px 0; }
.page-title  { font-size: 26px; font-weight: 600; letter-spacing: -.02em; color: var(--text); }
.page-sub    { font-size: 13px; color: var(--text-sub); margin-top: 2px; }

/* ── TOOLBAR ── */
.toolbar { padding: 20px 32px 0; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.search-box { display: flex; align-items: center; gap: 8px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; flex: 1; max-width: 320px; }
.search-box svg { width: 15px; height: 15px; color: var(--text-sub); flex-shrink: 0; }
.search-box input { border: none; background: transparent; font-family: 'DM Sans', sans-serif; font-size: 13px; color: var(--text); outline: none; width: 100%; }
.search-box input::placeholder { color: var(--text-sub); }

.btn { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid transparent; transition: opacity .15s, background .15s; }
.btn svg { width: 14px; height: 14px; }
.btn-primary { background: var(--accent); color: var(--accent-fg); }
.btn-primary:hover { opacity: .85; }
.btn-outline { background: var(--surface); border-color: var(--border); color: var(--text); }
.btn-outline:hover { background: var(--surface2); }
.toolbar-right { margin-left: auto; display: flex; gap: 8px; }

/* ── LIST ── */
.list-wrap { margin: 20px 32px 32px; }
.state-msg { padding: 60px 24px; text-align: center; font-size: 13px; color: var(--text-muted); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
.state-error { padding: 12px 14px; border-radius: 8px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: var(--red); font-size: 12.5px; }

.return-list { display: flex; flex-direction: column; gap: 10px; }

.return-card {
  display: flex; align-items: center; gap: 16px;
  padding: 14px 18px;
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  box-shadow: var(--shadow);
  animation: rowIn .3s ease both;
}
@keyframes rowIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

.return-img { width: 52px; height: 52px; object-fit: cover; border-radius: 9px; border: 1px solid var(--border); flex-shrink: 0; }
.return-img-placeholder { display: flex; align-items: center; justify-content: center; color: var(--text-muted); background: var(--surface2); }

.return-info { flex: 1; min-width: 0; }
.return-name { font-size: 14px; font-weight: 600; color: var(--text); }
.return-qty { font-size: 12px; font-weight: 500; color: var(--text-sub); font-family: 'DM Mono', monospace; }
.return-meta { font-size: 12px; color: var(--text-sub); margin-top: 3px; display: flex; align-items: center; gap: 6px; }
.return-sku { font-family: 'DM Mono', monospace; }
.return-dates { font-size: 11.5px; color: var(--text-muted); margin-top: 3px; display: flex; align-items: center; gap: 6px; }
.return-dot { color: var(--text-muted); }
.return-note { font-size: 11.5px; color: var(--text-muted); margin-top: 4px; font-style: italic; }

.return-actions { display: flex; gap: 8px; flex-shrink: 0; }

.btn-restock {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 8px; border: none;
  background: var(--green-bg); color: var(--green);
  font-size: 12.5px; font-weight: 600; font-family: 'DM Sans', sans-serif;
  cursor: pointer; transition: opacity .15s;
}
.btn-restock:hover:not(:disabled) { opacity: .8; }
.btn-restock:disabled { opacity: .5; cursor: not-allowed; }

.btn-discard {
  width: 34px; height: 34px; border-radius: 8px;
  border: 1px solid var(--border); background: var(--bg);
  color: var(--text-muted); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: color .15s, background .15s, border-color .15s;
}
.btn-discard:hover:not(:disabled) { color: var(--red); background: var(--red-bg); border-color: var(--red); }
.btn-discard:disabled { opacity: .5; cursor: not-allowed; }
</style>

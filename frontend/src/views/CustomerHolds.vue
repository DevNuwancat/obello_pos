<!--
  ╔═══════════════════════════════════════════════════════════════════╗
  ║  CustomerHolds.vue — Items set aside for customers                ║
  ║  Same design pattern as PayLaterView (stats · tabs · table ·      ║
  ║  expandable customer rows).                                       ║
  ║  Data: "customer_holds" + "customer_hold_items" tables            ║
  ║  Stock was already deducted when the hold was made (in POSView).  ║
  ║  • Continue in Cart → loads the remaining items into the cart     ║
  ║  • Cancel item / Cancel hold → puts the stock back                ║
  ║  Temporary = items still waiting · Completed = paid at the cart · ║
  ║  Cancelled = everything cancelled, nothing collected              ║
  ╚═══════════════════════════════════════════════════════════════════╝
-->

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import Slidebar from '../components/Slidebar.vue'
import Toast from '../components/Toast.vue'
import ConfirmModal from '../components/ConfirmModal.vue'
import { supabase } from '../lib/supabase'
import { markConnected, markError } from '../lib/connectionStatus'

// ──────────────────────────────────────────────
// 1. TYPES
// ──────────────────────────────────────────────
interface HoldItem {
  id: string
  hold_id: string
  product_id: string | null
  product_name: string
  sku: string | null
  image_url: string | null
  unit_price: number
  selling_price: number
  discount_label: string | null
  qty_held: number
  qty_sold: number
  qty_cancelled: number
}

interface Hold {
  id: string
  customer_id: string
  created_at: string
  pay_later_customers: {
    name: string
    phone: string | null
    id_number: string | null
    address: string | null
  } | null
  customer_hold_items: HoldItem[]
}


// ──────────────────────────────────────────────
// 2. THEME
// ──────────────────────────────────────────────
const isLight = ref(localStorage.getItem('theme') === 'light')


// ──────────────────────────────────────────────
// 3. DATA
// ──────────────────────────────────────────────
const holds      = ref<Hold[]>([])
const loading    = ref(false)
const fetchError = ref('')

async function fetchHolds() {
  loading.value    = true
  fetchError.value = ''
  try {
    const { data, error } = await supabase
      .from('customer_holds')
      .select('*, pay_later_customers(name, phone, id_number, address), customer_hold_items(*)')
      .order('created_at', { ascending: false })
    if (error) { fetchError.value = error.message; markError(); return }
    holds.value = (data ?? []) as Hold[]
    markConnected()
  } catch {
    fetchError.value = 'Could not load customer holds.'
    markError()
  } finally {
    loading.value = false
  }
}


// ──────────────────────────────────────────────
// 4. HELPERS — the page works everything out from the item numbers
// ──────────────────────────────────────────────
// How many of this item are still waiting to be collected
const remaining = (i: HoldItem) => i.qty_held - i.qty_sold - i.qty_cancelled

const holdHeldQty      = (h: Hold) => h.customer_hold_items.reduce((s, i) => s + i.qty_held, 0)
const holdRemainingQty = (h: Hold) => h.customer_hold_items.reduce((s, i) => s + remaining(i), 0)
const holdCollectedQty = (h: Hold) => h.customer_hold_items.reduce((s, i) => s + i.qty_sold, 0)
const holdCancelledQty = (h: Hold) => h.customer_hold_items.reduce((s, i) => s + i.qty_cancelled, 0)
const holdRemainingValue = (h: Hold) => h.customer_hold_items.reduce((s, i) => s + remaining(i) * i.unit_price, 0)

type HoldStatus = 'temporary' | 'completed' | 'cancelled'
const holdStatus = (h: Hold): HoldStatus =>
  holdRemainingQty(h) > 0 ? 'temporary' : holdCollectedQty(h) > 0 ? 'completed' : 'cancelled'

function discountLabelClass(label: string | null): string {
  if (!label) return ''
  const l = label.toLowerCase()
  if (l === 'super') return 'label-super'
  if (l === 'original') return 'label-original'
  return 'label-discount'
}

function fmtRs(n: number): string {
  return `Rs. ${Number(n).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
}


// ──────────────────────────────────────────────
// 5. STAT CARDS
// ──────────────────────────────────────────────
const temporaryHolds = computed(() => holds.value.filter(h => holdStatus(h) === 'temporary'))
const completedHolds = computed(() => holds.value.filter(h => holdStatus(h) === 'completed'))
const cancelledHolds = computed(() => holds.value.filter(h => holdStatus(h) === 'cancelled'))

const valueOnHold  = computed(() => temporaryHolds.value.reduce((s, h) => s + holdRemainingValue(h), 0))
const itemsWaiting = computed(() => temporaryHolds.value.reduce((s, h) => s + holdRemainingQty(h), 0))


// ──────────────────────────────────────────────
// 6. TABS / SEARCH / SORT
// ──────────────────────────────────────────────
const activeTab   = ref<HoldStatus>('temporary')
const searchQuery = ref('')
type SortMode = 'latest' | 'az'
const sortMode = ref<SortMode>('latest')

const filteredHolds = computed(() => {
  let list = holds.value.filter(h => holdStatus(h) === activeTab.value)

  const q = searchQuery.value.toLowerCase().trim()
  if (q) list = list.filter(h => (h.pay_later_customers?.name ?? '').toLowerCase().includes(q))

  if (sortMode.value === 'az') {
    list = [...list].sort((a, b) => (a.pay_later_customers?.name ?? '').localeCompare(b.pay_later_customers?.name ?? ''))
  } else {
    list = [...list].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }
  return list
})


// ──────────────────────────────────────────────
// 7. ROW EXPAND/COLLAPSE
// ──────────────────────────────────────────────
const expandedIds = ref(new Set<string>())
function toggleExpand(id: string) {
  const next = new Set(expandedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedIds.value = next
}


// ──────────────────────────────────────────────
// 8. CONTINUE IN CART
// ──────────────────────────────────────────────
// Full page load (same as the sidebar) → POSView reads ?hold= and fills the cart
function continueInCart(h: Hold) {
  window.location.href = `/?hold=${h.id}`
}


// ──────────────────────────────────────────────
// 9. CANCEL (puts stock back)
// ──────────────────────────────────────────────
// Reads the product's CURRENT stock from the database first, then adds the qty back
async function releaseItem(i: HoldItem) {
  const qty = remaining(i)
  if (qty <= 0) return null
  if (i.product_id) {
    const { data: prod, error: readErr } = await supabase
      .from('products').select('stock').eq('id', i.product_id).single()
    if (readErr) return readErr.message
    const { error: stockErr } = await supabase
      .from('products').update({ stock: (prod?.stock ?? 0) + qty }).eq('id', i.product_id)
    if (stockErr) return stockErr.message
  }
  const { error } = await supabase
    .from('customer_hold_items')
    .update({ qty_cancelled: i.qty_cancelled + qty })
    .eq('id', i.id)
  return error ? error.message : null
}

// Confirm dialog shared by both cancel actions
const showConfirm    = ref(false)
const confirmTitle   = ref('')
const confirmMessage = ref('')
const confirmYes     = ref('Yes, cancel')
let pendingAction: (() => Promise<void>) | null = null

function askConfirm(title: string, message: string, action: () => Promise<void>, yesText = 'Yes, cancel') {
  confirmYes.value     = yesText
  confirmTitle.value   = title
  confirmMessage.value = message
  pendingAction        = action
  showConfirm.value    = true
}

async function runPendingAction() {
  if (pendingAction) await pendingAction()
  pendingAction = null
}

function cancelItem(i: HoldItem) {
  askConfirm(
    'Cancel this item?',
    `${remaining(i)} × ${i.product_name} will be added back to stock.`,
    async () => {
      const err = await releaseItem(i)
      if (err) { showToastMsg('Cancel failed: ' + err); return }
      showToastMsg('Item cancelled · stock restored')
      await fetchHolds()
    },
  )
}

function cancelHold(h: Hold) {
  askConfirm(
    'Cancel the whole hold?',
    `All ${holdRemainingQty(h)} remaining item(s) for ${h.pay_later_customers?.name ?? 'this customer'} will be added back to stock.`,
    async () => {
      for (const i of h.customer_hold_items) {
        const err = await releaseItem(i)
        if (err) { showToastMsg('Cancel failed: ' + err); await fetchHolds(); return }
      }
      showToastMsg('Hold cancelled · stock restored')
      await fetchHolds()
    },
  )
}


// ──────────────────────────────────────────────
// 9b. DELETE a finished hold (Paid or Cancelled)
// Safe: the stock was already settled (sold, or put back), so this only removes the
// hold record from this list — the sale itself stays in Today Business.
// ──────────────────────────────────────────────
function deleteHold(h: Hold) {
  const name = h.pay_later_customers?.name ?? 'this customer'
  askConfirm(
    'Delete this hold?',
    `${name}'s ${holdStatus(h) === 'completed' ? 'paid' : 'cancelled'} hold will be removed from this list. This can't be undone.`,
    async () => {
      const { error } = await supabase.from('customer_holds').delete().eq('id', h.id)
      if (error) { showToastMsg('Delete failed: ' + error.message); return }
      holds.value = holds.value.filter(x => x.id !== h.id)
      showToastMsg('Hold deleted')
    },
    'Yes, delete',
  )
}


// ──────────────────────────────────────────────
// 10. EXPORT CSV (current tab + search + sort)
// ──────────────────────────────────────────────
function exportCSV() {
  const headers = ['Customer', 'Phone', 'Held On', 'Item', 'SKU', 'Price Type', 'Unit Price', 'Held', 'Collected', 'Cancelled', 'Left']
  const rows = filteredHolds.value.flatMap(h =>
    h.customer_hold_items.map(i => [
      h.pay_later_customers?.name ?? '—',
      h.pay_later_customers?.phone ?? '—',
      fmtDate(h.created_at),
      i.product_name,
      i.sku ?? '—',
      i.discount_label ?? 'Discount',
      Number(i.unit_price).toFixed(2),
      i.qty_held, i.qty_sold, i.qty_cancelled, remaining(i),
    ]),
  )
  const csv = [headers, ...rows]
    .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const a = Object.assign(document.createElement('a'), {
    href: 'data:text/csv,' + encodeURIComponent(csv),
    download: `customer-holds-${new Date().toISOString().slice(0, 10)}.csv`,
  })
  a.click()
  showToastMsg('CSV exported')
}


// ──────────────────────────────────────────────
// 11. TOAST
// ──────────────────────────────────────────────
const toastMsg     = ref('')
const toastVisible = ref(false)
function showToastMsg(msg: string) {
  toastMsg.value     = msg
  toastVisible.value = true
  setTimeout(() => { toastVisible.value = false }, 2600)
}


// ──────────────────────────────────────────────
// 12. INIT
// ──────────────────────────────────────────────
onMounted(fetchHolds)
</script>


<!-- ════════════════════════════════════════════ -->
<!--             TEMPLATE (the HTML)             -->
<!-- ════════════════════════════════════════════ -->
<template>
  <div class="page-wrap" :class="{ light: isLight }">

    <!-- ── SIDEBAR ── -->
    <Slidebar v-model:isLight="isLight" />

    <main class="main">

      <!-- ── PAGE HEADER ── -->
      <div class="page-header">
        <h1 class="page-title">Customer Holds</h1>
        <p class="page-sub">Items set aside for customers · stock stays reserved until collected or cancelled</p>
      </div>

      <!-- ── STATS BAR ── -->
      <div class="stats-bar">
        <div class="stat-card">
          <div class="stat-label">Value On Hold</div>
          <div class="stat-value profit">{{ fmtRs(valueOnHold) }}</div>
          <div class="stat-sub">waiting to be collected</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Items Waiting</div>
          <div class="stat-value">{{ itemsWaiting }}</div>
          <div class="stat-sub">reserved out of stock</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Temporary Holds</div>
          <div class="stat-value">{{ temporaryHolds.length }}</div>
          <div class="stat-sub">customers still to collect</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Completed Holds</div>
          <div class="stat-value">{{ completedHolds.length }}</div>
          <div class="stat-sub">paid at the cart</div>
        </div>
      </div>

      <!-- ── TABS ── -->
      <div class="tabs">
        <button class="tab" :class="{ active: activeTab === 'temporary' }" @click="activeTab = 'temporary'">
          Temporary <span class="tab-count">{{ temporaryHolds.length }}</span>
        </button>
        <button class="tab" :class="{ active: activeTab === 'completed' }" @click="activeTab = 'completed'">
          Paid <span class="tab-count">{{ completedHolds.length }}</span>
        </button>
        <button class="tab" :class="{ active: activeTab === 'cancelled' }" @click="activeTab = 'cancelled'">
          Cancelled <span class="tab-count">{{ cancelledHolds.length }}</span>
        </button>
      </div>

      <!-- ── TOOLBAR ── -->
      <div class="toolbar">
        <div class="search-box">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path stroke-linecap="round" d="m21 21-4.35-4.35"/></svg>
          <input v-model="searchQuery" type="text" placeholder="Search by name…" />
        </div>

        <div class="sort-chips">
          <button class="sort-chip" :class="{ active: sortMode === 'latest' }" @click="sortMode = 'latest'">Latest</button>
          <button class="sort-chip" :class="{ active: sortMode === 'az' }" @click="sortMode = 'az'">A – Z</button>
        </div>

        <div class="toolbar-right">
          <button class="btn btn-outline" @click="fetchHolds" title="Refresh data">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.08-6.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Refresh
          </button>
          <button class="btn btn-outline" @click="exportCSV">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
            Export CSV
          </button>
        </div>
      </div>

      <!-- ── TABLE ── -->
      <div class="table-wrap">
        <div v-if="loading" class="state-msg">Loading customer holds…</div>
        <div v-else-if="fetchError" class="state-error">{{ fetchError }}</div>

        <template v-else>
          <table>
            <thead>
              <tr>
                <th style="width:30px"></th>
                <th>#</th>
                <th>Customer</th>
                <th>Phone</th>
                <th style="text-align:right">Items Held</th>
                <th style="text-align:right">Collected</th>
                <th style="text-align:right">Cancelled</th>
                <th style="text-align:right">Waiting Value</th>
                <th>Held On</th>
                <th style="text-align:right; padding-right:20px;">Action</th>
              </tr>
            </thead>

            <tbody>
              <tr v-if="filteredHolds.length === 0">
                <td colspan="10" class="empty-row">
                  {{ activeTab === 'temporary' ? 'Nothing on hold right now.' : activeTab === 'completed' ? 'No paid holds yet.' : 'No cancelled holds.' }}
                </td>
              </tr>

              <template v-for="(h, index) in filteredHolds" :key="h.id">
                <tr class="txn-row" :style="{ animationDelay: (index * 0.03) + 's' }" @click="toggleExpand(h.id)">
                  <td class="expand-cell">
                    <svg class="expand-arrow" :class="{ open: expandedIds.has(h.id) }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                  </td>
                  <td>{{ index + 1 }}</td>
                  <td class="name-cell">
                    {{ h.pay_later_customers?.name ?? 'Unknown customer' }}
                    <div class="cust-id">{{ h.pay_later_customers?.id_number || '' }}</div>
                  </td>
                  <td class="date-cell">{{ h.pay_later_customers?.phone || '—' }}</td>
                  <td class="price-cell" style="text-align:right">{{ holdHeldQty(h) }}</td>
                  <td class="price-cell" style="text-align:right; color:var(--green)">{{ holdCollectedQty(h) }}</td>
                  <td class="price-cell" style="text-align:right; color:var(--text-muted)">{{ holdCancelledQty(h) }}</td>
                  <td class="price-cell" style="text-align:right; font-weight:700" :style="{ color: holdRemainingQty(h) > 0 ? 'var(--green)' : 'var(--text-muted)' }">
                    {{ fmtRs(holdRemainingValue(h)) }}
                  </td>
                  <td class="date-cell">{{ fmtDate(h.created_at) }}</td>
                  <td style="text-align:right; padding-right:20px;" @click.stop>
                    <span v-if="holdStatus(h) === 'temporary'" class="row-actions">
                      <button class="btn-pay" @click="continueInCart(h)">Continue in Cart</button>
                      <button class="btn-delete" title="Cancel the whole hold" @click="cancelHold(h)">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </span>
                    <span v-else class="row-actions">
                      <span v-if="holdStatus(h) === 'completed'" class="paid-tag">✓ Paid</span>
                      <span v-else class="cancelled-tag">Cancelled</span>
                      <button class="btn-delete" title="Delete this hold" @click="deleteHold(h)">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                      </button>
                    </span>
                  </td>
                </tr>

                <!-- ── EXPANDED PANEL: contact + held items ── -->
                <tr v-if="expandedIds.has(h.id)" class="expand-panel-row">
                  <td colspan="10">
                    <div class="expand-panel">

                      <!-- Contact details -->
                      <div class="expand-section">
                        <div class="expand-section-title">Contact</div>
                        <div class="contact-grid">
                          <div><span class="contact-label">Phone</span> {{ h.pay_later_customers?.phone || '—' }}</div>
                          <div><span class="contact-label">ID Number</span> {{ h.pay_later_customers?.id_number || '—' }}</div>
                          <div><span class="contact-label">Address</span> {{ h.pay_later_customers?.address || '—' }}</div>
                        </div>
                      </div>

                      <!-- Held items -->
                      <div class="expand-section">
                        <div class="expand-section-title">Held Items ({{ h.customer_hold_items.length }})</div>
                        <div class="bill-card">
                          <div
                            v-for="i in h.customer_hold_items"
                            :key="i.id"
                            class="expand-item"
                            :class="{ 'expand-item-done': remaining(i) === 0 }"
                          >
                            <img v-if="i.image_url" :src="i.image_url" class="expand-item-img" />
                            <div v-else class="expand-item-img expand-item-img-placeholder">
                              <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" width="14" height="14"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9l4-4 4 4 4-4 4 4"/><path d="M3 15l4 4 4-4 4 4 4-4"/></svg>
                            </div>
                            <div class="expand-item-info">
                              <div class="expand-item-name">{{ i.product_name }}</div>
                              <div class="expand-item-sku">{{ i.sku || '—' }}</div>
                            </div>
                            <span class="discount-badge" :class="discountLabelClass(i.discount_label)">{{ i.discount_label || 'Discount' }}</span>
                            <div class="expand-item-state">
                              <span>Held {{ i.qty_held }}</span>
                              <span v-if="i.qty_sold" class="st-sold">· Paid {{ i.qty_sold }}</span>
                              <span v-if="i.qty_cancelled" class="st-cancelled">· Cancelled {{ i.qty_cancelled }}</span>
                            </div>
                            <div class="expand-item-qty">x{{ remaining(i) }}</div>
                            <div class="expand-item-total">{{ fmtRs(remaining(i) * i.unit_price) }}</div>
                            <button
                              v-if="remaining(i) > 0"
                              class="btn-edit-payment"
                              title="Cancel this item (puts it back in stock)"
                              @click.stop="cancelItem(i)"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                            <span v-else class="item-spacer"></span>
                          </div>
                        </div>
                      </div>

                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </template>
      </div>
    </main>

    <ConfirmModal
      v-model="showConfirm"
      :isLight="isLight"
      :title="confirmTitle"
      :message="confirmMessage"
      :confirmText="confirmYes"
      :danger="true"
      @confirm="runPendingAction"
    />
    <Toast :message="toastMsg" :show="toastVisible" />
  </div>
</template>


<!-- ════════════════════════════════════════════ -->
<!--                SCOPED STYLES               -->
<!-- ════════════════════════════════════════════ -->
<style scoped>
/* ── CSS VARIABLES — Dark theme (default) ── */
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
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

.page-wrap {
  display: flex; min-height: 100vh; width: 100%;
  background: var(--bg); color: var(--text);
  font-family: 'DM Sans', sans-serif;
  transition: background .3s, color .3s;
}

::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 99px; }

.main { flex: 1; display: flex; flex-direction: column; min-height: 100vh; overflow-y: auto; }

.page-header { padding: 32px 32px 0; }
.page-title  { font-size: 26px; font-weight: 600; letter-spacing: -.02em; color: var(--text); }
.page-sub    { font-size: 13px; color: var(--text-sub); margin-top: 2px; }

/* ── STATS ── */
.stats-bar { display: flex; gap: 16px; padding: 24px 32px 4px; flex-wrap: wrap; }
.stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 20px; flex: 1; min-width: 160px; box-shadow: var(--shadow); }
.stat-label { font-size: 11px; color: var(--text-sub); text-transform: uppercase; letter-spacing: .06em; font-weight: 500; }
.stat-value { font-size: 22px; font-weight: 600; margin-top: 4px; letter-spacing: -.02em; font-family: 'DM Mono', monospace; color: var(--text); }
.stat-value.profit { color: var(--green); }
.stat-sub { font-size: 11px; color: var(--text-sub); margin-top: 2px; }

/* ── TABS ── */
.tabs { display: flex; gap: 4px; padding: 18px 32px 0; }
.tab {
  padding: 9px 18px; border-radius: 9px 9px 0 0;
  border: 1px solid var(--border); border-bottom: none;
  background: var(--surface2); color: var(--text-sub);
  font-size: 13px; font-weight: 500; font-family: 'DM Sans', sans-serif;
  cursor: pointer; transition: background .15s, color .15s;
  display: flex; align-items: center; gap: 7px;
}
.tab.active { background: var(--surface); color: var(--text); font-weight: 600; }
.tab-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px;
  background: var(--bg); font-size: 10.5px; font-weight: 700;
}

/* ── TOOLBAR ── */
.toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; background: var(--surface); border: 1px solid var(--border); border-radius: 0 var(--radius) var(--radius) var(--radius); margin: 0 32px; padding: 14px 20px; }
.search-box {
  display: flex; align-items: center; gap: 8px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
  padding: 8px 12px; flex: 1; max-width: 300px;
}
.search-box svg { width: 15px; height: 15px; color: var(--text-sub); flex-shrink: 0; }
.search-box input { border: none; background: transparent; font-family: 'DM Sans', sans-serif; font-size: 13px; color: var(--text); outline: none; width: 100%; }
.search-box input::placeholder { color: var(--text-sub); }

.sort-chips { display: flex; gap: 6px; }
.sort-chip { padding: 7px 13px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text-sub); font-size: 12px; font-family: 'DM Sans', sans-serif; cursor: pointer; transition: all .15s; }
.sort-chip.active { border-color: var(--accent); background: var(--accent); color: var(--accent-fg); font-weight: 600; }

.btn { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid transparent; transition: opacity .15s, background .15s; }
.btn svg { width: 14px; height: 14px; }
.btn-outline { background: var(--bg); border-color: var(--border); color: var(--text); }
.btn-outline:hover { background: var(--surface2); }
.toolbar-right { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; }

/* ── TABLE ── */
.table-wrap { margin: 16px 32px 32px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
.state-msg { padding: 40px 24px; text-align: center; font-size: 13px; color: var(--text-muted); }
.state-error { margin: 12px 24px; padding: 12px 14px; border-radius: 8px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: var(--red); font-size: 12.5px; }

table { width: 100%; border-collapse: collapse; font-size: 13px; }
thead tr { background: var(--surface2); border-bottom: 1px solid var(--border); }
thead th { padding: 11px 14px; text-align: left; font-weight: 600; font-size: 12px; letter-spacing: .04em; color: var(--text-sub); white-space: nowrap; }
thead th:first-child { padding-left: 20px; width: 44px; }

tbody tr { border-bottom: 1px solid var(--border); transition: background .12s; animation: rowIn .3s ease both; }
tbody tr:last-child { border-bottom: none; }
tbody tr:hover { background: var(--surface2); }
tbody td { padding: 12px 14px; vertical-align: middle; color: var(--text); }
tbody td:first-child { padding-left: 20px; color: var(--text-sub); font-family: 'DM Mono', monospace; font-size: 12px; }

.empty-row { text-align: center; color: var(--text-muted); padding: 40px 14px !important; }

@keyframes rowIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

.name-cell { font-weight: 500; }
.cust-id { font-size: 10.5px; color: var(--text-muted); margin-top: 2px; font-weight: 400; }
.date-cell { color: var(--text-sub); font-size: 12px; }
.price-cell { font-family: 'DM Mono', monospace; font-size: 12.5px; }

.row-actions { display: inline-flex; align-items: center; gap: 8px; }
.btn-pay {
  padding: 6px 16px; border-radius: 7px; border: none;
  background: var(--green); color: #fff; font-size: 12px; font-weight: 600;
  font-family: 'DM Sans', sans-serif; cursor: pointer; transition: opacity .15s;
  white-space: nowrap;
}
.btn-pay:hover { opacity: .85; }

.paid-tag { font-size: 12px; color: var(--green); font-weight: 600; }
.cancelled-tag { font-size: 12px; color: var(--red); font-weight: 600; }

.btn-delete {
  width: 26px; height: 26px; border-radius: 7px;
  border: 1px solid var(--border); background: var(--bg);
  color: var(--text-muted); cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: color .15s, background .15s, border-color .15s;
}
.btn-delete:hover { color: var(--red); background: var(--red-bg); border-color: var(--red); }

/* ── Expandable row ── */
.txn-row { cursor: pointer; }
.expand-cell { padding-left: 16px !important; width: 30px; }
.expand-arrow { transition: transform .15s; color: var(--text-muted); }
.expand-arrow.open { transform: rotate(90deg); color: var(--text); }

.expand-panel-row td { padding: 0 !important; border-bottom: 1px solid var(--border); }
.expand-panel { background: var(--surface2); padding: 16px 20px 16px 50px; display: flex; flex-direction: column; gap: 18px; animation: rowIn .2s ease both; }

.expand-section-title { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--text-sub); margin-bottom: 8px; }

.contact-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; font-size: 12.5px; color: var(--text); }
.contact-label { color: var(--text-muted); font-size: 10.5px; display: block; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 2px; }

.bill-card { background: var(--surface); border: 1px solid var(--border); border-radius: 9px; padding: 6px 12px; }

.expand-item { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--border); }
.expand-item:last-child { border-bottom: none; }
.expand-item-img { width: 32px; height: 32px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border); flex-shrink: 0; }
.expand-item-img-placeholder { display: flex; align-items: center; justify-content: center; color: var(--text-muted); background: var(--surface2); }
.expand-item-info { flex: 1; min-width: 0; }
.expand-item-name { font-size: 12px; font-weight: 500; color: var(--text); }
.expand-item-sku  { font-size: 10px; color: var(--text-muted); }
.expand-item-state { font-size: 11px; color: var(--text-sub); white-space: nowrap; }
.st-sold { color: var(--green); }
.st-cancelled { color: var(--red); }
.expand-item-qty   { font-size: 11.5px; color: var(--text-sub); font-family: 'DM Mono', monospace; width: 30px; text-align: right; }
.expand-item-total { font-size: 12px; font-weight: 600; color: var(--text); font-family: 'DM Mono', monospace; width: 100px; text-align: right; }
.item-spacer { width: 22px; flex-shrink: 0; }

.discount-badge {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 2px 8px; border-radius: 5px; font-size: 9px; font-weight: 600;
  letter-spacing: .03em; text-transform: uppercase; width: 68px; flex-shrink: 0;
  background: var(--surface); border: 1px solid var(--border); color: var(--text-sub);
}
.discount-badge.label-discount { border-color: var(--green); background: var(--green-bg); color: var(--green); }
.discount-badge.label-super    { border-color: #8b5cf6; background: rgba(139,92,246,0.12); color: #8b5cf6; }
.discount-badge.label-original { border-color: var(--border); background: var(--surface); color: var(--text-sub); }

/* Fully collected / cancelled line — dimmed */
.expand-item-done .expand-item-name,
.expand-item-done .expand-item-total { color: var(--text-muted); text-decoration: line-through; }
.expand-item-done .expand-item-img { opacity: .5; }

.btn-edit-payment {
  width: 22px; height: 22px; border-radius: 6px; flex-shrink: 0;
  border: 1px solid var(--border); background: var(--surface);
  color: var(--text-muted); cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: color .15s, background .15s, border-color .15s;
}
.btn-edit-payment:hover { color: var(--red); background: var(--red-bg); border-color: var(--red); }

/* ── PRINT MODE ── */
@media print {
  :deep(.sidebar) { display: none !important; }
  .tabs, .toolbar { display: none !important; }
  .page-wrap { display: block !important; background: #fff !important; color: #000 !important; }
  .main { overflow: visible !important; }
  .table-wrap { box-shadow: none !important; margin: 12px 0 !important; }
  .expand-panel-row { display: none !important; }
}
</style>

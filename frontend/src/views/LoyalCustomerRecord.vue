<!--
  ╔═══════════════════════════════════════════════════════════════════╗
  ║  LoyalCustomerRecord.vue — what registered customers bought       ║
  ║  Data: "loyal_purchases" table (one row per item bought), filled  ║
  ║  at checkout when the "Customer Book" toggle is ON.               ║
  ║  • Shows ONE MONTH at a time (default: this month)                ║
  ║  • Searching a name searches ALL records, whatever the month, and ║
  ║    shows that person's details + 1-year totals                    ║
  ║  • Tabs: Records · Top by Items · Top by Spending (for the month) ║
  ║  • Each purchase record is deleted after 1 year (nightly job in   ║
  ║    the database) — the customer and newer records stay            ║
  ║  Same design pattern as PayLaterView / CustomerHolds.             ║
  ╚═══════════════════════════════════════════════════════════════════╝
-->

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import Slidebar from '../components/Slidebar.vue'
import Toast from '../components/Toast.vue'
import PayLaterCustomerBookModal from '../components/modals/PayLaterCustomerBookModal.vue'
import EditPayLaterCustomerModal from '../components/modals/EditPayLaterCustomerModal.vue'
import { supabase } from '../lib/supabase'
import { markConnected, markError } from '../lib/connectionStatus'

// ──────────────────────────────────────────────
// 1. TYPES
// ──────────────────────────────────────────────
interface Purchase {
  id: string
  customer_id: string
  product_name: string
  sku: string | null
  image_url: string | null
  qty: number
  unit_price: number
  line_total: number
  discount_label: string | null
  payment_method: string | null
  invoice_no: string | null
  purchased_at: string
  pay_later_customers: { name: string; phone: string | null } | null
}

// A customer's saved contact details (same fields as the Edit Contact modal)
interface Contact {
  id: string
  name: string
  id_number: string | null
  phone: string | null
  address: string | null
}


// ──────────────────────────────────────────────
// 2. THEME
// ──────────────────────────────────────────────
const isLight = ref(localStorage.getItem('theme') === 'light')


// ──────────────────────────────────────────────
// 3. MONTH SELECTION (default = this month)
// ──────────────────────────────────────────────
function monthStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const currentMonth  = monthStr(new Date())
const selectedMonth = ref(currentMonth)

// Records only live for 1 year, so there is nothing to browse before that
const minMonth = (() => {
  const d = new Date()
  d.setFullYear(d.getFullYear() - 1)
  return monthStr(d)
})()

const monthLabel = computed(() => {
  const [y, m] = selectedMonth.value.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
})

const canGoPrev = computed(() => selectedMonth.value > minMonth)
const canGoNext = computed(() => selectedMonth.value < currentMonth)

function shiftMonth(delta: number) {
  const [y, m] = selectedMonth.value.split('-').map(Number)
  const next = monthStr(new Date(y, m - 1 + delta, 1))
  if (next < minMonth || next > currentMonth) return
  selectedMonth.value = next
}

// First moment of the selected month → first moment of the next month
function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number)
  return {
    start: new Date(y, m - 1, 1).toISOString(),
    end:   new Date(y, m, 1).toISOString(),
  }
}


// ──────────────────────────────────────────────
// 4. SEARCH — typing a name searches ALL months
// ──────────────────────────────────────────────
const searchQuery = ref('')
const isSearching = computed(() => searchQuery.value.trim().length > 0)

// Tabs: all records · ranking by items bought · ranking by money spent
type Tab = 'records' | 'items' | 'spent'
const activeTab = ref<Tab>('records')


// ──────────────────────────────────────────────
// 5. DATA
// ──────────────────────────────────────────────
const records    = ref<Purchase[]>([])
const matchedCustomers = ref<Contact[]>([])   // people whose name matches the search
const loading    = ref(false)
const fetchError = ref('')

// Supabase sends back at most 1000 rows per request, so ask page by page
// until a page comes back smaller than 1000 (same idea as ProductListView).
async function fetchRecords() {
  loading.value    = true
  fetchError.value = ''
  try {
    const q = searchQuery.value.trim()

    // Name search: find the matching customers first, then load all their records
    let customerIds: string[] | null = null
    if (q) {
      const { data: custs, error: custErr } = await supabase
        .from('pay_later_customers')
        .select('id, name, id_number, phone, address')
        .ilike('name', `%${q}%`)
        .order('name')
      if (custErr) { fetchError.value = custErr.message; markError(); return }
      matchedCustomers.value = (custs ?? []) as Contact[]
      customerIds = matchedCustomers.value.map(c => c.id)
      if (customerIds.length === 0) { records.value = []; markConnected(); return }
    } else {
      matchedCustomers.value = []
    }

    const PAGE_SIZE = 1000
    let all: Purchase[] = []
    let from = 0
    while (true) {
      let query = supabase
        .from('loyal_purchases')
        .select('*, pay_later_customers(name, phone)')
        .order('purchased_at', { ascending: false })
        .range(from, from + PAGE_SIZE - 1)

      if (customerIds) {
        query = query.in('customer_id', customerIds)
      } else {
        const { start, end } = monthRange(selectedMonth.value)
        query = query.gte('purchased_at', start).lt('purchased_at', end)
      }

      const { data, error } = await query
      if (error) { fetchError.value = error.message; markError(); return }

      const page = (data ?? []) as Purchase[]
      all = all.concat(page)
      if (page.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }

    records.value = all
    currentPage.value = 1
    markConnected()
  } catch {
    fetchError.value = 'Could not load customer records.'
    markError()
  } finally {
    loading.value = false
  }
}

// Reload when the month changes, and (after a short pause in typing) when the search changes
watch(selectedMonth, fetchRecords)
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(searchQuery, () => {
  // A name search always shows the person's records, so jump back to that tab
  if (isSearching.value) activeTab.value = 'records'
  clearTimeout(searchTimer)
  searchTimer = setTimeout(fetchRecords, 300)
})


// ──────────────────────────────────────────────
// 6. STAT CARDS
// ──────────────────────────────────────────────
const totalPurchases = computed(() => records.value.length)
const totalItems     = computed(() => records.value.reduce((s, r) => s + r.qty, 0))
const totalSpent     = computed(() => records.value.reduce((s, r) => s + Number(r.line_total), 0))
const customerCount  = computed(() => new Set(records.value.map(r => r.customer_id)).size)


// ──────────────────────────────────────────────
// 6b. RANKINGS — for the selected month (built from the records already loaded)
// ──────────────────────────────────────────────
interface RankRow {
  customer_id: string
  name: string
  phone: string | null
  items: number       // total quantity bought
  purchases: number   // number of separate bills
  spent: number       // total Rs.
}

const rankRows = computed<RankRow[]>(() => {
  const map = new Map<string, RankRow & { invoices: Set<string> }>()
  for (const r of records.value) {
    let row = map.get(r.customer_id)
    if (!row) {
      row = {
        customer_id: r.customer_id,
        name: r.pay_later_customers?.name ?? 'Unknown customer',
        phone: r.pay_later_customers?.phone ?? null,
        items: 0, purchases: 0, spent: 0, invoices: new Set<string>(),
      }
      map.set(r.customer_id, row)
    }
    row.items += r.qty
    row.spent += Number(r.line_total)
    row.invoices.add(r.invoice_no ?? r.id)
  }
  return [...map.values()].map(r => ({ ...r, purchases: r.invoices.size }))
})

const ranking = computed(() => {
  const list = [...rankRows.value]
  if (activeTab.value === 'items') list.sort((a, b) => b.items - a.items || b.spent - a.spent)
  else list.sort((a, b) => b.spent - a.spent || b.items - a.items)
  return list
})

// Click a ranked customer → search their name (shows details + everything they bought)
function openCustomer(name: string) {
  searchQuery.value = name
}


// ──────────────────────────────────────────────
// 6c. SEARCH DETAILS — one card per matching customer, totals over every
// record we still keep (1 year), because a name search loads all months
// ──────────────────────────────────────────────
const MAX_CARDS = 5

const customerCards = computed(() =>
  matchedCustomers.value.slice(0, MAX_CARDS).map(c => {
    const mine = records.value.filter(r => r.customer_id === c.id)
    return {
      contact: c,
      items: mine.reduce((s, r) => s + r.qty, 0),
      spent: mine.reduce((s, r) => s + Number(r.line_total), 0),
      purchases: new Set(mine.map(r => r.invoice_no ?? r.id)).size,
      last: mine.length ? mine[0].purchased_at : null,   // records are newest first
    }
  })
)

// Edit contact (reuses the Pay Later Edit Contact modal)
const showEditContact = ref(false)
const editingContact  = ref<Contact | null>(null)
function openEditContact(c: Contact) {
  editingContact.value = c
  showEditContact.value = true
}


// ──────────────────────────────────────────────
// 7. PAGINATION (on screen)
// ──────────────────────────────────────────────
const PER_PAGE    = 25
const currentPage = ref(1)
const totalPages  = computed(() => Math.max(1, Math.ceil(records.value.length / PER_PAGE)))
const pagedRecords = computed(() => {
  const start = (currentPage.value - 1) * PER_PAGE
  return records.value.slice(start, start + PER_PAGE)
})
const pageInfoText = computed(() => {
  const total = records.value.length
  if (total === 0) return 'No records found'
  const start = (currentPage.value - 1) * PER_PAGE + 1
  return `Showing ${start}–${Math.min(start + PER_PAGE - 1, total)} of ${total}`
})
function goToPage(p: number) {
  if (p >= 1 && p <= totalPages.value) currentPage.value = p
}


// ──────────────────────────────────────────────
// 8. HELPERS
// ──────────────────────────────────────────────
function fmtRs(n: number): string {
  return `Rs. ${Number(n).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
}

function discountLabelClass(label: string | null): string {
  if (!label) return ''
  const l = label.toLowerCase()
  if (l === 'super') return 'label-super'
  if (l === 'original') return 'label-original'
  return 'label-discount'
}

function methodLabel(m: string | null): string {
  if (!m) return '—'
  return m.charAt(0).toUpperCase() + m.slice(1)
}


// ──────────────────────────────────────────────
// 9. CUSTOMER BOOK (same contact book as Pay Later)
// ──────────────────────────────────────────────
const showCustomerBook = ref(false)


// ──────────────────────────────────────────────
// 10. EXPORT CSV (what's on screen: this month, or the search results)
// ──────────────────────────────────────────────
function exportCSV() {
  const headers = ['Date', 'Customer', 'Phone', 'Item', 'SKU', 'Price Type', 'Qty', 'Unit Price', 'Amount', 'Payment', 'Invoice']
  const rows = records.value.map(r => [
    fmtDate(r.purchased_at),
    r.pay_later_customers?.name ?? '—',
    r.pay_later_customers?.phone ?? '—',
    r.product_name,
    r.sku ?? '—',
    r.discount_label ?? '—',
    r.qty,
    Number(r.unit_price).toFixed(2),
    Number(r.line_total).toFixed(2),
    methodLabel(r.payment_method),
    r.invoice_no ?? '—',
  ])
  const csv = [headers, ...rows]
    .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const a = Object.assign(document.createElement('a'), {
    href: 'data:text/csv,' + encodeURIComponent(csv),
    download: `loyal-customers-${isSearching.value ? 'search' : selectedMonth.value}.csv`,
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
onMounted(fetchRecords)
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
        <h1 class="page-title">Loyal Customers</h1>
        <p class="page-sub">What your registered customers bought · each record is kept for 1 year</p>
      </div>

      <!-- ── STATS BAR ── -->
      <div class="stats-bar">
        <div class="stat-card">
          <div class="stat-label">Purchases</div>
          <div class="stat-value">{{ totalPurchases }}</div>
          <div class="stat-sub">{{ isSearching ? 'matching your search' : 'in ' + monthLabel }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Items Bought</div>
          <div class="stat-value">{{ totalItems }}</div>
          <div class="stat-sub">total quantity</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Spent</div>
          <div class="stat-value profit">{{ fmtRs(totalSpent) }}</div>
          <div class="stat-sub">by these customers</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Customers</div>
          <div class="stat-value">{{ customerCount }}</div>
          <div class="stat-sub">who bought</div>
        </div>
      </div>

      <!-- ── TABS ── -->
      <div class="tabs">
        <button class="tab" :class="{ active: activeTab === 'records' }" @click="activeTab = 'records'">Records</button>
        <button class="tab" :class="{ active: activeTab === 'items' }" @click="activeTab = 'items'">Top by Items</button>
        <button class="tab" :class="{ active: activeTab === 'spent' }" @click="activeTab = 'spent'">Top by Spending</button>
      </div>

      <!-- ── TOOLBAR ── -->
      <div class="toolbar">
        <!-- Month picker (hidden while searching, because a search covers every month) -->
        <div v-if="!isSearching" class="month-nav">
          <button class="month-btn" :disabled="!canGoPrev" title="Previous month" @click="shiftMonth(-1)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div class="month-label">{{ monthLabel }}</div>
          <button class="month-btn" :disabled="!canGoNext" title="Next month" @click="shiftMonth(1)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <div v-else class="search-note">Showing all records for “{{ searchQuery.trim() }}”</div>

        <div class="search-box">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path stroke-linecap="round" d="m21 21-4.35-4.35"/></svg>
          <input v-model="searchQuery" type="text" placeholder="Search customer name (all months)…" />
        </div>

        <div class="toolbar-right">
          <button class="btn btn-outline" @click="fetchRecords" title="Refresh data">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.08-6.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Refresh
          </button>
          <button v-if="activeTab === 'records'" class="btn btn-outline" @click="exportCSV">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
            Export CSV
          </button>
          <button class="btn btn-primary" @click="showCustomerBook = true" title="Browse, search, edit or delete every contact">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path stroke-linecap="round" stroke-linejoin="round" d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
            Customer Book
          </button>
        </div>
      </div>

      <!-- ── SEARCH RESULT: who is this customer? (details + 1-year totals) ── -->
      <div v-if="isSearching && !loading && customerCards.length" class="cards-wrap">
        <div v-for="c in customerCards" :key="c.contact.id" class="person-card">
          <div class="person-top">
            <div class="avatar">{{ c.contact.name.charAt(0).toUpperCase() }}</div>
            <div class="person-info">
              <div class="person-name">{{ c.contact.name }}</div>
              <div class="person-contact">
                <span><span class="contact-label">Phone</span> {{ c.contact.phone || '—' }}</span>
                <span><span class="contact-label">ID Number</span> {{ c.contact.id_number || '—' }}</span>
                <span><span class="contact-label">Address</span> {{ c.contact.address || '—' }}</span>
              </div>
            </div>
            <button class="btn btn-outline btn-edit" @click="openEditContact(c.contact)">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path stroke-linecap="round" stroke-linejoin="round" d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Edit
            </button>
          </div>
          <div class="person-stats">
            <div class="person-stat">
              <div class="stat-label">Items Bought</div>
              <div class="stat-value">{{ c.items }}</div>
              <div class="stat-sub">last 12 months</div>
            </div>
            <div class="person-stat">
              <div class="stat-label">Total Spent</div>
              <div class="stat-value profit">{{ fmtRs(c.spent) }}</div>
              <div class="stat-sub">last 12 months</div>
            </div>
            <div class="person-stat">
              <div class="stat-label">Purchases</div>
              <div class="stat-value">{{ c.purchases }}</div>
              <div class="stat-sub">separate bills</div>
            </div>
            <div class="person-stat">
              <div class="stat-label">Last Purchase</div>
              <div class="stat-value stat-value-sm">{{ c.last ? fmtDate(c.last) : '—' }}</div>
              <div class="stat-sub">most recent</div>
            </div>
          </div>
        </div>
        <div v-if="matchedCustomers.length > MAX_CARDS" class="more-note">
          and {{ matchedCustomers.length - MAX_CARDS }} more matching customers — type more of the name to narrow it down
        </div>
      </div>

      <!-- ── RANKING TABLE (Top by Items / Top by Spending, for the selected month) ── -->
      <div v-if="activeTab !== 'records' && !isSearching" class="table-wrap">
        <div v-if="loading" class="state-msg">Loading ranking…</div>
        <div v-else-if="fetchError" class="state-error">{{ fetchError }}</div>
        <template v-else>
          <div class="rank-title">
            {{ activeTab === 'items' ? 'Customers who bought the most items' : 'Customers who spent the most' }} · {{ monthLabel }}
          </div>
          <table>
            <thead>
              <tr>
                <th style="width:70px">Rank</th>
                <th>Customer</th>
                <th>Phone</th>
                <th style="text-align:right" :class="{ 'th-key': activeTab === 'items' }">Items Bought</th>
                <th style="text-align:right">Purchases</th>
                <th style="text-align:right; padding-right:20px" :class="{ 'th-key': activeTab === 'spent' }">Total Spent</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="ranking.length === 0">
                <td colspan="6" class="empty-row">No purchases recorded in {{ monthLabel }}.</td>
              </tr>
              <tr
                v-for="(r, index) in ranking"
                :key="r.customer_id"
                class="rank-row"
                :style="{ animationDelay: (index * 0.02) + 's' }"
                title="Click to see everything this customer bought"
                @click="openCustomer(r.name)"
              >
                <td><span class="rank-badge" :class="index < 3 ? 'rank-' + (index + 1) : ''">{{ index + 1 }}</span></td>
                <td class="name-cell">{{ r.name }}</td>
                <td class="date-cell">{{ r.phone || '—' }}</td>
                <td class="price-cell" style="text-align:right" :class="{ 'cell-key': activeTab === 'items' }">{{ r.items }}</td>
                <td class="price-cell" style="text-align:right">{{ r.purchases }}</td>
                <td class="price-cell" style="text-align:right; padding-right:20px" :class="{ 'cell-key': activeTab === 'spent' }">{{ fmtRs(r.spent) }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </div>

      <!-- ── TABLE ── -->
      <div v-else class="table-wrap">
        <div v-if="loading" class="state-msg">Loading records…</div>
        <div v-else-if="fetchError" class="state-error">{{ fetchError }}</div>

        <template v-else>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Item</th>
                <th>Price Type</th>
                <th style="text-align:right">Qty</th>
                <th style="text-align:right">Amount</th>
                <th>Payment</th>
                <th>Invoice</th>
              </tr>
            </thead>

            <tbody>
              <tr v-if="pagedRecords.length === 0">
                <td colspan="9" class="empty-row">
                  {{ isSearching ? 'No records found for that name.' : 'No purchases recorded in ' + monthLabel + '.' }}
                </td>
              </tr>

              <tr v-for="(r, index) in pagedRecords" :key="r.id" :style="{ animationDelay: (index * 0.02) + 's' }">
                <td>{{ (currentPage - 1) * PER_PAGE + index + 1 }}</td>
                <td class="date-cell">{{ fmtDate(r.purchased_at) }}</td>
                <td class="name-cell">
                  {{ r.pay_later_customers?.name ?? 'Unknown customer' }}
                  <div class="cust-id">{{ r.pay_later_customers?.phone || '' }}</div>
                </td>
                <td>
                  <div class="item-cell">
                    <img v-if="r.image_url" :src="r.image_url" class="thumb" />
                    <div v-else class="thumb thumb-empty">
                      <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" width="14" height="14"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9l4-4 4 4 4-4 4 4"/><path d="M3 15l4 4 4-4 4 4 4-4"/></svg>
                    </div>
                    <div>
                      <div class="item-name">{{ r.product_name }}</div>
                      <div class="item-sku">{{ r.sku || '—' }}</div>
                    </div>
                  </div>
                </td>
                <td><span class="discount-badge" :class="discountLabelClass(r.discount_label)">{{ r.discount_label || '—' }}</span></td>
                <td class="price-cell" style="text-align:right">{{ r.qty }}</td>
                <td class="price-cell" style="text-align:right; font-weight:700">{{ fmtRs(r.line_total) }}</td>
                <td class="date-cell">{{ methodLabel(r.payment_method) }}</td>
                <td class="inv-cell">{{ r.invoice_no || '—' }}</td>
              </tr>
            </tbody>
          </table>

          <!-- ── PAGINATION BAR ── -->
          <div class="pagination">
            <span class="page-info">{{ pageInfoText }}</span>
            <div class="page-btns">
              <button class="page-btn" :disabled="currentPage === 1" @click="goToPage(currentPage - 1)">‹</button>
              <span class="page-now">{{ currentPage }} / {{ totalPages }}</span>
              <button class="page-btn" :disabled="currentPage >= totalPages" @click="goToPage(currentPage + 1)">›</button>
            </div>
          </div>
        </template>
      </div>
    </main>

    <PayLaterCustomerBookModal
      v-model="showCustomerBook"
      :isLight="isLight"
      @changed="fetchRecords"
    />
    <EditPayLaterCustomerModal
      v-model="showEditContact"
      :isLight="isLight"
      :customer="editingContact"
      @saved="fetchRecords"
    />
    <Toast :message="toastMsg" :show="toastVisible" />
  </div>
</template>


<!-- ════════════════════════════════════════════ -->
<!--                SCOPED STYLES               -->
<!-- ════════════════════════════════════════════ -->
<style scoped>
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

.main { flex: 1; display: flex; flex-direction: column; min-height: 100vh; overflow-y: auto; min-width: 0; }

.page-header { padding: 32px 32px 0; }
.page-title  { font-size: 26px; font-weight: 600; letter-spacing: -.02em; }
.page-sub    { font-size: 13px; color: var(--text-sub); margin-top: 2px; }

/* STATS */
.stats-bar { display: flex; gap: 16px; padding: 24px 32px 4px; flex-wrap: wrap; }
.stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 20px; flex: 1; min-width: 160px; box-shadow: var(--shadow); }
.stat-label { font-size: 11px; color: var(--text-sub); text-transform: uppercase; letter-spacing: .06em; font-weight: 500; }
.stat-value { font-size: 22px; font-weight: 600; margin-top: 4px; letter-spacing: -.02em; font-family: 'DM Mono', monospace; }
.stat-value.profit { color: var(--green); }
.stat-sub { font-size: 11px; color: var(--text-sub); margin-top: 2px; }

/* TABS (same look as Pay Later / Customer Holds) */
.tabs { display: flex; gap: 4px; padding: 18px 32px 0; }
.tab {
  padding: 9px 18px; border-radius: 9px 9px 0 0;
  border: 1px solid var(--border); border-bottom: none;
  background: var(--surface2); color: var(--text-sub);
  font-size: 13px; font-weight: 500; font-family: inherit;
  cursor: pointer; transition: background .15s, color .15s;
}
.tab.active { background: var(--surface); color: var(--text); font-weight: 600; }

/* TOOLBAR */
.toolbar {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  background: var(--surface); border: 1px solid var(--border); border-radius: 0 var(--radius) var(--radius) var(--radius);
  margin: 0 32px; padding: 14px 20px;
}

.month-nav { display: flex; align-items: center; gap: 4px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 3px; }
.month-btn {
  width: 30px; height: 30px; border-radius: 6px; border: none; background: transparent;
  color: var(--text-sub); cursor: pointer; display: grid; place-items: center; transition: background .12s, color .12s;
}
.month-btn:hover:not(:disabled) { background: var(--surface2); color: var(--text); }
.month-btn:disabled { opacity: .3; cursor: default; }
.month-label { min-width: 140px; text-align: center; font-size: 13px; font-weight: 600; }
.search-note { font-size: 12.5px; color: var(--green); font-weight: 600; padding: 0 4px; }

.search-box {
  display: flex; align-items: center; gap: 8px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
  padding: 8px 12px; flex: 1; max-width: 340px; min-width: 200px;
}
.search-box svg { width: 15px; height: 15px; color: var(--text-sub); flex-shrink: 0; }
.search-box input { border: none; background: transparent; font-family: inherit; font-size: 13px; color: var(--text); outline: none; width: 100%; }
.search-box input::placeholder { color: var(--text-sub); }

.btn { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px; font-family: inherit; font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid transparent; transition: opacity .15s, background .15s; }
.btn svg { width: 14px; height: 14px; }
.btn-primary { background: var(--accent); color: var(--accent-fg); }
.btn-primary:hover { opacity: .85; }
.btn-outline { background: var(--bg); border-color: var(--border); color: var(--text); }
.btn-outline:hover { background: var(--surface2); }
.toolbar-right { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; }

/* TABLE */
.table-wrap { margin: 16px 32px 32px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
.state-msg { padding: 40px 24px; text-align: center; font-size: 13px; color: var(--text-muted); }
.state-error { margin: 12px 24px; padding: 12px 14px; border-radius: 8px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: var(--red); font-size: 12.5px; }

table { width: 100%; border-collapse: collapse; font-size: 13px; }
thead tr { background: var(--surface2); border-bottom: 1px solid var(--border); }
thead th { padding: 11px 14px; text-align: left; font-weight: 600; font-size: 12px; letter-spacing: .04em; color: var(--text-sub); white-space: nowrap; }
thead th:first-child { padding-left: 20px; width: 54px; }

tbody tr { border-bottom: 1px solid var(--border); transition: background .12s; animation: rowIn .3s ease both; }
tbody tr:last-child { border-bottom: none; }
tbody tr:hover { background: var(--surface2); }
tbody td { padding: 11px 14px; vertical-align: middle; }
tbody td:first-child { padding-left: 20px; color: var(--text-sub); font-family: 'DM Mono', monospace; font-size: 12px; }
.empty-row { text-align: center; color: var(--text-muted); padding: 40px 14px !important; }
@keyframes rowIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

.name-cell { font-weight: 500; }
.cust-id { font-size: 10.5px; color: var(--text-muted); margin-top: 2px; font-weight: 400; }
.date-cell { color: var(--text-sub); font-size: 12px; white-space: nowrap; }
.price-cell { font-family: 'DM Mono', monospace; font-size: 12.5px; }
.inv-cell { font-family: 'DM Mono', monospace; font-size: 11px; color: var(--text-sub); }

.item-cell { display: flex; align-items: center; gap: 10px; }
.thumb { width: 36px; height: 36px; object-fit: cover; border-radius: 7px; border: 1px solid var(--border); flex-shrink: 0; }
.thumb-empty { display: flex; align-items: center; justify-content: center; color: var(--text-muted); background: var(--surface2); }
.item-name { font-size: 12.5px; font-weight: 500; }
.item-sku { font-size: 10.5px; color: var(--text-muted); font-family: 'DM Mono', monospace; }

.discount-badge {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 2px 8px; border-radius: 5px; font-size: 9px; font-weight: 600;
  letter-spacing: .03em; text-transform: uppercase; width: 68px;
  background: var(--surface); border: 1px solid var(--border); color: var(--text-sub);
}
.discount-badge.label-discount { border-color: var(--green); background: var(--green-bg); color: var(--green); }
.discount-badge.label-super    { border-color: #8b5cf6; background: rgba(139,92,246,0.12); color: #8b5cf6; }
.discount-badge.label-original { border-color: var(--border); background: var(--surface); color: var(--text-sub); }

/* SEARCH RESULT — person card */
.cards-wrap { margin: 16px 32px 0; display: flex; flex-direction: column; gap: 12px; }
.person-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); padding: 18px 20px; }
.person-top { display: flex; align-items: center; gap: 14px; }
.avatar { width: 44px; height: 44px; border-radius: 50%; flex-shrink: 0; background: var(--accent); color: var(--accent-fg); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 17px; }
.person-info { flex: 1; min-width: 0; }
.person-name { font-size: 16px; font-weight: 600; }
.person-contact { display: flex; flex-wrap: wrap; gap: 6px 24px; margin-top: 6px; font-size: 12.5px; }
.contact-label { color: var(--text-muted); font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; margin-right: 6px; }
.btn-edit { align-self: flex-start; }
.person-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 16px; }
.person-stat { background: var(--surface2); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
.stat-value-sm { font-size: 15px; }
.more-note { font-size: 12px; color: var(--text-muted); padding: 0 4px; }

/* RANKING */
.rank-title { padding: 14px 20px; font-size: 12.5px; font-weight: 600; color: var(--text-sub); border-bottom: 1px solid var(--border); }
.rank-row { cursor: pointer; }
.rank-badge {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: 50%;
  background: var(--surface2); color: var(--text-sub);
  font-size: 12px; font-weight: 700; font-family: 'DM Mono', monospace;
}
.rank-badge.rank-1 { background: #fbbf24; color: #3b2a00; }
.rank-badge.rank-2 { background: #cbd5e1; color: #1e293b; }
.rank-badge.rank-3 { background: #d6a77a; color: #3a2210; }
thead th.th-key { color: var(--text); }
.cell-key { font-weight: 700; color: var(--green); }

/* PAGINATION */
.pagination { padding: 14px 20px; display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--border); background: var(--surface2); }
.page-info { font-size: 12px; color: var(--text-sub); }
.page-btns { display: flex; align-items: center; gap: 8px; }
.page-now { font-size: 12px; color: var(--text-sub); font-family: 'DM Mono', monospace; }
.page-btn { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); font-size: 14px; cursor: pointer; color: var(--text); transition: background .12s; }
.page-btn:hover:not(:disabled) { background: var(--bg); }
.page-btn:disabled { opacity: .35; cursor: default; }

@media (max-width: 900px) {
  .person-stats { grid-template-columns: repeat(2, 1fr); }
}

@media print {
  :deep(.sidebar) { display: none !important; }
  .toolbar { display: none !important; }
  .page-wrap { display: block !important; background: #fff !important; color: #000 !important; }
  .main { overflow: visible !important; }
  .table-wrap { box-shadow: none !important; margin: 12px 0 !important; }
}
</style>

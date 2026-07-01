<!--
  ╔═══════════════════════════════════════════════════════════════════╗
  ║  PayLaterView.vue — All Pay Later customer accounts in one place  ║
  ║  Data: "pay_later_balances" view (bills − payments = owed)        ║
  ║  Click a row to expand: every bill (with items) + payment history ║
  ║  Same Slidebar + light/dark theme + card/table look as             ║
  ║  TodayBusinessView.vue                                             ║
  ╚═══════════════════════════════════════════════════════════════════╝
-->

<script setup lang="ts">
// ──────────────────────────────────────────────
// 1. IMPORTS
// ──────────────────────────────────────────────
import { ref, computed, onMounted } from 'vue'
import Slidebar from '../components/Slidebar.vue'
import Toast from '../components/Toast.vue'
import { supabase } from '../lib/supabase'


// ──────────────────────────────────────────────
// 2. TYPES
// ──────────────────────────────────────────────
// One row from the pay_later_balances view — bills minus payments, already done in SQL
interface CustomerBalance {
  id: string
  name: string
  id_number: string | null
  phone: string | null
  address: string | null
  created_at: string
  updated_at: string
  total_billed: number
  total_paid: number
  total_owed: number
  last_bill_at: string | null
  last_payment_at: string | null
}

// One Later Pay sale belonging to a customer
interface CustomerBill {
  id: string
  invoice_no: string
  total: number
  created_at: string
  customer_id: string
}

// One line item belonging to a bill (for the expanded "what did they buy" view)
interface BillItem {
  id: string
  transaction_id: string
  product_name: string
  sku: string | null
  qty: number
  unit_price: number
  discount_label: string | null
  line_total: number
  products: { image_url: string | null } | null
}

// One payment a customer made toward their balance
interface Payment {
  id: string
  customer_id: string
  amount: number
  paid_at: string
  note: string | null
}


// ──────────────────────────────────────────────
// 3. THEME
// ──────────────────────────────────────────────
const isLight = ref(localStorage.getItem('theme') === 'light')


// ──────────────────────────────────────────────
// 4. DATA from Supabase
// ──────────────────────────────────────────────
const customers = ref<CustomerBalance[]>([])
const bills      = ref<CustomerBill[]>([])
const billItems  = ref<BillItem[]>([])
const payments   = ref<Payment[]>([])
const loading    = ref(false)
const fetchError = ref('')

async function fetchAll() {
  loading.value    = true
  fetchError.value = ''
  try {
    // 1. Every customer's running balance (computed in the view itself)
    const { data: balData, error: balError } = await supabase
      .from('pay_later_balances')
      .select('*')
    if (balError) { fetchError.value = balError.message; return }
    customers.value = balData ?? []

    // 2. Every Later Pay bill, so we can show "what did they buy and when"
    const { data: billData, error: billError } = await supabase
      .from('transactions')
      .select('id, invoice_no, total, created_at, customer_id')
      .eq('payment_method', 'later_pay')
      .eq('status', 'completed')
      .not('customer_id', 'is', null)
      .order('created_at', { ascending: false })
    if (billError) { fetchError.value = billError.message; return }
    bills.value = billData ?? []

    // 3. Items inside those bills (joined with product image)
    const billIds = bills.value.map(b => b.id)
    if (billIds.length > 0) {
      const { data: itemData, error: itemError } = await supabase
        .from('transaction_items')
        .select('id, transaction_id, product_name, sku, qty, unit_price, discount_label, line_total, products(image_url)')
        .in('transaction_id', billIds)
      if (itemError) { fetchError.value = itemError.message; return }
      billItems.value = (itemData ?? []) as unknown as BillItem[]
    } else {
      billItems.value = []
    }

    // 4. Every payment ever made, for the expanded payment-history list
    const { data: payData, error: payError } = await supabase
      .from('pay_later_payments')
      .select('*')
      .order('paid_at', { ascending: false })
    if (payError) { fetchError.value = payError.message; return }
    payments.value = payData ?? []
  } catch {
    fetchError.value = 'Could not load Pay Later data.'
  } finally {
    loading.value = false
  }
}


// ──────────────────────────────────────────────
// 5. GROUPING — bills/items/payments per customer (for the expand panel)
// ──────────────────────────────────────────────
const billsByCustomer = computed(() => {
  const map = new Map<string, CustomerBill[]>()
  for (const b of bills.value) {
    const list = map.get(b.customer_id) ?? []
    list.push(b)
    map.set(b.customer_id, list)
  }
  return map
})

const itemsByBill = computed(() => {
  const map = new Map<string, BillItem[]>()
  for (const i of billItems.value) {
    const list = map.get(i.transaction_id) ?? []
    list.push(i)
    map.set(i.transaction_id, list)
  }
  return map
})

const paymentsByCustomer = computed(() => {
  const map = new Map<string, Payment[]>()
  for (const p of payments.value) {
    const list = map.get(p.customer_id) ?? []
    list.push(p)
    map.set(p.customer_id, list)
  }
  return map
})


// ──────────────────────────────────────────────
// 6. STAT CARDS
// ──────────────────────────────────────────────
const totalOwed       = computed(() => customers.value.reduce((s, c) => s + c.total_owed, 0))
const totalCollected  = computed(() => customers.value.reduce((s, c) => s + c.total_paid, 0))
const pendingAccounts = computed(() => customers.value.filter(c => c.total_owed > 0).length)
const paidAccounts    = computed(() => customers.value.filter(c => c.total_billed > 0 && c.total_owed <= 0).length)


// ──────────────────────────────────────────────
// 7. TABS / SEARCH / SORT
// ──────────────────────────────────────────────
type Tab = 'pending' | 'paid'
const activeTab = ref<Tab>('pending')

const searchQuery = ref('')
type SortMode = 'latest' | 'az'
const sortMode = ref<SortMode>('latest')

// Newest activity = whichever is more recent between last bill and last payment
function lastActivity(c: CustomerBalance): string | null {
  if (c.last_bill_at && c.last_payment_at) {
    return c.last_bill_at > c.last_payment_at ? c.last_bill_at : c.last_payment_at
  }
  return c.last_bill_at ?? c.last_payment_at
}

const filteredCustomers = computed(() => {
  let list = customers.value.filter(c => {
    if (activeTab.value === 'pending') return c.total_owed > 0 || c.total_billed === 0
    return c.total_billed > 0 && c.total_owed <= 0
  })

  const q = searchQuery.value.toLowerCase()
  if (q) list = list.filter(c => c.name.toLowerCase().includes(q))

  if (sortMode.value === 'az') {
    list = [...list].sort((a, b) => a.name.localeCompare(b.name))
  } else {
    list = [...list].sort((a, b) => {
      const da = lastActivity(a)
      const db = lastActivity(b)
      if (!da && !db) return 0
      if (!da) return 1
      if (!db) return -1
      return new Date(db).getTime() - new Date(da).getTime()
    })
  }
  return list
})


// ──────────────────────────────────────────────
// 8. ROW EXPAND/COLLAPSE
// ──────────────────────────────────────────────
const expandedIds = ref(new Set<string>())
function toggleExpand(id: string) {
  const next = new Set(expandedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedIds.value = next
}

function discountLabelClass(label: string | null): string {
  if (!label) return ''
  const l = label.toLowerCase()
  if (l === 'super') return 'label-super'
  if (l === 'original') return 'label-original'
  return 'label-discount'
}


// ──────────────────────────────────────────────
// 9. PAY MODAL
// ──────────────────────────────────────────────
const showPayModal   = ref(false)
const payCustomer    = ref<CustomerBalance | null>(null)
const payAmount      = ref('')
const payNote        = ref('')
const payError       = ref('')
const paySaving      = ref(false)

function openPayModal(c: CustomerBalance) {
  payCustomer.value  = c
  payAmount.value    = ''        // always blank so user must type the actual amount
  payNote.value      = ''
  payError.value     = ''
  showPayModal.value = true
}

// Quick-fill button — sets the amount to the full outstanding balance
function payFull() {
  if (payCustomer.value) payAmount.value = String(payCustomer.value.total_owed)
}

function closePayModal() {
  showPayModal.value = false
  payCustomer.value  = null
}

async function submitPayment() {
  if (!payCustomer.value) return
  const amount = parseFloat(payAmount.value)

  if (!amount || amount <= 0) { payError.value = 'Enter a valid amount'; return }
  if (amount > payCustomer.value.total_owed) { payError.value = `Cannot exceed balance of ${fmtRs(payCustomer.value.total_owed)}`; return }

  paySaving.value = true
  payError.value  = ''

  const { error } = await supabase.from('pay_later_payments').insert({
    customer_id: payCustomer.value.id,
    amount,
    note: payNote.value || null,
  })

  paySaving.value = false

  if (error) { payError.value = error.message; return }

  const wasFullyPaid = amount >= payCustomer.value.total_owed
  const name = payCustomer.value.name
  closePayModal()
  await fetchAll()
  showToastMsg(wasFullyPaid ? `${name} fully paid off ✓` : `Payment of ${fmtRs(amount)} recorded for ${name}`)
}


// ──────────────────────────────────────────────
// 10. ADD NEW CUSTOMER MODAL
// ──────────────────────────────────────────────
const showAddModal = ref(false)
const newName       = ref('')
const newIdNum       = ref('')
const newPhone       = ref('')
const newAddress     = ref('')
const newShowErr      = ref(false)
const newSaving       = ref(false)
const newError        = ref('')

function openAddModal() {
  newName.value = ''; newIdNum.value = ''; newPhone.value = ''; newAddress.value = ''
  newShowErr.value = false; newError.value = ''
  showAddModal.value = true
}

async function submitNewCustomer() {
  if (!newName.value.trim()) { newShowErr.value = true; return }
  newSaving.value = true
  newError.value  = ''

  const { error } = await supabase.from('pay_later_customers').insert({
    name:      newName.value.trim(),
    id_number: newIdNum.value || null,
    phone:     newPhone.value || null,
    address:   newAddress.value || null,
  })

  newSaving.value = false

  if (error) { newError.value = error.message; return }

  showAddModal.value = false
  await fetchAll()
  showToastMsg(`${newName.value.trim()} registered`)
}


// ──────────────────────────────────────────────
// 11. HELPERS
// ──────────────────────────────────────────────
function fmtRs(n: number): string {
  return `Rs. ${n.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
}


// ──────────────────────────────────────────────
// 12. EXPORT CSV
// ──────────────────────────────────────────────
function exportCSV() {
  const headers = ['Name', 'Phone', 'ID Number', 'Total Billed', 'Total Paid', 'Total Owed', 'Last Bill', 'Last Payment', 'Status']
  const rows = filteredCustomers.value.map(c => [
    c.name,
    c.phone || '—',
    c.id_number || '—',
    c.total_billed.toFixed(2),
    c.total_paid.toFixed(2),
    c.total_owed.toFixed(2),
    fmtDate(c.last_bill_at),
    fmtDate(c.last_payment_at),
    c.total_owed > 0 ? 'Pending' : 'Paid',
  ])
  const csv = [headers, ...rows]
    .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const a = Object.assign(document.createElement('a'), {
    href: 'data:text/csv,' + encodeURIComponent(csv),
    download: `pay-later-${new Date().toISOString().slice(0, 10)}.csv`,
  })
  a.click()
  showToastMsg('CSV exported')
}

function exportPDF() {
  window.print()
}


// ──────────────────────────────────────────────
// 13. TOAST
// ──────────────────────────────────────────────
const toastMsg     = ref('')
const toastVisible = ref(false)
function showToastMsg(msg: string) {
  toastMsg.value     = msg
  toastVisible.value = true
  setTimeout(() => { toastVisible.value = false }, 2600)
}


// ──────────────────────────────────────────────
// 14. INIT
// ──────────────────────────────────────────────
onMounted(fetchAll)
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
        <h1 class="page-title">Pay Later</h1>
        <p class="page-sub">All credit accounts · who owes what, and what they bought</p>
      </div>

      <!-- ── STATS BAR ── -->
      <div class="stats-bar">
        <div class="stat-card">
          <div class="stat-label">Total Owed</div>
          <div class="stat-value low">{{ fmtRs(totalOwed) }}</div>
          <div class="stat-sub">across all customers</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Collected</div>
          <div class="stat-value profit">{{ fmtRs(totalCollected) }}</div>
          <div class="stat-sub">payments received so far</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Pending Accounts</div>
          <div class="stat-value">{{ pendingAccounts }}</div>
          <div class="stat-sub">still owe money</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Paid Accounts</div>
          <div class="stat-value">{{ paidAccounts }}</div>
          <div class="stat-sub">fully settled</div>
        </div>
      </div>

      <!-- ── TABS ── -->
      <div class="tabs">
        <button class="tab" :class="{ active: activeTab === 'pending' }" @click="activeTab = 'pending'">
          Pending <span class="tab-count">{{ pendingAccounts }}</span>
        </button>
        <button class="tab" :class="{ active: activeTab === 'paid' }" @click="activeTab = 'paid'">
          Paid <span class="tab-count">{{ paidAccounts }}</span>
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
          <button class="btn btn-outline" @click="fetchAll" title="Refresh data">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.08-6.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Refresh
          </button>
          <button class="btn btn-outline" @click="exportCSV">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
            Export CSV
          </button>
          <button class="btn btn-outline" @click="exportPDF">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z"/></svg>
            Export PDF
          </button>
          <button class="btn btn-primary" @click="openAddModal">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
            New Customer
          </button>
        </div>
      </div>

      <!-- ── TABLE ── -->
      <div class="table-wrap">
        <div v-if="loading" class="state-msg">Loading Pay Later accounts…</div>
        <div v-else-if="fetchError" class="state-error">{{ fetchError }}</div>

        <template v-else>
          <table>
            <thead>
              <tr>
                <th style="width:30px"></th>
                <th>#</th>
                <th>Customer</th>
                <th>Phone</th>
                <th style="text-align:right">Total Billed</th>
                <th style="text-align:right">Total Paid</th>
                <th style="text-align:right">Balance</th>
                <th>Last Activity</th>
                <th style="text-align:right; padding-right:20px;">Action</th>
              </tr>
            </thead>

            <tbody>
              <tr v-if="filteredCustomers.length === 0">
                <td colspan="9" class="empty-row">
                  {{ activeTab === 'pending' ? 'No pending accounts — everyone is paid up!' : 'No paid accounts yet.' }}
                </td>
              </tr>

              <template v-for="(c, index) in filteredCustomers" :key="c.id">
                <tr class="txn-row" :style="{ animationDelay: (index * 0.03) + 's' }" @click="toggleExpand(c.id)">
                  <td class="expand-cell">
                    <svg class="expand-arrow" :class="{ open: expandedIds.has(c.id) }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                  </td>
                  <td>{{ index + 1 }}</td>
                  <td class="name-cell">
                    {{ c.name }}
                    <div class="cust-id">{{ c.id_number || '' }}</div>
                  </td>
                  <td class="date-cell">{{ c.phone || '—' }}</td>
                  <td class="price-cell" style="text-align:right">{{ fmtRs(c.total_billed) }}</td>
                  <td class="price-cell" style="text-align:right; color:var(--green)">{{ fmtRs(c.total_paid) }}</td>
                  <td class="price-cell" style="text-align:right; font-weight:700" :style="{ color: c.total_owed > 0 ? 'var(--red)' : 'var(--text-muted)' }">
                    {{ fmtRs(c.total_owed) }}
                  </td>
                  <td class="date-cell">{{ fmtDate(lastActivity(c)) }}</td>
                  <td style="text-align:right; padding-right:20px;" @click.stop>
                    <button
                      v-if="c.total_owed > 0"
                      class="btn-pay"
                      @click="openPayModal(c)"
                    >Pay</button>
                    <span v-else class="paid-tag">✓ Paid</span>
                  </td>
                </tr>

                <!-- ── EXPANDED PANEL: bills + payment history ── -->
                <tr v-if="expandedIds.has(c.id)" class="expand-panel-row">
                  <td colspan="9">
                    <div class="expand-panel">

                      <!-- Contact details -->
                      <div class="expand-section">
                        <div class="expand-section-title">Contact</div>
                        <div class="contact-grid">
                          <div><span class="contact-label">Phone</span> {{ c.phone || '—' }}</div>
                          <div><span class="contact-label">ID Number</span> {{ c.id_number || '—' }}</div>
                          <div><span class="contact-label">Address</span> {{ c.address || '—' }}</div>
                        </div>
                      </div>

                      <!-- Bills (what they bought) -->
                      <div class="expand-section">
                        <div class="expand-section-title">Bills ({{ (billsByCustomer.get(c.id) ?? []).length }})</div>
                        <div v-if="(billsByCustomer.get(c.id) ?? []).length === 0" class="expand-empty">No bills yet</div>
                        <div v-for="bill in (billsByCustomer.get(c.id) ?? [])" :key="bill.id" class="bill-card">
                          <div class="bill-head">
                            <span class="bill-invoice">{{ bill.invoice_no }}</span>
                            <span class="bill-date">{{ fmtDate(bill.created_at) }}</span>
                            <span class="bill-total">{{ fmtRs(bill.total) }}</span>
                          </div>
                          <div
                            v-for="item in (itemsByBill.get(bill.id) ?? [])"
                            :key="item.id"
                            class="expand-item"
                          >
                            <img v-if="item.products?.image_url" :src="item.products.image_url" class="expand-item-img" />
                            <div v-else class="expand-item-img expand-item-img-placeholder">
                              <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" width="14" height="14"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9l4-4 4 4 4-4 4 4"/><path d="M3 15l4 4 4-4 4 4 4-4"/></svg>
                            </div>
                            <div class="expand-item-info">
                              <div class="expand-item-name">{{ item.product_name }}</div>
                              <div class="expand-item-sku">{{ item.sku || '—' }}</div>
                            </div>
                            <span class="discount-badge" :class="discountLabelClass(item.discount_label)">{{ item.discount_label || '—' }}</span>
                            <div class="expand-item-qty">x{{ item.qty }}</div>
                            <div class="expand-item-total">{{ fmtRs(item.line_total) }}</div>
                          </div>
                        </div>
                      </div>

                      <!-- Payment history -->
                      <div class="expand-section">
                        <div class="expand-section-title">Payment History ({{ (paymentsByCustomer.get(c.id) ?? []).length }})</div>
                        <div v-if="(paymentsByCustomer.get(c.id) ?? []).length === 0" class="expand-empty">No payments recorded yet</div>
                        <div v-for="p in (paymentsByCustomer.get(c.id) ?? [])" :key="p.id" class="payment-row">
                          <span class="payment-date">{{ fmtDate(p.paid_at) }}</span>
                          <span class="payment-amount">{{ fmtRs(p.amount) }}</span>
                          <span v-if="p.note" class="payment-note">{{ p.note }}</span>
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

    <!-- ══════════════════════════════════════ -->
    <!--    PAY MODAL                          -->
    <!-- ══════════════════════════════════════ -->
    <Transition name="fade">
      <div v-if="showPayModal" class="modal-overlay" :class="{ light: isLight }" @click.self="closePayModal">
        <div class="modal-box">
          <div class="modal-header">
            <div>
              <div class="modal-title">Record Payment</div>
              <div class="modal-sub">{{ payCustomer?.name }} · owes {{ fmtRs(payCustomer?.total_owed ?? 0) }}</div>
            </div>
            <button class="modal-close" @click="closePayModal">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <div class="modal-body">
            <div class="form-field">
              <div class="pay-amount-label-row">
                <label class="form-label">Amount Paid Now <span class="req">*</span></label>
                <button class="btn-pay-full" type="button" @click="payFull">Pay Full · {{ fmtRs(payCustomer?.total_owed ?? 0) }}</button>
              </div>
              <div class="input-prefix-wrap">
                <span class="input-prefix">Rs.</span>
                <input v-model="payAmount" type="number" class="form-input has-prefix" placeholder="Enter amount…" autofocus />
              </div>
              <span class="form-hint-text">Outstanding balance: {{ fmtRs(payCustomer?.total_owed ?? 0) }}</span>
            </div>
            <div class="form-field">
              <label class="form-label">Note (optional)</label>
              <input v-model="payNote" class="form-input" placeholder="e.g. Paid in cash at shop" />
            </div>
            <div v-if="payError" class="save-error">{{ payError }}</div>
          </div>

          <div class="modal-footer">
            <button class="modal-cancel" :disabled="paySaving" @click="closePayModal">Cancel</button>
            <button class="modal-save" :disabled="paySaving" @click="submitPayment">
              {{ paySaving ? 'Saving…' : 'Confirm Payment' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ══════════════════════════════════════ -->
    <!--    ADD NEW CUSTOMER MODAL             -->
    <!-- ══════════════════════════════════════ -->
    <Transition name="fade">
      <div v-if="showAddModal" class="modal-overlay" :class="{ light: isLight }" @click.self="showAddModal = false">
        <div class="modal-box">
          <div class="modal-header">
            <div>
              <div class="modal-title">Register Pay Later Customer</div>
              <div class="modal-sub">Add a new credit account</div>
            </div>
            <button class="modal-close" @click="showAddModal = false">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <div class="modal-body">
            <div class="form-field">
              <label class="form-label">Full Name <span class="req">*</span></label>
              <input v-model="newName" class="form-input" :class="{ error: newShowErr && !newName.trim() }" placeholder="e.g. Shashika Nuwan" />
              <span v-if="newShowErr && !newName.trim()" class="form-error">Name is required</span>
            </div>
            <div class="form-field">
              <label class="form-label">ID Number</label>
              <input v-model="newIdNum" class="form-input" placeholder="National ID / Passport" />
            </div>
            <div class="form-field">
              <label class="form-label">Phone Number</label>
              <input v-model="newPhone" class="form-input" type="tel" placeholder="e.g. 077 123 4567" />
            </div>
            <div class="form-field">
              <label class="form-label">Address</label>
              <textarea v-model="newAddress" class="form-input textarea" rows="3" placeholder="Street, City…" />
            </div>
            <div v-if="newError" class="save-error">{{ newError }}</div>
          </div>

          <div class="modal-footer">
            <button class="modal-cancel" :disabled="newSaving" @click="showAddModal = false">Cancel</button>
            <button class="modal-save" :disabled="newSaving" @click="submitNewCustomer">
              {{ newSaving ? 'Saving…' : 'Add Customer' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ── TOAST ── -->
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
.stat-value.low { color: var(--red); }
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
.toolbar { padding: 0 32px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; background: var(--surface); border: 1px solid var(--border); border-radius: 0 var(--radius) var(--radius) var(--radius); margin: 0 32px; padding: 14px 20px; }
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
.btn-primary { background: var(--accent); color: var(--accent-fg); }
.btn-primary:hover { opacity: .85; }
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

.btn-pay {
  padding: 6px 16px; border-radius: 7px; border: none;
  background: var(--green); color: #fff; font-size: 12px; font-weight: 600;
  font-family: 'DM Sans', sans-serif; cursor: pointer; transition: opacity .15s;
}
.btn-pay:hover { opacity: .85; }
.paid-tag { font-size: 12px; color: var(--green); font-weight: 600; }

/* ── Expandable row ── */
.txn-row { cursor: pointer; }
.expand-cell { padding-left: 16px !important; width: 30px; }
.expand-arrow { transition: transform .15s; color: var(--text-muted); }
.expand-arrow.open { transform: rotate(90deg); color: var(--text); }

.expand-panel-row td { padding: 0 !important; border-bottom: 1px solid var(--border); }
.expand-panel { background: var(--surface2); padding: 16px 20px 16px 50px; display: flex; flex-direction: column; gap: 18px; animation: rowIn .2s ease both; }

.expand-section-title { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--text-sub); margin-bottom: 8px; }
.expand-empty { font-size: 12px; color: var(--text-muted); padding: 2px 0; }

.contact-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; font-size: 12.5px; color: var(--text); }
.contact-label { color: var(--text-muted); font-size: 10.5px; display: block; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 2px; }

.bill-card { background: var(--surface); border: 1px solid var(--border); border-radius: 9px; padding: 10px 12px; margin-bottom: 8px; }
.bill-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
.bill-invoice { font-family: 'DM Mono', monospace; font-size: 11.5px; font-weight: 600; color: var(--text); }
.bill-date { font-size: 11px; color: var(--text-muted); }
.bill-total { margin-left: auto; font-size: 12.5px; font-weight: 700; color: var(--text); font-family: 'DM Mono', monospace; }

.expand-item { display: flex; align-items: center; gap: 10px; padding: 5px 0; }
.expand-item-img { width: 32px; height: 32px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border); flex-shrink: 0; }
.expand-item-img-placeholder { display: flex; align-items: center; justify-content: center; color: var(--text-muted); background: var(--surface2); }
.expand-item-info { flex: 1; min-width: 0; }
.expand-item-name { font-size: 12px; font-weight: 500; color: var(--text); }
.expand-item-sku  { font-size: 10px; color: var(--text-muted); }
.expand-item-qty   { font-size: 11.5px; color: var(--text-sub); font-family: 'DM Mono', monospace; width: 30px; text-align: right; }
.expand-item-total { font-size: 12px; font-weight: 600; color: var(--text); font-family: 'DM Mono', monospace; width: 90px; text-align: right; }

.discount-badge {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 2px 8px; border-radius: 5px; font-size: 9px; font-weight: 600;
  letter-spacing: .03em; text-transform: uppercase; width: 68px; flex-shrink: 0;
  background: var(--surface); border: 1px solid var(--border); color: var(--text-sub);
}
.discount-badge.label-discount { border-color: var(--green); background: var(--green-bg); color: var(--green); }
.discount-badge.label-super    { border-color: #8b5cf6; background: rgba(139,92,246,0.12); color: #8b5cf6; }
.discount-badge.label-original { border-color: var(--border); background: var(--surface); color: var(--text-sub); }

.payment-row { display: flex; align-items: center; gap: 12px; padding: 6px 0; font-size: 12.5px; }
.payment-date   { color: var(--text-sub); width: 100px; flex-shrink: 0; }
.payment-amount { font-weight: 700; color: var(--green); font-family: 'DM Mono', monospace; width: 100px; }
.payment-note   { color: var(--text-muted); font-size: 11.5px; }


/* ══════════════════════════════════
   MODALS (Pay + Add Customer)
   ══════════════════════════════════ */
.modal-overlay {
  --bg-panel:    #181817;
  --bg-card:     #1f1f1e;
  --bg-hover:    #252524;
  --bg-input:    #161615;
  --border-mid:  rgba(255,255,255,0.13);
  --border-focus:rgba(255,255,255,0.3);
  --accent-bg:   #f5f2ee;
  --accent-text: #111110;
  --danger:      #ef4444;

  position: fixed; inset: 0; background: rgba(0,0,0,0.65); backdrop-filter: blur(7px);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
}
.modal-overlay.light {
  --bg-panel:    #ffffff;
  --bg-card:     #fafaf8;
  --bg-hover:    #f0ede9;
  --bg-input:    #ffffff;
  --border-mid:  rgba(0,0,0,0.13);
  --border-focus:rgba(0,0,0,0.4);
  --accent-bg:   #141412;
  --accent-text: #f7f5f2;
  --danger:      #dc2626;
}

.modal-box { width: 460px; max-width: calc(100vw - 40px); max-height: 88vh; background: var(--bg-panel); border: 1px solid var(--border-mid); border-radius: 20px; box-shadow: var(--shadow-lg); display: flex; flex-direction: column; overflow: hidden; }
.modal-header { display: flex; align-items: center; justify-content: space-between; padding: 22px 24px 18px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.modal-title { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 18px; letter-spacing: -0.4px; color: var(--text); }
.modal-sub { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
.modal-close { width: 34px; height: 34px; border-radius: 9px; background: var(--bg-card); border: 1px solid var(--border); cursor: pointer; display: flex; align-items: center; justify-content: center; color: var(--text-sub); transition: background 0.15s, color 0.15s; }
.modal-close:hover { background: var(--bg-hover); color: var(--text); }

.modal-body { flex: 1; overflow-y: auto; padding: 22px 24px; min-height: 0; display: flex; flex-direction: column; gap: 16px; }
.form-field { display: flex; flex-direction: column; gap: 6px; }
.form-label { font-size: 11px; font-weight: 600; color: var(--text-sub); letter-spacing: 0.06em; text-transform: uppercase; }
.form-hint-text { font-size: 10.5px; color: var(--text-muted); }
.req { color: var(--danger); }

.form-input { width: 100%; padding: 10px 13px; background: var(--bg-input); border: 1px solid var(--border-mid); border-radius: 9px; color: var(--text); font-size: 13.5px; font-family: 'DM Sans', sans-serif; outline: none; transition: border-color 0.15s; }
.form-input::placeholder { color: var(--text-muted); opacity: 0.6; }
.form-input:focus { border-color: var(--border-focus); }
.form-input.error { border-color: var(--danger); }
.form-input.textarea { resize: vertical; min-height: 70px; }
.form-error { font-size: 11px; color: var(--danger); }

.input-prefix-wrap { position: relative; display: flex; align-items: center; }
.input-prefix { position: absolute; left: 11px; font-size: 11px; color: var(--text-muted); pointer-events: none; z-index: 1; }
.has-prefix { padding-left: 30px; }

.pay-amount-label-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px; }

.btn-pay-full {
  padding: 4px 10px; border-radius: 6px; border: none;
  background: var(--green-bg); color: var(--green);
  font-size: 11px; font-weight: 600; font-family: 'DM Sans', sans-serif;
  cursor: pointer; transition: opacity .15s;
}
.btn-pay-full:hover { opacity: .8; }

.save-error { padding: 10px 14px; border-radius: 8px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: var(--danger); font-size: 12.5px; }

.modal-footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 14px 24px 18px; border-top: 1px solid var(--border); flex-shrink: 0; }
.modal-cancel { padding: 10px 20px; border-radius: 9px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text-sub); font-size: 13px; font-family: 'DM Sans', sans-serif; cursor: pointer; transition: background 0.15s; }
.modal-cancel:hover { background: var(--bg-hover); color: var(--text); }
.modal-save { padding: 10px 24px; border-radius: 9px; border: none; background: var(--accent-bg); color: var(--accent-text); font-size: 13px; font-weight: 600; font-family: 'DM Sans', sans-serif; cursor: pointer; min-width: 120px; transition: opacity 0.15s; }
.modal-save:hover { opacity: 0.85; }
.modal-save:disabled { opacity: 0.5; cursor: not-allowed; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }


/* ══════════════════════════════════
   PRINT MODE
   ══════════════════════════════════ */
@media print {
  :deep(.sidebar) { display: none !important; }
  .tabs, .toolbar { display: none !important; }
  .page-wrap { display: block !important; background: #fff !important; color: #000 !important; }
  .main { overflow: visible !important; }
  .table-wrap { box-shadow: none !important; margin: 12px 0 !important; }
  .expand-panel-row { display: none !important; }
}
</style>

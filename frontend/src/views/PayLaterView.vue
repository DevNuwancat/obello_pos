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
import { markConnected, markError } from '../lib/connectionStatus'
import { useAuthStore } from '../store/auth'
import PayLaterCustomerBookModal from '../components/modals/PayLaterCustomerBookModal.vue'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'


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
  total_loaned: number          // money the shop lent this customer (Credit Loan)
  last_loan_at: string | null
}

// One Credit Loan (cash lent to a customer)
interface Loan {
  id: string
  customer_id: string
  amount: number
  note: string | null
  given_at: string
  users: { full_name: string | null } | null
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

// One correction made to a payment — kept forever as proof of what changed, why, and by whom
interface PaymentEdit {
  id: string
  payment_id: string
  old_amount: number
  new_amount: number
  reason: string
  edited_at: string
  edited_by: string | null
  users: { full_name: string | null } | null
}


// ──────────────────────────────────────────────
// 3. THEME
// ──────────────────────────────────────────────
const isLight = ref(localStorage.getItem('theme') === 'light')
const auth = useAuthStore()   // who's logged in right now — used to stamp "who corrected this payment"


// ──────────────────────────────────────────────
// 4. DATA from Supabase
// ──────────────────────────────────────────────
const customers = ref<CustomerBalance[]>([])
const bills      = ref<CustomerBill[]>([])
const loans      = ref<Loan[]>([])
const billItems  = ref<BillItem[]>([])
const payments   = ref<Payment[]>([])
const paymentEdits = ref<PaymentEdit[]>([])
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
    if (balError) { fetchError.value = balError.message; markError(); return }
    customers.value = balData ?? []

    // 2. Every Later Pay bill, so we can show "what did they buy and when"
    const { data: billData, error: billError } = await supabase
      .from('transactions')
      .select('id, invoice_no, total, created_at, customer_id')
      .eq('payment_method', 'later_pay')
      .eq('status', 'completed')
      .not('customer_id', 'is', null)
      .order('created_at', { ascending: false })
    if (billError) { fetchError.value = billError.message; markError(); return }
    bills.value = billData ?? []

    // 2b. Every Credit Loan (money lent), newest first
    const { data: loanData, error: loanError } = await supabase
      .from('pay_later_loans')
      .select('*, users(full_name)')
      .order('given_at', { ascending: false })
    if (loanError) { fetchError.value = loanError.message; markError(); return }
    loans.value = (loanData ?? []) as unknown as Loan[]

    // 3. Items inside those bills (joined with product image)
    const billIds = bills.value.map(b => b.id)
    if (billIds.length > 0) {
      const { data: itemData, error: itemError } = await supabase
        .from('transaction_items')
        .select('id, transaction_id, product_name, sku, qty, unit_price, discount_label, line_total, products(image_url)')
        .in('transaction_id', billIds)
      if (itemError) { fetchError.value = itemError.message; markError(); return }
      billItems.value = (itemData ?? []) as unknown as BillItem[]
    } else {
      billItems.value = []
    }

    // 4. Every payment ever made, for the expanded payment-history list
    const { data: payData, error: payError } = await supabase
      .from('pay_later_payments')
      .select('*')
      .order('paid_at', { ascending: false })
    if (payError) { fetchError.value = payError.message; markError(); return }
    payments.value = payData ?? []

    // 5. Every past correction made to a payment (old amount → new amount + why + who)
    const { data: editData, error: editError } = await supabase
      .from('pay_later_payment_edits')
      .select('*, users(full_name)')
      .order('edited_at', { ascending: true })
    if (editError) { fetchError.value = editError.message; markError(); return }
    paymentEdits.value = (editData ?? []) as unknown as PaymentEdit[]

    markConnected()
  } catch {
    fetchError.value = 'Could not load Pay Later data.'
    markError()
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

const loansByCustomer = computed(() => {
  const map = new Map<string, Loan[]>()
  for (const l of loans.value) {
    const list = map.get(l.customer_id) ?? []
    list.push(l)
    map.set(l.customer_id, list)
  }
  return map
})

// ── OLDEST-FIRST REPAYMENT ──
// A customer has ONE balance (bills + loans − payments). To show which entries are
// settled, line up every bill and loan by date (oldest first) and pour the money
// they have paid over them, one by one. Worked out here from total_paid, so edits or
// removed payments update it automatically — nothing extra is saved.
type AllocStatus = 'paid' | 'partial' | 'unpaid'
interface Alloc { paid: number; left: number; status: AllocStatus }

const allocations = computed(() => {
  const result = new Map<string, Alloc>()   // key = bill id or loan id
  for (const c of customers.value) {
    const entries = [
      ...(billsByCustomer.value.get(c.id) ?? []).map(b => ({ id: b.id, date: b.created_at, amount: Number(b.total) })),
      ...(loansByCustomer.value.get(c.id) ?? []).map(l => ({ id: l.id, date: l.given_at, amount: Number(l.amount) })),
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

    let pool = Number(c.total_paid)
    for (const e of entries) {
      const paid = Math.min(pool, e.amount)
      pool -= paid
      const left = Math.round((e.amount - paid) * 100) / 100
      result.set(e.id, { paid, left, status: left <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid' })
    }
  }
  return result
})

function allocLabel(id: string): string {
  const a = allocations.value.get(id)
  if (!a) return ''
  if (a.status === 'paid') return '✓ Paid'
  if (a.status === 'partial') return `Partly paid · ${fmtRs(a.left)} left`
  return 'Unpaid'
}
function allocClass(id: string): string {
  return 'alloc-' + (allocations.value.get(id)?.status ?? 'unpaid')
}

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

// Which corrections belong to which payment — so we can print them under that row
const editsByPayment = computed(() => {
  const map = new Map<string, PaymentEdit[]>()
  for (const e of paymentEdits.value) {
    const list = map.get(e.payment_id) ?? []
    list.push(e)
    map.set(e.payment_id, list)
  }
  return map
})


// ──────────────────────────────────────────────
// 6. STAT CARDS
// ──────────────────────────────────────────────
const totalOwed       = computed(() => customers.value.reduce((s, c) => s + c.total_owed, 0))
const totalCollected  = computed(() => customers.value.reduce((s, c) => s + c.total_paid, 0))
const pendingAccounts = computed(() => customers.value.filter(c => c.total_owed > 0).length)
const totalLoaned     = computed(() => customers.value.reduce((s, c) => s + Number(c.total_loaned), 0))
// A customer has "history" once they bought on credit OR were lent money
const hasCredit = (c: CustomerBalance) => Number(c.total_billed) + Number(c.total_loaned) > 0
const paidAccounts    = computed(() => customers.value.filter(c => hasCredit(c) && c.total_owed <= 0).length)


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
  const dates = [c.last_bill_at, c.last_payment_at, c.last_loan_at].filter((d): d is string => !!d)
  return dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null
}

const filteredCustomers = computed(() => {
  let list = customers.value.filter(c => {
    // Contacts with total_billed === 0 have never actually bought anything on
    // credit — they're just registered contacts (from "+ New Customer" here or
    // in the Cart's Pay Later checkout). They stay in pay_later_customers and
    // are still selectable in the Cart's contact list, but this ledger table
    // only shows people who have real bill/payment activity.
    if (activeTab.value === 'pending') return c.total_owed > 0
    return hasCredit(c) && c.total_owed <= 0
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
const payMethod      = ref<'cash' | 'card' | 'bank'>('cash')   // how the money actually came in — Cash is the common case, so it's the default
const payError       = ref('')
const paySaving      = ref(false)

function openPayModal(c: CustomerBalance) {
  payCustomer.value  = c
  payAmount.value    = ''        // always blank so user must type the actual amount
  payNote.value      = ''
  payMethod.value    = 'cash'    // reset to the default every time the modal opens
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
    payment_method: payMethod.value,
    received_by: auth.user?.id ?? null,
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
// 9b. EDIT PAYMENT MODAL — fix a mistaken amount, must say why
// ──────────────────────────────────────────────
const showEditPayModal = ref(false)
const editingPayment    = ref<Payment | null>(null)
const editAmount        = ref('')
const editReason        = ref('')
const editError         = ref('')
const editSaving        = ref(false)
const removeMode        = ref(false)   // true = the modal is asking "remove this whole payment?" instead of "correct the amount"

// A removed payment is one that was corrected down to Rs. 0 — it stays in the
// history (nothing is erased), but no longer counts toward what the customer paid.
function isRemoved(p: Payment): boolean {
  return p.amount === 0 && (editsByPayment.value.get(p.id) ?? []).some(e => e.new_amount === 0)
}
// Who removed it (the person logged in when they pressed Remove)
function removedBy(p: Payment): string {
  const removal = (editsByPayment.value.get(p.id) ?? []).find(e => e.new_amount === 0)
  return removal?.users?.full_name || 'Unknown user'
}
// What the removed payment used to be, shown crossed out
function removedAmount(p: Payment): number {
  const removal = (editsByPayment.value.get(p.id) ?? []).find(e => e.new_amount === 0)
  return removal?.old_amount ?? 0
}

function openEditPayment(p: Payment) {
  editingPayment.value = p
  editAmount.value     = String(p.amount)   // start from the current amount, not blank
  editReason.value     = ''
  editError.value      = ''
  removeMode.value     = false
  showEditPayModal.value = true
}

function closeEditPayModal() {
  showEditPayModal.value = false
  editingPayment.value   = null
}

async function submitEditPayment() {
  if (!editingPayment.value) return
  const newAmount = parseFloat(editAmount.value)
  const oldAmount = editingPayment.value.amount

  if (!newAmount || newAmount <= 0) { editError.value = 'Enter a valid amount'; return }
  if (newAmount === oldAmount) { editError.value = 'New amount is the same as before'; return }
  if (!editReason.value.trim()) { editError.value = 'Please explain why this is being changed'; return }

  await savePaymentChange(newAmount, 'Payment corrected')
}

// Removing = the same as a correction, but the new amount is 0 and a reason is a must
async function submitRemovePayment() {
  if (!editingPayment.value) return
  if (!editReason.value.trim()) { editError.value = 'Please explain why this payment is being removed'; return }

  await savePaymentChange(0, 'Payment removed')
}

// Shared by "correct" and "remove": log it first, then change the payment
async function savePaymentChange(newAmount: number, toast: string) {
  if (!editingPayment.value) return
  editSaving.value = true
  editError.value  = ''

  // 1. Save the change to the logbook first — old amount, new amount, reason, who
  const { error: logError } = await supabase.from('pay_later_payment_edits').insert({
    payment_id: editingPayment.value.id,
    old_amount: editingPayment.value.amount,
    new_amount: newAmount,
    reason: editReason.value.trim(),
    edited_by: auth.user?.id ?? null,
  })
  if (logError) { editSaving.value = false; editError.value = logError.message; return }

  // 2. Then actually change the payment's amount (0 when removed)
  const { error: updError } = await supabase
    .from('pay_later_payments')
    .update({ amount: newAmount })
    .eq('id', editingPayment.value.id)

  editSaving.value = false

  if (updError) { editError.value = updError.message; return }

  closeEditPayModal()
  await fetchAll()
  showToastMsg(toast)
}


// ──────────────────────────────────────────────
// 9c. CUSTOMER BOOK — browse/search/edit/delete EVERY contact, including
// ones with no purchases yet (hidden from the ledger table above)
// ──────────────────────────────────────────────
const showCustomerBook = ref(false)


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
// 10b. DELETE CUSTOMER — for settled accounts, once paid off in person
// ──────────────────────────────────────────────
const deletingCustomerId = ref<string | null>(null)

async function deleteCustomer(c: CustomerBalance) {
  if (!confirm(`Delete ${c.name}'s Pay Later account? This can't be undone.`)) return

  deletingCustomerId.value = c.id
  const { error } = await supabase.from('pay_later_customers').delete().eq('id', c.id)
  deletingCustomerId.value = null

  if (error) {
    // 23503 = foreign key violation — their bills/payments still reference this customer
    if (error.code === '23503') {
      showToastMsg('Could not delete — this account still has bill or payment history')
    } else {
      showToastMsg('Delete failed: ' + error.message)
    }
    return
  }

  customers.value = customers.value.filter(x => x.id !== c.id)
  showToastMsg(`${c.name} removed`)
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
  const headers = ['Name', 'Phone', 'ID Number', 'Total Billed', 'Total Loaned', 'Total Paid', 'Total Owed', 'Last Bill', 'Last Payment', 'Status']
  const rows = filteredCustomers.value.map(c => [
    c.name,
    c.phone || '—',
    c.id_number || '—',
    c.total_billed.toFixed(2),
    Number(c.total_loaned).toFixed(2),
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

// ──────────────────────────────────────────────
// 12b. EXPORT PDF
// Builds a real A4 PDF file straight in the browser and downloads it —
// same look and structure as Today Business Report's PDF export.
// ──────────────────────────────────────────────
// Same simple bordered-grid look as the Today Business reports; money with commas (9,180.00)
const pdfBorder: [number, number, number] = [90, 88, 84]
const pdfGridStyles = {
  font: 'helvetica', fontSize: 9, cellPadding: 6, textColor: [20, 20, 18] as [number, number, number],
  lineColor: pdfBorder, lineWidth: 0.6,
}
const pdfGridHead = { fillColor: [247, 245, 242] as [number, number, number], textColor: [20, 20, 18] as [number, number, number], fontStyle: 'bold' as const }
function fmtNum(n: number): string {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function exportPDF() {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 40
  let y = 50

  const todayLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })

  // ── HEADER ──
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(20, 20, 18)
  doc.text('obello', margin, y)
  doc.setFontSize(10)
  doc.setTextColor(120, 120, 115)
  doc.setFont('helvetica', 'normal')
  doc.text('POS V2.0', margin + 62, y)

  doc.setFontSize(11)
  doc.setTextColor(80, 80, 78)
  doc.text('Pay Later Report', pageWidth - margin, y - 6, { align: 'right' })
  doc.setFontSize(9.5)
  doc.text(todayLabel, pageWidth - margin, y + 8, { align: 'right' })

  y += 20
  doc.setDrawColor(230, 228, 224)
  doc.line(margin, y, pageWidth - margin, y)
  y += 26

  // ── SUMMARY CARDS (key/value grid) ──
  const summaryPairs: [string, string][] = [
    ['Total Owed', fmtRs(totalOwed.value)],
    ['Loans Given', fmtRs(totalLoaned.value)],
    ['Total Collected', fmtRs(totalCollected.value)],
    ['Pending Accounts', String(pendingAccounts.value)],
    ['Paid Accounts', String(paidAccounts.value)],
  ]
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: 'grid',
    body: summaryPairs,
    styles: { ...pdfGridStyles, fontSize: 10, cellPadding: 7 },
    columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right' } },
  })
  y = (doc as any).lastAutoTable.finalY + 26

  // ── CUSTOMER ACCOUNTS TABLE (respects the current tab + search + sort) ──
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(20, 20, 18)
  doc.text(activeTab.value === 'pending' ? 'Pending Accounts' : 'Paid Accounts', margin, y)
  y += 10

  const custHead = [['Customer', 'Phone', 'Credit (bills + loans)', 'Total Paid', 'Balance', 'Last Activity']]
  const custBody = filteredCustomers.value.map(c => [
    c.name,
    c.phone || '—',
    fmtNum(Number(c.total_billed) + Number(c.total_loaned)),
    fmtNum(c.total_paid),
    fmtNum(c.total_owed),
    fmtDate(lastActivity(c)),
  ])
  autoTable(doc, {
    startY: y + 6,
    margin: { left: margin, right: margin },
    head: custHead,
    body: custBody,
    theme: 'grid',
    styles: pdfGridStyles,
    headStyles: pdfGridHead,
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
  })
  y = (doc as any).lastAutoTable.finalY + 26

  // ── BILLS BREAKDOWN (every Later Pay bill belonging to the listed customers) ──
  const filteredIds = new Set(filteredCustomers.value.map(c => c.id))
  const nameById = new Map(filteredCustomers.value.map(c => [c.id, c.name]))
  const billBody = bills.value
    .filter(b => filteredIds.has(b.customer_id))
    .map(b => [
      nameById.get(b.customer_id) || '—',
      b.invoice_no,
      fmtDate(b.created_at),
      fmtNum(b.total),
    ])

  if (billBody.length > 0) {
    if (y > doc.internal.pageSize.getHeight() - 120) {
      doc.addPage()
      y = 50
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(20, 20, 18)
    doc.text('Bills', margin, y)

    autoTable(doc, {
      startY: y + 10,
      margin: { left: margin, right: margin },
      head: [['Customer', 'Invoice No', 'Date', 'Total']],
      body: billBody,
      theme: 'grid',
      styles: { ...pdfGridStyles, fontSize: 8.5, cellPadding: 5 },
      headStyles: pdfGridHead,
      columnStyles: { 3: { halign: 'right' } },
    })
  }

  // ── FOOTER on every page ──
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    const pageHeight = doc.internal.pageSize.getHeight()
    doc.setFontSize(8)
    doc.setTextColor(150, 148, 144)
    doc.text(`Generated ${new Date().toLocaleString('en-US')}`, margin, pageHeight - 24)
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, pageHeight - 24, { align: 'right' })
  }

  doc.save(`pay-later-${new Date().toISOString().slice(0, 10)}.pdf`)
  showToastMsg('PDF exported')
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
          <div class="stat-label">Loans Given</div>
          <div class="stat-value">{{ fmtRs(totalLoaned) }}</div>
          <div class="stat-sub">cash lent to customers</div>
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
          <button class="btn btn-outline" @click="showCustomerBook = true" title="Browse, search, edit or delete every Pay Later contact">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path stroke-linecap="round" stroke-linejoin="round" d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
            Customer Book
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
                <th style="text-align:right">Total Credit</th>
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
                    <span class="name-line">
                      {{ c.name }}
                      <!-- coin = has a loan · shirt = bought clothes on credit (both = both) -->
                      <span v-if="c.total_loaned > 0" class="type-icon type-loan" title="Has a loan">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M14.5 9.5a2.5 2.5 0 0 0-2.5-1.5c-1.4 0-2.5.9-2.5 2s1.1 1.7 2.5 2 2.5.9 2.5 2-1.1 2-2.5 2a2.5 2.5 0 0 1-2.5-1.5"/><line x1="12" y1="6" x2="12" y2="7.5"/><line x1="12" y1="16.5" x2="12" y2="18"/></svg>
                      </span>
                      <span v-if="c.total_billed > 0" class="type-icon type-cloth" title="Bought clothes on credit">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/></svg>
                      </span>
                    </span>
                    <div class="cust-id">{{ c.id_number || '' }}</div>
                  </td>
                  <td class="date-cell">{{ c.phone || '—' }}</td>
                  <td class="price-cell" style="text-align:right">{{ fmtRs(Number(c.total_billed) + Number(c.total_loaned)) }}</td>
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
                    <span v-else class="paid-actions">
                      <span class="paid-tag">✓ Paid</span>
                      <button
                        class="btn-delete"
                        :disabled="deletingCustomerId === c.id"
                        title="Delete this account"
                        @click="deleteCustomer(c)"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                      </button>
                    </span>
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

                      <!-- Credit Loans (cash lent) -->
                      <div v-if="(loansByCustomer.get(c.id) ?? []).length > 0" class="expand-section">
                        <div class="expand-section-title">Credit Loans ({{ (loansByCustomer.get(c.id) ?? []).length }})</div>
                        <div v-for="loan in (loansByCustomer.get(c.id) ?? [])" :key="loan.id" class="bill-card loan-card">
                          <div class="loan-row">
                            <span class="type-icon type-loan">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M14.5 9.5a2.5 2.5 0 0 0-2.5-1.5c-1.4 0-2.5.9-2.5 2s1.1 1.7 2.5 2 2.5.9 2.5 2-1.1 2-2.5 2a2.5 2.5 0 0 1-2.5-1.5"/><line x1="12" y1="6" x2="12" y2="7.5"/><line x1="12" y1="16.5" x2="12" y2="18"/></svg>
                            </span>
                            <span class="bill-date">{{ fmtDate(loan.given_at) }}</span>
                            <span class="loan-note">{{ loan.note || 'Loan' }}<span v-if="loan.users?.full_name" class="loan-by"> · by {{ loan.users.full_name }}</span></span>
                            <span class="alloc-badge" :class="allocClass(loan.id)">{{ allocLabel(loan.id) }}</span>
                            <span class="bill-total">{{ fmtRs(loan.amount) }}</span>
                          </div>
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
                            <span class="alloc-badge alloc-pushed" :class="allocClass(bill.id)">{{ allocLabel(bill.id) }}</span>
                            <span class="bill-total">{{ fmtRs(bill.total) }}</span>
                          </div>
                          <div
                            v-for="item in (itemsByBill.get(bill.id) ?? [])"
                            :key="item.id"
                            class="expand-item"
                            :class="{ 'expand-item-returned': item.qty === 0 }"
                          >
                            <img v-if="item.products?.image_url" :src="item.products.image_url" class="expand-item-img" />
                            <div v-else class="expand-item-img expand-item-img-placeholder">
                              <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" width="14" height="14"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9l4-4 4 4 4-4 4 4"/><path d="M3 15l4 4 4-4 4 4 4-4"/></svg>
                            </div>
                            <div class="expand-item-info">
                              <div class="expand-item-name">{{ item.product_name }}</div>
                              <div class="expand-item-sku">{{ item.sku || '—' }}</div>
                            </div>
                            <span v-if="item.qty === 0" class="returned-badge" title="This item was returned — its cost has already been removed from the balance">
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                              Returned
                            </span>
                            <span v-else class="discount-badge" :class="discountLabelClass(item.discount_label)">{{ item.discount_label || '—' }}</span>
                            <div class="expand-item-qty">x{{ item.qty }}</div>
                            <div class="expand-item-total">{{ fmtRs(item.line_total) }}</div>
                          </div>
                        </div>
                      </div>

                      <!-- Payment history -->
                      <div class="expand-section">
                        <div class="expand-section-title">Payment History ({{ (paymentsByCustomer.get(c.id) ?? []).length }})</div>
                        <div v-if="(paymentsByCustomer.get(c.id) ?? []).length === 0" class="expand-empty">No payments recorded yet</div>
                        <div v-for="p in (paymentsByCustomer.get(c.id) ?? [])" :key="p.id" class="payment-block">
                          <div class="payment-row">
                            <span class="payment-date">{{ fmtDate(p.paid_at) }}</span>
                            <span v-if="isRemoved(p)" class="payment-amount payment-amount-removed">{{ fmtRs(removedAmount(p)) }}</span>
                            <span v-else class="payment-amount">{{ fmtRs(p.amount) }}</span>
                            <span v-if="isRemoved(p)" class="removed-badge">Removed</span>
                            <span v-if="isRemoved(p)" class="payment-note">by {{ removedBy(p) }}</span>
                            <span v-else-if="p.note" class="payment-note">{{ p.note }}</span>
                            <button v-if="!isRemoved(p)" class="btn-edit-payment" title="Correct or remove this payment" @click.stop="openEditPayment(p)">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                              </svg>
                            </button>
                          </div>
                          <!-- Correction trail — every past edit to this payment, in red -->
                          <div v-for="e in (editsByPayment.get(p.id) ?? [])" :key="e.id" class="payment-edit-row">
                            <template v-if="e.new_amount === 0">Removed {{ fmtRs(e.old_amount) }} - {{ e.reason }}</template>
                            <template v-else>{{ fmtRs(e.old_amount) }} → {{ fmtRs(e.new_amount) }} - {{ e.reason }}</template>
                            <span class="payment-edit-by">· by {{ e.users?.full_name || 'Unknown user' }}</span>
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

    <!-- ══════════════════════════════════════ -->
    <!--    PAY MODAL                          -->
    <!-- ══════════════════════════════════════ -->
    <Transition name="fade">
      <div v-if="showPayModal" class="modal-overlay" :class="{ light: isLight }">
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
              <label class="form-label">Payment Method</label>
              <div class="method-chips">
                <button type="button" class="method-chip" :class="{ active: payMethod === 'cash' }" @click="payMethod = 'cash'">Cash</button>
                <button type="button" class="method-chip" :class="{ active: payMethod === 'card' }" @click="payMethod = 'card'">Card</button>
                <button type="button" class="method-chip" :class="{ active: payMethod === 'bank' }" @click="payMethod = 'bank'">Bank</button>
              </div>
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
    <!--    EDIT PAYMENT MODAL                 -->
    <!-- ══════════════════════════════════════ -->
    <Transition name="fade">
      <div v-if="showEditPayModal" class="modal-overlay" :class="{ light: isLight }">
        <div class="modal-box">
          <div class="modal-header">
            <div>
              <div class="modal-title">{{ removeMode ? 'Remove Payment' : 'Correct Payment' }}</div>
              <div class="modal-sub">Currently {{ fmtRs(editingPayment?.amount ?? 0) }} · {{ fmtDate(editingPayment?.paid_at ?? null) }}</div>
            </div>
            <button class="modal-close" @click="closeEditPayModal">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <div class="modal-body">
            <div v-if="removeMode" class="remove-warning">
              This takes {{ fmtRs(editingPayment?.amount ?? 0) }} off what this customer has paid, so their balance goes back up.
              The payment stays in the history, marked as removed.
            </div>
            <div v-if="!removeMode" class="form-field">
              <label class="form-label">Correct Amount <span class="req">*</span></label>
              <div class="input-prefix-wrap">
                <span class="input-prefix">Rs.</span>
                <input v-model="editAmount" type="number" class="form-input has-prefix" placeholder="Enter the correct amount…" autofocus />
              </div>
            </div>
            <div class="form-field">
              <label class="form-label">{{ removeMode ? 'Reason for removing' : 'Reason for change' }} <span class="req">*</span></label>
              <textarea v-model="editReason" class="form-input textarea" rows="3" :placeholder="removeMode ? 'e.g. Added to the wrong customer by mistake' : 'e.g. Cashier typed the wrong amount'" />
              <span class="form-hint-text">This is saved permanently and shown in the payment history.</span>
            </div>
            <div v-if="editError" class="save-error">{{ editError }}</div>
          </div>

          <div class="modal-footer">
            <button v-if="!removeMode" class="modal-remove-link" :disabled="editSaving" @click="removeMode = true; editError = ''">Remove payment</button>
            <button class="modal-cancel" :disabled="editSaving" @click="removeMode ? (removeMode = false, editError = '') : closeEditPayModal()">{{ removeMode ? 'Back' : 'Cancel' }}</button>
            <button v-if="removeMode" class="modal-save modal-save-danger" :disabled="editSaving" @click="submitRemovePayment">
              {{ editSaving ? 'Removing…' : 'Remove Payment' }}
            </button>
            <button v-else class="modal-save" :disabled="editSaving" @click="submitEditPayment">
              {{ editSaving ? 'Saving…' : 'Save Correction' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ══════════════════════════════════════ -->
    <!--    ADD NEW CUSTOMER MODAL             -->
    <!-- ══════════════════════════════════════ -->
    <Transition name="fade">
      <div v-if="showAddModal" class="modal-overlay" :class="{ light: isLight }">
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

    <!-- ══════════════════════════════════════ -->
    <!--    CUSTOMER BOOK — all contacts       -->
    <!-- ══════════════════════════════════════ -->
    <PayLaterCustomerBookModal
      v-model="showCustomerBook"
      :isLight="isLight"
      @changed="fetchAll"
    />

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

.paid-actions { display: inline-flex; align-items: center; gap: 10px; }
.paid-tag { font-size: 12px; color: var(--green); font-weight: 600; }

.btn-delete {
  width: 26px; height: 26px; border-radius: 7px;
  border: 1px solid var(--border); background: var(--bg);
  color: var(--text-muted); cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: color .15s, background .15s, border-color .15s;
}
.btn-delete:hover:not(:disabled) { color: var(--red); background: var(--red-bg); border-color: var(--red); }
.btn-delete:disabled { opacity: .4; cursor: not-allowed; }

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

.name-line { display: inline-flex; align-items: center; gap: 6px; }
.type-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border-radius: 50%; flex-shrink: 0;
}
.type-loan  { background: rgba(251,191,36,.18); color: #d97706; }
.type-cloth { background: rgba(96,165,250,.18); color: #3b82f6; }
.page-wrap:not(.light) .type-loan { color: #fbbf24; }
.page-wrap:not(.light) .type-cloth { color: #60a5fa; }

.loan-row { display: flex; align-items: center; gap: 10px; }
.loan-note { font-size: 12px; color: var(--text-sub); flex: 1; min-width: 0; }
.loan-by { color: var(--text-muted); }

.alloc-badge { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 5px; border: 1px solid var(--border); white-space: nowrap; }
.alloc-badge.alloc-paid    { color: var(--green); background: var(--green-bg); border-color: var(--green); }
.alloc-badge.alloc-partial { color: #d97706; background: rgba(251,191,36,.14); border-color: #d97706; }
.alloc-badge.alloc-unpaid  { color: var(--text-sub); background: var(--surface2); }
.page-wrap:not(.light) .alloc-badge.alloc-partial { color: #fbbf24; border-color: #fbbf24; }
.loan-row .bill-total { margin-left: 0; }

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

/* Fully returned line item — dim the row and swap the discount badge for a "Returned" tag */
.expand-item-returned .expand-item-name,
.expand-item-returned .expand-item-total { color: var(--text-muted); text-decoration: line-through; }
.expand-item-returned .expand-item-img { opacity: .5; }

.returned-badge {
  display: inline-flex; align-items: center; gap: 4px; justify-content: center;
  padding: 2px 8px; border-radius: 5px; font-size: 9px; font-weight: 600;
  letter-spacing: .03em; text-transform: uppercase; width: 68px; flex-shrink: 0;
  border: 1px solid var(--red); background: var(--red-bg); color: var(--red);
}

.payment-block  { padding: 2px 0; }
.payment-row { display: flex; align-items: center; gap: 12px; padding: 4px 0; font-size: 12.5px; }
.payment-date   { color: var(--text-sub); width: 100px; flex-shrink: 0; }
.payment-amount { font-weight: 700; color: var(--green); font-family: 'DM Mono', monospace; width: 100px; }
.payment-note   { color: var(--text-muted); font-size: 11.5px; flex: 1; }

.btn-edit-payment {
  width: 22px; height: 22px; border-radius: 6px; margin-left: auto; flex-shrink: 0;
  border: 1px solid var(--border); background: var(--surface);
  color: var(--text-muted); cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: color .15s, background .15s, border-color .15s;
}
.btn-edit-payment:hover { color: var(--text); background: var(--surface2); border-color: var(--text-muted); }

/* Correction trail — permanent proof of what a payment used to be, why, and who did it */
.payment-edit-row {
  font-size: 11.5px; color: var(--red); font-family: 'DM Mono', monospace;
  padding: 3px 0 3px 112px;
}
.payment-edit-by { color: var(--text-muted); font-style: italic; }

/* Removed payment — original amount crossed out, red "Removed" tag */
.payment-amount-removed { color: var(--text-muted); text-decoration: line-through; }
.removed-badge {
  padding: 2px 8px; border-radius: 5px; font-size: 9px; font-weight: 600;
  letter-spacing: .03em; text-transform: uppercase; flex-shrink: 0;
  border: 1px solid var(--red); background: var(--red-bg); color: var(--red);
}


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

.method-chips { display: flex; gap: 8px; }
.method-chip {
  flex: 1; padding: 9px 0; border-radius: 8px;
  border: 1px solid var(--border-mid); background: var(--bg-card);
  color: var(--text-sub); font-size: 12.5px; font-weight: 600;
  font-family: 'DM Sans', sans-serif; cursor: pointer; transition: all .15s;
}
.method-chip:hover { background: var(--bg-hover); }
.method-chip.active { border-color: var(--accent-bg); background: var(--accent-bg); color: var(--accent-text); }

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
.modal-save-danger { background: #dc2626; color: #fff; }
.modal-remove-link { margin-right: auto; background: none; border: none; padding: 10px 4px; font-size: 13px; font-family: 'DM Sans', sans-serif; color: #f87171; cursor: pointer; }
.modal-remove-link:hover:not(:disabled) { text-decoration: underline; }
.remove-warning { padding: 10px 12px; border-radius: 8px; font-size: 12.5px; line-height: 1.5; color: #f87171; background: rgba(220,38,38,.12); border: 1px solid rgba(220,38,38,.3); }

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

<!--
  ╔═══════════════════════════════════════════════════════════════════╗
  ║  TodayBusinessView.vue — Today's sales summary + sale-by-sale list ║
  ║  All data comes from Supabase "transactions" + "transaction_items" ║
  ║  Same Slidebar + light/dark theme + card/table look as             ║
  ║  ProductListView.vue                                               ║
  ╚═══════════════════════════════════════════════════════════════════╝
-->

<script setup lang="ts">
// ──────────────────────────────────────────────
// 1. IMPORTS
// ──────────────────────────────────────────────
import { ref, computed, onMounted, watch } from 'vue'
import Slidebar from '../components/Slidebar.vue'
import Toast from '../components/Toast.vue'
import { supabase } from '../lib/supabase'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../store/auth'
import { markConnected, markError } from '../lib/connectionStatus'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'


// ──────────────────────────────────────────────
// 2. TYPES — shape of one transaction row from Supabase
//    (the "users" and "transaction_items" bits are joined in
//    automatically because of the foreign keys in the table)
// ──────────────────────────────────────────────
interface Transaction {
  id: string
  invoice_no: string
  cashier_id: string | null
  customer_id: string | null   // Later Pay: who took the goods (pay_later_customers.id)
  subtotal: number
  discount_percent: number
  discount_amount: number
  total: number
  amount_paid: number
  balance: number
  payment_method: string   // 'cash' | 'card' | 'bank' | 'later_pay'
  printed_receipt: boolean
  status: string            // 'completed' | 'refunded' | 'void'
  created_at: string
  users: { full_name: string | null } | null
  // Filled in only when the sale was cancelled (status = 'void')
  voided_at: string | null
  voided_by_name: string | null
  void_reason: string | null
}

// One line item belonging to a transaction — used both for the cost
// calculation AND for the expanded "show items" panel under each row
interface TransactionItemRow {
  id: string
  transaction_id: string
  product_id: string | null
  product_name: string
  sku: string | null
  qty: number
  unit_price: number
  discount_label: string | null
  line_total: number
  products: { cost_price: number; image_url: string | null; selling_price?: number; sub_category?: string | null } | null
}

// ──────────────────────────────────────────────
// 3. THEME — same pattern as ProductListView
// ──────────────────────────────────────────────
const isLight = ref(localStorage.getItem('theme') === 'light')


// ──────────────────────────────────────────────
// 3b. DATE SELECTION
//     Reports can be viewed for any day in the last 4 months (matches the
//     retention window — older data is auto-deleted, so there's nothing
//     to show before that anyway).
// ──────────────────────────────────────────────
function toDateStr(d: Date): string {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const todayStr = toDateStr(new Date())
const selectedDate = ref(todayStr)
const isViewingToday = computed(() => selectedDate.value === todayStr)

const minSelectableDate = (() => {
  const d = new Date()
  d.setMonth(d.getMonth() - 4)
  return toDateStr(d)
})()
const maxSelectableDate = todayStr

const selectedDateLabel = computed(() => {
  const d = new Date(selectedDate.value + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })
})


// ──────────────────────────────────────────────
// 4. TRANSACTIONS from Supabase, for whichever date is selected
// ──────────────────────────────────────────────
const transactions = ref<Transaction[]>([])
const itemRows      = ref<TransactionItemRow[]>([])
// Later Pay customers for the loaded sales, by id — so a sale can show "who took it"
interface PayLaterCustomer { id: string; name: string; phone: string | null; id_number: string | null; address: string | null }
const customerById  = ref(new Map<string, PayLaterCustomer>())
const loading       = ref(false)
const fetchError    = ref('')

// Midnight → midnight tomorrow for a given "YYYY-MM-DD" date, in local time
function dayRange(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const start = new Date(y, m - 1, d, 0, 0, 0, 0)
  const end   = new Date(y, m - 1, d, 23, 59, 59, 999)
  return { start: start.toISOString(), end: end.toISOString() }
}

async function fetchReportData() {
  loading.value    = true
  fetchError.value = ''
  try {
    const { start, end } = dayRange(selectedDate.value)

    // All of the selected day's transactions, newest first, with the cashier's name joined in.
    // Cancelled (void) sales are loaded too, so the table can show them as
    // "Cancelled" with who/why. They are NOT counted in any total below —
    // everything that adds up money uses saleTransactions (completed only).
    const { data: txnData, error: txnError } = await supabase
      .from('transactions')
      .select('*, users(full_name)')
      .gte('created_at', start)
      .lte('created_at', end)
      .order('created_at', { ascending: false })

    if (txnError) { fetchError.value = txnError.message; markError(); return }
    transactions.value = txnData ?? []

    // Who took each Later Pay sale: look the customers up by the ids saved on the sales.
    // If this lookup fails the report still works, the customer box just says "not found".
    const customerIds = [...new Set(
      transactions.value.filter(t => t.payment_method === 'later_pay' && t.customer_id).map(t => t.customer_id as string)
    )]
    const customerMap = new Map<string, PayLaterCustomer>()
    if (customerIds.length > 0) {
      const { data: custData, error: custError } = await supabase
        .from('pay_later_customers')
        .select('id, name, phone, id_number, address')
        .in('id', customerIds)
      if (custError) console.warn('Could not load Later Pay customers:', custError.message)
      for (const c of custData ?? []) customerMap.set(c.id, c as PayLaterCustomer)
    }
    customerById.value = customerMap

    // Every item sold that day, with its product image + cost price joined in.
    // Used for: the cost/profit calc, the "Items" count column, and the
    // expanded item list under each row.
    const ids = transactions.value.map(t => t.id)
    if (ids.length > 0) {
      const { data: itemData, error: itemError } = await supabase
        .from('transaction_items')
        .select('*, products(cost_price, image_url, selling_price, sub_category)')
        .in('transaction_id', ids)
      if (itemError) { fetchError.value = itemError.message; markError(); return }
      itemRows.value = (itemData ?? []) as unknown as TransactionItemRow[]
    } else {
      itemRows.value = []
    }

    markConnected()
  } catch {
    fetchError.value = 'Could not load business data for this day.'
    markError()
  } finally {
    loading.value = false
  }
}

// ── Returned items for the selected day (from the permanent "return_log") ──
const returnedCount  = ref(0)   // total units returned
const returnedAmount = ref(0)   // total Rs. those units were sold for

async function fetchReturns() {
  const { start, end } = dayRange(selectedDate.value)
  const { data, error } = await supabase
    .from('return_log')
    .select('qty, amount')
    .gte('returned_at', start)
    .lte('returned_at', end)
  if (error) { console.error('Return log fetch error:', error); returnedCount.value = 0; returnedAmount.value = 0; return }
  returnedCount.value  = (data ?? []).reduce((s, r) => s + r.qty, 0)
  returnedAmount.value = (data ?? []).reduce((s, r) => s + Number(r.amount), 0)
}

// ── Credit Loans given on the selected day (cash lent — NOT a sale, never in Sales/Profit) ──
const loansCount  = ref(0)
const loansAmount = ref(0)

async function fetchLoans() {
  const { start, end } = dayRange(selectedDate.value)
  const { data, error } = await supabase
    .from('pay_later_loans')
    .select('amount')
    .gte('given_at', start)
    .lte('given_at', end)
  if (error) { console.error('Loans fetch error:', error); loansCount.value = 0; loansAmount.value = 0; return }
  loansCount.value  = (data ?? []).length
  loansAmount.value = (data ?? []).reduce((s, r) => s + Number(r.amount), 0)
}

// Reload the report whenever the selected date changes
watch(selectedDate, () => { fetchReportData(); fetchReturns(); fetchLoans() })


// ──────────────────────────────────────────────
// 4b. AVAILABLE DATES — which days in the last 4 months have any sales,
//     so the calendar can grey out empty days instead of showing a blank
//     report for them.
// ──────────────────────────────────────────────
const availableDates = ref<Set<string>>(new Set())

async function fetchAvailableDates() {
  const fourMonthsAgo = new Date()
  fourMonthsAgo.setMonth(fourMonthsAgo.getMonth() - 4)

  const { data, error } = await supabase
    .from('transactions')
    .select('created_at')
    .gte('created_at', fourMonthsAgo.toISOString())
    .neq('status', 'void')

  if (error) { console.error('Available dates fetch error:', error); return }

  const set = new Set<string>()
  for (const row of data ?? []) set.add(toDateStr(new Date(row.created_at)))
  availableDates.value = set
}


// ──────────────────────────────────────────────
// 4c. CALENDAR DROPDOWN — pick any day with data, within the retention window
// ──────────────────────────────────────────────
const showCalendar    = ref(false)
const calendarView    = ref(new Date(selectedDate.value + 'T00:00:00')) // which month is showing

function openCalendar() {
  calendarView.value = new Date(selectedDate.value + 'T00:00:00')
  showCalendar.value = true
}
function closeCalendar() {
  showCalendar.value = false
}

const calendarMonthLabel = computed(() =>
  calendarView.value.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
)

interface CalendarCell { dateStr: string | null; day: number | null; hasData: boolean; inRange: boolean }

const calendarCells = computed<CalendarCell[]>(() => {
  const year  = calendarView.value.getFullYear()
  const month = calendarView.value.getMonth()
  const firstWeekday = new Date(year, month, 1).getDay()   // 0 = Sunday
  const daysInMonth  = new Date(year, month + 1, 0).getDate()

  const cells: CalendarCell[] = []
  for (let i = 0; i < firstWeekday; i++) cells.push({ dateStr: null, day: null, hasData: false, inRange: false })
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = toDateStr(new Date(year, month, day))
    cells.push({
      dateStr,
      day,
      hasData: availableDates.value.has(dateStr),
      inRange: dateStr >= minSelectableDate && dateStr <= maxSelectableDate,
    })
  }
  return cells
})

// Don't let the user navigate outside the 4-month retention window
const canGoPrevMonth = computed(() => {
  const prev = new Date(calendarView.value.getFullYear(), calendarView.value.getMonth() - 1, 1)
  const floor = new Date(minSelectableDate + 'T00:00:00')
  return prev >= new Date(floor.getFullYear(), floor.getMonth(), 1)
})
const canGoNextMonth = computed(() => {
  const next = new Date(calendarView.value.getFullYear(), calendarView.value.getMonth() + 1, 1)
  const ceiling = new Date(maxSelectableDate + 'T00:00:00')
  return next <= new Date(ceiling.getFullYear(), ceiling.getMonth(), 1)
})

function prevMonth() {
  if (canGoPrevMonth.value) calendarView.value = new Date(calendarView.value.getFullYear(), calendarView.value.getMonth() - 1, 1)
}
function nextMonth() {
  if (canGoNextMonth.value) calendarView.value = new Date(calendarView.value.getFullYear(), calendarView.value.getMonth() + 1, 1)
}

function pickDate(cell: CalendarCell) {
  if (!cell.dateStr || !cell.hasData || !cell.inRange) return
  selectedDate.value = cell.dateStr
  showCalendar.value = false
}


// ──────────────────────────────────────────────
// 5. SPLIT: completed sales vs "Later Pay" sales
//    Later Pay bills now count as a normal completed sale straight away —
//    the moment the order is placed, not whenever the customer eventually
//    pays it off. Simpler bookkeeping: one sale, counted once, at checkout.
//    laterPayTransactions is kept only for the informational "Later Pay"
//    card (how much of today's total is still on credit) — it's a SUBSET
//    of saleTransactions, not an exclusion from it.
// ──────────────────────────────────────────────
const saleTransactions = computed(() =>
  transactions.value.filter(t => t.status === 'completed')
)
const laterPayTransactions = computed(() =>
  saleTransactions.value.filter(t => t.payment_method === 'later_pay')
)
// Cancelled sales — shown in the table + an info card, never in the totals
const cancelledTransactions = computed(() =>
  transactions.value.filter(t => t.status === 'void')
)
const cancelledTotal = computed(() =>
  cancelledTransactions.value.reduce((sum, t) => sum + t.total, 0)
)


// ──────────────────────────────────────────────
// 6. STAT CARD NUMBERS
// ──────────────────────────────────────────────
// Today's Sales — every completed sale today, cash/card/bank AND Later Pay alike
const todaysSalesTotal = computed(() =>
  saleTransactions.value.reduce((sum, t) => sum + t.total, 0)
)

// Cost of Goods Sold — what those sold items cost YOU (cost_price), not what
// the customer paid. Includes Later Pay sales too, same as Sales above.
const todaysCostTotal = computed(() => {
  const saleIds = new Set(saleTransactions.value.map(t => t.id))
  return itemRows.value
    .filter(row => saleIds.has(row.transaction_id))
    .reduce((sum, row) => sum + (row.products?.cost_price ?? 0) * row.qty, 0)
})

// Card fee — the card machine keeps 2.5% of every CARD payment, so that part
// of the sale is never ours. It only applies to card sales (not cash/bank/later pay).
const CARD_FEE_RATE = 0.025
const CARD_FEE_LABEL = '2.5%'
function cardFeeOf(t: { payment_method: string; total: number }): number {
  return t.payment_method === 'card' ? t.total * CARD_FEE_RATE : 0
}
const todaysCardFee = computed(() =>
  saleTransactions.value.reduce((sum, t) => sum + cardFeeOf(t), 0)
)
const todaysCardCount = computed(() =>
  saleTransactions.value.filter(t => t.payment_method === 'card').length
)

// Profit — what's left after cost AND the card fee are taken out of sales
const todaysProfit = computed(() => todaysSalesTotal.value - todaysCostTotal.value - todaysCardFee.value)

// Average Profit Margin — what % of every Rs. of sales is profit.
// profit ÷ sales × 100. If there are no sales yet we show 0 (never divide by zero).
function marginPct(profit: number, sales: number): number {
  return sales > 0 ? (profit / sales) * 100 : 0
}
const todaysMargin = computed(() => marginPct(todaysProfit.value, todaysSalesTotal.value))

// How many completed sales happened today, Later Pay included
const todaysSalesCount = computed(() => saleTransactions.value.length)

// Later Pay — informational only now: how many of today's sales (already
// counted above) were sold on credit, and how much of that Rs. is still
// uncollected. Recording an eventual payment (Pay Later page) doesn't
// touch this report at all — the sale was already counted here.
const laterPayCount = computed(() => laterPayTransactions.value.length)
const laterPayTotal = computed(() => laterPayTransactions.value.reduce((sum, t) => sum + t.total, 0))


// How many items were sold in a given transaction (for the table's "Items" column)
const itemCountByTxn = computed(() => {
  const map = new Map<string, number>()
  for (const row of itemRows.value) {
    map.set(row.transaction_id, (map.get(row.transaction_id) ?? 0) + row.qty)
  }
  return map
})

// Group the line items by transaction id, so the expanded row can show
// "all items that belong to this bill"
const itemsByTxn = computed(() => {
  const map = new Map<string, TransactionItemRow[]>()
  for (const row of itemRows.value) {
    const list = map.get(row.transaction_id) ?? []
    list.push(row)
    map.set(row.transaction_id, list)
  }
  return map
})


// Profit of ONE invoice (shown when its row is opened):
// what the customer paid (after any bill discount) minus what the items cost you.
function billFigures(t: Transaction) {
  const items = itemsByTxn.value.get(t.id) ?? []
  const cost = items.reduce((sum, i) => sum + (i.products?.cost_price ?? 0) * i.qty, 0)
  const cardFee = cardFeeOf(t)
  const profit = t.total - cost - cardFee
  const margin = t.total > 0 ? (profit / t.total) * 100 : 0
  return { cost, cardFee, profit, margin }
}


// ──────────────────────────────────────────────
// 7. PAYMENT METHOD FILTER (for the table only)
// ──────────────────────────────────────────────
// 'all_no_later' / 'all_with_later' = the two "All Payments" modes, otherwise
// a specific method: 'cash' | 'card' | 'bank' | 'later_pay'
const paymentFilter = ref('all_with_later')

const filteredTransactions = computed(() => {
  if (paymentFilter.value === 'all_no_later') {
    return transactions.value.filter(t => t.payment_method !== 'later_pay')
  }
  if (paymentFilter.value === 'all_with_later') return transactions.value
  return transactions.value.filter(t => t.payment_method === paymentFilter.value)
})


// ──────────────────────────────────────────────
// 7a. ITEM-BY-ITEM VIEW (toggle in the toolbar)
// Instead of one row per bill, show one row per PRODUCT: how many were sold
// across all of the day's sales, the average price, and the total Rs.
// It follows the payment filter above, and leaves out cancelled sales and
// items that were returned (qty 0), so it matches the numbers at the top.
// ──────────────────────────────────────────────
const itemView = ref(false)

interface SoldLine { id: string; invoice_no: string; time: string; label: string | null; qty: number; unitPrice: number; total: number }

const soldItems = computed(() => {
  const saleById = new Map(
    filteredTransactions.value.filter(t => t.status === 'completed').map(t => [t.id, t])
  )
  const map = new Map<string, { key: string; name: string; sku: string | null; image_url: string | null; category: string; listPrice: number | null; qty: number; total: number; lines: SoldLine[] }>()

  for (const row of itemRows.value) {
    const sale = saleById.get(row.transaction_id)
    if (!sale || row.qty <= 0) continue
    // Same product on different bills is grouped together by its product id
    const key = row.product_id ?? row.product_name
    const entry = map.get(key) ?? {
      key, name: row.product_name, sku: row.sku, image_url: row.products?.image_url ?? null,
      category: row.products?.sub_category?.trim() || 'Uncategorised',
      listPrice: row.products?.selling_price ?? null,
      qty: 0, total: 0, lines: [],
    }
    entry.qty   += row.qty
    entry.total += row.line_total
    // One line per sale: which bill, when, how it was priced (Discount / Super / Original)
    entry.lines.push({
      id: row.id, invoice_no: sale.invoice_no, time: sale.created_at,
      label: row.discount_label, qty: row.qty, unitPrice: row.unit_price, total: row.line_total,
    })
    map.set(key, entry)
  }

  return [...map.values()]
    .map(e => ({ ...e, billCount: e.lines.length, lines: [...e.lines].sort((a, b) => a.time.localeCompare(b.time)) }))
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name))   // best sellers first
})

// ── Hover preview of an item's picture (same pop-up as Product List) ──
const previewImg = ref('')
const previewX   = ref(0)
const previewY   = ref(0)
const PREVIEW_SIZE = 220

function showImgPreview(e: MouseEvent, imageUrl: string | null) {
  if (!imageUrl) return
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  previewImg.value = imageUrl
  previewX.value   = rect.right + 14
  // centre next to the thumbnail, but keep the whole picture on screen
  previewY.value   = Math.min(
    Math.max(12, rect.top + rect.height / 2 - PREVIEW_SIZE / 2),
    window.innerHeight - PREVIEW_SIZE - 12,
  )
}

function hideImgPreview() {
  previewImg.value = ''
}

// Click an item row to open / close its price breakdown
const expandedItemKeys = ref(new Set<string>())
function toggleItem(key: string) {
  const next = new Set(expandedItemKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedItemKeys.value = next
}

// ── How the Items view is grouped ──
// 'category' (default): one row per category, click it to open its items.
// 'item': the flat list, one row per item.
const itemGroup = ref<'category' | 'item'>('category')

type SoldItem = (typeof soldItems)['value'][number]

const categoryGroups = computed(() => {
  const map = new Map<string, { name: string; qty: number; total: number; items: SoldItem[] }>()
  for (const item of soldItems.value) {
    const g = map.get(item.category) ?? { name: item.category, qty: 0, total: 0, items: [] }
    g.qty += item.qty
    g.total += item.total
    g.items.push(item)
    map.set(item.category, g)
  }
  return [...map.values()].sort((a, b) => b.total - a.total)   // biggest category first
})

// Click a category row to open / close the items inside it
const expandedCategories = ref(new Set<string>())
function toggleCategory(name: string) {
  const next = new Set(expandedCategories.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  expandedCategories.value = next
}

const soldItemsQty   = computed(() => soldItems.value.reduce((sum, i) => sum + i.qty, 0))
const soldItemsTotal = computed(() => soldItems.value.reduce((sum, i) => sum + i.total, 0))
// What the customers really paid for these bills (after any bill-level discount)
const soldSalesTotal = computed(() =>
  filteredTransactions.value.filter(t => t.status === 'completed').reduce((sum, t) => sum + t.total, 0)
)
// Items total − sales total = discounts given on the whole bill
const soldDiscounts  = computed(() => Math.max(0, soldItemsTotal.value - soldSalesTotal.value))


// ──────────────────────────────────────────────
// 7b. ROW EXPAND/COLLAPSE — click a row to see its items
// ──────────────────────────────────────────────
const expandedIds = ref(new Set<string>())

function toggleExpand(id: string) {
  const next = new Set(expandedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedIds.value = next
}


// ──────────────────────────────────────────────
// 7b-2. CANCEL A SALE (admin only)
// A sale added by mistake can be cancelled. It is never deleted: it stays in
// the list marked "Cancelled" with who cancelled it, when and why, and it is
// left out of Sales / Cost / Profit. The stock goes back on the shelf.
// The real work (and the admin check) happens in the database function
// "void_sale" — this is just the button + the reason pop-up.
// ──────────────────────────────────────────────
const auth = useAuthStore()
const router = useRouter()

// Jump to the Pay Later page, already opened on this customer
function goToPayLaterCustomer(customerId: string) {
  router.push({ name: 'pay-later', query: { customer: customerId } })
}

const voidTarget  = ref<Transaction | null>(null)   // the sale being cancelled (null = pop-up closed)
const voidReason  = ref('')
const voidBusy    = ref(false)
const voidError   = ref('')

function openVoidModal(t: Transaction) {
  voidTarget.value = t
  voidReason.value = ''
  voidError.value  = ''
}

function closeVoidModal() {
  if (voidBusy.value) return
  voidTarget.value = null
}

async function confirmVoid() {
  if (!voidTarget.value) return
  const reason = voidReason.value.trim()
  if (reason.length < 3) { voidError.value = 'Please write a reason (at least 3 letters).'; return }

  voidBusy.value  = true
  voidError.value = ''
  const invoice = voidTarget.value.invoice_no
  const { error } = await supabase.rpc('void_sale', {
    p_transaction_id: voidTarget.value.id,
    p_reason: reason,
  })
  voidBusy.value = false

  if (error) { voidError.value = error.message; return }

  voidTarget.value = null
  showToastMsg(`${invoice} cancelled`)
  fetchReportData()   // reload so totals and the table update right away
}


// ──────────────────────────────────────────────
// 7c. REPRINT — resend any past sale to the same local print agent the
// POS screen uses (http://localhost:8899), so a lost/skipped receipt
// can be printed again straight from this report.
// ──────────────────────────────────────────────
const printingId = ref<string | null>(null)

async function reprintBill(t: Transaction) {
  printingId.value = t.id
  try {
    const items = itemsByTxn.value.get(t.id) ?? []
    await fetch('http://localhost:8899/print-receipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invoice_no: t.invoice_no,
        items: items.map(i => ({
          product_name: i.product_name,
          quantity: i.qty,
          unit_price: i.unit_price,
        })),
        payment_method: t.payment_method,
        subtotal: t.subtotal,
        discount_amount: t.discount_amount,
        total: t.total,
        amount_paid: t.amount_paid,
        balance: t.balance,
        is_cash_sale: t.payment_method === 'cash',
      }),
    })

    // Mark it as printed now, in case it wasn't already (keeps the
    // "Printed" column in this table honest for anyone checking later)
    if (!t.printed_receipt) {
      const { error } = await supabase.from('transactions').update({ printed_receipt: true }).eq('id', t.id)
      if (!error) t.printed_receipt = true
    }

    showToastMsg(`Reprinting ${t.invoice_no}…`)
  } catch (e) {
    console.warn('Print agent not running or unreachable:', e)
    showToastMsg('⚠️ Could not reach printer — make sure the print agent is running')
  } finally {
    printingId.value = null
  }
}

// Discount label → CSS class, so "Discount" / "Super" / "Original" each get
// their own colour (matches the price-mode buttons on the POS cart screen)
function discountLabelClass(label: string | null): string {
  if (!label) return ''
  const l = label.toLowerCase()
  if (l === 'super') return 'label-super'
  if (l === 'original') return 'label-original'
  return 'label-discount'
}


// ──────────────────────────────────────────────
// 8. HELPER FUNCTIONS
// ──────────────────────────────────────────────
function fmtRs(n: number): string {
  return `Rs. ${n.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtTime(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function paymentLabel(method: string): string {
  if (method === 'later_pay') return 'Later Pay'
  return method.charAt(0).toUpperCase() + method.slice(1)
}


// ──────────────────────────────────────────────
// 9. REFRESH — re-fetch the currently selected day (and the available-dates
//    list), without losing which date the user is looking at
// ──────────────────────────────────────────────
function refreshData() {
  fetchReportData()
  fetchReturns()
  fetchLoans()
  fetchAvailableDates()
}


// ── Shared PDF look: simple bordered grid, light header with bold dark text ──
const borderColor: [number, number, number] = [90, 88, 84]
const headFill: [number, number, number] = [247, 245, 242]
const gridStyles = {
  font: 'helvetica', fontSize: 9, cellPadding: 6, textColor: [20, 20, 18] as [number, number, number],
  lineColor: borderColor, lineWidth: 0.6,
}
const gridHead = { fillColor: headFill, textColor: [20, 20, 18] as [number, number, number], fontStyle: 'bold' as const }

// Money in the tables with commas: 9180 → "9,180.00", 402370 → "402,370.00"
function fmtNum(n: number): string {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ──────────────────────────────────────────────
// CATEGORY SECTION (used by BOTH the daily and the monthly PDF)
// "How many of each kind of item did we sell?" — a summary per category,
// then the items sold inside each category.
// ──────────────────────────────────────────────
interface CategoryGroup {
  name: string
  qty: number
  total: number
  items: { name: string; sku: string | null; qty: number; total: number }[]
}

// rows = sold item lines, saleIds = which bills count (completed sales only).
// Cancelled bills and returned items (qty 0) are left out.
function groupByCategory(rows: TransactionItemRow[], saleIds: Set<string>): CategoryGroup[] {
  const cats = new Map<string, { group: CategoryGroup; items: Map<string, CategoryGroup['items'][number]> }>()
  for (const row of rows) {
    if (!saleIds.has(row.transaction_id) || row.qty <= 0) continue
    const catName = row.products?.sub_category?.trim() || 'Uncategorised'
    const cat = cats.get(catName) ?? { group: { name: catName, qty: 0, total: 0, items: [] }, items: new Map() }
    cat.group.qty += row.qty
    cat.group.total += row.line_total

    const key = row.product_id ?? row.product_name   // same product on many bills = one line
    const item = cat.items.get(key) ?? { name: row.product_name, sku: row.sku, qty: 0, total: 0 }
    item.qty += row.qty
    item.total += row.line_total
    cat.items.set(key, item)
    cats.set(catName, cat)
  }
  return [...cats.values()]
    .map(({ group, items }) => ({ ...group, items: [...items.values()].sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name)) }))
    .sort((a, b) => b.total - a.total)   // biggest category first
}

// Draws the category section on the PDF starting at startY, returns where it ended
function drawCategorySections(doc: jsPDF, startY: number, margin: number, groups: CategoryGroup[]): number {
  if (groups.length === 0) return startY
  let y = startY
  const pageH = doc.internal.pageSize.getHeight()

  const heading = (text: string, size: number) => {
    if (y > pageH - 110) { doc.addPage(); y = 50 }   // don't leave a heading alone at the page bottom
    doc.setFont('helvetica', 'bold'); doc.setFontSize(size); doc.setTextColor(20, 20, 18)
    doc.text(text, margin, y)
    y += 10
  }

  const itemCount = groups.reduce((sum, g) => sum + g.items.length, 0)
  const totalQty  = groups.reduce((sum, g) => sum + g.qty, 0)
  const totalAmt  = groups.reduce((sum, g) => sum + g.total, 0)

  // 1) one row per category
  heading('Sales by category', 12)
  autoTable(doc, {
    startY: y, margin: { left: margin, right: margin }, theme: 'grid',
    styles: gridStyles, headStyles: gridHead,
    head: [['Category', 'Different items', 'Qty sold', 'Total (Rs.)', 'Share']],
    body: groups.map(g => [
      g.name, String(g.items.length), String(g.qty), fmtNum(g.total),
      `${totalAmt > 0 ? ((g.total / totalAmt) * 100).toFixed(1) : '0.0'}%`,
    ]),
    foot: [['Total', String(itemCount), String(totalQty), fmtNum(totalAmt), '100%']],
    footStyles: { fillColor: [247, 245, 242], textColor: [20, 20, 18], fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
  })
  y = (doc as any).lastAutoTable.finalY + 26

  // 2) the items sold inside each category
  heading('Items sold by category', 12)
  for (const g of groups) {
    heading(`${g.name}  -  ${g.qty} pcs  -  Rs. ${fmtNum(g.total)}`, 10)
    autoTable(doc, {
      startY: y, margin: { left: margin, right: margin }, theme: 'grid',
      styles: gridStyles, headStyles: gridHead,
      head: [['#', 'Item', 'SKU', 'Qty sold', 'Total (Rs.)']],
      body: g.items.map((it, idx) => [String(idx + 1), it.name, it.sku || '-', String(it.qty), fmtNum(it.total)]),
      columnStyles: { 0: { cellWidth: 24 }, 3: { halign: 'center' }, 4: { halign: 'right' } },
    })
    y = (doc as any).lastAutoTable.finalY + 16
  }
  return y + 10
}

// "obello POS V2.0" on the left, report title + subtitle on the right, thin line under.
// Returns the y position where the page body should start.
function drawReportHeader(doc: jsPDF, title: string, subtitle: string): number {
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 40
  let y = 50
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
  doc.text(title, pageWidth - margin, y - 6, { align: 'right' })
  doc.setFontSize(9.5)
  doc.text(subtitle, pageWidth - margin, y + 8, { align: 'right' })

  y += 20
  doc.setDrawColor(230, 228, 224)
  doc.line(margin, y, pageWidth - margin, y)
  return y + 26
}

// "Generated …" on the left and "Page 1 of 3" on the right, on every page
function addReportFooters(doc: jsPDF, margin: number) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    const pageHeight = doc.internal.pageSize.getHeight()
    doc.setFontSize(8)
    doc.setTextColor(150, 148, 144)
    doc.text(`Generated ${new Date().toLocaleString('en-US')}`, margin, pageHeight - 24)
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, pageHeight - 24, { align: 'right' })
  }
}


// ──────────────────────────────────────────────
// 9c. DAILY REPORT (PDF)
// Builds a real A4 PDF file straight in the browser and downloads it —
// no print dialog, no "Save as PDF" step. Uses jsPDF + autoTable.
// ──────────────────────────────────────────────
function exportPDF() {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' }) // A4, points as the unit
  const margin = 40
  let y = 50

  // ── HEADER ──
  y = drawReportHeader(doc, 'Today Business Report', selectedDateLabel.value)

  // ── SUMMARY (label on the left, value on the right) ──
  const summaryPairs: [string, string][] = [
    ['Sales', fmtRs(todaysSalesTotal.value)],
    ['Cost of Goods', fmtRs(todaysCostTotal.value)],
    [`Card Fee (${CARD_FEE_LABEL} of card sales)`, `- ${fmtRs(todaysCardFee.value)}`],
    ['Profit (after cost & card fee)', fmtRs(todaysProfit.value)],
    ['Avg Profit Margin', `${todaysMargin.value.toFixed(1)}%`],
    ['Sales Count', String(todaysSalesCount.value)],
    ['Cancelled Sales (not counted)', `${cancelledTransactions.value.length} (${fmtRs(cancelledTotal.value)})`],
    ['Later Pay Orders', String(laterPayCount.value)],
    ['Later Pay Owed', fmtRs(laterPayTotal.value)],
    ['Returned Items', String(returnedCount.value)],
    ['Returned Amount', fmtRs(returnedAmount.value)],
    ['Loans Given', `${loansCount.value} (${fmtRs(loansAmount.value)})`],
  ]
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: 'grid',
    body: summaryPairs,
    styles: { ...gridStyles, fontSize: 10, cellPadding: 7 },
    columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right' } },
  })
  y = (doc as any).lastAutoTable.finalY + 28

  // ── SALES BY CATEGORY — how many of each kind of item sold today ──
  // Always covers ALL of the day's completed sales (the payment filter doesn't change it)
  y = drawCategorySections(doc, y, margin, groupByCategory(itemRows.value, new Set(saleTransactions.value.map(t => t.id))))

  // ── TRANSACTIONS — each one is a small table, its items in a table right under it ──
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(20, 20, 18)
  doc.text('Transactions', margin, y)
  y += 12

  const pageH = doc.internal.pageSize.getHeight()
  filteredTransactions.value.forEach((t, idx) => {
    const items = itemRows.value.filter(row => row.transaction_id === t.id)

    // Don't leave a transaction heading stranded at the bottom of a page
    if (y > pageH - 140) {
      doc.addPage()
      y = 50
    }

    // 1) The transaction
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      theme: 'grid',
      head: [['#', 'Time', 'Invoice No', 'Cashier', 'Payment', 'Status', 'Items', 'Total']],
      body: [[
        String(idx + 1),
        fmtTime(t.created_at),
        t.invoice_no,
        t.users?.full_name || '—',
        t.payment_method === 'later_pay' && t.customer_id && customerById.value.get(t.customer_id)
          ? `${paymentLabel(t.payment_method)} - ${customerById.value.get(t.customer_id)!.name}`
          : paymentLabel(t.payment_method),
        t.status === 'void' ? 'CANCELLED' : t.status,
        String(itemCountByTxn.value.get(t.id) ?? 0),
        fmtRs(t.total),
      ]],
      styles: gridStyles,
      headStyles: gridHead,
      bodyStyles: { fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 24 }, 6: { halign: 'center' }, 7: { halign: 'right' } },
    })
    y = (doc as any).lastAutoTable.finalY

    // 2) Its items, directly underneath
    if (items.length > 0) {
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        theme: 'grid',
        head: [['', 'Product', 'SKU', 'Price Mode', 'Qty', 'Unit Price', 'Line Total']],
        body: items.map((row, i) => [
          String(i + 1),
          row.product_name,
          row.sku || '—',
          row.discount_label || '—',
          String(row.qty),
          fmtNum(row.unit_price),
          fmtNum(row.line_total),
        ]),
        styles: { ...gridStyles, fontSize: 8.5, cellPadding: 5 },
        headStyles: gridHead,
        columnStyles: { 0: { cellWidth: 24 }, 4: { halign: 'center' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
      })
      y = (doc as any).lastAutoTable.finalY
    }
    y += 24
  })

  addReportFooters(doc, margin)

  doc.save(`today-business-${selectedDate.value}.pdf`)
  showToastMsg('PDF exported')
}


// ──────────────────────────────────────────────
// 9d. MONTHLY REPORT
// Pick any month that has sales data → downloads one PDF for the whole month:
// summary, day-by-day table, payment methods and top-selling products.
// ──────────────────────────────────────────────
const monthBusy = ref(false)

// The month comes from the calendar at the top: pick any day in September
// and the button builds the September report.
const selectedMonthKey   = computed(() => selectedDate.value.slice(0, 7)) // 'YYYY-MM'
const selectedMonthDate  = computed(() => new Date(selectedDate.value + 'T00:00:00'))
const selectedMonthLabel = computed(() => selectedMonthDate.value.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }))
const selectedMonthShort = computed(() => selectedMonthDate.value.toLocaleDateString('en-US', { month: 'short' }))

// Supabase returns at most 1000 rows per request — a month can have more,
// so this keeps asking for the next 1000 until there is nothing left.
async function fetchAllRows(makeQuery: (from: number, to: number) => any): Promise<any[]> {
  const pageSize = 1000
  const all: any[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    all.push(...(data ?? []))
    if (!data || data.length < pageSize) break
  }
  return all
}

async function exportMonthlyPDF() {
  const monthKey = selectedMonthKey.value
  const monthLabel = selectedMonthLabel.value
  monthBusy.value = true
  showToastMsg(`Building ${monthLabel} report…`)
  try {
    const [y, m] = monthKey.split('-').map(Number)
    const start = new Date(y, m - 1, 1, 0, 0, 0, 0).toISOString()
    const end   = new Date(y, m, 0, 23, 59, 59, 999).toISOString()   // day 0 of next month = last day of this one

    // 1) every non-void transaction in the month
    const monthTxns: Transaction[] = await fetchAllRows((from, to) =>
      supabase.from('transactions').select('*, users(full_name)')
        .gte('created_at', start).lte('created_at', end).neq('status', 'void')
        .order('created_at', { ascending: true }).order('id').range(from, to)
    )
    const sales = monthTxns.filter(t => t.status === 'completed')

    // 2) their items, fetched 100 bills at a time (keeps the request small)
    const ids = sales.map(t => t.id)
    const monthItems: TransactionItemRow[] = []
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100)
      const rows = await fetchAllRows((from, to) =>
        supabase.from('transaction_items').select('*, products(cost_price, image_url, sub_category)')
          .in('transaction_id', chunk).order('id').range(from, to)
      )
      monthItems.push(...(rows as TransactionItemRow[]))
    }

    // 3) work out the numbers (same rules as the daily report)
    const costOfTxn = new Map<string, number>()
    for (const row of monthItems) {
      costOfTxn.set(row.transaction_id, (costOfTxn.get(row.transaction_id) ?? 0) + (row.products?.cost_price ?? 0) * row.qty)
    }
    const totalSales = sales.reduce((s, t) => s + t.total, 0)
    const totalCost  = sales.reduce((s, t) => s + (costOfTxn.get(t.id) ?? 0), 0)
    const totalFee   = sales.reduce((s, t) => s + cardFeeOf(t), 0)
    const totalProfit = totalSales - totalCost - totalFee
    const laterPay   = sales.filter(t => t.payment_method === 'later_pay')

    // day-by-day
    const days = new Map<string, { count: number; sales: number; cost: number; fee: number }>()
    for (const t of sales) {
      const key = toDateStr(new Date(t.created_at))
      const d = days.get(key) ?? { count: 0, sales: 0, cost: 0, fee: 0 }
      d.count += 1; d.sales += t.total; d.cost += costOfTxn.get(t.id) ?? 0; d.fee += cardFeeOf(t)
      days.set(key, d)
    }

    // by payment method
    const methods = new Map<string, { count: number; total: number }>()
    for (const t of sales) {
      const d = methods.get(t.payment_method) ?? { count: 0, total: 0 }
      d.count += 1; d.total += t.total
      methods.set(t.payment_method, d)
    }

    // top products by quantity
    const products = new Map<string, { qty: number; total: number }>()
    for (const row of monthItems) {
      const d = products.get(row.product_name) ?? { qty: 0, total: 0 }
      d.qty += row.qty; d.total += row.line_total
      products.set(row.product_name, d)
    }
    const topProducts = [...products.entries()].sort((a, b) => b[1].qty - a[1].qty).slice(0, 10)

    // 4) draw the PDF
    const doc = new jsPDF({ unit: 'pt', format: 'a4' })
    const margin = 40
    let y0 = drawReportHeader(doc, 'Monthly Business Report', monthLabel)

    const heading = (text: string) => {
      if (y0 > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y0 = 50 }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(20, 20, 18)
      doc.text(text, margin, y0)
      y0 += 10
    }
    const table = (opts: Record<string, any>) => {
      autoTable(doc, {
        startY: y0, margin: { left: margin, right: margin }, theme: 'grid',
        styles: gridStyles, headStyles: gridHead, ...opts,
      })
      y0 = (doc as any).lastAutoTable.finalY + 26
    }

    table({
      body: [
        ['Sales', fmtRs(totalSales)],
        ['Cost of Goods', fmtRs(totalCost)],
        [`Card Fee (${CARD_FEE_LABEL} of card sales)`, `- ${fmtRs(totalFee)}`],
        ['Profit (after cost & card fee)', fmtRs(totalProfit)],
        ['Avg Profit Margin', `${marginPct(totalProfit, totalSales).toFixed(1)}%`],
        ['Sales Count', String(sales.length)],
        ['Later Pay Orders', String(laterPay.length)],
        ['Later Pay Owed', fmtRs(laterPay.reduce((s, t) => s + t.total, 0))],
      ],
      styles: { ...gridStyles, fontSize: 10, cellPadding: 7 },
      columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right' } },
    })

    heading('Day by day')
    table({
      head: [['Date', 'Sales', 'Sales (Rs.)', 'Cost (Rs.)', 'Card Fee (Rs.)', 'Profit (Rs.)', 'Margin']],
      body: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, d]) => [
        new Date(key + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }),
        String(d.count), fmtNum(d.sales), fmtNum(d.cost), fmtNum(d.fee), fmtNum(d.sales - d.cost - d.fee),
        `${marginPct(d.sales - d.cost - d.fee, d.sales).toFixed(1)}%`,
      ]),
      foot: [['Total', String(sales.length), fmtNum(totalSales), fmtNum(totalCost), fmtNum(totalFee), fmtNum(totalProfit),
        `${marginPct(totalProfit, totalSales).toFixed(1)}%`]],
      footStyles: { fillColor: [247, 245, 242], textColor: [20, 20, 18], fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
    })

    heading('Payment methods')
    table({
      head: [['Method', 'Sales', 'Total (Rs.)']],
      body: [...methods.entries()].map(([method, d]) => [paymentLabel(method), String(d.count), fmtNum(d.total)]),
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' } },
    })

    // Sales by category + the items sold inside each category
    y0 = drawCategorySections(doc, y0, margin, groupByCategory(monthItems, new Set(sales.map(t => t.id))))

    if (topProducts.length > 0) {
      heading('Top selling products')
      table({
        head: [['#', 'Product', 'Qty sold', 'Total (Rs.)']],
        body: topProducts.map(([name, d], i) => [String(i + 1), name, String(d.qty), fmtNum(d.total)]),
        columnStyles: { 0: { cellWidth: 24 }, 2: { halign: 'center' }, 3: { halign: 'right' } },
      })
    }

    addReportFooters(doc, margin)
    doc.save(`monthly-business-${monthKey}.pdf`)
    showToastMsg('Monthly PDF exported')
  } catch (e) {
    console.error('Monthly report error:', e)
    showToastMsg('⚠️ Could not build the monthly report')
  } finally {
    monthBusy.value = false
  }
}


// ──────────────────────────────────────────────
// 10. TOAST
// ──────────────────────────────────────────────
const toastMsg     = ref('')
const toastVisible = ref(false)

function showToastMsg(msg: string) {
  toastMsg.value     = msg
  toastVisible.value = true
  setTimeout(() => { toastVisible.value = false }, 2600)
}


// ──────────────────────────────────────────────
// 11. INIT
// ──────────────────────────────────────────────
onMounted(() => {
  fetchReportData()
  fetchReturns()
  fetchLoans()
  fetchAvailableDates()
})
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
        <div class="page-header-top">
          <div>
            <h1 class="page-title">{{ isViewingToday ? 'Today Business' : 'Business Report' }}</h1>
            <p class="page-sub">{{ isViewingToday ? 'Live snapshot of today\'s sales' : 'Archived snapshot' }}</p>
          </div>

          <!-- ── DATE PICKER ── -->
          <div class="date-picker">
            <button class="date-picker-btn" @click="showCalendar ? closeCalendar() : openCalendar()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              <span>{{ selectedDateLabel }}</span>
              <svg class="date-picker-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>

            <!-- Backdrop closes the dropdown on outside click -->
            <div v-if="showCalendar" class="calendar-backdrop" @click="closeCalendar"></div>

            <div v-if="showCalendar" class="calendar-pop">
              <div class="calendar-nav">
                <button class="calendar-nav-btn" :disabled="!canGoPrevMonth" @click="prevMonth">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                <span class="calendar-month-label">{{ calendarMonthLabel }}</span>
                <button class="calendar-nav-btn" :disabled="!canGoNextMonth" @click="nextMonth">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              </div>

              <div class="calendar-weekdays">
                <span v-for="d in ['S','M','T','W','T','F','S']" :key="d">{{ d }}</span>
              </div>

              <div class="calendar-grid">
                <button
                  v-for="(cell, idx) in calendarCells"
                  :key="idx"
                  class="calendar-cell"
                  :class="{
                    empty: !cell.day,
                    disabled: cell.day && (!cell.hasData || !cell.inRange),
                    selected: cell.dateStr === selectedDate,
                    today: cell.dateStr === todayStr,
                  }"
                  :disabled="!cell.day || !cell.hasData || !cell.inRange"
                  @click="pickDate(cell)"
                >{{ cell.day || '' }}</button>
              </div>

              <div class="calendar-legend">
                <span class="legend-dot has-data"></span> Has sales data
                <span class="legend-dot no-data"></span> No data
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ── STATS BAR (4 summary cards, Later Pay shown as an info card too) ── -->
      <div class="stats-bar">
        <!-- Sales -->
        <div class="stat-card">
          <div class="stat-label">Sales</div>
          <div class="stat-value">{{ fmtRs(todaysSalesTotal) }}</div>
          <div class="stat-sub">cash, card, bank &amp; later pay</div>
        </div>
        <!-- Cost of Goods Sold -->
        <div class="stat-card">
          <div class="stat-label">Cost of Goods</div>
          <div class="stat-value">{{ fmtRs(todaysCostTotal) }}</div>
          <div class="stat-sub">cost price of items sold</div>
        </div>
        <!-- Card Fee — 2.5% the card machine keeps on card payments; comes off the profit -->
        <div class="stat-card fee-card">
          <div class="stat-label">Card Fee <span class="fee-pill">{{ CARD_FEE_LABEL }}</span></div>
          <div class="stat-value fee">− {{ fmtRs(todaysCardFee) }}</div>
          <div class="stat-sub">{{ todaysCardCount }} card sale{{ todaysCardCount === 1 ? '' : 's' }} · deducted from profit</div>
        </div>
        <!-- Profit -->
        <div class="stat-card">
          <div class="stat-label">Profit</div>
          <div class="stat-value" :class="todaysProfit < 0 ? 'low' : 'profit'">{{ fmtRs(todaysProfit) }}</div>
          <div class="stat-sub">sales − cost − card fee</div>
        </div>
        <!-- Average Profit Margin -->
        <div class="stat-card">
          <div class="stat-label">Avg Profit Margin</div>
          <div class="stat-value" :class="todaysMargin < 0 ? 'low' : 'profit'">{{ todaysMargin.toFixed(1) }}%</div>
          <div class="stat-sub">profit ÷ sales</div>
        </div>
        <!-- Sales Count -->
        <div class="stat-card">
          <div class="stat-label">Sales Count</div>
          <div class="stat-value">{{ todaysSalesCount }}</div>
          <div class="stat-sub">completed sales today</div>
        </div>
        <!-- Later Pay — informational: how many of the sales above were sold
             on credit, and how much of that Rs. is still uncollected. -->
        <div class="stat-card later-card">
          <div class="stat-label">Later Pay</div>
          <div class="stat-value">{{ laterPayCount }} <span class="stat-value-sub">order{{ laterPayCount === 1 ? '' : 's' }}</span></div>
          <div class="stat-sub">{{ fmtRs(laterPayTotal) }} sold on credit · already in Sales above</div>
        </div>
        <!-- Cancelled sales — informational: mistakes that were cancelled, not counted anywhere above -->
        <div v-if="cancelledTransactions.length > 0" class="stat-card void-card">
          <div class="stat-label">Cancelled</div>
          <div class="stat-value">{{ cancelledTransactions.length }} <span class="stat-value-sub">sale{{ cancelledTransactions.length === 1 ? '' : 's' }}</span></div>
          <div class="stat-sub">{{ fmtRs(cancelledTotal) }} · not counted in Sales</div>
        </div>
        <!-- Loans Given — cash lent to customers (informational, not a sale) -->
        <div class="stat-card loan-card">
          <div class="stat-label">Loans Given</div>
          <div class="stat-value">{{ loansCount }} <span class="stat-value-sub">loan{{ loansCount === 1 ? '' : 's' }}</span></div>
          <div class="stat-sub">{{ fmtRs(loansAmount) }} lent {{ isViewingToday ? 'today' : 'this day' }} · not in Sales</div>
        </div>
        <!-- Returned items — units brought back this day and their value -->
        <div class="stat-card return-card">
          <div class="stat-label">Returned Items</div>
          <div class="stat-value">{{ returnedCount }} <span class="stat-value-sub">item{{ returnedCount === 1 ? '' : 's' }}</span></div>
          <div class="stat-sub">{{ fmtRs(returnedAmount) }} returned {{ isViewingToday ? 'today' : 'this day' }}</div>
        </div>
      </div>

      <!-- ── TOOLBAR (payment filter + refresh) ── -->
      <div class="toolbar">
        <!-- Payment method filter -->
        <div class="select-wrap">
          <select v-model="paymentFilter">
            <option value="all_with_later">All Payments (with pay later)</option>
            <option value="all_no_later">All Payments (without pay later)</option>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="bank">Bank</option>
            <option value="later_pay">Later Pay</option>
          </select>
        </div>

        <!-- Right-side buttons -->
        <div class="toolbar-right">
          <!-- View switcher: Bills = normal bill-by-bill list, Items = one row per product sold -->
          <div class="view-seg" role="tablist" aria-label="Sales view">
            <button
              class="view-seg-btn" :class="{ active: !itemView }"
              role="tab" :aria-selected="!itemView" @click="itemView = false"
              title="One row per bill"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="14" y2="17"/></svg>
              Bills
            </button>
            <button
              class="view-seg-btn" :class="{ active: itemView }"
              role="tab" :aria-selected="itemView" @click="itemView = true"
              title="One row per item sold"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/></svg>
              Items
            </button>
          </div>
          <button class="btn btn-outline" @click="refreshData" title="Refresh data">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.08-6.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Refresh
          </button>
          <button class="btn btn-primary" @click="exportPDF" title="Download today's report as PDF">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z"/></svg>
            Daily Report
          </button>
          <!-- Monthly report: always for the month of the date picked in the calendar above -->
          <button class="btn btn-outline" :disabled="monthBusy" @click="exportMonthlyPDF" :title="`Download the full ${selectedMonthLabel} report`">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            {{ monthBusy ? 'Building…' : `Monthly Report · ${selectedMonthShort}` }}
          </button>
        </div>
      </div>

      <!-- ══════════════════════════════════════ -->
      <!--          SALE-BY-SALE TABLE           -->
      <!-- ══════════════════════════════════════ -->
      <div class="table-wrap">

        <!-- Loading / Error states -->
        <div v-if="loading" class="state-msg">Loading today's business…</div>
        <div v-else-if="fetchError" class="state-error">{{ fetchError }}</div>

        <!-- ── ITEMS VIEW: by category (default) or item by item ── -->
        <template v-else-if="itemView">
          <!-- Small switch: By category | By item -->
          <div class="item-subbar">
            <div class="view-seg view-seg-sm" role="tablist" aria-label="Group items">
              <button class="view-seg-btn" :class="{ active: itemGroup === 'category' }" role="tab" :aria-selected="itemGroup === 'category'" @click="itemGroup = 'category'">By category</button>
              <button class="view-seg-btn" :class="{ active: itemGroup === 'item' }" role="tab" :aria-selected="itemGroup === 'item'" @click="itemGroup = 'item'">By item</button>
            </div>
            <span class="item-subbar-hint">{{ categoryGroups.length }} categor{{ categoryGroups.length === 1 ? 'y' : 'ies' }} · {{ soldItems.length }} item{{ soldItems.length === 1 ? '' : 's' }}</span>
          </div>

          <table>
            <thead v-if="itemGroup === 'category'">
              <tr>
                <th style="width:30px"></th>
                <th>#</th>
                <th colspan="3">Category</th>
                <th class="center">Qty Sold</th>
                <th class="center">Items</th>
                <th style="text-align:right; padding-right:20px;">Total (Rs.)</th>
              </tr>
            </thead>
            <thead v-else>
              <tr>
                <th style="width:30px"></th>
                <th>#</th>
                <th>Image</th>
                <th>Item</th>
                <th>SKU</th>
                <th class="center">Qty Sold</th>
                <th class="center">Bills</th>
                <th style="text-align:right; padding-right:20px;">Total (Rs.)</th>
              </tr>
            </thead>

            <!-- ── BY CATEGORY: one simple row per category, click to see its items ── -->
            <tbody v-if="itemGroup === 'category'">
              <tr v-if="categoryGroups.length === 0">
                <td colspan="8" class="empty-row">No items sold</td>
              </tr>
              <template v-for="(cat, index) in categoryGroups" :key="cat.name">
                <tr class="txn-row" :style="{ animationDelay: (index * 0.02) + 's' }" @click="toggleCategory(cat.name)">
                  <td class="expand-cell">
                    <svg class="expand-arrow" :class="{ open: expandedCategories.has(cat.name) }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                  </td>
                  <td>{{ index + 1 }}</td>
                  <td colspan="3" class="name-cell">{{ cat.name }}</td>
                  <td class="center-cell item-qty">{{ cat.qty }}</td>
                  <td class="center-cell date-cell">{{ cat.items.length }}</td>
                  <td class="price-cell" style="text-align:right; padding-right:20px;">{{ fmtRs(cat.total) }}</td>
                </tr>

                <!-- Items of this category; click an item to see how it was priced -->
                <tr v-if="expandedCategories.has(cat.name)" class="expand-panel-row">
                  <td colspan="8">
                    <div class="cat-items">
                      <template v-for="item in cat.items" :key="item.key">
                        <div class="cat-item" @click="toggleItem(item.key)">
                          <div
                            class="item-img-wrap" :class="{ zoomable: !!item.image_url }"
                            @click.stop
                            @mouseenter="(e) => showImgPreview(e, item.image_url)"
                            @mouseleave="hideImgPreview"
                          >
                            <img v-if="item.image_url" :src="item.image_url" class="item-thumb item-thumb-sm" :alt="item.name" />
                            <div v-else class="item-thumb item-thumb-sm item-thumb-empty">
                              <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" width="16" height="16"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                            </div>
                          </div>
                          <span class="cat-item-name">{{ item.name }}</span>
                          <span class="cat-item-sku">{{ item.sku || '—' }}</span>
                          <span class="cat-item-qty">{{ item.qty }}</span>
                          <span class="cat-item-total">{{ fmtRs(item.total) }}</span>
                        </div>
                        <div v-if="expandedItemKeys.has(item.key)" class="item-breakdown nested">
                      <div class="item-breakdown-head">
                        <span class="item-breakdown-title">How {{ item.name }} was sold</span>
                        <span v-if="item.listPrice" class="item-breakdown-list">List price {{ fmtRs(item.listPrice) }}</span>
                      </div>
                      <div v-for="line in item.lines" :key="line.id" class="item-line">
                        <span class="item-line-time">{{ fmtTime(line.time) }}</span>
                        <span class="item-line-invoice">{{ line.invoice_no }}</span>
                        <span class="discount-badge" :class="discountLabelClass(line.label)">{{ line.label || '—' }}</span>
                        <span class="item-line-calc">{{ line.qty }} × {{ fmtRs(line.unitPrice) }}</span>
                        <span class="item-line-total">{{ fmtRs(line.total) }}</span>
                      </div>
                    </div>
                      </template>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>

            <!-- ── BY ITEM: flat list, one row per item ── -->
            <tbody v-else>
              <tr v-if="soldItems.length === 0">
                <td colspan="8" class="empty-row">No items sold</td>
              </tr>
              <template v-for="(item, index) in soldItems" :key="item.key">
                <tr class="txn-row" :style="{ animationDelay: (index * 0.02) + 's' }" @click="toggleItem(item.key)">
                  <td class="expand-cell">
                    <svg class="expand-arrow" :class="{ open: expandedItemKeys.has(item.key) }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                  </td>
                  <td>{{ index + 1 }}</td>
                  <td class="item-img-cell">
                    <!-- Hover the picture to see it bigger -->
                    <div
                      class="item-img-wrap" :class="{ zoomable: !!item.image_url }"
                      @mouseenter="(e) => showImgPreview(e, item.image_url)"
                      @mouseleave="hideImgPreview"
                    >
                      <img v-if="item.image_url" :src="item.image_url" class="item-thumb" :alt="item.name" />
                      <div v-else class="item-thumb item-thumb-empty">
                        <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" width="18" height="18"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                      </div>
                    </div>
                  </td>
                  <td class="name-cell">{{ item.name }}</td>
                  <td class="sku-cell">{{ item.sku || '—' }}</td>
                  <td class="center-cell item-qty">{{ item.qty }}</td>
                  <td class="center-cell date-cell">{{ item.billCount }}</td>
                  <td class="price-cell" style="text-align:right; padding-right:20px;">{{ fmtRs(item.total) }}</td>
                </tr>

                <!-- ── PRICE BREAKDOWN: every sale of this item and how it was priced ── -->
                <tr v-if="expandedItemKeys.has(item.key)" class="expand-panel-row">
                  <td colspan="8">
                    <div class="item-breakdown">
                      <div class="item-breakdown-head">
                        <span class="item-breakdown-title">How {{ item.name }} was sold</span>
                        <span v-if="item.listPrice" class="item-breakdown-list">List price {{ fmtRs(item.listPrice) }}</span>
                      </div>
                      <div v-for="line in item.lines" :key="line.id" class="item-line">
                        <span class="item-line-time">{{ fmtTime(line.time) }}</span>
                        <span class="item-line-invoice">{{ line.invoice_no }}</span>
                        <span class="discount-badge" :class="discountLabelClass(line.label)">{{ line.label || '—' }}</span>
                        <span class="item-line-calc">{{ line.qty }} × {{ fmtRs(line.unitPrice) }}</span>
                        <span class="item-line-total">{{ fmtRs(line.total) }}</span>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>

            <!-- Totals: items added up, then bill discounts, then the real sales figure -->
            <tfoot v-if="soldItems.length > 0">
              <tr class="foot-row">
                <td colspan="5" class="foot-label">Items total · {{ soldItems.length }} different item{{ soldItems.length === 1 ? '' : 's' }}</td>
                <td class="center-cell item-qty">{{ soldItemsQty }}</td>
                <td></td>
                <td class="price-cell" style="text-align:right; padding-right:20px;">{{ fmtRs(soldItemsTotal) }}</td>
              </tr>
              <tr v-if="soldDiscounts > 0" class="foot-row">
                <td colspan="7" class="foot-label">Bill discounts</td>
                <td class="price-cell foot-minus" style="text-align:right; padding-right:20px;">− {{ fmtRs(soldDiscounts) }}</td>
              </tr>
              <tr class="foot-row foot-grand">
                <td colspan="7" class="foot-label">Sales total</td>
                <td class="price-cell" style="text-align:right; padding-right:20px;">{{ fmtRs(soldSalesTotal) }}</td>
              </tr>
            </tfoot>
          </table>
        </template>

        <!-- ── NORMAL VIEW: one row per bill ── -->
        <template v-else>
          <table>
            <thead>
              <tr>
                <th style="width:30px"></th>
                <th>#</th>
                <th>Time</th>
                <th>Invoice No</th>
                <th>Cashier</th>
                <th class="center">Items</th>
                <th>Payment</th>
                <th>Status</th>
                <th class="center">Printed</th>
                <th class="center">Bill Discount</th>
                <th style="text-align:right; padding-right:20px;">Total (Rs.)</th>
              </tr>
            </thead>

            <tbody>
              <tr v-if="filteredTransactions.length === 0">
                <td colspan="11" class="empty-row">No sales yet today</td>
              </tr>

              <template v-for="(t, index) in filteredTransactions" :key="t.id">
                <!-- Click anywhere on the row to expand/collapse its items -->
                <tr
                  class="txn-row"
                  :class="{ 'txn-void': t.status === 'void' }"
                  :style="{ animationDelay: (index * 0.03) + 's' }"
                  @click="toggleExpand(t.id)"
                >
                  <td class="expand-cell">
                    <svg class="expand-arrow" :class="{ open: expandedIds.has(t.id) }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                  </td>
                  <td>{{ index + 1 }}</td>
                  <td class="date-cell">{{ fmtTime(t.created_at) }}</td>
                  <td class="sku-cell">{{ t.invoice_no }}</td>
                  <td class="name-cell">{{ t.users?.full_name || '—' }}</td>
                  <td class="center-cell">{{ itemCountByTxn.get(t.id) ?? 0 }}</td>
                  <td>
                    <span class="pay-badge" :class="t.payment_method">{{ paymentLabel(t.payment_method) }}</span>
                  </td>
                  <td>
                    <span class="status-badge" :class="t.status">{{ t.status === 'void' ? 'cancelled' : t.status }}</span>
                  </td>
                  <td class="center-cell">
                    <span class="printed-badge" :class="{ yes: t.printed_receipt }">
                      {{ t.printed_receipt ? 'Printed' : 'Not printed' }}
                    </span>
                  </td>
                  <td class="center-cell">
                    <span v-if="t.discount_percent > 0" class="bill-discount-badge">{{ t.discount_percent }}% off</span>
                    <span v-else class="no-discount">No discount</span>
                  </td>
                  <td class="price-cell" style="text-align:right; padding-right:20px;">{{ fmtRs(t.total) }}</td>
                </tr>

                <!-- ── EXPANDED PANEL: every item in this bill ── -->
                <tr v-if="expandedIds.has(t.id)" class="expand-panel-row">
                  <td colspan="11">
                    <div class="expand-panel">
                      <div
                        v-for="item in (itemsByTxn.get(t.id) ?? [])"
                        :key="item.id"
                        class="expand-item"
                        :class="{ 'expand-item-returned': item.qty === 0 }"
                      >
                        <img
                          v-if="item.products?.image_url"
                          :src="item.products.image_url"
                          class="expand-item-img"
                        />
                        <div v-else class="expand-item-img expand-item-img-placeholder">
                          <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" width="16" height="16"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9l4-4 4 4 4-4 4 4"/><path d="M3 15l4 4 4-4 4 4 4-4"/></svg>
                        </div>
                        <div class="expand-item-info">
                          <div class="expand-item-name">{{ item.product_name }}</div>
                          <div class="expand-item-sku">{{ item.sku || '—' }}</div>
                        </div>
                        <span v-if="item.qty === 0" class="returned-badge" title="This item was returned — its cost has been removed from the total">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                          Returned
                        </span>
                        <span v-else class="discount-badge" :class="discountLabelClass(item.discount_label)">{{ item.discount_label || '—' }}</span>
                        <div class="expand-item-qty">x{{ item.qty }}</div>
                        <div class="expand-item-price">{{ fmtRs(item.unit_price) }}</div>
                        <div class="expand-item-total">{{ fmtRs(item.line_total) }}</div>
                      </div>
                      <div v-if="(itemsByTxn.get(t.id) ?? []).length === 0" class="expand-empty">No item details found</div>

                      <!-- Later Pay: who took the goods on credit -->
                      <div v-if="t.payment_method === 'later_pay'" class="taken-by">
                        <div class="taken-by-title">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                          Taken on Later Pay by
                        </div>
                        <template v-if="t.customer_id && customerById.get(t.customer_id)">
                          <div class="taken-by-name">{{ customerById.get(t.customer_id)!.name }}</div>
                          <div class="taken-by-row"><span>Phone</span><strong>{{ customerById.get(t.customer_id)!.phone || '—' }}</strong></div>
                          <div class="taken-by-row"><span>ID number</span><strong>{{ customerById.get(t.customer_id)!.id_number || '—' }}</strong></div>
                          <div class="taken-by-row"><span>Address</span><strong>{{ customerById.get(t.customer_id)!.address || '—' }}</strong></div>
                          <button class="btn-view-customer" @click.stop="goToPayLaterCustomer(t.customer_id!)">
                            View in Pay Later
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                          </button>
                        </template>
                        <div v-else class="taken-by-missing">Customer not found for this sale</div>
                      </div>

                      <!-- Cancelled sale: who cancelled it, when, and why -->
                      <div v-if="t.status === 'void'" class="void-info">
                        <div class="void-info-title">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"/></svg>
                          This sale was cancelled
                        </div>
                        <div class="void-info-row"><span>Cancelled by</span><strong>{{ t.voided_by_name || '—' }}</strong></div>
                        <div class="void-info-row"><span>When</span><strong>{{ t.voided_at ? new Date(t.voided_at).toLocaleString('en-GB') : '—' }}</strong></div>
                        <div class="void-info-row"><span>Reason</span><strong>{{ t.void_reason || '—' }}</strong></div>
                        <div class="void-info-note">Not counted in Sales, Cost or Profit. Stock was returned to the shelf.</div>
                      </div>

                      <!-- Profit for this invoice: sale total − cost of its items -->
                      <div v-if="t.status !== 'void'" class="bill-profit">
                        <div class="bp-cell">
                          <span class="bp-label">Sale Total</span>
                          <span class="bp-value">{{ fmtRs(t.total) }}</span>
                        </div>
                        <div class="bp-cell">
                          <span class="bp-label">Cost of Items</span>
                          <span class="bp-value">{{ fmtRs(billFigures(t).cost) }}</span>
                        </div>
                        <div class="bp-cell" v-if="billFigures(t).cardFee > 0">
                          <span class="bp-label">Card Fee {{ CARD_FEE_LABEL }}</span>
                          <span class="bp-value bp-fee">− {{ fmtRs(billFigures(t).cardFee) }}</span>
                        </div>
                        <div class="bp-cell">
                          <span class="bp-label">Profit</span>
                          <span class="bp-value" :class="billFigures(t).profit < 0 ? 'bp-loss' : 'bp-gain'">{{ fmtRs(billFigures(t).profit) }}</span>
                        </div>
                        <div class="bp-cell">
                          <span class="bp-label">Margin</span>
                          <span class="bp-value" :class="billFigures(t).profit < 0 ? 'bp-loss' : 'bp-gain'">{{ billFigures(t).margin.toFixed(1) }}%</span>
                        </div>
                      </div>

                      <!-- Reprint this bill — sits under its item list -->
                      <div v-if="t.status !== 'void'" class="expand-print-row">
                        <button
                          class="btn-reprint"
                          :disabled="printingId === t.id"
                          @click="reprintBill(t)"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                          {{ printingId === t.id ? 'Printing…' : 'Print' }}
                        </button>
                        <!-- Cancel sale: admins and managers only -->
                        <button v-if="auth.isAdmin || auth.isManager" class="btn-cancel-sale" @click="openVoidModal(t)">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"/></svg>
                          Cancel sale
                        </button>
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

    <!-- ── TOAST ── -->
    <!-- ── CANCEL SALE POP-UP: a reason is required ── -->
    <div v-if="voidTarget" class="void-overlay" @click.self="closeVoidModal">
      <div class="void-modal" role="dialog" aria-modal="true">
        <div class="void-modal-title">Cancel this sale?</div>
        <div class="void-modal-sub">
          {{ voidTarget.invoice_no }} · {{ fmtRs(voidTarget.total) }}<br />
          It will stay in the list as <strong>Cancelled</strong> (with your name and the reason), it will no longer count in
          Sales or Profit, and the items go back into stock.
        </div>
        <label class="void-label" for="void-reason">Why is it being cancelled? *</label>
        <textarea
          id="void-reason"
          v-model="voidReason"
          class="void-textarea"
          rows="3"
          maxlength="300"
          placeholder="e.g. Added to the wrong bill by mistake"
          :disabled="voidBusy"
        ></textarea>
        <div v-if="voidError" class="void-error">{{ voidError }}</div>
        <div class="void-actions">
          <button class="btn btn-outline" :disabled="voidBusy" @click="closeVoidModal">Keep sale</button>
          <button class="btn-void-confirm" :disabled="voidBusy || voidReason.trim().length < 3" @click="confirmVoid">
            {{ voidBusy ? 'Cancelling…' : 'Cancel sale' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── ITEM PICTURE PREVIEW (hover pop-up, same as Product List) ── -->
    <Transition name="img-pop">
      <div v-if="previewImg" class="img-preview-fixed" :style="{ top: previewY + 'px', left: previewX + 'px' }">
        <img :src="previewImg" class="img-preview-big" />
      </div>
    </Transition>

    <Toast :message="toastMsg" :show="toastVisible" />

  </div>
</template>


<!-- ════════════════════════════════════════════ -->
<!--                SCOPED STYLES               -->
<!--   (copied from ProductListView.vue so both  -->
<!--    pages look and feel identical)           -->
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
  --amber:     #fbbf24;
  --amber-bg:  rgba(217,119,6,.18);
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
  --amber:     #b45309;
  --amber-bg:  #fef3c7;
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

/* ── SCROLLBAR ── */
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
.page-header-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.page-title  { font-size: 26px; font-weight: 600; letter-spacing: -.02em; color: var(--text); }
.page-sub    { font-size: 13px; color: var(--text-sub); margin-top: 2px; }


/* ══════════════════════════════════
   DATE PICKER
   ══════════════════════════════════ */
.date-picker { position: relative; }

.date-picker-btn {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 14px; border-radius: 9px;
  background: var(--surface); border: 1px solid var(--border);
  color: var(--text); font-family: 'DM Sans', sans-serif;
  font-size: 13px; font-weight: 500; cursor: pointer;
  transition: background .15s, border-color .15s;
}
.date-picker-btn:hover { background: var(--surface2); }
.date-picker-btn svg { flex-shrink: 0; color: var(--text-sub); }
.date-picker-chevron { margin-left: 2px; }

.calendar-backdrop { position: fixed; inset: 0; z-index: 40; }

.calendar-pop {
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 41;
  width: 280px; padding: 14px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
  box-shadow: var(--shadow-lg);
  animation: popIn .15s ease both;
}
@keyframes popIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }

.calendar-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.calendar-month-label { font-size: 13px; font-weight: 600; color: var(--text); }
.calendar-nav-btn {
  width: 26px; height: 26px; border-radius: 7px; border: 1px solid var(--border);
  background: var(--bg); color: var(--text); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s;
}
.calendar-nav-btn:hover:not(:disabled) { background: var(--surface2); }
.calendar-nav-btn:disabled { opacity: .3; cursor: not-allowed; }

.calendar-weekdays {
  display: grid; grid-template-columns: repeat(7, 1fr);
  font-size: 10.5px; color: var(--text-muted); text-align: center;
  margin-bottom: 4px;
}

.calendar-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }

.calendar-cell {
  aspect-ratio: 1; border-radius: 7px; border: none; background: transparent;
  font-size: 12px; font-family: 'DM Mono', monospace; color: var(--text);
  cursor: pointer; transition: background .12s, color .12s;
}
.calendar-cell:hover:not(.disabled):not(.empty) { background: var(--surface2); }
.calendar-cell.empty { cursor: default; }
.calendar-cell.disabled { color: var(--text-muted); opacity: .35; cursor: not-allowed; }
.calendar-cell.today:not(.selected) { border: 1px solid var(--text-sub); }
.calendar-cell.selected { background: var(--accent); color: var(--accent-fg); font-weight: 700; }

.calendar-legend {
  display: flex; align-items: center; gap: 5px;
  margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border);
  font-size: 10.5px; color: var(--text-muted);
}
.legend-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.legend-dot.has-data { background: var(--text); }
.legend-dot.no-data { background: var(--text-muted); margin-left: 10px; }


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

.stat-card.later-card { border-color: var(--amber-bg); }
.stat-card.fee-card { border-color: var(--amber-bg); }
.stat-card.void-card { border-color: var(--red-bg); }

/* ── Later Pay sale: who took it ── */
.taken-by {
  margin-top: 4px; padding: 12px 14px; border-radius: 10px;
  background: var(--amber-bg); border: 1px solid var(--amber);
  display: flex; flex-direction: column; gap: 5px; font-size: 12.5px;
}
.taken-by-title { display: flex; align-items: center; gap: 6px; font-weight: 600; color: var(--amber); font-size: 11.5px; text-transform: uppercase; letter-spacing: .05em; }
.taken-by-name { font-size: 16px; font-weight: 600; color: var(--text); }
.taken-by-row { display: flex; gap: 10px; color: var(--text-sub); }
.taken-by-row span { width: 80px; flex-shrink: 0; }
.taken-by-row strong { color: var(--text); font-weight: 500; }
.taken-by-missing { color: var(--text-sub); }
.btn-view-customer {
  align-self: flex-start; display: inline-flex; align-items: center; gap: 5px; margin-top: 6px;
  padding: 4px 10px; border-radius: 6px; cursor: pointer;
  background: transparent; border: 1px solid var(--amber); color: var(--amber);
  font-size: 11.5px; font-weight: 500; font-family: inherit;
}
.btn-view-customer:hover { background: var(--amber-bg); }

/* ── Cancelled sale: faded + struck through row, and its info box ── */
.txn-row.txn-void td { opacity: .55; }
.txn-row.txn-void .price-cell { text-decoration: line-through; }
.void-info {
  margin-top: 4px; padding: 12px 14px; border-radius: 10px;
  background: var(--red-bg); border: 1px solid var(--red);
  display: flex; flex-direction: column; gap: 6px; font-size: 12.5px;
}
.void-info-title { display: flex; align-items: center; gap: 6px; font-weight: 600; color: var(--red); }
.void-info-row { display: flex; gap: 10px; color: var(--text-sub); }
.void-info-row span { width: 90px; flex-shrink: 0; }
.void-info-row strong { color: var(--text); font-weight: 500; }
.void-info-note { font-size: 11px; color: var(--text-sub); margin-top: 2px; }

.btn-cancel-sale {
  display: inline-flex; align-items: center; gap: 6px; margin-left: 8px;
  padding: 7px 14px; border-radius: 8px; cursor: pointer;
  background: transparent; border: 1px solid var(--red); color: var(--red);
  font-size: 12.5px; font-family: inherit;
}
.btn-cancel-sale:hover { background: var(--red-bg); }

/* ── Cancel pop-up ── */
.void-overlay {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(0,0,0,.55);
  display: flex; align-items: center; justify-content: center; padding: 16px;
}
.void-modal {
  width: 100%; max-width: 440px; padding: 22px;
  background: var(--surface); color: var(--text);
  border: 1px solid var(--border); border-radius: 14px;
  display: flex; flex-direction: column; gap: 10px;
}
.void-modal-title { font-size: 17px; font-weight: 600; }
.void-modal-sub { font-size: 12.5px; color: var(--text-sub); line-height: 1.5; }
.void-label { font-size: 12px; font-weight: 500; margin-top: 4px; }
.void-textarea {
  width: 100%; resize: vertical; padding: 10px 12px; border-radius: 8px;
  background: var(--surface2); color: var(--text);
  border: 1px solid var(--border); font-family: inherit; font-size: 13px;
}
.void-textarea:focus { outline: none; border-color: var(--red); }
.void-error { font-size: 12px; color: var(--red); }
.void-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
.btn-void-confirm {
  padding: 9px 16px; border-radius: 8px; border: none; cursor: pointer;
  background: var(--red); color: #fff; font-size: 13px; font-weight: 600; font-family: inherit;
}
.btn-void-confirm:disabled { opacity: .4; cursor: not-allowed; }
.stat-value.fee { color: var(--amber); }
.fee-pill {
  margin-left: 4px; padding: 1px 6px; border-radius: 999px;
  background: var(--amber-bg); color: var(--amber);
  font-size: 10px; font-weight: 600; letter-spacing: 0; text-transform: none;
}
.bp-value.bp-fee { color: var(--amber); }
.stat-card.return-card { border-color: var(--red-bg); }
.stat-card.loan-card { border-color: var(--amber-bg); }

.stat-label { font-size: 11px; color: var(--text-sub); text-transform: uppercase; letter-spacing: .06em; font-weight: 500; }
.stat-value { font-size: 22px; font-weight: 600; margin-top: 4px; letter-spacing: -.02em; font-family: 'DM Mono', monospace; color: var(--text); }
.stat-value-sub { font-size: 13px; font-weight: 500; color: var(--text-sub); }
.stat-value.low { color: var(--red); }
.stat-value.profit { color: var(--green); }
.stat-sub { font-size: 11px; color: var(--text-sub); margin-top: 2px; }


/* ══════════════════════════════════
   TOOLBAR
   ══════════════════════════════════ */
.toolbar {
  padding: 20px 32px 0;
  display: flex; align-items: center;
  gap: 12px; flex-wrap: wrap;
}

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
  min-width: 180px;
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

.btn {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 8px;
  font-family: 'DM Sans', sans-serif;
  font-size: 13px; font-weight: 500;
  cursor: pointer; border: 1px solid transparent;
  transition: opacity .15s, background .15s;
}
.btn svg { width: 14px; height: 14px; }
.btn-outline { background: var(--surface); border-color: var(--border); color: var(--text); }
.btn-outline:hover { background: var(--surface2); }
.btn-primary { background: var(--accent); color: var(--accent-fg); }
.btn-primary:hover { opacity: .85; }
.toolbar-right { margin-left: auto; display: flex; gap: 8px; align-items: center; }

/* ── View switcher (Bills | Items) ── */
.view-seg {
  display: inline-flex; padding: 3px; gap: 2px; border-radius: 10px;
  background: var(--surface2); border: 1px solid var(--border);
}
.view-seg-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 14px; border: none; border-radius: 7px; cursor: pointer;
  background: transparent; color: var(--text-sub);
  font-size: 13px; font-weight: 500; font-family: inherit;
  transition: background .15s, color .15s;
}
.view-seg-btn:hover:not(.active) { color: var(--text); }
.view-seg-btn.active { background: var(--text); color: var(--bg); font-weight: 600; }

/* ── Small "By category | By item" switch ── */
.item-subbar { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; border-bottom: 1px solid var(--border); }
.item-subbar-hint { font-size: 12px; color: var(--text-sub); }
.view-seg-sm .view-seg-btn { padding: 4px 12px; font-size: 12px; }

/* ── Items inside an opened category ── */
.cat-items { padding: 8px 20px 12px 76px; background: var(--surface2); display: flex; flex-direction: column; gap: 4px; }
.cat-item {
  display: grid; grid-template-columns: 44px 1fr 190px 60px 130px; align-items: center; gap: 12px;
  padding: 7px 12px; border-radius: 8px; cursor: pointer;
  background: var(--surface); border: 1px solid var(--border); font-size: 13px;
}
.cat-item:hover { border-color: var(--text-sub); }
.cat-item-name  { font-weight: 500; }
.cat-item-sku   { font-family: 'DM Mono', monospace; font-size: 11.5px; color: var(--text-sub); }
.cat-item-qty   { font-family: 'DM Mono', monospace; font-weight: 600; text-align: center; }
.cat-item-total { font-family: 'DM Mono', monospace; text-align: right; }
.item-thumb-sm  { width: 40px; height: 40px; border-radius: 6px; }
.item-breakdown.nested { padding: 4px 0 8px 56px; background: transparent; }

/* ── Item view table ── */
.item-img-cell { width: 76px; padding: 8px 14px !important; }
.item-thumb {
  width: 52px; height: 52px; border-radius: 8px;
  object-fit: cover; display: block; flex-shrink: 0;
  border: 1px solid var(--border);
}
.item-img-wrap { display: inline-block; }
.item-img-wrap.zoomable { cursor: zoom-in; }

/* ── Big hover preview (same look + springy zoom as Product List) ── */
.img-preview-fixed { position: fixed; z-index: 9999; pointer-events: none; }
.img-preview-big {
  width: 220px; height: 220px;
  object-fit: cover; border-radius: 16px;
  border: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
  display: block;
}
.img-pop-enter-active { transition: opacity 0.18s ease, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1); }
.img-pop-leave-active { transition: opacity 0.15s ease, transform 0.15s ease; }
.img-pop-enter-from, .img-pop-leave-to { opacity: 0; transform: scale(0.7); }

.item-thumb-empty { display: flex; align-items: center; justify-content: center; background: var(--surface2); color: var(--text-muted); }

/* ── Price breakdown under an item ── */
.item-breakdown { padding: 14px 20px 16px 76px; display: flex; flex-direction: column; gap: 6px; background: var(--surface2); }
.item-breakdown-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 4px; }
.item-breakdown-title { font-size: 12.5px; font-weight: 600; color: var(--text); }
.item-breakdown-list { font-size: 11.5px; color: var(--text-sub); }
.item-line {
  display: grid; grid-template-columns: 70px 1fr auto 130px 120px; align-items: center; gap: 12px;
  padding: 8px 12px; border-radius: 8px; background: var(--surface); border: 1px solid var(--border);
  font-size: 12.5px;
}
.item-line-time { color: var(--text-sub); font-size: 12px; }
.item-line-invoice { font-family: 'DM Mono', monospace; font-size: 11.5px; color: var(--text-sub); }
.item-line-calc { font-family: 'DM Mono', monospace; text-align: right; color: var(--text-sub); }
.item-line-total { font-family: 'DM Mono', monospace; text-align: right; font-weight: 600; }
.item-qty { font-family: 'DM Mono', monospace; font-weight: 600; }
tfoot .foot-row { background: var(--surface2); border-top: 1px solid var(--border); }
tfoot .foot-row td { padding: 11px 14px; }
.foot-label { font-weight: 600; font-size: 12.5px; color: var(--text-sub); padding-left: 20px !important; }
.foot-minus { color: var(--amber); }
tfoot .foot-grand td { font-weight: 700; color: var(--text); border-top: 2px solid var(--border); }
tfoot .foot-grand .foot-label { color: var(--text); }


/* ══════════════════════════════════
   SALES TABLE
   ══════════════════════════════════ */
.table-wrap {
  margin: 20px 32px 32px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
}

.state-msg { padding: 40px 24px; text-align: center; font-size: 13px; color: var(--text-muted); }
.state-error { margin: 12px 24px; padding: 12px 14px; border-radius: 8px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: var(--red); font-size: 12.5px; }

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
.date-cell { color: var(--text-sub); font-size: 12px; }
.price-cell { font-family: 'DM Mono', monospace; font-size: 12.5px; }
.center-cell { text-align: center; }

/* ── Payment method badge ── */
.pay-badge {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 3px 10px; border-radius: 6px;
  font-size: 11px; font-weight: 600;
  text-transform: capitalize;
  background: var(--surface2); color: var(--text-sub);
}
.pay-badge.cash { background: var(--green-bg); color: var(--green); }
.pay-badge.card { background: var(--green-bg); color: var(--green); }
.pay-badge.bank { background: var(--green-bg); color: var(--green); }
.pay-badge.later_pay { background: var(--amber-bg); color: var(--amber); }

/* ── Status badge ── */
.status-badge {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 3px 10px; border-radius: 6px;
  font-size: 11px; font-weight: 600;
  text-transform: capitalize;
  background: var(--surface2); color: var(--text-sub);
}
.status-badge.completed { background: var(--green-bg); color: var(--green); }
.status-badge.refunded  { background: var(--amber-bg); color: var(--amber); }
.status-badge.void      { background: var(--red-bg); color: var(--red); }

/* ── Printed receipt badge ── */
.printed-badge {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 3px 10px; border-radius: 6px;
  font-size: 11px; font-weight: 600;
  background: var(--surface2); color: var(--text-muted);
}
.printed-badge.yes { background: var(--green-bg); color: var(--green); }

/* ── Profit strip — one invoice's sale / cost / profit / margin ── */
.bill-profit {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
  margin-top: 12px;
}
.bp-cell {
  display: flex; flex-direction: column; gap: 3px;
  padding: 10px 14px; border-radius: 9px;
  background: var(--surface); border: 1px solid var(--border);
}
.bp-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--text-sub); font-weight: 500; }
.bp-value { font-size: 15px; font-weight: 600; font-family: 'DM Mono', monospace; color: var(--text); }
.bp-gain { color: var(--green); }
.bp-loss { color: var(--red); }

/* ── Reprint row + button — sits under the item list in the expanded panel ── */
.expand-print-row {
  display: flex; justify-content: flex-end;
  margin-top: 10px; padding-top: 10px;
  border-top: 1px solid var(--border);
}
.btn-reprint {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px; border-radius: 7px; border: 1px solid var(--border);
  background: var(--surface); color: var(--text);
  font-size: 12.5px; font-weight: 600; font-family: 'DM Sans', sans-serif;
  cursor: pointer; transition: background .15s, border-color .15s;
}
.btn-reprint svg { flex-shrink: 0; }
.btn-reprint:hover:not(:disabled) { background: var(--surface2); border-color: var(--text-sub); }
.btn-reprint:disabled { opacity: .5; cursor: not-allowed; }

/* ── Bill-level discount badge ── */
.bill-discount-badge {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 3px 10px; border-radius: 6px;
  font-size: 11px; font-weight: 600;
  background: var(--amber-bg); color: var(--amber);
}
.no-discount { font-size: 11px; color: var(--text-muted); }

/* ── Expandable row (click a sale to see its items) ── */
.txn-row { cursor: pointer; }

.expand-cell { padding-left: 16px !important; width: 30px; }

.expand-arrow {
  transition: transform .15s;
  color: var(--text-muted);
}
.expand-arrow.open { transform: rotate(90deg); color: var(--text); }

.expand-panel-row td { padding: 0 !important; border-bottom: 1px solid var(--border); }

.expand-panel {
  background: var(--surface2);
  padding: 12px 20px 12px 50px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: rowIn .2s ease both;
}

.expand-item {
  display: flex;
  align-items: center;
  gap: 12px;
}

.expand-item-img {
  width: 38px; height: 38px;
  object-fit: cover;
  border-radius: 7px;
  border: 1px solid var(--border);
  flex-shrink: 0;
}
.expand-item-img-placeholder {
  display: flex; align-items: center; justify-content: center;
  color: var(--text-muted);
  background: var(--surface);
}

.expand-item-info { flex: 1; min-width: 0; }
.expand-item-name { font-size: 12.5px; font-weight: 500; color: var(--text); }
.expand-item-sku  { font-size: 10.5px; color: var(--text-muted); margin-top: 1px; }

.expand-item-qty   { font-size: 12px; color: var(--text-sub); font-family: 'DM Mono', monospace; width: 36px; text-align: right; }
.expand-item-price { font-size: 12px; color: var(--text-sub); font-family: 'DM Mono', monospace; width: 90px; text-align: right; }
.expand-item-total { font-size: 12.5px; font-weight: 600; color: var(--text); font-family: 'DM Mono', monospace; width: 100px; text-align: right; }

.expand-empty { font-size: 12px; color: var(--text-muted); padding: 4px 0; }

/* ── Discount label badge (matches the POS cart's price-mode colours) ── */
.discount-badge {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 2px 9px; border-radius: 5px;
  font-size: 10px; font-weight: 600;
  letter-spacing: 0.03em; text-transform: uppercase;
  width: 80px; flex-shrink: 0;
  background: var(--surface); border: 1px solid var(--border); color: var(--text-sub);
}
.discount-badge.label-discount { border-color: var(--green); background: var(--green-bg); color: var(--green); }
.discount-badge.label-super    { border-color: #8b5cf6; background: rgba(139,92,246,0.12); color: #8b5cf6; }
.discount-badge.label-original { border-color: var(--border); background: var(--surface); color: var(--text-sub); }

/* Fully returned line item — dim the row and swap the discount badge for a "Returned" tag */
.expand-item-returned .expand-item-name,
.expand-item-returned .expand-item-price,
.expand-item-returned .expand-item-total { color: var(--text-muted); text-decoration: line-through; }
.expand-item-returned .expand-item-img { opacity: .5; }

.returned-badge {
  display: inline-flex; align-items: center; gap: 4px; justify-content: center;
  padding: 2px 9px; border-radius: 5px;
  font-size: 10px; font-weight: 600;
  letter-spacing: 0.03em; text-transform: uppercase;
  width: 80px; flex-shrink: 0;
  border: 1px solid var(--red); background: var(--red-bg); color: var(--red);
}

</style>

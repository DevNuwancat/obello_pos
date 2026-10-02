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
  products: { cost_price: number; image_url: string | null } | null
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
    // Voided bills are cancelled sales, so they're left out entirely — they
    // never count toward totals and never appear in the table.
    const { data: txnData, error: txnError } = await supabase
      .from('transactions')
      .select('*, users(full_name)')
      .gte('created_at', start)
      .lte('created_at', end)
      .neq('status', 'void')
      .order('created_at', { ascending: false })

    if (txnError) { fetchError.value = txnError.message; markError(); return }
    transactions.value = txnData ?? []

    // Every item sold that day, with its product image + cost price joined in.
    // Used for: the cost/profit calc, the "Items" count column, and the
    // expanded item list under each row.
    const ids = transactions.value.map(t => t.id)
    if (ids.length > 0) {
      const { data: itemData, error: itemError } = await supabase
        .from('transaction_items')
        .select('*, products(cost_price, image_url)')
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

// Reload the report whenever the selected date changes
watch(selectedDate, () => { fetchReportData(); fetchReturns() })


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
  transactions.value.filter(t => t.payment_method === 'later_pay')
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

// Profit — what's left after cost is taken out of sales
const todaysProfit = computed(() => todaysSalesTotal.value - todaysCostTotal.value)

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
  fetchAvailableDates()
}


// ── Shared PDF look: bordered grid, light header with bold dark text ──
const borderColor: [number, number, number] = [90, 88, 84]
const headFill: [number, number, number] = [247, 245, 242]
const gridStyles = {
  font: 'helvetica', fontSize: 9, cellPadding: 6, textColor: [20, 20, 18] as [number, number, number],
  lineColor: borderColor, lineWidth: 0.6,
}
const gridHead = { fillColor: headFill, textColor: [20, 20, 18] as [number, number, number], fontStyle: 'bold' as const }

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
    ['Profit', fmtRs(todaysProfit.value)],
    ['Sales Count', String(todaysSalesCount.value)],
    ['Later Pay Orders', String(laterPayCount.value)],
    ['Later Pay Owed', fmtRs(laterPayTotal.value)],
    ['Returned Items', String(returnedCount.value)],
    ['Returned Amount', fmtRs(returnedAmount.value)],
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
        paymentLabel(t.payment_method),
        t.status,
        String(itemCountByTxn.value.get(t.id) ?? 0),
        `Rs ${t.total.toFixed(2)}`,
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
          row.unit_price.toFixed(2),
          row.line_total.toFixed(2),
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
        supabase.from('transaction_items').select('*, products(cost_price, image_url)')
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
    const laterPay   = sales.filter(t => t.payment_method === 'later_pay')

    // day-by-day
    const days = new Map<string, { count: number; sales: number; cost: number }>()
    for (const t of sales) {
      const key = toDateStr(new Date(t.created_at))
      const d = days.get(key) ?? { count: 0, sales: 0, cost: 0 }
      d.count += 1; d.sales += t.total; d.cost += costOfTxn.get(t.id) ?? 0
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
        ['Profit', fmtRs(totalSales - totalCost)],
        ['Sales Count', String(sales.length)],
        ['Later Pay Orders', String(laterPay.length)],
        ['Later Pay Owed', fmtRs(laterPay.reduce((s, t) => s + t.total, 0))],
      ],
      styles: { ...gridStyles, fontSize: 10, cellPadding: 7 },
      columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right' } },
    })

    heading('Day by day')
    table({
      head: [['Date', 'Sales', 'Sales (Rs.)', 'Cost (Rs.)', 'Profit (Rs.)']],
      body: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, d]) => [
        new Date(key + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }),
        String(d.count), d.sales.toFixed(2), d.cost.toFixed(2), (d.sales - d.cost).toFixed(2),
      ]),
      foot: [['Total', String(sales.length), totalSales.toFixed(2), totalCost.toFixed(2), (totalSales - totalCost).toFixed(2)]],
      footStyles: { fillColor: [247, 245, 242], textColor: [20, 20, 18], fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    })

    heading('Payment methods')
    table({
      head: [['Method', 'Sales', 'Total (Rs.)']],
      body: [...methods.entries()].map(([method, d]) => [paymentLabel(method), String(d.count), d.total.toFixed(2)]),
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' } },
    })

    if (topProducts.length > 0) {
      heading('Top selling products')
      table({
        head: [['#', 'Product', 'Qty sold', 'Total (Rs.)']],
        body: topProducts.map(([name, d], i) => [String(i + 1), name, String(d.qty), d.total.toFixed(2)]),
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
        <!-- Profit -->
        <div class="stat-card">
          <div class="stat-label">Profit</div>
          <div class="stat-value" :class="todaysProfit < 0 ? 'low' : 'profit'">{{ fmtRs(todaysProfit) }}</div>
          <div class="stat-sub">sales − cost</div>
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
                    <span class="status-badge" :class="t.status">{{ t.status }}</span>
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

                      <!-- Reprint this bill — sits under its item list -->
                      <div class="expand-print-row">
                        <button
                          class="btn-reprint"
                          :disabled="printingId === t.id"
                          @click="reprintBill(t)"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                          {{ printingId === t.id ? 'Printing…' : 'Print' }}
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
.stat-card.return-card { border-color: var(--red-bg); }

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
.toolbar-right { margin-left: auto; display: flex; gap: 8px; }


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

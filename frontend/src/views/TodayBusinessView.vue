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

    if (txnError) { fetchError.value = txnError.message; return }
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
      if (itemError) { fetchError.value = itemError.message; return }
      itemRows.value = (itemData ?? []) as unknown as TransactionItemRow[]
    } else {
      itemRows.value = []
    }
  } catch {
    fetchError.value = 'Could not load business data for this day.'
  } finally {
    loading.value = false
  }
}

// Reload the report whenever the selected date changes
watch(selectedDate, fetchReportData)


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
// 5. SPLIT: real sales vs "Later Pay" sales
//    Later Pay money hasn't actually come in yet, so it must NOT be
//    counted in Sales / Cost / Profit — it gets its own card instead.
// ──────────────────────────────────────────────
const saleTransactions = computed(() =>
  transactions.value.filter(t => t.payment_method !== 'later_pay' && t.status === 'completed')
)
const laterPayTransactions = computed(() =>
  transactions.value.filter(t => t.payment_method === 'later_pay')
)


// ──────────────────────────────────────────────
// 6. STAT CARD NUMBERS
// ──────────────────────────────────────────────
// Today's Sales — total Rs. taken in (cash + card + bank only)
const todaysSalesTotal = computed(() =>
  saleTransactions.value.reduce((sum, t) => sum + t.total, 0)
)

// Cost of Goods Sold — what those sold items cost YOU (cost_price), not what
// the customer paid. Only counts items belonging to non-Later-Pay sales.
const todaysCostTotal = computed(() => {
  const saleIds = new Set(saleTransactions.value.map(t => t.id))
  return itemRows.value
    .filter(row => saleIds.has(row.transaction_id))
    .reduce((sum, row) => sum + (row.products?.cost_price ?? 0) * row.qty, 0)
})

// Profit — what's left after cost is taken out of sales
const todaysProfit = computed(() => todaysSalesTotal.value - todaysCostTotal.value)

// How many completed sales happened today (Later Pay not counted)
const todaysSalesCount = computed(() => saleTransactions.value.length)

// Later Pay — kept completely separate from the cards above
const laterPayCount = computed(() => laterPayTransactions.value.length)
const laterPayTotal = computed(() => laterPayTransactions.value.reduce((sum, t) => sum + t.total, 0))


// ──────────────────────────────────────────────
// 7. PAYMENT METHOD FILTER (for the table only)
// ──────────────────────────────────────────────
// 'all_no_later' / 'all_with_later' = the two "All Payments" modes, otherwise
// a specific method: 'cash' | 'card' | 'bank' | 'later_pay'
const paymentFilter = ref('all_no_later')

const filteredTransactions = computed(() => {
  if (paymentFilter.value === 'all_no_later') {
    return transactions.value.filter(t => t.payment_method !== 'later_pay')
  }
  if (paymentFilter.value === 'all_with_later') return transactions.value
  return transactions.value.filter(t => t.payment_method === paymentFilter.value)
})

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
// 7b. ROW EXPAND/COLLAPSE — click a row to see its items
// ──────────────────────────────────────────────
const expandedIds = ref(new Set<string>())

function toggleExpand(id: string) {
  const next = new Set(expandedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedIds.value = next
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
  fetchAvailableDates()
}


// ──────────────────────────────────────────────
// 9b. EXPORT CSV
// Exports whatever is currently visible in the table (respects the
// payment-method filter), plus a summary block of the cards at the top.
// ──────────────────────────────────────────────
function exportCSV() {
  const summary = [
    ['Today Business Report'],
    [selectedDateLabel.value],
    [],
    ['Sales', fmtRs(todaysSalesTotal.value)],
    ['Cost of Goods', fmtRs(todaysCostTotal.value)],
    ['Profit', fmtRs(todaysProfit.value)],
    ['Sales Count', String(todaysSalesCount.value)],
    ['Later Pay Count', String(laterPayCount.value)],
    ['Later Pay Total', fmtRs(laterPayTotal.value)],
    [],
  ]

  const headers = ['Invoice No', 'Time', 'Cashier', 'Payment', 'Status', 'Printed', 'Bill Discount %', 'Items', 'Subtotal', 'Discount Rs.', 'Total']
  const rows = filteredTransactions.value.map(t => [
    t.invoice_no,
    fmtTime(t.created_at),
    t.users?.full_name || '—',
    paymentLabel(t.payment_method),
    t.status,
    t.printed_receipt ? 'Yes' : 'No',
    t.discount_percent > 0 ? `${t.discount_percent}%` : '—',
    String(itemCountByTxn.value.get(t.id) ?? 0),
    t.subtotal.toFixed(2),
    t.discount_amount.toFixed(2),
    t.total.toFixed(2),
  ])

  // Item-by-item breakdown — every product sold today, one row each,
  // tagged with which invoice it belongs to.
  const itemSection = [
    [],
    ['Item-by-Item Breakdown'],
    ['Invoice No', 'Product Name', 'SKU', 'Price Mode', 'Qty', 'Unit Price', 'Line Total'],
  ]
  const filteredIds = new Set(filteredTransactions.value.map(t => t.id))
  const invoiceByTxnId = new Map(filteredTransactions.value.map(t => [t.id, t.invoice_no]))
  const itemRowsOut = itemRows.value
    .filter(row => filteredIds.has(row.transaction_id))
    .map(row => [
      invoiceByTxnId.get(row.transaction_id) || '—',
      row.product_name,
      row.sku || '—',
      row.discount_label || '—',
      String(row.qty),
      row.unit_price.toFixed(2),
      row.line_total.toFixed(2),
    ])

  const csv = [...summary, headers, ...rows, ...itemSection, ...itemRowsOut]
    .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')

  const a = Object.assign(document.createElement('a'), {
    href: 'data:text/csv,' + encodeURIComponent(csv),
    download: `today-business-${selectedDate.value}.csv`,
  })
  a.click()
  showToastMsg('CSV exported')
}


// ──────────────────────────────────────────────
// 9c. EXPORT PDF
// Builds a real A4 PDF file straight in the browser and downloads it —
// no print dialog, no "Save as PDF" step. Uses jsPDF + autoTable.
// ──────────────────────────────────────────────
function exportPDF() {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' }) // A4, points as the unit
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 40
  let y = 50

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
  doc.text('Today Business Report', pageWidth - margin, y - 6, { align: 'right' })
  doc.setFontSize(9.5)
  doc.text(selectedDateLabel.value, pageWidth - margin, y + 8, { align: 'right' })

  y += 20
  doc.setDrawColor(230, 228, 224)
  doc.line(margin, y, pageWidth - margin, y)
  y += 26

  // ── SUMMARY CARDS (as a clean key/value grid) ──
  const summaryPairs: [string, string][] = [
    ['Sales', fmtRs(todaysSalesTotal.value)],
    ['Cost of Goods', fmtRs(todaysCostTotal.value)],
    ['Profit', fmtRs(todaysProfit.value)],
    ['Sales Count', String(todaysSalesCount.value)],
    ['Later Pay Orders', String(laterPayCount.value)],
    ['Later Pay Owed', fmtRs(laterPayTotal.value)],
  ]
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: 'plain',
    body: summaryPairs,
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 6 },
    columnStyles: {
      0: { textColor: [110, 108, 104], cellWidth: 140 },
      1: { textColor: [20, 20, 18], fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      // Alternate light background per pair for readability
      if (data.row.index % 2 === 0) data.cell.styles.fillColor = [247, 245, 242]
    },
  })
  y = (doc as any).lastAutoTable.finalY + 26

  // ── TRANSACTIONS TABLE ──
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(20, 20, 18)
  doc.text('Transactions', margin, y)
  y += 10

  const txnHead = [['Time', 'Invoice No', 'Cashier', 'Payment', 'Status', 'Items', 'Total (Rs.)']]
  const txnBody = filteredTransactions.value.map(t => [
    fmtTime(t.created_at),
    t.invoice_no,
    t.users?.full_name || '—',
    paymentLabel(t.payment_method),
    t.status,
    String(itemCountByTxn.value.get(t.id) ?? 0),
    t.total.toFixed(2),
  ])
  autoTable(doc, {
    startY: y + 6,
    margin: { left: margin, right: margin },
    head: txnHead,
    body: txnBody,
    theme: 'striped',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 6 },
    headStyles: { fillColor: [20, 20, 18], textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: { 6: { halign: 'right' } },
  })
  y = (doc as any).lastAutoTable.finalY + 26

  // ── ITEM-BY-ITEM BREAKDOWN ──
  const invoiceByTxnId = new Map(filteredTransactions.value.map(t => [t.id, t.invoice_no]))
  const filteredIds = new Set(filteredTransactions.value.map(t => t.id))
  const itemBody = itemRows.value
    .filter(row => filteredIds.has(row.transaction_id))
    .map(row => [
      invoiceByTxnId.get(row.transaction_id) || '—',
      row.product_name,
      row.sku || '—',
      row.discount_label || '—',
      String(row.qty),
      row.unit_price.toFixed(2),
      row.line_total.toFixed(2),
    ])

  if (itemBody.length > 0) {
    // Start a fresh page if there's not much room left for a heading + a few rows
    if (y > doc.internal.pageSize.getHeight() - 120) {
      doc.addPage()
      y = 50
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(20, 20, 18)
    doc.text('Item-by-Item Breakdown', margin, y)

    autoTable(doc, {
      startY: y + 10,
      margin: { left: margin, right: margin },
      head: [['Invoice No', 'Product', 'SKU', 'Price Mode', 'Qty', 'Unit Price', 'Line Total']],
      body: itemBody,
      theme: 'striped',
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 5 },
      headStyles: { fillColor: [20, 20, 18], textColor: [255, 255, 255], fontStyle: 'bold' },
      columnStyles: { 4: { halign: 'center' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
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

  doc.save(`today-business-${selectedDate.value}.pdf`)
  showToastMsg('PDF exported')
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

      <!-- ── STATS BAR (4 summary cards, Later Pay kept separate) ── -->
      <div class="stats-bar">
        <!-- Sales -->
        <div class="stat-card">
          <div class="stat-label">Sales</div>
          <div class="stat-value">{{ fmtRs(todaysSalesTotal) }}</div>
          <div class="stat-sub">cash, card &amp; bank only</div>
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
        <!-- Later Pay — kept separate, NOT part of the totals above -->
        <div class="stat-card later-card">
          <div class="stat-label">Later Pay</div>
          <div class="stat-value">{{ laterPayCount }} <span class="stat-value-sub">order{{ laterPayCount === 1 ? '' : 's' }}</span></div>
          <div class="stat-sub">{{ fmtRs(laterPayTotal) }} owed · not in totals above</div>
        </div>
      </div>

      <!-- ── TOOLBAR (payment filter + refresh) ── -->
      <div class="toolbar">
        <!-- Payment method filter -->
        <div class="select-wrap">
          <select v-model="paymentFilter">
            <option value="all_no_later">All Payments (without pay later)</option>
            <option value="all_with_later">All Payments (with pay later)</option>
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
          <button class="btn btn-outline" @click="exportCSV" title="Download CSV">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
            Export CSV
          </button>
          <button class="btn btn-primary" @click="exportPDF" title="Download PDF">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z"/></svg>
            Export PDF
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
                        <span class="discount-badge" :class="discountLabelClass(item.discount_label)">{{ item.discount_label || '—' }}</span>
                        <div class="expand-item-qty">x{{ item.qty }}</div>
                        <div class="expand-item-price">{{ fmtRs(item.unit_price) }}</div>
                        <div class="expand-item-total">{{ fmtRs(item.line_total) }}</div>
                      </div>
                      <div v-if="(itemsByTxn.get(t.id) ?? []).length === 0" class="expand-empty">No item details found</div>
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

</style>

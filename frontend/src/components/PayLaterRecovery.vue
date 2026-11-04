<!--
  PayLaterRecovery.vue — "how much credit did we get back?"
  The Recovery tab of the Pay Later page.

  Recovery = the payments customers make toward what they owe (table "pay_later_payments").
  It is NOT a sale, so it never touches Sales / Profit in Today Business.

  DAILY   : pick a day → total collected, split by cash / card / bank, and every payment of that day.
  MONTHLY : pick a month → total collected and new credit given (Pay Later bills + loans),
            with a day-by-day table.
  Both can be downloaded as a PDF.

  The colours come from the Pay Later page (CSS variables), so it follows light / dark mode by itself.
-->
<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import CalendarPicker from './CalendarPicker.vue'
import { supabase } from '../lib/supabase'
import { markConnected, markError } from '../lib/connectionStatus'
import { useCustomerTags } from '../composables/useCustomerTags'
import TagChips from './TagChips.vue'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// ──────────────────────────────────────────────
// TYPES
// ──────────────────────────────────────────────
interface PaymentRow {
  id: string
  customer_id: string
  amount: number
  paid_at: string
  note: string | null
  payment_method: string
  received_by: string | null
}

const { loadTags, tagsOf } = useCustomerTags()

// ──────────────────────────────────────────────
// DATE HELPERS (all in local time)
// ──────────────────────────────────────────────
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const todayStr = toDateStr(new Date())
const thisMonthStr = todayStr.slice(0, 7)

function dayRange(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return { start: new Date(y, m - 1, d, 0, 0, 0, 0).toISOString(), end: new Date(y, m - 1, d, 23, 59, 59, 999).toISOString() }
}
function monthRange(monthStr: string) {
  const [y, m] = monthStr.split('-').map(Number)
  return { start: new Date(y, m - 1, 1, 0, 0, 0, 0).toISOString(), end: new Date(y, m, 0, 23, 59, 59, 999).toISOString() }
}

const fmtRs  = (n: number) => `Rs. ${Number(n).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtNum = (n: number) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
const methodLabel = (m: string) => m.charAt(0).toUpperCase() + m.slice(1)

// ──────────────────────────────────────────────
// STATE
// ──────────────────────────────────────────────
const mode  = ref<'daily' | 'monthly'>('daily')
const date  = ref(todayStr)
const month = ref(thisMonthStr)

const loading = ref(false)
const error   = ref('')

const payments    = ref<PaymentRow[]>([])
const customerInfo = ref(new Map<string, { name: string; nickname: string | null }>())
const staffName   = ref(new Map<string, string>())
// Monthly only: new credit given in the month (Pay Later bills + loans), by day
const creditByDay = ref(new Map<string, number>())
const creditBills = ref(0)
const creditLoans = ref(0)

// Supabase sends at most 1000 rows per request, so ask page by page
async function fetchAllRows(make: (from: number, to: number) => any): Promise<any[]> {
  const all: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error: err } = await make(from, from + 999)
    if (err) throw new Error(err.message)
    all.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return all
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const { start, end } = mode.value === 'daily' ? dayRange(date.value) : monthRange(month.value)

    const rows: PaymentRow[] = await fetchAllRows((from, to) =>
      supabase.from('pay_later_payments').select('*')
        .gte('paid_at', start).lte('paid_at', end)
        .order('paid_at', { ascending: true }).order('id').range(from, to)
    )
    payments.value = rows

    // Who paid and who took the money (small separate lookups, 100 ids at a time)
    const custIds  = [...new Set(rows.map(r => r.customer_id))]
    const staffIds = [...new Set(rows.map(r => r.received_by).filter((x): x is string => !!x))]
    const cMap = new Map<string, { name: string; nickname: string | null }>()
    for (let i = 0; i < custIds.length; i += 100) {
      const { data } = await supabase.from('pay_later_balances').select('id, name, nickname').in('id', custIds.slice(i, i + 100))
      for (const c of data ?? []) cMap.set(c.id, { name: c.name, nickname: c.nickname })
    }
    customerInfo.value = cMap
    const sMap = new Map<string, string>()
    if (staffIds.length) {
      const { data } = await supabase.from('users').select('id, full_name').in('id', staffIds)
      for (const u of data ?? []) sMap.set(u.id, u.full_name ?? '')
    }
    staffName.value = sMap

    // Monthly: how much NEW credit was given in the same month
    if (mode.value === 'monthly') {
      const bills: { total: number; created_at: string }[] = await fetchAllRows((from, to) =>
        supabase.from('transactions').select('total, created_at')
          .eq('payment_method', 'later_pay').eq('status', 'completed')
          .gte('created_at', start).lte('created_at', end).order('created_at').order('id').range(from, to)
      )
      const loans: { amount: number; given_at: string }[] = await fetchAllRows((from, to) =>
        supabase.from('pay_later_loans').select('amount, given_at')
          .gte('given_at', start).lte('given_at', end).order('given_at').order('id').range(from, to)
      )
      const byDay = new Map<string, number>()
      for (const b of bills) { const k = toDateStr(new Date(b.created_at)); byDay.set(k, (byDay.get(k) ?? 0) + Number(b.total)) }
      for (const l of loans) { const k = toDateStr(new Date(l.given_at)); byDay.set(k, (byDay.get(k) ?? 0) + Number(l.amount)) }
      creditByDay.value = byDay
      creditBills.value = bills.reduce((s, b) => s + Number(b.total), 0)
      creditLoans.value = loans.reduce((s, l) => s + Number(l.amount), 0)
    }
    markConnected()
  } catch (e: any) {
    error.value = e?.message || 'Could not load recovery data.'
    markError()
  } finally {
    loading.value = false
  }
}

// Which days / months had a payment — these get a green dot in the calendar.
// Only paid_at and amount are fetched, so it stays light even with many payments.
const paidDays   = ref(new Set<string>())
const paidMonths = ref(new Set<string>())

async function loadPaidDates() {
  try {
    const rows = await fetchAllRows((from, to) =>
      supabase.from('pay_later_payments').select('paid_at, amount').gt('amount', 0).order('id').range(from, to)
    )
    const days = new Set<string>()
    const months = new Set<string>()
    for (const r of rows as { paid_at: string }[]) {
      const d = toDateStr(new Date(r.paid_at))   // local date, same as the report itself
      days.add(d)
      months.add(d.slice(0, 7))
    }
    paidDays.value   = days
    paidMonths.value = months
  } catch { /* dots are a nice extra — the report still works without them */ }
}

onMounted(() => { loadTags(); load(); loadPaidDates() })
watch([mode, date, month], load)

// ──────────────────────────────────────────────
// NUMBERS
// ──────────────────────────────────────────────
const totalCollected = computed(() => payments.value.reduce((s, p) => s + Number(p.amount), 0))
const byMethod = computed(() => {
  const m = { cash: 0, card: 0, bank: 0 } as Record<string, number>
  for (const p of payments.value) m[p.payment_method] = (m[p.payment_method] ?? 0) + Number(p.amount)
  return m
})
const customersPaid = computed(() => new Set(payments.value.map(p => p.customer_id)).size)

const creditGiven = computed(() => creditBills.value + creditLoans.value)

// Daily list, newest payment last → we show newest first
const dayPayments = computed(() => [...payments.value].sort((a, b) => b.paid_at.localeCompare(a.paid_at)))

// Monthly day-by-day rows
interface DayRow { key: string; count: number; collected: number; credit: number }
const dayRows = computed<DayRow[]>(() => {
  const map = new Map<string, DayRow>()
  const row = (key: string) => map.get(key) ?? { key, count: 0, collected: 0, credit: 0 }
  for (const p of payments.value) {
    const k = toDateStr(new Date(p.paid_at))
    const r = row(k); r.count += 1; r.collected += Number(p.amount); map.set(k, r)
  }
  for (const [k, v] of creditByDay.value) { const r = row(k); r.credit += v; map.set(k, r) }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key))
})
const maxCollected = computed(() => Math.max(1, ...dayRows.value.map(r => r.collected)))

// ──────────────────────────────────────────────
// DATE NAVIGATION
// ──────────────────────────────────────────────
function shiftDay(delta: number) {
  const [y, m, d] = date.value.split('-').map(Number)
  const next = toDateStr(new Date(y, m - 1, d + delta))
  if (next <= todayStr) date.value = next
}
function shiftMonth(delta: number) {
  const [y, m] = month.value.split('-').map(Number)
  const next = toDateStr(new Date(y, m - 1 + delta, 1)).slice(0, 7)
  if (next <= thisMonthStr) month.value = next
}
const canNext = computed(() => mode.value === 'daily' ? date.value < todayStr : month.value < thisMonthStr)

const dateLabel = computed(() => {
  const [y, m, d] = date.value.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })
})
const monthLabel = computed(() => {
  const [y, m] = month.value.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
})
const periodLabel = computed(() => mode.value === 'daily' ? dateLabel.value : monthLabel.value)

// Click a day in the monthly table → open that day
function openDay(key: string) {
  date.value = key
  mode.value = 'daily'
}

function nameOf(id: string): string { return customerInfo.value.get(id)?.name ?? 'Unknown customer' }

// ──────────────────────────────────────────────
// PDF (same plain bordered-grid look as the other reports)
// ──────────────────────────────────────────────
const borderColor: [number, number, number] = [90, 88, 84]
const gridStyles = { font: 'helvetica', fontSize: 9, cellPadding: 6, textColor: [20, 20, 18] as [number, number, number], lineColor: borderColor, lineWidth: 0.6 }
const gridHead = { fillColor: [247, 245, 242] as [number, number, number], textColor: [20, 20, 18] as [number, number, number], fontStyle: 'bold' as const }
const footStyle = { fillColor: [247, 245, 242] as [number, number, number], textColor: [20, 20, 18] as [number, number, number], fontStyle: 'bold' as const }

function exportPDF() {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 40
  let y = 50

  // header
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(20, 20, 18)
  doc.text('obello', margin, y)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(120, 120, 115)
  doc.text('POS V2.0', margin + 62, y)
  doc.setFontSize(11); doc.setTextColor(80, 80, 78)
  doc.text(`Pay Later Recovery - ${mode.value === 'daily' ? 'Daily' : 'Monthly'}`, pageWidth - margin, y - 6, { align: 'right' })
  doc.setFontSize(9.5)
  doc.text(periodLabel.value, pageWidth - margin, y + 8, { align: 'right' })
  y += 20
  doc.setDrawColor(230, 228, 224); doc.line(margin, y, pageWidth - margin, y)
  y += 26

  // summary
  const pairs: [string, string][] = [
    ['Credit collected', fmtRs(totalCollected.value)],
    ['Payments received', String(payments.value.length)],
    ['Customers who paid', String(customersPaid.value)],
    ['Cash', fmtRs(byMethod.value.cash ?? 0)],
    ['Card', fmtRs(byMethod.value.card ?? 0)],
    ['Bank', fmtRs(byMethod.value.bank ?? 0)],
  ]
  if (mode.value === 'monthly') {
    pairs.push(['New credit given (bills + loans)', fmtRs(creditGiven.value)])
  }
  autoTable(doc, {
    startY: y, margin: { left: margin, right: margin }, theme: 'grid', body: pairs,
    styles: { ...gridStyles, fontSize: 10, cellPadding: 7 },
    columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right' } },
  })
  y = (doc as any).lastAutoTable.finalY + 26

  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(20, 20, 18)
  if (mode.value === 'daily') {
    doc.text('Payments received', margin, y)
    autoTable(doc, {
      startY: y + 10, margin: { left: margin, right: margin }, theme: 'grid', styles: gridStyles, headStyles: gridHead,
      head: [['#', 'Time', 'Customer', 'Method', 'Received by', 'Note', 'Amount (Rs.)']],
      body: dayPayments.value.map((p, i) => [
        String(i + 1), fmtTime(p.paid_at),
        [nameOf(p.customer_id), customerInfo.value.get(p.customer_id)?.nickname ? `"${customerInfo.value.get(p.customer_id)!.nickname}"` : ''].filter(Boolean).join(' '),
        methodLabel(p.payment_method), (p.received_by && staffName.value.get(p.received_by)) || '-', p.note || '', fmtNum(p.amount),
      ]),
      foot: [['', '', '', '', '', 'Total', fmtNum(totalCollected.value)]],
      footStyles: footStyle,
      columnStyles: { 0: { cellWidth: 24 }, 6: { halign: 'right' } },
    })
  } else {
    doc.text('Day by day', margin, y)
    autoTable(doc, {
      startY: y + 10, margin: { left: margin, right: margin }, theme: 'grid', styles: gridStyles, headStyles: gridHead,
      head: [['Date', 'Payments', 'Collected (Rs.)', 'New credit (Rs.)']],
      body: dayRows.value.map(r => [
        new Date(r.key + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }),
        String(r.count), fmtNum(r.collected), fmtNum(r.credit),
      ]),
      foot: [['Total', String(payments.value.length), fmtNum(totalCollected.value), fmtNum(creditGiven.value)]],
      footStyles: footStyle,
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    })
  }

  // page footers
  const pages = doc.getNumberOfPages()
  const pageH = doc.internal.pageSize.getHeight()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(150, 150, 145)
    doc.text(`Page ${i} of ${pages}`, pageWidth - margin, pageH - 24, { align: 'right' })
  }
  doc.save(mode.value === 'daily' ? `pay-later-recovery-${date.value}.pdf` : `pay-later-recovery-${month.value}.pdf`)
}
</script>

<template>
  <div class="rec">

    <!-- ── CONTROLS ── -->
    <div class="rec-bar">
      <div class="seg">
        <button class="seg-btn" :class="{ active: mode === 'daily' }" @click="mode = 'daily'">Daily</button>
        <button class="seg-btn" :class="{ active: mode === 'monthly' }" @click="mode = 'monthly'">Monthly</button>
      </div>

      <div class="nav">
        <button class="nav-btn" title="Previous" @click="mode === 'daily' ? shiftDay(-1) : shiftMonth(-1)">‹</button>
        <CalendarPicker v-if="mode === 'daily'" v-model="date" mode="day" :max="todayStr" :marked="paidDays" />
        <CalendarPicker v-else v-model="month" mode="month" :max="thisMonthStr" :marked="paidMonths" />
        <button class="nav-btn" title="Next" :disabled="!canNext" @click="mode === 'daily' ? shiftDay(1) : shiftMonth(1)">›</button>
        <button v-if="mode === 'daily' ? date !== todayStr : month !== thisMonthStr" class="nav-today" @click="date = todayStr; month = thisMonthStr">
          {{ mode === 'daily' ? 'Today' : 'This month' }}
        </button>
      </div>

      <div class="rec-title">{{ periodLabel }}</div>

      <button class="btn-export" :disabled="loading" @click="exportPDF">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z"/></svg>
        Export PDF
      </button>
    </div>

    <div v-if="error" class="rec-error">{{ error }}</div>

    <!-- ── NUMBERS ── -->
    <div class="cards">
      <div class="card main">
        <div class="card-label">Credit Collected</div>
        <div class="card-value green">{{ fmtRs(totalCollected) }}</div>
        <div class="card-sub">Cash {{ fmtRs(byMethod.cash ?? 0) }} · Card {{ fmtRs(byMethod.card ?? 0) }} · Bank {{ fmtRs(byMethod.bank ?? 0) }}</div>
      </div>
      <div class="card">
        <div class="card-label">Payments</div>
        <div class="card-value">{{ payments.length }}</div>
        <div class="card-sub">from {{ customersPaid }} customer{{ customersPaid === 1 ? '' : 's' }}</div>
      </div>
      <template v-if="mode === 'monthly'">
        <div class="card">
          <div class="card-label">New Credit Given</div>
          <div class="card-value">{{ fmtRs(creditGiven) }}</div>
          <div class="card-sub">bills {{ fmtRs(creditBills) }} · loans {{ fmtRs(creditLoans) }}</div>
        </div>
      </template>
    </div>

    <!-- ── TABLE ── -->
    <div class="rec-table">
      <div v-if="loading" class="state">Loading recovery…</div>

      <!-- DAILY: every payment of the day -->
      <table v-else-if="mode === 'daily'">
        <thead>
          <tr>
            <th>#</th><th>Time</th><th>Customer</th><th>Method</th><th>Received by</th><th>Note</th>
            <th style="text-align:right; padding-right:20px;">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="dayPayments.length === 0"><td colspan="7" class="empty">No credit was collected on this day</td></tr>
          <tr v-for="(p, i) in dayPayments" :key="p.id">
            <td class="dim">{{ i + 1 }}</td>
            <td class="dim">{{ fmtTime(p.paid_at) }}</td>
            <td>
              <div class="cust">{{ nameOf(p.customer_id) }}<span v-if="customerInfo.get(p.customer_id)?.nickname" class="nick"> “{{ customerInfo.get(p.customer_id)!.nickname }}”</span></div>
              <TagChips v-if="tagsOf(p.customer_id).length" :tags="tagsOf(p.customer_id)" />
            </td>
            <td><span class="method" :class="p.payment_method">{{ methodLabel(p.payment_method) }}</span></td>
            <td class="dim">{{ (p.received_by && staffName.get(p.received_by)) || '—' }}</td>
            <td class="dim">{{ p.note || '' }}</td>
            <td class="amt green" style="padding-right:20px;">{{ fmtRs(p.amount) }}</td>
          </tr>
        </tbody>
        <tfoot v-if="dayPayments.length">
          <tr><td colspan="6" class="foot-label">Total collected</td><td class="amt green" style="padding-right:20px;">{{ fmtRs(totalCollected) }}</td></tr>
        </tfoot>
      </table>

      <!-- MONTHLY: day by day -->
      <table v-else>
        <thead>
          <tr>
            <th>Date</th><th style="text-align:center">Payments</th><th style="min-width:220px">Collected</th>
            <th style="text-align:right; padding-right:20px;">New credit</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="dayRows.length === 0"><td colspan="4" class="empty">Nothing collected or given on credit in this month</td></tr>
          <tr v-for="r in dayRows" :key="r.key" class="clickable" title="Open this day" @click="openDay(r.key)">
            <td>{{ new Date(r.key + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }) }}</td>
            <td class="dim" style="text-align:center">{{ r.count }}</td>
            <td>
              <div class="bar-row">
                <div class="bar-track"><div class="bar-fill" :style="{ width: (r.collected / maxCollected * 100) + '%' }"></div></div>
                <span class="amt green">{{ fmtRs(r.collected) }}</span>
              </div>
            </td>
            <td class="amt dim" style="text-align:right; padding-right:20px;">{{ fmtRs(r.credit) }}</td>
          </tr>
        </tbody>
        <tfoot v-if="dayRows.length">
          <tr>
            <td class="foot-label">Total</td>
            <td class="dim" style="text-align:center; font-weight:600">{{ payments.length }}</td>
            <td class="amt green">{{ fmtRs(totalCollected) }}</td>
            <td class="amt" style="text-align:right; padding-right:20px;">{{ fmtRs(creditGiven) }}</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <p class="rec-note">Recovery is money customers paid back. It is not a sale, so it is not counted in Today Business sales or profit.</p>
  </div>
</template>

<style scoped>
.rec { display: flex; flex-direction: column; gap: 16px; padding: 0 32px 32px; color: var(--text); font-family: 'DM Sans', sans-serif; }

.rec-bar {
  display: flex; align-items: center; flex-wrap: wrap; gap: 14px; padding: 14px 20px; margin-top: 0;
  background: var(--surface); border: 1px solid var(--border); border-radius: 0 var(--radius) var(--radius) var(--radius);
}
.seg { display: inline-flex; padding: 3px; border-radius: 10px; background: var(--bg); border: 1px solid var(--border); }
.seg-btn { padding: 6px 16px; border: none; border-radius: 8px; background: transparent; color: var(--text-sub); font-size: 12.5px; font-family: inherit; cursor: pointer; transition: all .15s; }
.seg-btn.active { background: var(--accent); color: var(--accent-fg); font-weight: 600; }

.nav { display: inline-flex; align-items: center; gap: 6px; }
.nav-btn { width: 30px; height: 30px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font-size: 16px; cursor: pointer; line-height: 1; }
.nav-btn:disabled { opacity: .35; cursor: not-allowed; }
.nav-btn:hover:not(:disabled) { background: var(--surface2); }
.nav-input { padding: 6px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font-size: 13px; font-family: inherit; outline: none; color-scheme: light dark; }
.nav-today { padding: 6px 12px; border-radius: 8px; border: 1px solid var(--border); background: transparent; color: var(--text-sub); font-size: 12px; font-family: inherit; cursor: pointer; }
.nav-today:hover { color: var(--text); background: var(--surface2); }

.rec-title { font-size: 14px; font-weight: 600; }
.btn-export { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font-size: 13px; font-weight: 500; font-family: inherit; cursor: pointer; }
.btn-export:hover:not(:disabled) { background: var(--surface2); }
.btn-export:disabled { opacity: .5; cursor: not-allowed; }

.rec-error { padding: 12px 14px; border-radius: 8px; background: rgba(239,68,68,.1); border: 1px solid rgba(239,68,68,.3); color: var(--red); font-size: 12.5px; }

.cards { display: flex; gap: 16px; flex-wrap: wrap; }
.card { flex: 1; min-width: 190px; padding: 14px 20px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); }
.card.main { flex: 2; min-width: 280px; border-color: var(--green); }
.card-label { font-size: 11px; color: var(--text-sub); text-transform: uppercase; letter-spacing: .06em; font-weight: 500; }
.card-value { margin-top: 4px; font-size: 22px; font-weight: 600; letter-spacing: -.02em; font-family: 'DM Mono', monospace; }
.card-sub { margin-top: 2px; font-size: 11px; color: var(--text-sub); }
.green { color: var(--green); }
.red { color: var(--red); }

.rec-table { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
.state { padding: 40px 24px; text-align: center; font-size: 13px; color: var(--text-muted); }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
thead tr { background: var(--surface2); border-bottom: 1px solid var(--border); }
thead th { padding: 11px 14px; text-align: left; font-weight: 600; font-size: 12px; letter-spacing: .04em; color: var(--text-sub); white-space: nowrap; }
thead th:first-child { padding-left: 20px; }
tbody tr { border-bottom: 1px solid var(--border); transition: background .12s; }
tbody tr:hover { background: var(--surface2); }
tbody tr.clickable { cursor: pointer; }
tbody td { padding: 11px 14px; vertical-align: middle; }
tbody td:first-child, tfoot td:first-child { padding-left: 20px; }
tfoot td { padding: 12px 14px; border-top: 1px solid var(--border-mid, var(--border)); background: var(--surface2); }
.foot-label { text-align: right; font-weight: 600; font-size: 12px; color: var(--text-sub); }
tfoot td.foot-label:first-child { text-align: left; }
.empty { text-align: center; color: var(--text-muted); padding: 40px 14px !important; }
.dim { color: var(--text-sub); font-size: 12.5px; }
.amt { font-family: 'DM Mono', monospace; font-size: 12.5px; text-align: right; font-weight: 600; }
.cust { font-weight: 500; }
.nick { font-weight: 400; font-style: italic; color: var(--text-sub); font-size: 12px; }

.method { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; background: var(--surface2); color: var(--text-sub); }

.bar-row { display: flex; align-items: center; gap: 10px; }
.bar-track { flex: 1; height: 8px; border-radius: 99px; background: var(--surface2); overflow: hidden; min-width: 90px; }
.bar-fill { height: 100%; border-radius: 99px; background: var(--green); transition: width .4s cubic-bezier(.2, .9, .3, 1); }
.bar-row .amt { min-width: 120px; }

.rec-note { font-size: 11.5px; color: var(--text-muted); }
</style>

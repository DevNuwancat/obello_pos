<!--
  ╔═══════════════════════════════════════════════════════════════════╗
  ║  FreeGiftsView.vue — free gifts for big bills                      ║
  ║  A bill of "min amount" or more earns ONE free gift.               ║
  ║  Tab 1: gifts given (who, which invoice, released or pending)      ║
  ║  Tab 2: Pay Later bills that earned a gift but have none yet       ║
  ║  Tab 3: settings (minimum amount) + the list of gift items         ║
  ║  Same Slidebar + light/dark theme + card/table look as             ║
  ║  PayLaterView.vue                                                  ║
  ╚═══════════════════════════════════════════════════════════════════╝
-->

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import Slidebar from '../components/Slidebar.vue'
import Toast from '../components/Toast.vue'
import ProductThumb from '../components/ProductThumb.vue'
import { supabase } from '../lib/supabase'
import { markConnected, markError } from '../lib/connectionStatus'
import { useAuthStore } from '../store/auth'

const auth = useAuthStore()
const isLight = ref(localStorage.getItem('theme') === 'light')

// ──────────────────────────────────────────────
// TYPES
// ──────────────────────────────────────────────
interface Gift {
  id: string
  transaction_id: string
  invoice_no: string
  product_id: string | null
  product_name: string
  sku: string | null
  image_url: string | null
  qty: number
  cost: number
  bill_total: number
  payment_method: string | null
  customer_id: string | null
  customer_name: string | null
  status: 'pending' | 'released'
  given_by_name: string | null
  created_at: string
  released_at: string | null
  released_by_name: string | null
  released_unpaid: boolean
  release_note: string | null
}
interface GiftItem {
  id: string
  product_id: string
  products: { name: string; sku: string | null; barcode: string | null; image_url: string | null; stock: number; cost_price: number } | null
}
interface EligibleBill {
  id: string
  invoice_no: string
  total: number
  created_at: string
  customer_id: string | null
}

// ──────────────────────────────────────────────
// STATE
// ──────────────────────────────────────────────
const loading    = ref(false)
const fetchError = ref('')
const minAmount  = ref(5000)
const minInput   = ref<number | string>(5000)
const gifts      = ref<Gift[]>([])
const giftItems  = ref<GiftItem[]>([])
const eligible   = ref<EligibleBill[]>([])
// Pay Later customers: name + how much they still owe in total
const customerName = ref(new Map<string, string>())
const customerOwed = ref(new Map<string, number>())

const activeTab    = ref<'given' | 'eligible' | 'settings'>('given')
const statusFilter = ref<'all' | 'pending' | 'released' | 'unpaid'>('all')
const payFilter    = ref('all')
const searchQuery  = ref('')
const monthFilter  = ref(thisMonth())

const toastMsg  = ref('')
const toastShow = ref(false)
function toast(msg: string) {
  toastMsg.value = msg
  toastShow.value = true
  setTimeout(() => { toastShow.value = false }, 2600)
}

const fmtRs = (n: number) => `Rs. ${Number(n).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
const payLabel: Record<string, string> = { cash: 'Cash', card: 'Card', bank: 'Bank', later_pay: 'Later Pay' }

function thisMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function monthOf(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
// Last 12 months for the month picker
const monthOptions = computed(() => {
  const out: { value: string; label: string }[] = []
  const d = new Date()
  d.setDate(1)
  for (let i = 0; i < 12; i++) {
    out.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
    })
    d.setMonth(d.getMonth() - 1)
  }
  return out
})

// ──────────────────────────────────────────────
// LOAD
// ──────────────────────────────────────────────
// quiet = refresh the numbers without flashing "Loading…" (keeps the search box open)
async function fetchAll(quiet = false) {
  if (!quiet) loading.value = true
  fetchError.value = ''
  try {
    const [settingsRes, itemsRes, giftsRes] = await Promise.all([
      supabase.from('free_gift_settings').select('min_amount').eq('id', 1).maybeSingle(),
      supabase.from('free_gift_items')
        .select('id, product_id, products(name, sku, barcode, image_url, stock, cost_price)')
        .order('added_at', { ascending: false }),
      supabase.from('free_gifts').select('*').order('created_at', { ascending: false }).limit(1000),
    ])
    if (giftsRes.error) { fetchError.value = giftsRes.error.message; markError(); return }
    if (itemsRes.error) { fetchError.value = itemsRes.error.message; markError(); return }

    if (settingsRes.data) {
      minAmount.value = Number(settingsRes.data.min_amount)
      minInput.value  = minAmount.value
    }
    giftItems.value = (itemsRes.data ?? []) as unknown as GiftItem[]
    gifts.value     = (giftsRes.data ?? []) as Gift[]

    // Pay Later bills big enough for a gift (transactions are kept ~4 months)
    const { data: billData, error: billError } = await supabase
      .from('transactions')
      .select('id, invoice_no, total, created_at, customer_id')
      .eq('payment_method', 'later_pay')
      .eq('status', 'completed')
      .gte('total', minAmount.value)
      .not('customer_id', 'is', null)
      .order('created_at', { ascending: false })
    if (billError) { fetchError.value = billError.message; markError(); return }
    const haveGift = new Set(gifts.value.map(g => g.transaction_id))
    eligible.value = ((billData ?? []) as EligibleBill[]).filter(b => !haveGift.has(b.id))

    // Names + what each Pay Later customer still owes
    const ids = [...new Set([
      ...gifts.value.map(g => g.customer_id),
      ...eligible.value.map(b => b.customer_id),
    ].filter((x): x is string => !!x))]
    const names = new Map<string, string>()
    const owed  = new Map<string, number>()
    if (ids.length > 0) {
      const { data: bal } = await supabase.from('pay_later_balances').select('id, name, total_owed').in('id', ids)
      for (const c of bal ?? []) { names.set(c.id, c.name); owed.set(c.id, Number(c.total_owed)) }
    }
    customerName.value = names
    customerOwed.value = owed

    markConnected()
  } catch {
    fetchError.value = 'Could not load free gifts.'
    markError()
  } finally {
    loading.value = false
  }
}

onMounted(() => fetchAll())

// ──────────────────────────────────────────────
// GIFTS GIVEN (tab 1)
// ──────────────────────────────────────────────
const periodGifts = computed(() =>
  gifts.value.filter(g => monthFilter.value === 'all' || monthOf(g.created_at) === monthFilter.value)
)

const shownGifts = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return periodGifts.value.filter(g => {
    if (statusFilter.value === 'pending'  && g.status !== 'pending') return false
    if (statusFilter.value === 'released' && g.status !== 'released') return false
    if (statusFilter.value === 'unpaid'   && !(g.status === 'pending' && owedOf(g) > 0) && !g.released_unpaid) return false
    if (payFilter.value !== 'all' && g.payment_method !== payFilter.value) return false
    if (!q) return true
    return g.invoice_no.toLowerCase().includes(q)
      || customerOf(g).toLowerCase().includes(q)
      || g.product_name.toLowerCase().includes(q)
      || (g.sku || '').toLowerCase().includes(q)
  })
})

// The name on the bill, if there was one (otherwise the invoice number is all we show)
function customerOf(g: Gift): string {
  return (g.customer_id && customerName.value.get(g.customer_id)) || g.customer_name || ''
}
// What the Pay Later customer still owes in total (0 for cash / card / bank)
function owedOf(g: Gift): number {
  return g.customer_id ? (customerOwed.value.get(g.customer_id) ?? 0) : 0
}

const statGiven    = computed(() => periodGifts.value.reduce((s, g) => s + g.qty, 0))
const statCost     = computed(() => periodGifts.value.reduce((s, g) => s + g.cost * g.qty, 0))
const statPending  = computed(() => gifts.value.filter(g => g.status === 'pending').length)
const statUnpaid   = computed(() => gifts.value.filter(g => g.released_unpaid || (g.status === 'pending' && owedOf(g) > 0)).length)

// ── Release a pending gift ──
const releaseTarget = ref<Gift | null>(null)
const releaseNote   = ref('')
const releaseBusy   = ref(false)
const releaseError  = ref('')

function openRelease(g: Gift) {
  releaseTarget.value = g
  releaseNote.value = ''
  releaseError.value = ''
}
function closeRelease() { if (!releaseBusy.value) releaseTarget.value = null }

async function confirmRelease() {
  const g = releaseTarget.value
  if (!g) return
  releaseBusy.value = true
  releaseError.value = ''
  const { error } = await supabase.rpc('release_free_gift', { p_gift_id: g.id, p_note: releaseNote.value })
  releaseBusy.value = false
  if (error) { releaseError.value = error.message; return }
  releaseTarget.value = null
  toast('Gift released')
  fetchAll()
}

// ──────────────────────────────────────────────
// ELIGIBLE PAY LATER BILLS (tab 2)
// ──────────────────────────────────────────────
// Only a SINGLE bill of the minimum amount or more qualifies — bills are never added together.
// (fetchAll already asks for bills with total >= minimum; the month picker narrows the list.)
const periodEligible = computed(() =>
  eligible.value.filter(b => b.total >= minAmount.value && (monthFilter.value === 'all' || monthOf(b.created_at) === monthFilter.value))
)

const shownEligible = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return periodEligible.value.filter(b => {
    if (!q) return true
    const name = (b.customer_id && customerName.value.get(b.customer_id)) || ''
    return b.invoice_no.toLowerCase().includes(q) || name.toLowerCase().includes(q)
  })
})

const giveTarget = ref<EligibleBill | null>(null)
const giveSearch = ref('')
const giveBusy   = ref(false)
const giveError  = ref('')

const giveChoices = computed(() => {
  const q = giveSearch.value.trim().toLowerCase()
  return giftItems.value.filter(i => {
    if (!q || !i.products) return !!i.products
    return i.products.name.toLowerCase().includes(q)
      || (i.products.sku || '').toLowerCase().includes(q)
      || i.products.barcode === giveSearch.value.trim()
  })
})

function openGive(b: EligibleBill) {
  giveTarget.value = b
  giveSearch.value = ''
  giveError.value = ''
}
function closeGive() { if (!giveBusy.value) giveTarget.value = null }

async function giveGift(item: GiftItem) {
  const b = giveTarget.value
  if (!b || !item.products) return
  if (item.products.stock <= 0) { giveError.value = `${item.products.name} is out of stock.`; return }
  giveBusy.value = true
  giveError.value = ''
  // Pay Later gifts start as "pending" — release them when you hand them over
  const { error } = await supabase.rpc('give_free_gift', {
    p_transaction_id: b.id,
    p_product_id: item.product_id,
    p_release_now: false,
  })
  giveBusy.value = false
  if (error) { giveError.value = error.message; return }
  giveTarget.value = null
  toast('Gift added to ' + b.invoice_no)
  fetchAll()
}

// ──────────────────────────────────────────────
// SETTINGS + GIFT LIST (tab 3)
// ──────────────────────────────────────────────
const savingMin = ref(false)
async function saveMin() {
  const n = Number(minInput.value)
  if (!n || n <= 0) { toast('Enter an amount above 0'); return }
  savingMin.value = true
  const { error } = await supabase.from('free_gift_settings')
    .update({ min_amount: n, updated_at: new Date().toISOString() }).eq('id', 1)
  savingMin.value = false
  if (error) { toast('Could not save: ' + error.message); return }
  toast('Minimum bill amount saved')
  fetchAll(true)
}

// Search the whole stock (name / SKU / barcode) to add gift items
const productSearch  = ref('')
const productResults = ref<{ id: string; name: string; sku: string | null; barcode: string | null; image_url: string | null; stock: number; cost_price: number; selling_price: number; sub_category: string | null }[]>([])
const ddOpen         = ref(false)
function closeDd() { setTimeout(() => { ddOpen.value = false }, 150) }
const searching      = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | null = null

watch(productSearch, (q) => {
  if (searchTimer) clearTimeout(searchTimer)
  const text = q.trim().replace(/[%,()]/g, ' ')
  if (text.length < 2) { productResults.value = []; ddOpen.value = false; return }
  ddOpen.value = true
  searchTimer = setTimeout(async () => {
    searching.value = true
    const { data } = await supabase
      .from('products')
      .select('id, name, sku, barcode, image_url, stock, cost_price, selling_price, sub_category')
      .or(`name.ilike.%${text}%,sku.ilike.%${text}%,barcode.eq.${text}`)
      .order('name')
      .limit(40)
    searching.value = false
    productResults.value = data ?? []
  }, 250)
})

const giftProductIds = computed(() => new Set(giftItems.value.map(i => i.product_id)))

async function addGiftItem(productId: string) {
  const { error } = await supabase.from('free_gift_items').insert({ product_id: productId, added_by: auth.user?.id ?? null })
  if (error) { toast('Could not add: ' + error.message); return }
  toast('Added to the gift list')
  fetchAll(true)   // the row flips to "On list"; the dropdown stays open so you can add more
}

async function removeGiftItem(item: GiftItem) {
  const { error } = await supabase.from('free_gift_items').delete().eq('id', item.id)
  if (error) { toast('Could not remove: ' + error.message); return }
  toast('Removed from the gift list')
  fetchAll(true)
}
</script>

<template>
  <div class="page-wrap" :class="{ light: isLight }">

    <Slidebar v-model:isLight="isLight" />

    <main class="main">

      <div class="page-header">
        <h1 class="page-title">Free Gifts</h1>
        <p class="page-sub">A bill of {{ fmtRs(minAmount) }} or more earns one free gift · who got it, what it cost, and what is still to hand over</p>
      </div>

      <!-- ── STATS ── -->
      <div class="stats-bar">
        <div class="stat-card">
          <div class="stat-label">Gifts Given</div>
          <div class="stat-value gift">{{ statGiven }}</div>
          <div class="stat-sub">{{ monthFilter === 'all' ? 'all time' : 'in the selected month' }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Gift Cost</div>
          <div class="stat-value low">{{ fmtRs(statCost) }}</div>
          <div class="stat-sub">taken off profit</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">To Release</div>
          <div class="stat-value">{{ statPending }}</div>
          <div class="stat-sub">pending, stock already taken</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Not Paid Yet</div>
          <div class="stat-value">{{ statUnpaid }}</div>
          <div class="stat-sub">gift given, customer still owes</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Waiting for a Gift</div>
          <div class="stat-value">{{ periodEligible.length }}</div>
          <div class="stat-sub">single Pay Later bills ≥ {{ fmtRs(minAmount) }}, no gift yet</div>
        </div>
      </div>

      <!-- ── TABS ── -->
      <div class="tabs">
        <button class="tab" :class="{ active: activeTab === 'given' }" @click="activeTab = 'given'">
          Gifts Given <span class="tab-count">{{ periodGifts.length }}</span>
        </button>
        <button class="tab" :class="{ active: activeTab === 'eligible' }" @click="activeTab = 'eligible'">
          Pay Later · No Gift Yet <span class="tab-count">{{ periodEligible.length }}</span>
        </button>
        <button class="tab" :class="{ active: activeTab === 'settings' }" @click="activeTab = 'settings'">
          Gift List &amp; Amount <span class="tab-count">{{ giftItems.length }}</span>
        </button>
      </div>

      <!-- ── TOOLBAR (tabs 1 + 2) ── -->
      <div v-if="activeTab !== 'settings'" class="toolbar">
        <div class="search-box">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path stroke-linecap="round" d="m21 21-4.35-4.35"/></svg>
          <input v-model="searchQuery" type="text" placeholder="Invoice, customer or gift…" />
        </div>

        <template v-if="activeTab === 'given'">
          <div class="chips">
            <button class="chip" :class="{ active: statusFilter === 'all' }" @click="statusFilter = 'all'">All</button>
            <button class="chip" :class="{ active: statusFilter === 'pending' }" @click="statusFilter = 'pending'">To release</button>
            <button class="chip" :class="{ active: statusFilter === 'released' }" @click="statusFilter = 'released'">Released</button>
            <button class="chip" :class="{ active: statusFilter === 'unpaid' }" @click="statusFilter = 'unpaid'">Not paid yet</button>
          </div>
          <select v-model="payFilter" class="select">
            <option value="all">All payments</option>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="bank">Bank</option>
            <option value="later_pay">Later Pay</option>
          </select>
        </template>

        <select v-model="monthFilter" class="select">
          <option value="all">All time</option>
          <option v-for="m in monthOptions" :key="m.value" :value="m.value">{{ m.label }}</option>
        </select>

        <div class="toolbar-right">
          <button class="btn btn-outline" @click="fetchAll()" title="Refresh data">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.08-6.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Refresh
          </button>
        </div>
      </div>

      <!-- ── TABLE ── -->
      <div class="table-wrap" :class="{ 'dd-open': activeTab === 'settings' }">
        <div v-if="loading" class="state-msg">Loading free gifts…</div>
        <div v-else-if="fetchError" class="state-error">{{ fetchError }}</div>

        <!-- TAB 1: gifts given -->
        <table v-else-if="activeTab === 'given'">
          <thead>
            <tr>
              <th>#</th>
              <th>Date</th>
              <th>Invoice / Customer</th>
              <th>Gift</th>
              <th style="text-align:right">Bill</th>
              <th>Payment</th>
              <th style="text-align:right">Customer Owes</th>
              <th>Status</th>
              <th style="text-align:right; padding-right:20px;">Action</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="shownGifts.length === 0">
              <td colspan="9" class="empty-row">No gifts found</td>
            </tr>
            <tr v-for="(g, i) in shownGifts" :key="g.id">
              <td>{{ i + 1 }}</td>
              <td class="date-cell">{{ fmtDate(g.created_at) }}<div class="cust-id">{{ fmtTime(g.created_at) }}<template v-if="g.given_by_name"> · {{ g.given_by_name }}</template></div></td>
              <td>
                <div class="name-cell mono">{{ g.invoice_no }}</div>
                <div v-if="customerOf(g)" class="cust-id">{{ customerOf(g) }}</div>
              </td>
              <td>
                <div class="gift-cell">
                  <ProductThumb :src="g.image_url" :size="40" />
                  <div>
                    <div class="name-cell">{{ g.product_name }}</div>
                    <div class="cust-id">{{ g.sku }}</div>
                  </div>
                </div>
              </td>
              <td class="price-cell" style="text-align:right">{{ fmtRs(g.bill_total) }}</td>
              <td>{{ payLabel[g.payment_method ?? ''] ?? g.payment_method }}</td>
              <td class="price-cell" style="text-align:right">
                <template v-if="g.customer_id">
                  <span :class="owedOf(g) > 0 ? 'owe' : 'settled'">{{ owedOf(g) > 0 ? fmtRs(owedOf(g)) : 'Paid' }}</span>
                </template>
                <span v-else class="muted">—</span>
              </td>
              <td>
                <span v-if="g.status === 'pending'" class="badge badge-pending">To release</span>
                <template v-else>
                  <span class="badge badge-released">Released</span>
                  <span v-if="g.released_unpaid" class="badge badge-unpaid" title="Handed over while the customer still owed money">Not paid</span>
                  <div v-if="g.released_at && g.payment_method === 'later_pay'" class="cust-id">{{ fmtDate(g.released_at) }} · {{ g.released_by_name }}</div>
                  <div v-if="g.release_note" class="cust-id">“{{ g.release_note }}”</div>
                </template>
              </td>
              <td style="text-align:right; padding-right:20px;">
                <button v-if="g.status === 'pending'" class="btn-gift" @click="openRelease(g)">Release</button>
              </td>
            </tr>
          </tbody>
        </table>

        <!-- TAB 2: Pay Later bills with no gift yet -->
        <div v-else-if="activeTab === 'eligible'">
        <div class="rule-note">One bill of {{ fmtRs(minAmount) }} or more earns one gift. A customer's separate bills are never added together.</div>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Date</th>
              <th>Invoice</th>
              <th>Customer</th>
              <th style="text-align:right">Bill</th>
              <th style="text-align:right">Customer Owes</th>
              <th style="text-align:right; padding-right:20px;">Action</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="shownEligible.length === 0">
              <td colspan="7" class="empty-row">Every big Pay Later bill already has its gift</td>
            </tr>
            <tr v-for="(b, i) in shownEligible" :key="b.id">
              <td>{{ i + 1 }}</td>
              <td class="date-cell">{{ fmtDate(b.created_at) }}<div class="cust-id">{{ fmtTime(b.created_at) }}</div></td>
              <td class="name-cell mono">{{ b.invoice_no }}</td>
              <td class="name-cell">{{ (b.customer_id && customerName.get(b.customer_id)) || '—' }}</td>
              <td class="price-cell" style="text-align:right">{{ fmtRs(b.total) }}</td>
              <td class="price-cell" style="text-align:right">
                <span :class="(customerOwed.get(b.customer_id ?? '') ?? 0) > 0 ? 'owe' : 'settled'">
                  {{ (customerOwed.get(b.customer_id ?? '') ?? 0) > 0 ? fmtRs(customerOwed.get(b.customer_id ?? '') ?? 0) : 'Paid' }}
                </span>
              </td>
              <td style="text-align:right; padding-right:20px;">
                <button class="btn-gift" @click="openGive(b)">Give gift</button>
              </td>
            </tr>
          </tbody>
        </table>
        </div>

        <!-- TAB 3: settings + gift list -->
        <div v-else class="settings">
          <div class="set-card">
            <div class="set-title">Gift rules</div>

            <div class="set-block">
              <div class="set-label">Minimum bill amount</div>
              <div class="set-sub">One bill of this amount or more (after discount) can take one free gift.</div>
              <div class="set-row">
                <input v-model.number="minInput" type="number" min="1" class="set-input" />
                <button class="btn btn-primary" :disabled="savingMin" @click="saveMin">{{ savingMin ? 'Saving…' : 'Save' }}</button>
              </div>
            </div>

            <div class="set-block">
              <div class="set-label">Add a gift item</div>
              <div class="set-sub">Search your stock by name, SKU or barcode. Gift items can't be sold normally in the cart.</div>

              <div class="dd-wrap">
                <svg class="dd-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input
                  v-model="productSearch"
                  class="dd-input"
                  placeholder="Scan barcode or type name / SKU…"
                  autocomplete="off"
                  @focus="ddOpen = productSearch.trim().length >= 2"
                  @blur="closeDd"
                  @keydown.esc="ddOpen = false"
                />

                <Transition name="dd-pop">
                  <div v-if="ddOpen" class="dd-panel">
                    <div v-if="searching && productResults.length === 0" class="dd-state">Searching…</div>
                    <div v-else-if="productResults.length === 0" class="dd-state">No items found</div>
                    <template v-else>
                      <div class="dd-count">{{ productResults.length }}{{ productResults.length === 40 ? '+' : '' }} found · scroll for more</div>
                      <div class="dd-list">
                        <div
                          v-for="p in productResults"
                          :key="p.id"
                          class="dd-item"
                          :class="{ added: giftProductIds.has(p.id) }"
                          @mousedown.prevent="!giftProductIds.has(p.id) && addGiftItem(p.id)"
                        >
                          <ProductThumb :src="p.image_url" :size="44" />
                          <div class="dd-info">
                            <div class="dd-name">{{ p.name }}</div>
                            <div class="dd-meta">{{ p.sku }}<template v-if="p.sub_category"> · {{ p.sub_category }}</template></div>
                          </div>
                          <div class="dd-right">
                            <span v-if="giftProductIds.has(p.id)" class="dd-added">✓ On the list</span>
                            <template v-else>
                              <span class="dd-price">{{ fmtRs(p.selling_price) }}</span>
                              <span class="dd-stock" :class="p.stock > 0 ? 'in' : 'out'">{{ p.stock > 0 ? p.stock + ' in stock' : 'Out of stock' }}</span>
                            </template>
                          </div>
                        </div>
                      </div>
                    </template>
                  </div>
                </Transition>
              </div>
            </div>
          </div>

          <div class="set-table">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Gift item</th>
                <th>SKU</th>
                <th style="text-align:right">In stock</th>
                <th style="text-align:right">Cost</th>
                <th style="text-align:right; padding-right:20px;">Action</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="giftItems.length === 0">
                <td colspan="6" class="empty-row">No gift items yet — search above to add one</td>
              </tr>
              <tr v-for="(it, i) in giftItems" :key="it.id">
                <td>{{ i + 1 }}</td>
                <td>
                  <div class="gift-cell">
                    <ProductThumb :src="it.products?.image_url" :size="40" />
                    <div class="name-cell">{{ it.products?.name ?? 'Deleted item' }}</div>
                  </div>
                </td>
                <td class="mono">{{ it.products?.sku }}</td>
                <td class="price-cell" style="text-align:right" :class="{ owe: (it.products?.stock ?? 0) <= 0 }">{{ it.products?.stock ?? 0 }}</td>
                <td class="price-cell" style="text-align:right">{{ fmtRs(it.products?.cost_price ?? 0) }}</td>
                <td style="text-align:right; padding-right:20px;">
                  <button class="btn-remove" @click="removeGiftItem(it)">Remove</button>
                </td>
              </tr>
            </tbody>
          </table>
          </div>
        </div>
      </div>
    </main>

    <!-- ── RELEASE MODAL ── -->
    <Transition name="fade">
      <div v-if="releaseTarget" class="overlay" @click.self="closeRelease">
        <div class="modal">
          <div class="modal-title">Release this gift?</div>
          <div class="modal-text">
            <b>{{ releaseTarget.product_name }}</b> for <span class="mono">{{ releaseTarget.invoice_no }}</span>
            <template v-if="customerOf(releaseTarget)"> · {{ customerOf(releaseTarget) }}</template>
          </div>
          <div v-if="owedOf(releaseTarget) > 0" class="warn">
            This customer still owes {{ fmtRs(owedOf(releaseTarget)) }}. You can still release the gift — it will be marked “Not paid”.
          </div>
          <input v-model="releaseNote" class="set-input wide" placeholder="Note (optional)" />
          <div v-if="releaseError" class="state-error" style="margin:0">{{ releaseError }}</div>
          <div class="modal-actions">
            <button class="btn btn-outline" :disabled="releaseBusy" @click="closeRelease">Cancel</button>
            <button class="btn btn-gift-solid" :disabled="releaseBusy" @click="confirmRelease">{{ releaseBusy ? 'Releasing…' : 'Release gift' }}</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ── GIVE-A-GIFT MODAL (Pay Later bill with no gift) ── -->
    <Transition name="fade">
      <div v-if="giveTarget" class="overlay" @click.self="closeGive">
        <div class="modal">
          <div class="modal-title">Give a free gift</div>
          <div class="modal-text">
            <span class="mono">{{ giveTarget.invoice_no }}</span> · {{ fmtRs(giveTarget.total) }}
            <template v-if="giveTarget.customer_id"> · {{ customerName.get(giveTarget.customer_id) }}</template>
          </div>
          <input v-model="giveSearch" class="set-input wide" placeholder="Search the gift list…" autocomplete="off" />
          <div class="pick-list">
            <div v-if="giveChoices.length === 0" class="muted" style="text-align:center;padding:16px">No gift items</div>
            <button v-for="it in giveChoices" :key="it.id" class="pick-row" :class="{ out: (it.products?.stock ?? 0) <= 0 }" :disabled="giveBusy" @click="giveGift(it)">
              <ProductThumb :src="it.products?.image_url" :size="40" />
              <div class="result-text">
                <div class="name-cell">{{ it.products?.name }}</div>
                <div class="cust-id">{{ it.products?.sku }}</div>
              </div>
              <span class="gift-stock">{{ (it.products?.stock ?? 0) > 0 ? it.products?.stock + ' in stock' : 'Out of stock' }}</span>
            </button>
          </div>
          <div v-if="giveError" class="state-error" style="margin:0">{{ giveError }}</div>
          <div class="modal-actions">
            <button class="btn btn-outline" :disabled="giveBusy" @click="closeGive">Close</button>
          </div>
        </div>
      </div>
    </Transition>

    <Toast :message="toastMsg" :show="toastShow" />
  </div>
</template>

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
  --gift:      #a78bfa;
  --gift-bg:   rgba(167,139,250,0.14);
  --gift-border: rgba(167,139,250,0.4);
  --amber:     #fbbf24;
  --amber-bg:  rgba(251,191,36,0.14);
  --shadow:    0 1px 3px rgba(0,0,0,.5);
  --radius:    12px;
}
.page-wrap.light {
  --bg:        #F7F5F2;
  --surface:   #ffffff;
  --surface2:  #f7f5f2;
  --border:    rgba(0,0,0,0.16);
  --text:      #1a1a1a;
  --text-sub:  #6b6660;
  --text-muted:#B0ADA5;
  --accent:    #1a1a1a;
  --accent-fg: #ffffff;
  --red:       #dc2626;
  --green:     #16a34a;
  --gift:      #7c3aed;
  --gift-bg:   #f3efff;
  --gift-border: #c4b5fd;
  --amber:     #b45309;
  --amber-bg:  #fef3c7;
  --shadow:    0 1px 3px rgba(0,0,0,.08), 0 4px 16px rgba(0,0,0,.04);
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

.page-wrap { display: flex; min-height: 100vh; width: 100%; background: var(--bg); color: var(--text); font-family: 'DM Sans', sans-serif; transition: background .3s, color .3s; }
::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 99px; }

.main { flex: 1; display: flex; flex-direction: column; min-height: 100vh; overflow-y: auto; }
.page-header { padding: 32px 32px 0; }
.page-title  { font-size: 26px; font-weight: 600; letter-spacing: -.02em; }
.page-sub    { font-size: 13px; color: var(--text-sub); margin-top: 2px; }

.stats-bar { display: flex; gap: 16px; padding: 24px 32px 4px; flex-wrap: wrap; }
.stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 20px; flex: 1; min-width: 160px; box-shadow: var(--shadow); }
.stat-label { font-size: 11px; color: var(--text-sub); text-transform: uppercase; letter-spacing: .06em; font-weight: 500; }
.stat-value { font-size: 22px; font-weight: 600; margin-top: 4px; letter-spacing: -.02em; font-family: 'DM Mono', monospace; }
.stat-value.low  { color: var(--red); }
.stat-value.gift { color: var(--gift); }
.stat-sub { font-size: 11px; color: var(--text-sub); margin-top: 2px; }

.tabs { display: flex; gap: 4px; padding: 18px 32px 0; flex-wrap: wrap; }
.tab { padding: 9px 18px; border-radius: 9px 9px 0 0; border: 1px solid var(--border); border-bottom: none; background: var(--surface2); color: var(--text-sub); font-size: 13px; font-weight: 500; font-family: 'DM Sans', sans-serif; cursor: pointer; transition: background .15s, color .15s; display: flex; align-items: center; gap: 7px; }
.tab.active { background: var(--surface); color: var(--text); font-weight: 600; }
.tab-count { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: var(--bg); font-size: 10.5px; font-weight: 700; }

.toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; background: var(--surface); border: 1px solid var(--border); border-radius: 0 var(--radius) var(--radius) var(--radius); margin: 0 32px; padding: 14px 20px; }
.search-box { display: flex; align-items: center; gap: 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; flex: 1; max-width: 300px; }
.search-box svg { width: 15px; height: 15px; color: var(--text-sub); flex-shrink: 0; }
.search-box input { border: none; background: transparent; font-family: 'DM Sans', sans-serif; font-size: 13px; color: var(--text); outline: none; width: 100%; }
.chips { display: flex; gap: 6px; }
.chip { padding: 7px 13px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text-sub); font-size: 12px; font-family: 'DM Sans', sans-serif; cursor: pointer; transition: all .15s; }
.chip.active { border-color: var(--accent); background: var(--accent); color: var(--accent-fg); font-weight: 600; }
.select { padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font-size: 12.5px; font-family: 'DM Sans', sans-serif; outline: none; }

.btn { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid transparent; transition: opacity .15s, background .15s; }
.btn svg { width: 14px; height: 14px; }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.btn-primary { background: var(--accent); color: var(--accent-fg); }
.btn-primary:hover { opacity: .85; }
.btn-outline { background: var(--bg); border-color: var(--border); color: var(--text); }
.btn-outline:hover { background: var(--surface2); }
.btn-gift-solid { background: var(--gift); color: #fff; }
.btn-gift-solid:hover { opacity: .88; }
.toolbar-right { margin-left: auto; display: flex; gap: 8px; }

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
tbody td { padding: 12px 14px; vertical-align: middle; }
tbody td:first-child { padding-left: 20px; color: var(--text-sub); font-family: 'DM Mono', monospace; font-size: 12px; }
.empty-row { text-align: center; color: var(--text-muted); padding: 40px 14px !important; }
@keyframes rowIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

.name-cell { font-weight: 500; }
.mono { font-family: 'DM Mono', monospace; font-size: 12.5px; }
.cust-id { font-size: 10.5px; color: var(--text-muted); margin-top: 2px; font-weight: 400; }
.date-cell { color: var(--text-sub); font-size: 12px; }
.price-cell { font-family: 'DM Mono', monospace; font-size: 12.5px; }
.muted { color: var(--text-muted); font-size: 12px; }
.owe { color: var(--red); font-weight: 600; }
.settled { color: var(--green); font-weight: 600; }

.gift-cell { display: flex; align-items: center; gap: 10px; }
.gift-img { width: 40px; height: 40px; border-radius: 8px; object-fit: cover; background: var(--surface2); flex-shrink: 0; }
.gift-img-empty { border: 1px dashed var(--border); }

.badge { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; margin-right: 4px; }
.badge-pending  { background: var(--gift-bg); color: var(--gift); border: 1px solid var(--gift-border); }
.badge-released { background: rgba(74,222,128,.14); color: var(--green); }
.badge-unpaid   { background: var(--amber-bg); color: var(--amber); }

.btn-gift { padding: 6px 16px; border-radius: 7px; border: none; background: var(--gift); color: #fff; font-size: 12px; font-weight: 600; font-family: 'DM Sans', sans-serif; cursor: pointer; transition: opacity .15s; }
.btn-gift:hover { opacity: .85; }
.btn-remove { padding: 5px 12px; border-radius: 7px; border: 1px solid var(--border); background: var(--bg); color: var(--text-sub); font-size: 12px; font-family: 'DM Sans', sans-serif; cursor: pointer; transition: all .15s; }
.btn-remove:hover { color: var(--red); border-color: var(--red); }

/* settings tab */
.settings { display: flex; flex-direction: column; }
.set-card { padding: 20px 24px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; }
.set-title { font-size: 14px; font-weight: 600; }
.set-block { display: flex; flex-direction: column; gap: 8px; padding-top: 6px; }
.set-card { display: grid; grid-template-columns: minmax(260px, 340px) 1fr; column-gap: 32px; row-gap: 4px; align-items: start; }
.set-card .set-title { grid-column: 1 / -1; }
.set-block + .set-block { padding-left: 32px; border-left: 1px dashed var(--border); }
@media (max-width: 900px) {
  .set-card { grid-template-columns: 1fr; }
  .set-block + .set-block { padding-left: 0; border-left: none; padding-top: 16px; border-top: 1px dashed var(--border); }
}
.set-label { font-size: 13px; font-weight: 600; }
.rule-note { padding: 12px 20px; font-size: 12px; color: var(--text-sub); background: var(--gift-bg); border-bottom: 1px solid var(--border); }
.set-sub { font-size: 12px; color: var(--text-sub); }
.set-row { display: flex; gap: 10px; align-items: center; margin-top: 4px; }
.set-input { padding: 9px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13.5px; font-family: 'DM Sans', sans-serif; outline: none; width: 180px; }
.set-input.wide { width: 100%; max-width: 420px; }
.set-input:focus { border-color: var(--gift-border); }
.set-note { font-size: 12px; color: var(--text-muted); }
.result-row, .pick-row { display: flex; align-items: center; gap: 12px; padding: 8px 10px; border-radius: 10px; max-width: 520px; }
.result-row { background: var(--bg); border: 1px solid var(--border); }
.result-text { flex: 1; min-width: 0; }

/* modals */
.overlay { position: fixed; inset: 0; z-index: 1100; background: rgba(0,0,0,.55); backdrop-filter: blur(5px); display: flex; align-items: center; justify-content: center; }
.modal { width: 460px; max-width: calc(100vw - 40px); max-height: 86vh; overflow-y: auto; background: var(--surface); border: 1px solid var(--border); border-radius: 18px; padding: 22px; display: flex; flex-direction: column; gap: 12px; box-shadow: 0 8px 32px rgba(0,0,0,.4); }
.modal-title { font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 16px; }
.modal-text { font-size: 13px; color: var(--text-sub); }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }
.warn { padding: 10px 12px; border-radius: 8px; background: var(--amber-bg); color: var(--amber); font-size: 12.5px; }
.pick-list { display: flex; flex-direction: column; gap: 8px; max-height: 300px; overflow-y: auto; }
.pick-row { background: var(--bg); border: 1px solid var(--border); cursor: pointer; text-align: left; color: var(--text); font-family: 'DM Sans', sans-serif; max-width: none; transition: border-color .15s, background .15s; }
.pick-row:hover:not(:disabled) { border-color: var(--gift-border); background: var(--gift-bg); }
.pick-row.out { opacity: .5; }
.gift-stock { font-size: 11.5px; color: var(--gift); white-space: nowrap; }

/* gift search dropdown (same look as the POS search dropdown, with a scrolling list) */
.table-wrap.dd-open { overflow: visible; }
.set-table { border-top: 1px solid var(--border); border-radius: 0 0 var(--radius) var(--radius); overflow: hidden; }
.dd-wrap { position: relative; max-width: 560px; }
.dd-icon { position: absolute; left: 13px; top: 13px; color: var(--text-muted); pointer-events: none; }
.dd-input {
  width: 100%; padding: 11px 14px 11px 38px; background: var(--bg); border: 1px solid var(--border);
  border-radius: 10px; color: var(--text); font-size: 13.5px; font-family: 'DM Sans', sans-serif; outline: none;
  transition: border-color .15s, box-shadow .15s;
}
.dd-input:focus { border-color: var(--gift-border); box-shadow: 0 0 0 3px var(--gift-bg); }
.dd-input::placeholder { color: var(--text-muted); }
.dd-panel {
  position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 60;
  background: var(--surface); border: 1px solid var(--border); border-radius: 14px; overflow: hidden;
  box-shadow: 0 12px 36px rgba(0,0,0,.45); transform-origin: top center;
}
.page-wrap.light .dd-panel { box-shadow: 0 12px 36px rgba(0,0,0,.14); }
.dd-state { padding: 22px 16px; text-align: center; font-size: 13px; color: var(--text-muted); }
.dd-count { padding: 8px 16px; font-size: 11px; color: var(--text-muted); background: var(--surface2); border-bottom: 1px solid var(--border); }
.dd-list { max-height: 340px; overflow-y: auto; overscroll-behavior: contain; }
.dd-item { display: flex; align-items: center; gap: 12px; padding: 10px 16px; cursor: pointer; border-bottom: 1px solid var(--border); transition: background .12s; }
.dd-item:last-child { border-bottom: none; }
.dd-item:hover { background: var(--gift-bg); }
.dd-item.added { cursor: default; opacity: .65; }
.dd-item.added:hover { background: transparent; }
.dd-img { width: 44px; height: 44px; border-radius: 9px; object-fit: cover; border: 1px solid var(--border); flex-shrink: 0; background: var(--surface2); }
.dd-img-empty { border-style: dashed; }
.dd-info { flex: 1; min-width: 0; }
.dd-name { font-size: 13.5px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dd-meta { font-size: 11px; color: var(--text-muted); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dd-right { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; flex-shrink: 0; }
.dd-price { font-size: 13px; font-weight: 600; }
.dd-stock { font-size: 10.5px; padding: 1px 8px; border-radius: 999px; }
.dd-stock.in  { color: var(--green); background: rgba(74,222,128,.12); }
.dd-stock.out { color: var(--red); background: rgba(248,113,113,.12); }
.dd-added { font-size: 12px; font-weight: 600; color: var(--gift); }
.dd-pop-enter-active { transition: opacity .18s ease, transform .22s cubic-bezier(.2,.9,.3,1.2); }
.dd-pop-leave-active { transition: opacity .12s ease, transform .12s ease; }
.dd-pop-enter-from, .dd-pop-leave-to { opacity: 0; transform: translateY(-6px) scale(.98); }

.fade-enter-active, .fade-leave-active { transition: opacity .2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>

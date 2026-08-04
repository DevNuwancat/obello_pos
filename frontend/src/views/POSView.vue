<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import Slidebar from '../components/Slidebar.vue'
import PayLaterModal from '../components/modals/PayLaterModal.vue'
import { useAuthStore } from "../store/auth"
import { supabase } from '../lib/supabase'



const auth = useAuthStore()
// ── THEME ──
// isLight still lives here because .pos-wrap needs the .light class
const isLight = ref(localStorage.getItem('theme') === 'light')

// ── PRODUCTS (loaded live from the Supabase "products" table) ──
// discount / super_discount are the FINAL Rs. price for those modes
// selling_price is the original tag price ("Original" price mode)
interface Product {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  selling_price: number
  discount: number
  super_discount: number
  stock: number
  image_url: string | null
  main_category: string | null
}

const PRODUCTS = ref<Product[]>([])
const loadingProducts = ref(false)
const loadError = ref('')

async function fetchProducts() {
  loadingProducts.value = true
  loadError.value = ''
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) {
    loadError.value = error.message
  } else {
    PRODUCTS.value = data ?? []
  }
  loadingProducts.value = false
}

// discount / super_discount in Supabase are the FINAL Rs. price for that mode
// (not a percentage and not a subtracted amount) — e.g. selling_price 1500, discount 1300
// means "Discount" mode charges Rs. 1300 for the item.
function priceForMode(product: Product, mode: string): number {
  if (mode === 'original') return product.selling_price
  if (mode === 'royal')    return product.super_discount ?? product.selling_price
  return product.discount ?? product.selling_price // 'discount' (default)
}

// ── CART STATE ──
const cart        = ref<any[]>([])
const discount    = ref(0)
const amountPaid  = ref(0)
const payMethod   = ref('Cash')
const printReceipt = ref(true)
const checkoutDone = ref(false)
const checkingOut  = ref(false)
const showPayLaterModal = ref(false)

// When Later Pay is selected, turn off "Print with Receipt" automatically —
// you can still toggle it on manually in the Pay Later modal itself.
watch(payMethod, (method) => {
  if (method === 'Later Pay') printReceipt.value = false
})
const toastMsg    = ref('')
const toastVisible = ref(false)
const searchQuery = ref('')
const barcodeInput    = ref('')
const barcodeInputEl  = ref<HTMLInputElement | null>(null)
const barcodeSuccess  = ref(false)
const barcodeFail     = ref(false)

// Keep the barcode field focused by default so a physical scanner (which just
// "types" fast + Enter) always lands here. Clicking an actual input/button
// still works normally — clicking anywhere else on the page snaps focus back.
function focusBarcodeInput() {
  barcodeInputEl.value?.focus()
}

function refocusBarcodeUnlessInput(e: MouseEvent) {
  const tag = (e.target as HTMLElement).tagName
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return
  focusBarcodeInput()
}
const showDropdown = ref(false)
const previewImg = ref('')
const previewX   = ref(0)
const previewY   = ref(0)

function showImgPreview(e: MouseEvent, item: any) {
  if (!item.image_url) return
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  previewImg.value = item.image_url
  previewX.value   = rect.right + 14
  previewY.value   = rect.top + rect.height / 2 - 110
}

function hideImgPreview() {
  previewImg.value = ''
}

// ── SEARCH RESULTS ──
const searchResults = computed(() => {
  if (!searchQuery.value.trim()) return []
  const q = searchQuery.value.toLowerCase()
  return PRODUCTS.value.filter(p =>
    p.name.toLowerCase().includes(q) ||
    (p.sku || '').toLowerCase().includes(q)
  )
})

// ── TODAY DATE ──
const today = new Date().toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })

// ── CALCULATIONS ──
const subtotal    = computed(() => cart.value.reduce((s, i) => s + i.activePrice * i.qty, 0))
const discountAmt = computed(() => discount.value ? (subtotal.value * discount.value) / 100 : 0)
const total       = computed(() => subtotal.value - discountAmt.value)
const balance     = computed(() => amountPaid.value ? Math.max(0, amountPaid.value - total.value) : 0)
const totalQty    = computed(() => cart.value.reduce((s, i) => s + i.qty, 0))
const canCheckout = computed(() => {
  if (cart.value.length === 0 || checkoutDone.value) return false
  if (payMethod.value === 'Later Pay') return true
  return amountPaid.value > 0 && amountPaid.value >= total.value
})

// ── FORMAT CURRENCY ──
const fmt = (n: number) => `Rs. ${n.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// ── TOAST ──
function showToast(msg: string) {
  toastMsg.value = msg
  toastVisible.value = true
  setTimeout(() => { toastVisible.value = false }, 2200)
}

// ── CART ACTIONS ──
// Stock is the ceiling — cart qty can never exceed what's actually in the products table
function addToCart(product: Product) {
  const existing = cart.value.find(i => i.id === product.id)
  if (existing) {
    if (existing.qty >= product.stock) {
      showToast(`Only ${product.stock} in stock`)
      return
    }
    existing.qty++
  } else {
    if (product.stock <= 0) {
      showToast(`${product.name} is out of stock`)
      return
    }
    cart.value.push({ ...product, qty: 1, priceMode: 'discount', activePrice: priceForMode(product, 'discount') })
  }
  showToast(`${product.name} added`)
}

function setPriceMode(id: string, mode: string) {
  const item = cart.value.find(i => i.id === id)
  if (!item) return
  item.priceMode = mode
  item.activePrice = priceForMode(item, mode)
}

function updateQty(id: string, delta: number) {
  const item = cart.value.find(i => i.id === id)
  if (!item) return
  const product = PRODUCTS.value.find(p => p.id === id)
  const maxStock = product ? product.stock : item.stock
  if (delta > 0 && item.qty >= maxStock) {
    showToast(`Only ${maxStock} in stock`)
    return
  }
  item.qty = Math.max(0, item.qty + delta)
  if (item.qty === 0) cart.value = cart.value.filter(i => i.id !== id)
}

function removeItem(id: string) {
  cart.value = cart.value.filter(i => i.id !== id)
}

function clearCart() {
  cart.value = []
}

// ── BARCODE ──
function flashBarcode(success: boolean) {
  if (success) {
    barcodeSuccess.value = true
    setTimeout(() => { barcodeSuccess.value = false }, 800)
  } else {
    barcodeFail.value = true
    setTimeout(() => { barcodeFail.value = false }, 800)
  }
}

function handleBarcode() {
  const val = barcodeInput.value.trim()
  if (!val) return
  const product = PRODUCTS.value.find(p => p.barcode === val || (p.sku || '').toLowerCase() === val.toLowerCase())
  if (product) {
    addToCart(product)
    showToast(`${product.name} added`)
    flashBarcode(true)
  } else {
    showToast('Product not found')
    flashBarcode(false)
  }
  barcodeInput.value = ''
  focusBarcodeInput()
}

// ── SEARCH PICK ──
function pickFromSearch(product: any) {
  addToCart(product)
  searchQuery.value = ''
  showDropdown.value = false
}

function hideDropdown() {
  setTimeout(() => { showDropdown.value = false }, 180)
}

// "Cash" / "Card" / "Bank" / "Later Pay" (UI labels) → matches the
// payment_method check constraint on the transactions table
function paymentMethodCode(label: string): string {
  return label.toLowerCase().replace(' ', '_')
}

// Human-readable label for which price mode was used on a line item
function discountLabel(mode: string): string {
  if (mode === 'royal') return 'Super'
  if (mode === 'original') return 'Original'
  return 'Discount'
}

// ── CHECKOUT INTERCEPT ──
// For Later Pay: open the customer selection modal instead of checking out directly.
// For all other payment methods: go straight through.
function initiateCheckout() {
  if (!canCheckout.value) return
  if (payMethod.value === 'Later Pay') {
    showPayLaterModal.value = true
  } else {
    handleCheckout()
  }
}

// Called when the Pay Later modal confirms a customer
function onPayLaterConfirm(payload: { customerId: string; printBill: boolean }) {
  showPayLaterModal.value = false
  handleCheckout(payload.customerId, payload.printBill)
}

// ── CHECKOUT ──
// Saves the sale to "transactions" + "transaction_items", then removes
// the sold quantity from each product's stock in the "products" table.
// customerId — only set for Later Pay orders (links to pay_later_customers table)
// receiptOverride — Later Pay has its own "print bill" toggle in the modal
async function handleCheckout(customerId?: string, receiptOverride?: boolean) {
  if (!canCheckout.value) return
  checkingOut.value = true

  try {
    // 1. Create the transaction (the "receipt") row first — we need its
    //    id before we can save the line items that belong to it.
    const invoiceNo = `INV-${Date.now()}`
    const { data: txn, error: txnError } = await supabase
      .from('transactions')
      .insert({
        invoice_no: invoiceNo,
        cashier_id: auth.user?.id ?? null,
        customer_id: customerId ?? null,
        subtotal: subtotal.value,
        discount_percent: Number(discount.value) || 0,
        discount_amount: discountAmt.value,
        total: total.value,
        amount_paid: Number(amountPaid.value) || 0,
        balance: balance.value,
        payment_method: paymentMethodCode(payMethod.value),
        printed_receipt: receiptOverride ?? printReceipt.value,
        status: 'completed',
      })
      .select()
      .single()

    if (txnError || !txn) {
      showToast('Checkout failed: ' + (txnError?.message ?? 'unknown error'))
      return
    }

    // 2. Save one row per cart item, linked to that transaction
    const itemRows = cart.value.map(item => ({
      transaction_id: txn.id,
      product_id: item.id,
      product_name: item.name,
      sku: item.sku,
      qty: item.qty,
      unit_price: item.activePrice,
      discount_label: discountLabel(item.priceMode),
      line_total: item.activePrice * item.qty,
    }))

    const { error: itemsError } = await supabase.from('transaction_items').insert(itemRows)
    if (itemsError) {
      showToast('Checkout failed: ' + itemsError.message)
      return
    }

    // 3. Reduce stock for every product sold
    const updates = cart.value.map(item => {
      const product = PRODUCTS.value.find(p => p.id === item.id)
      const newStock = Math.max(0, (product ? product.stock : item.stock) - item.qty)
      return supabase.from('products').update({ stock: newStock }).eq('id', item.id)
        .then(({ error }) => {
          if (!error && product) product.stock = newStock
          return error
        })
    })
    const results = await Promise.all(updates)
    const failed = results.find(e => e)
    if (failed) {
      showToast('Stock update failed: ' + failed.message)
      return
    }

    // 4. Try to print receipt (if enabled) — call the local print agent running on this computer
    const shouldPrint = receiptOverride ?? printReceipt.value
    const isCashSale = paymentMethodCode(payMethod.value).toLowerCase() === 'cash'

    if (shouldPrint) {
      try {
        await fetch('http://localhost:8899/print-receipt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invoice_no: invoiceNo,
            items: itemRows.map(i => ({
              product_name: i.product_name,
              quantity: i.qty,
              unit_price: i.unit_price,
            })),
            payment_method: paymentMethodCode(payMethod.value),
            subtotal: subtotal.value,
            discount_amount: discountAmt.value,
            total: total.value,
            amount_paid: Number(amountPaid.value) || 0,
            balance: balance.value,
            is_cash_sale: isCashSale,
          }),
        })
      } catch (e) {
        console.warn('Print agent not running or unreachable:', e)
        showToast('⚠️ Could not reach printer — make sure the print agent is running')
      }
    } else if (isCashSale) {
      // Open drawer even if not printing (for "cash payment, no receipt" scenario)
      try {
        await fetch('http://localhost:8899/open-drawer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
      } catch (e) {
        console.warn('Could not open cash drawer:', e)
      }
    }
  } finally {
    checkingOut.value = false
  }

  checkoutDone.value = true
  showToast('Order completed · ' + payMethod.value)
  setTimeout(() => {
    cart.value     = []
    discount.value = 0
    amountPaid.value = 0
    payMethod.value = 'Cash'
    checkoutDone.value = false
  }, 2500)
}

// ── INIT ──
onMounted(() => {
  fetchProducts()
  focusBarcodeInput()
})
</script>

<template>
  <div class="pos-wrap" :class="{ light: isLight }">

    <!-- ── SIDEBAR ── -->
    <!-- v-model:isLight sends isLight into Slidebar and listens for changes back -->
    <Slidebar v-model:isLight="isLight" />

    <!-- ── MAIN CASHIER ── -->
    <main class="main" @click="refocusBarcodeUnlessInput">
      <div class="main-header">
        <div class="main-title">Cashier</div>
        <div class="header-actions">
          <div class="date-chip">{{ today }}</div>
          <div class="clear-chip" @click="clearCart">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.08-6.2"/></svg>
            Clear
          </div>
        </div>
      </div>

      <!-- Search bar -->
      <div class="search-bar">
        <!-- Barcode -->
        <div class="input-wrap" :class="{ 'barcode-success': barcodeSuccess, 'barcode-fail': barcodeFail }">
          <span class="input-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="8" x2="7" y2="16"/><line x1="11" y1="8" x2="11" y2="16"/><line x1="15" y1="8" x2="15" y2="16"/><line x1="9" y1="8" x2="9" y2="16"/><line x1="13" y1="8" x2="13" y2="16"/></svg>
          </span>
          <input
            ref="barcodeInputEl"
            v-model="barcodeInput"
            class="pos-input"
            placeholder="Scan barcode…"
            autocomplete="off"
            @keydown.enter="handleBarcode"
          />
        </div>
        <!-- Search -->
        <div class="input-wrap" style="position:relative">
          <span class="input-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </span>
          <input
            v-model="searchQuery"
            class="pos-input"
            placeholder="Search product…"
            autocomplete="off"
            @focus="showDropdown = true"
            @blur="hideDropdown"
          />
          <div class="search-dropdown" :class="{ visible: showDropdown && searchResults.length > 0 }">
            <div
              v-for="p in searchResults"
              :key="p.id"
              class="dropdown-item"
              @mousedown="pickFromSearch(p)"
            >
              <img :src="p.image_url || ''" class="dropdown-img" />
              <div class="dropdown-info">
                <div class="dropdown-name">{{ p.name }}</div>
                <div class="dropdown-meta">{{ p.sku }} · {{ p.main_category }}</div>
              </div>
              <div class="dropdown-right">
                <div class="dropdown-price">Rs. {{ p.selling_price.toLocaleString() }}</div>
                <div class="dropdown-stock" :class="{ 'low-stock': p.stock < 4 }">
                  {{ p.stock }} in stock
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Cart list -->
      <div class="cart-area">
        <!-- Empty state -->
        <div v-if="cart.length === 0" class="empty-cart">
          <div class="empty-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
          </div>
          <div class="empty-text">No items yet — scan or search to add</div>
        </div>

        <!-- Cart table -->
        <div v-else>
          <div class="cart-header">
            <span></span>
            <span>Item</span>
            <span></span>
            <span>Qty</span>
            <span style="text-align:right">Price</span>
            <span></span>
          </div>
          <div
            v-for="item in cart"
            :key="item.id"
            class="cart-row"
          >
            <div class="cart-img-wrap"
              @mouseenter="(e) => showImgPreview(e, item)"
              @mouseleave="hideImgPreview"
            >
              <img :src="item.image_url || ''" class="cart-img" />
            </div>
            <div>
              <div class="cart-name">{{ item.name }}</div>
              <div class="cart-sku">{{ item.sku }}</div>
            </div>
            <div class="price-mode-btns">
              <button
                v-for="mode in ['discount', 'royal', 'original']"
                :key="mode"
                class="pmode-btn"
                :class="{ active: item.priceMode === mode }"
                @click="setPriceMode(item.id, mode)"
              >{{ mode === 'discount' ? 'Discount' : mode === 'royal' ? 'Super' : 'Original' }}</button>
            </div>
            <div class="qty-control">
              <button class="qty-btn" @click="updateQty(item.id, -1)">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
              <span class="qty-num">{{ item.qty }}</span>
              <button class="qty-btn" @click="updateQty(item.id, 1)">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
            </div>
            <div class="cart-price-col">
              <span v-if="item.priceMode !== 'original'" class="cart-original-crossed">{{ fmt(item.selling_price * item.qty) }}</span>
              <span class="cart-price">{{ fmt(item.activePrice * item.qty) }}</span>
            </div>
            <button class="remove-btn" @click="removeItem(item.id)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      </div>
    </main>

    <!-- ── CART PANEL ── -->
    <aside class="cart-panel">
      <div class="cart-panel-header">
        <div class="cart-panel-title-row">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
          <span class="cart-title">Cart</span>
        </div>
        <div v-if="totalQty > 0" class="cart-count">{{ totalQty }}</div>
      </div>

      <div class="summary-area">
        <div class="summary-row">
          <span class="summary-label">Subtotal</span>
          <span class="summary-val">{{ fmt(subtotal) }}</span>
        </div>
        <div v-if="discountAmt > 0" class="summary-row">
          <span class="summary-discount-label">Discount ({{ discount }}%)</span>
          <span class="summary-discount-val">− {{ fmt(discountAmt) }}</span>
        </div>
        <div class="discount-row">
          <div class="input-field">
            <label class="input-label">Discount %</label>
            <input
              v-model.number="discount"
              class="small-input"
              placeholder="0"
              type="number"
              min="0"
              max="100"
              @blur="discount = Number(discount) || 0"
            />
          </div>
          <div class="input-field">
            <label class="input-label">Amount Paid</label>
            <input
              v-model.number="amountPaid"
              class="small-input"
              placeholder="0"
              type="number"
              min="0"
              @blur="amountPaid = Number(amountPaid) || 0"
            />
          </div>
        </div>
      </div>

      <div class="totals-area">
        <div class="total-box">
          <div class="total-label">Total</div>
          <div class="total-value">{{ fmt(total) }}</div>
        </div>
        <div class="balance-box">
          <div class="balance-label">Balance</div>
          <div class="balance-value">{{ fmt(balance) }}</div>
        </div>
      </div>

      <div class="payment-area">
        <div class="pay-label">Payment Method</div>
        <div class="pay-methods">
          <div
            v-for="method in ['Cash', 'Card', 'Bank', 'Later Pay']"
            :key="method"
            class="pay-chip"
            :class="{ active: payMethod === method }"
            @click="payMethod = method"
          >{{ method }}</div>
        </div>
        <!-- Disabled for Later Pay — receipt is controlled in the Pay Later modal -->
        <div
          class="receipt-row"
          :class="{ 'receipt-disabled': payMethod === 'Later Pay' }"
          @click="payMethod !== 'Later Pay' && (printReceipt = !printReceipt)"
        >
          <div class="checkbox" :class="{ checked: printReceipt && payMethod !== 'Later Pay' }">
            <svg v-if="printReceipt && payMethod !== 'Later Pay'" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <span class="receipt-label">
            Print with Receipt
            <span v-if="payMethod === 'Later Pay'" class="receipt-note">(set in Pay Later modal)</span>
          </span>
        </div>
      </div>

      <div class="checkout-area">
        <button
          class="checkout-btn"
          :class="{ ready: canCheckout, done: checkoutDone }"
          :disabled="checkingOut"
          @click="initiateCheckout"
        >
          <svg v-if="!checkoutDone" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          {{ checkoutDone ? 'Order Placed!' : checkingOut ? 'Processing…' : 'Checkout' }}
        </button>
      </div>

      <div class="cart-branding">
        <span class="cart-branding-text">Powered by Xearch AI</span>
      </div>
    </aside>

    <!-- ── PAY LATER MODAL ── -->
    <PayLaterModal
      v-model="showPayLaterModal"
      :isLight="isLight"
      :orderTotal="total"
      @confirm="onPayLaterConfirm"
    />

    <!-- ── TOAST ── -->
    <div class="toast" :class="{ show: toastVisible }">{{ toastMsg }}</div>

    <!-- ── IMAGE PREVIEW ── -->
    <Transition name="img-pop">
      <div
        v-if="previewImg"
        class="img-preview-fixed"
        :style="{ top: previewY + 'px', left: previewX + 'px' }"
      >
        <img :src="previewImg" class="img-preview-big" />
      </div>
    </Transition>

  </div>
</template>

<style scoped>
/* ── CSS VARIABLES (dark default) ── */
.pos-wrap {
  --bg:                #111110;
  --bg-panel:          #181817;
  --bg-card:           #1f1f1e;
  --bg-hover:          #252524;
  --bg-input:          #1a1a19;
  --border:            rgba(255,255,255,0.07);
  --border-mid:        rgba(255,255,255,0.12);
  --text:              #F5F2EE;
  --text-sub:          #888884;
  --text-muted:        #555551;
  --accent-bg:         #F5F2EE;
  --accent-text:       #111110;
  --chip:              #252524;
  --active-nav:        #1f1f1e;
  --active-nav-text:   #F5F2EE;
  --shadow:            0 1px 3px rgba(0,0,0,0.5);
  --shadow-lg:         0 8px 32px rgba(0,0,0,0.6);
  --checkout-bg:       #F5F2EE;
  --checkout-text:     #111110;
  --total-bg:          #1f1f1e;
  --balance-bg:        #F5F2EE;
  --balance-text:      #111110;
  --balance-label-color: rgba(17,17,16,0.5);
  --discount-color:    #22c55e;
}

/* ── LIGHT THEME OVERRIDES ── */
.pos-wrap.light {
  --bg:                #F7F5F2;
  --bg-panel:          #FFFFFF;
  --bg-card:           #FAFAF8;
  --bg-hover:          #F0EDE9;
  --bg-input:          #FFFFFF;
  --border:            rgba(0,0,0,0.07);
  --border-mid:        rgba(0,0,0,0.12);
  --text:              #141412;
  --text-sub:          #7A776F;
  --text-muted:        #B0ADA5;
  --accent-bg:         #141412;
  --accent-text:       #F7F5F2;
  --chip:              #EDEBE7;
  --active-nav:        #141412;
  --active-nav-text:   #F7F5F2;
  --shadow:            0 1px 3px rgba(0,0,0,0.06);
  --shadow-lg:         0 8px 32px rgba(0,0,0,0.1);
  --checkout-bg:       #141412;
  --checkout-text:     #F7F5F2;
  --total-bg:          #EDEBE7;
  --balance-bg:        #141412;
  --balance-text:      #F7F5F2;
  --balance-label-color: rgba(245,242,238,0.5);
}

/* ── LAYOUT ── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

.pos-wrap {
  display: flex;
  height: 100vh;
  width: 100vw;
  background: var(--bg);
  color: var(--text);
  font-family: 'DM Sans', sans-serif;
  overflow: hidden;
  transition: background 0.3s, color 0.3s;
}

/* ── SCROLLBAR ── */
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.2); border-radius: 2px; }

/* ── MAIN ── */
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
  overflow: hidden;
  min-width: 0;
}

.main-header {
  padding: 24px 32px 20px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.main-title {
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 600;
  font-size: 22px;
  letter-spacing: -0.5px;
  color: var(--text);
}

.header-actions { display: flex; align-items: center; gap: 8px; }

.date-chip {
  font-size: 11.5px;
  color: var(--text-muted);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 10px;
}

.clear-chip {
  font-size: 11.5px;
  color: var(--text-muted);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: background 0.15s, color 0.15s;
}

.clear-chip:hover { background: var(--bg-hover); color: var(--text); }

/* ── SEARCH ── */
.search-bar {
  padding: 18px 32px;
  border-bottom: 1px solid var(--border);
  display: flex;
  gap: 12px;
  flex-shrink: 0;
}

.input-wrap {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
}

.input-icon {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  pointer-events: none;
  display: flex;
  align-items: center;
}

.pos-input {
  width: 100%;
  padding: 12px 14px 12px 42px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 10px;
  color: var(--text);
  font-size: 13.5px;
  font-family: 'DM Sans', sans-serif;
  outline: none;
  transition: border-color 0.15s;
}

.pos-input::placeholder { color: var(--text-muted); }
.pos-input:focus { border-color: var(--border-mid); }

.search-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 100;
  background: var(--bg-panel);
  border: 1px solid var(--border-mid);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: var(--shadow-lg);
  display: none;
}

.search-dropdown.visible { display: block; }

.dropdown-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  cursor: pointer;
  transition: background 0.1s;
  border-bottom: 1px solid var(--border);
}

.dropdown-item:last-child { border-bottom: none; }
.dropdown-item:hover { background: var(--bg-hover); }

.dropdown-img {
  width: 42px;
  height: 42px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid var(--border);
  flex-shrink: 0;
}

.dropdown-info { flex: 1; min-width: 0; }

.dropdown-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}

.dropdown-name { font-size: 13.5px; font-weight: 500; color: var(--text); }
.dropdown-meta { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
.dropdown-price { font-size: 13.5px; font-weight: 600; color: var(--text); }

.dropdown-stock {
  font-size: 10.5px;
  color: var(--text-muted);
  font-weight: 500;
}

.dropdown-stock.low-stock {
  color: #ef4444;
  font-weight: 600;
}

/* ── CART AREA ── */
.cart-area {
  flex: 1;
  overflow-y: auto;
  padding: 16px 32px;
}

.empty-cart {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
}

.empty-icon {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--bg-card);
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-text { font-size: 13.5px; color: var(--text-muted); }

.cart-header {
  display: grid;
  grid-template-columns: 44px 1fr auto 80px 110px 36px;
  gap: 8px;
  padding: 0 0 10px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-weight: 500;
}

.cart-row {
  display: grid;
  grid-template-columns: 44px 1fr auto 80px 110px 36px;
  gap: 8px;
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
  align-items: center;
  animation: slideIn 0.2s ease;
}

.cart-img-wrap {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  cursor: zoom-in;
}

.cart-img {
  width: 44px;
  height: 44px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid var(--border);
  display: block;
}

.img-preview-fixed {
  position: fixed;
  z-index: 9999;
  pointer-events: none;
}

.img-preview-big {
  width: 220px;
  height: 220px;
  object-fit: cover;
  border-radius: 16px;
  border: 1px solid var(--border-mid);
  box-shadow: var(--shadow-lg);
  display: block;
}

.img-pop-enter-active {
  transition: opacity 0.18s ease, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.img-pop-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.img-pop-enter-from,
.img-pop-leave-to {
  opacity: 0;
  transform: scale(0.7);
}

@keyframes slideIn {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}

.cart-name { font-size: 13.5px; font-weight: 500; color: var(--text); }
.cart-sku  { font-size: 11px; color: var(--text-muted); margin-top: 2px; }

.qty-control { display: flex; align-items: center; gap: 6px; }

.qty-btn {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-sub);
  transition: background 0.12s, color 0.12s;
}

.qty-btn:hover { background: var(--bg-hover); color: var(--text); }

.qty-num {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  width: 20px;
  text-align: center;
}

.cart-price-col {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.cart-original-crossed {
  font-size: 10.5px;
  color: var(--text-muted);
  text-decoration: line-through;
  text-align: right;
}

.cart-price { font-size: 13.5px; font-weight: 500; color: var(--text); text-align: right; }

.price-mode-btns {
  display: flex;
  flex-direction: column;
  gap: 3px;
  justify-content: center;
}

.pmode-btn {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 3px 8px;
  cursor: pointer;
  font-family: 'DM Sans', sans-serif;
  background: transparent;
  color: var(--text-muted);
  transition: all 0.15s;
  white-space: nowrap;
}

.pmode-btn:hover { border-color: var(--border-mid); color: var(--text); }
.pmode-btn.active { border-color: #22c55e; background: rgba(34,197,94,0.12); color: #22c55e; }
.pmode-btn.active:nth-child(2) { border-color: #8b5cf6; background: rgba(139,92,246,0.12); color: #8b5cf6; }
.pmode-btn.active:nth-child(3) { border-color: var(--border-mid); background: var(--bg-card); color: var(--text); }

.remove-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  transition: color 0.12s;
}

.remove-btn:hover { color: #ef4444; }

/* ── CART PANEL ── */
.cart-panel {
  width: 380px;
  min-width: 380px;
  background: var(--bg-panel);
  display: flex;
  flex-direction: column;
  transition: background 0.3s;
  overflow: hidden;
}

.cart-panel-header {
  padding: 24px 28px 20px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.cart-panel-title-row { display: flex; align-items: center; gap: 10px; }

.cart-title {
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 600;
  font-size: 20px;
  letter-spacing: -0.5px;
  color: var(--text);
}

.cart-count {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--accent-bg);
  color: var(--accent-text);
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

.summary-area {
  padding: 20px 28px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.summary-label          { font-size: 12.5px; color: var(--text-sub); }
.summary-val            { font-size: 13px; font-weight: 500; color: var(--text); }
.summary-discount-label { font-size: 12.5px; color: var(--discount-color); }
.summary-discount-val   { font-size: 13px; font-weight: 500; color: var(--discount-color); }

.discount-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 4px;
}

.input-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.input-label {
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  font-weight: 500;
}

.small-input {
  width: 100%;
  padding: 11px 14px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 9px;
  color: var(--text);
  font-size: 13px;
  font-family: 'DM Sans', sans-serif;
  outline: none;
  transition: border-color 0.15s;
}

.small-input::placeholder { color: var(--text-muted); }
.small-input:focus { border-color: var(--border-mid); }

.totals-area {
  padding: 16px 28px;
  border-bottom: 1px solid var(--border);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  flex-shrink: 0;
}

.total-box {
  padding: 14px 16px;
  border-radius: 10px;
  background: var(--total-bg);
  border: 1px solid var(--border);
}

.total-label {
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-bottom: 4px;
}

.total-value { font-size: 15px; font-weight: 600; color: var(--text); letter-spacing: -0.3px; }

.balance-box {
  padding: 14px 16px;
  border-radius: 10px;
  background: var(--balance-bg);
}

.balance-label {
  font-size: 11px;
  color: var(--balance-label-color);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-bottom: 4px;
}

.balance-value { font-size: 15px; font-weight: 600; color: var(--balance-text); letter-spacing: -0.3px; }

.payment-area {
  padding: 18px 28px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.pay-label {
  font-size: 11.5px;
  color: var(--text-muted);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  margin-bottom: 10px;
}

.pay-methods { display: flex; gap: 8px; flex-wrap: wrap; }

.pay-chip {
  padding: 8px 14px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--text-sub);
  font-size: 12.5px;
  transition: all 0.15s;
  user-select: none;
  font-family: 'DM Sans', sans-serif;
}

.pay-chip.active {
  border-color: var(--text);
  background: var(--accent-bg);
  color: var(--accent-text);
  font-weight: 600;
}

.receipt-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  cursor: pointer;
  user-select: none;
}

.checkbox {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1.5px solid var(--border);
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  flex-shrink: 0;
}

.checkbox.checked { border-color: var(--text); background: var(--accent-bg); }
.checkbox.checked svg { color: var(--accent-text); }

.receipt-label { font-size: 12.5px; color: var(--text-sub); }
.receipt-note  { font-size: 10.5px; color: var(--text-muted); margin-left: 4px; }
.receipt-disabled { opacity: 0.4; cursor: not-allowed; }

.checkout-area { padding: 20px 28px; flex-shrink: 0; }

.checkout-btn {
  width: 100%;
  padding: 16px;
  border-radius: 12px;
  border: none;
  cursor: not-allowed;
  background: var(--bg-card);
  color: var(--text-muted);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.2px;
  font-family: 'Space Grotesk', sans-serif;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.checkout-btn.ready {
  cursor: pointer;
  background: var(--checkout-bg);
  color: var(--checkout-text);
  box-shadow: var(--shadow);
}

.checkout-btn.ready:hover { opacity: 0.88; }
.checkout-btn.done { cursor: default; background: #22c55e; color: #fff; }

.cart-branding {
  padding: 0 28px 20px;
  text-align: center;
  margin-top: auto;
}

.cart-branding-text {
  font-size: 10px;
  color: var(--text-muted);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

/* ── TOAST ── */
.toast {
  position: fixed;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%) translateY(80px);
  background: var(--text);
  color: var(--bg);
  padding: 10px 20px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 500;
  z-index: 9999;
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  pointer-events: none;
  box-shadow: var(--shadow-lg);
}

.toast.show { transform: translateX(-50%) translateY(0); }

/* ── BARCODE FLASH ── */
.barcode-success .pos-input {
  border-color: #22c55e;
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.2);
  animation: flashGreen 0.8s ease;
}

.barcode-fail .pos-input {
  border-color: #ef4444;
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.2);
  animation: flashRed 0.8s ease;
}

.barcode-success .input-icon { color: #22c55e; }
.barcode-fail    .input-icon { color: #ef4444; }

@keyframes flashGreen {
  0%   { background: rgba(34, 197, 94, 0.15); }
  100% { background: var(--bg-input); }
}

@keyframes flashRed {
  0%   { background: rgba(239, 68, 68, 0.15); }
  100% { background: var(--bg-input); }
}
</style>

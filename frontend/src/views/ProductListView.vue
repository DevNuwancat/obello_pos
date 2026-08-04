<!--
  ╔═══════════════════════════════════════════════════════════════════╗
  ║  ProductListView.vue — Browse, search, edit & delete products   ║
  ║  All data comes from Supabase "products" table                  ║
  ║  Uses the same Slidebar + light/dark theme as POSView           ║
  ╚═══════════════════════════════════════════════════════════════════╝
-->

<script setup lang="ts">
// ──────────────────────────────────────────────
// 1. IMPORTS
// ──────────────────────────────────────────────
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Slidebar from '../components/Slidebar.vue'
import AddClothModal from '../components/modals/AddClothModal.vue'
import EditProductModal from '../components/modals/EditProductModal.vue'
import ImportProductsModal from '../components/modals/ImportProductsModal.vue'
import Toast from '../components/Toast.vue'
import { supabase } from '../lib/supabase'
import { useBarcodePrintStore } from '../store/barcodePrint'

const router = useRouter()
const barcodePrintStore = useBarcodePrintStore()


// ──────────────────────────────────────────────
// 2. TYPES — shape of one product row from Supabase
// ──────────────────────────────────────────────
interface Product {
  id: string
  name: string
  main_category: string | null
  sub_category: string | null
  size: string | null
  cost_price: number
  selling_price: number
  discount: number
  super_discount: number
  stock: number
  barcode: string | null
  lot_no: string | null
  design_no: string | null
  color: string | null
  supplier_id: string | null
  owner: string | null
  sku: string | null
  image_url: string | null
  created_at: string
}

// Shape of a category row
interface Category {
  id: string
  name: string
  code: string
  type: string
}

// Shape of a supplier / owner row (for filter dropdowns)
interface NamedCode {
  id: string
  name: string
  code: string
}


// ──────────────────────────────────────────────
// 3. THEME — same pattern as POSView
// ──────────────────────────────────────────────
const isLight = ref(localStorage.getItem('theme') === 'light')


// ──────────────────────────────────────────────
// 4. PRODUCT DATA from Supabase
// ──────────────────────────────────────────────
const products   = ref<Product[]>([])
const loading    = ref(false)
const fetchError = ref('')

// Fetch all products from the database.
// Supabase only ever sends back 1000 rows per request, no matter how many
// rows the table actually has. So we ask for it "page by page" (1000 rows
// at a time) and keep asking until a page comes back with fewer than 1000
// rows — that means we've reached the end of the table.
async function fetchProducts() {
  loading.value    = true
  fetchError.value = ''
  try {
    const PAGE_SIZE = 1000
    let allProducts: Product[] = []
    let from = 0

    while (true) {
      const to = from + PAGE_SIZE - 1
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('created_at', { ascending: false })
        .range(from, to) // e.g. rows 0-999, then 1000-1999, etc.

      if (error) { fetchError.value = error.message; return }

      const page = data ?? []
      allProducts = allProducts.concat(page)

      if (page.length < PAGE_SIZE) break // fewer rows than we asked for = last page
      from += PAGE_SIZE
    }

    products.value = allProducts
  } catch {
    fetchError.value = 'Could not load products.'
  } finally {
    loading.value = false
  }
}


// ──────────────────────────────────────────────
// 5. CATEGORIES from Supabase (for filter dropdowns)
// ──────────────────────────────────────────────
const allCategories = ref<Category[]>([])

async function fetchCategories() {
  const { data } = await supabase
    .from('categories')
    .select('id, name, code, type')
    .eq('is_active', true)
  allCategories.value = data ?? []
}

// Unique main category types (e.g. "Clothing & Accessories")
const categoryTypes = computed(() => {
  const seen = new Set<string>()
  for (const c of allCategories.value) seen.add(c.type)
  return Array.from(seen).sort()
})

// Sub-categories filtered by selected main type
const subCategoriesForFilter = computed(() =>
  allCategories.value.filter(c => c.type === mainCategoryFilter.value)
)


// ──────────────────────────────────────────────
// 6. SUPPLIER COUNT from Supabase (for stats card)
// ──────────────────────────────────────────────
const supplierCount = ref(0)

async function fetchSupplierCount() {
  const { count } = await supabase
    .from('suppliers')
    .select('*', { count: 'exact', head: true })
  supplierCount.value = count ?? 0
}


// ──────────────────────────────────────────────
// 6b. SUPPLIERS & OWNERS from Supabase (for filter dropdowns)
// ──────────────────────────────────────────────
const allSuppliers = ref<NamedCode[]>([])
const allOwners     = ref<NamedCode[]>([])

async function fetchSuppliers() {
  const { data } = await supabase.from('suppliers').select('id, name, code').order('name')
  allSuppliers.value = data ?? []
}

async function fetchOwners() {
  const { data } = await supabase.from('owners').select('id, name, code').eq('is_active', true).order('name')
  allOwners.value = data ?? []
}


// ──────────────────────────────────────────────
// 7. FILTER & SEARCH STATE
// ──────────────────────────────────────────────
const mainCategoryFilter = ref('')   // e.g. "Clothing & Accessories" or '' for all
const subCategoryFilter  = ref('')   // e.g. "T Shirt" (only visible when main = Clothing)
const searchQuery        = ref('')   // search by name, SKU, or barcode
const supplierFilter     = ref('')   // supplier id, or '' for all
const ownerFilter        = ref('')   // owner name, or '' for all
const stockStatusFilter  = ref<'all' | 'in_stock' | 'low_stock'>('all')

// Show sub-category dropdown only when main type = "Clothing & Accessories"
const showSubCategoryFilter = computed(() =>
  mainCategoryFilter.value === 'Clothing & Accessories'
)

// Any filter (besides the default "all") currently active
const hasActiveFilters = computed(() =>
  !!mainCategoryFilter.value || !!subCategoryFilter.value || !!searchQuery.value ||
  !!supplierFilter.value || !!ownerFilter.value || stockStatusFilter.value !== 'all'
)

function clearFilters() {
  mainCategoryFilter.value = ''
  subCategoryFilter.value  = ''
  searchQuery.value        = ''
  supplierFilter.value     = ''
  ownerFilter.value        = ''
  stockStatusFilter.value  = 'all'
  applyFilter()
}


// ──────────────────────────────────────────────
// 8. PAGINATION STATE
// ──────────────────────────────────────────────
const PER_PAGE    = 8
const currentPage = ref(1)


// ──────────────────────────────────────────────
// 8b. SORTING STATE
// ──────────────────────────────────────────────
// sortKey  = which column to sort by (matches Product field names)
// sortDir  = 'asc' (A→Z, low→high) or 'desc' (Z→A, high→low)
// Clicking the same column header toggles between asc ↔ desc.
// Clicking a different column sorts it ascending first.
type SortKey = 'created_at' | 'name' | 'sku' | 'stock' | 'cost_price' | 'selling_price' | 'discount'
const sortKey = ref<SortKey>('created_at')
const sortDir = ref<'asc' | 'desc'>('desc')

function toggleSort(key: SortKey) {
  if (sortKey.value === key) {
    // Same column clicked → flip direction
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    // New column → default ascending (except date which defaults descending)
    sortKey.value = key
    sortDir.value = key === 'created_at' ? 'desc' : 'asc'
  }
  currentPage.value = 1
}

// Returns '▲' or '▼' if this column is currently sorted, otherwise ''
function sortIcon(key: SortKey): string {
  if (sortKey.value !== key) return ''
  return sortDir.value === 'asc' ? ' ▲' : ' ▼'
}


// ──────────────────────────────────────────────
// 9. COMPUTED VALUES — auto-recalculate on changes
// ──────────────────────────────────────────────

// Filter products by category + search, then SORT by the active column
const filtered = computed(() => {
  const mainCat = mainCategoryFilter.value
  const subCat  = subCategoryFilter.value.toLowerCase()
  const q       = searchQuery.value.toLowerCase()

  // Step 1 — filter
  const result = products.value.filter(p => {
    if (mainCat && p.main_category !== mainCat) return false
    if (subCat && (p.sub_category || '').toLowerCase() !== subCat) return false
    if (q) {
      const matchName    = (p.name || '').toLowerCase().includes(q)
      const matchSku     = (p.sku  || '').toLowerCase().includes(q)
      const matchBarcode = (p.barcode || '').toLowerCase().includes(q)
      if (!matchName && !matchSku && !matchBarcode) return false
    }
    if (supplierFilter.value && p.supplier_id !== supplierFilter.value) return false
    if (ownerFilter.value && p.owner !== ownerFilter.value) return false
    if (stockStatusFilter.value === 'in_stock' && p.stock <= 1) return false
    if (stockStatusFilter.value === 'low_stock' && p.stock > 1) return false
    return true
  })

  // Step 2 — sort by the active column
  const key = sortKey.value
  const dir = sortDir.value === 'asc' ? 1 : -1

  return [...result].sort((a, b) => {
    let av: any = a[key]
    let bv: any = b[key]
    // For strings, compare lowercase
    if (typeof av === 'string') av = av.toLowerCase()
    if (typeof bv === 'string') bv = bv.toLowerCase()
    // nulls go to the end
    if (av == null) return 1
    if (bv == null) return -1
    if (av < bv) return -1 * dir
    if (av > bv) return  1 * dir
    return 0
  })
})

// Total pages for pagination
const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / PER_PAGE)))

// The slice of products shown on the current page
const pagedProducts = computed(() => {
  const start = (currentPage.value - 1) * PER_PAGE
  return filtered.value.slice(start, start + PER_PAGE)
})

// "Showing 1–8 of 12" text
const pageInfoText = computed(() => {
  const total = filtered.value.length
  if (total === 0) return 'No products found'
  const start = (currentPage.value - 1) * PER_PAGE + 1
  const end   = Math.min(start + PER_PAGE - 1, total)
  return `Showing ${start}–${end} of ${total}`
})

// Smart pagination: show only pages around current page (not all pages)
const paginationPages = computed(() => {
  const total = totalPages.value
  const current = currentPage.value
  const range = 2  // show 2 pages on each side of current page (5 total: -2, -1, current, +1, +2)

  const pages: (number | string)[] = []

  // Add first page
  if (total <= 7) {
    // If 7 or fewer pages total, show them all
    for (let i = 1; i <= total; i++) pages.push(i)
  } else {
    // Otherwise, show smart pagination
    pages.push(1)

    // Show ellipsis if there's a gap
    if (current - range > 2) pages.push('...')

    // Show pages around current
    for (let i = Math.max(2, current - range); i <= Math.min(total - 1, current + range); i++) {
      if (!pages.includes(i)) pages.push(i)
    }

    // Show ellipsis if there's a gap before last page
    if (current + range < total - 1) pages.push('...')

    // Add last page
    if (!pages.includes(total)) pages.push(total)
  }

  return pages
})

// ── Stats cards ──
const statTotal = computed(() => products.value.length)
const statLow   = computed(() => products.value.filter(p => p.stock <= 1).length)
const statCats  = computed(() => new Set(products.value.map(p => p.main_category).filter(Boolean)).size)


// ──────────────────────────────────────────────
// 10. HELPER FUNCTIONS
// ──────────────────────────────────────────────

// Format price as "1,150.00"
function fmt(n: number): string {
  return parseFloat(String(n)).toFixed(2)
}

// Format date "2026-01-29T..." → "29/01/2026"
function fmtDate(dateStr: string): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}


// ──────────────────────────────────────────────
// 11. FILTER & PAGINATION ACTIONS
// ──────────────────────────────────────────────
function applyFilter() {
  currentPage.value = 1
}

// Reset sub-category when main category changes
function onMainCategoryChange() {
  subCategoryFilter.value = ''
  applyFilter()
}

function goToPage(page: number) {
  if (page >= 1 && page <= totalPages.value) currentPage.value = page
}


// ──────────────────────────────────────────────
// 11b. REFRESH — reload everything from database
// ──────────────────────────────────────────────
async function refreshData() {
  await Promise.all([fetchProducts(), fetchCategories(), fetchSupplierCount(), fetchSuppliers(), fetchOwners()])
  showToastMsg('Data refreshed')
}


// ──────────────────────────────────────────────
// 12. ADD PRODUCT MODAL (uses AddClothModal)
// ──────────────────────────────────────────────
const showAddModal = ref(false)

function openAddModal() {
  showAddModal.value = true
}

// When AddClothModal closes, refresh the product list
// (AddClothModal emits 'update:modelValue' when done)
function onAddModalClose(val: boolean) {
  showAddModal.value = val
  if (!val) fetchProducts()
}


// ──────────────────────────────────────────────
// 12b. IMPORT PRODUCTS FROM CSV
// ──────────────────────────────────────────────
const showImportModal = ref(false)

function onImported() {
  fetchProducts()
}


// ──────────────────────────────────────────────
// 13. EDIT PRODUCT MODAL
// ──────────────────────────────────────────────
const showEditModal   = ref(false)
const editingProduct  = ref<Product | null>(null)

function editProduct(p: Product) {
  editingProduct.value = { ...p }
  showEditModal.value  = true
}

function onEditSaved() {
  fetchProducts()
}


// ──────────────────────────────────────────────
// 14. DELETE PRODUCT (from database)
// ──────────────────────────────────────────────
async function deleteProduct(id: string) {
  if (!confirm('Delete this product? This cannot be undone.')) return
  const { error } = await supabase.from('products').delete().eq('id', id)
  if (error) {
    showToastMsg('Delete failed: ' + error.message)
    return
  }
  // Remove from local list instantly
  products.value = products.value.filter(p => p.id !== id)
  showToastMsg('Product deleted')
}


// ──────────────────────────────────────────────
// 15. VIEW / BARCODE QUEUE ACTIONS
// ──────────────────────────────────────────────
function viewProduct(p: Product) {
  showToastMsg(`${p.name} — SKU: ${p.sku || '—'}`)
}

// Adds this product to the barcode print queue (defaults the label count
// to the product's current stock — editable later on the Barcode Print page)
function addToBarcodeQueue(p: Product) {
  barcodePrintStore.addToQueue(p, p.stock)
  showToastMsg(`${p.name} added to barcode print queue`)
}


// ──────────────────────────────────────────────
// 16. IMAGE PREVIEW (hover to see, like POSView cart)
// ──────────────────────────────────────────────
const previewImg = ref('')
const previewX   = ref(0)
const previewY   = ref(0)

function showImgPreview(e: MouseEvent, p: Product) {
  if (!p.image_url) return
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  previewImg.value = p.image_url
  previewX.value   = rect.right + 14
  previewY.value   = rect.top + rect.height / 2 - 110
}

function hideImgPreview() {
  previewImg.value = ''
}


// ──────────────────────────────────────────────
// 17. EXPORT CSV
// ──────────────────────────────────────────────
function exportCSV() {
  const headers = ['ID', 'Date', 'SKU', 'Name', 'Stock', 'Cost', 'Selling', 'Discount', 'Barcode', 'Category', 'Sub Category']
  const rows = products.value.map(p => [
    p.id, fmtDate(p.created_at), p.sku || '', p.name, p.stock,
    p.cost_price, p.selling_price, p.discount,
    p.barcode || '', p.main_category || '', p.sub_category || '',
  ])
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
  const a = Object.assign(document.createElement('a'), {
    href: 'data:text/csv,' + encodeURIComponent(csv),
    download: 'obello-products.csv',
  })
  a.click()
  showToastMsg('CSV exported')
}


// ──────────────────────────────────────────────
// 18. TOAST
// ──────────────────────────────────────────────
const toastMsg     = ref('')
const toastVisible = ref(false)

function showToastMsg(msg: string) {
  toastMsg.value     = msg
  toastVisible.value = true
  setTimeout(() => { toastVisible.value = false }, 2600)
}


// ──────────────────────────────────────────────
// 19. INIT — load data when the page opens
// ──────────────────────────────────────────────
onMounted(() => {
  fetchProducts()
  fetchCategories()
  fetchSupplierCount()
  fetchSuppliers()
  fetchOwners()
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
        <h1 class="page-title">Product List</h1>
        <p class="page-sub">Browse and manage your inventory</p>
      </div>

      <!-- ── STATS BAR (4 summary cards) ── -->
      <div class="stats-bar">
        <!-- Total Products -->
        <div class="stat-card">
          <div class="stat-label">Total Products</div>
          <div class="stat-value">{{ statTotal }}</div>
          <div class="stat-sub">across all categories</div>
        </div>
        <!-- Low Stock -->
        <div class="stat-card">
          <div class="stat-label">Low Stock</div>
          <div class="stat-value low">{{ statLow }}</div>
          <div class="stat-sub">stock ≤ 1</div>
        </div>
        <!-- Suppliers count (from suppliers table) -->
        <div class="stat-card">
          <div class="stat-label">Suppliers</div>
          <div class="stat-value">{{ supplierCount }}</div>
          <div class="stat-sub">registered</div>
        </div>
        <!-- Categories -->
        <div class="stat-card">
          <div class="stat-label">Categories</div>
          <div class="stat-value">{{ statCats }}</div>
          <div class="stat-sub">active</div>
        </div>
      </div>

      <!-- ── TOOLBAR (filter row + action row, kept apart for readability) ── -->
      <div class="toolbar">

        <!-- ROW 1: filters -->
        <div class="toolbar-row toolbar-filters">
          <!-- Main Category dropdown -->
          <div class="select-wrap">
            <select v-model="mainCategoryFilter" @change="onMainCategoryChange">
              <option value="">All Categories</option>
              <option v-for="t in categoryTypes" :key="t" :value="t">{{ t }}</option>
            </select>
          </div>

          <!-- Sub-category dropdown — only shows when "Clothing & Accessories" is selected -->
          <div v-if="showSubCategoryFilter" class="select-wrap">
            <select v-model="subCategoryFilter" @change="applyFilter">
              <option value="">All Sub-categories</option>
              <option
                v-for="c in subCategoriesForFilter"
                :key="c.id"
                :value="c.name"
              >{{ c.name }}</option>
            </select>
          </div>

          <!-- Search box (searches name, SKU, AND barcode) -->
          <div class="search-box">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path stroke-linecap="round" d="m21 21-4.35-4.35"/></svg>
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Search name, SKU, or barcode…"
              @input="applyFilter"
            />
          </div>

          <!-- Supplier filter -->
          <div class="select-wrap">
            <select v-model="supplierFilter" @change="applyFilter">
              <option value="">All Suppliers</option>
              <option v-for="s in allSuppliers" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </div>

          <!-- Owner filter -->
          <div class="select-wrap">
            <select v-model="ownerFilter" @change="applyFilter">
              <option value="">All Owners</option>
              <option v-for="o in allOwners" :key="o.id" :value="o.name">{{ o.name }}</option>
            </select>
          </div>

          <!-- Stock status filter -->
          <div class="select-wrap">
            <select v-model="stockStatusFilter" @change="applyFilter">
              <option value="all">All Stock</option>
              <option value="in_stock">In Stock</option>
              <option value="low_stock">Low Stock</option>
            </select>
          </div>

          <!-- Clear filters -->
          <button v-if="hasActiveFilters" class="btn-clear-filters" @click="clearFilters">Clear filters</button>
        </div>

        <!-- ROW 2: actions -->
        <div class="toolbar-row toolbar-actions">
          <!-- Refresh button — reloads data from Supabase -->
          <button class="btn btn-outline" @click="refreshData" title="Refresh data">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.08-6.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Refresh
          </button>
          <button class="btn btn-outline" @click="exportCSV">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
            Export
          </button>
          <button class="btn btn-outline" @click="showImportModal = true">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l4-4m0 0l4 4m-4-4v12"/></svg>
            Import CSV
          </button>
          <!-- Goes to the Barcode Print page — badge shows how many products are queued -->
          <button class="btn btn-outline" @click="router.push('/barcode-print')" title="Go to barcode print queue">
            <svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" d="M3 5h2M7 5h2M3 12h2M7 12h2M3 19h2M7 19h2M13 5h2M17 5h2M13 12h2M17 12h2M13 19h2M17 19h2"/></svg>
            Print Queue<span v-if="barcodePrintStore.queue.length" class="queue-count">{{ barcodePrintStore.queue.length }}</span>
          </button>
          <button class="btn btn-primary" @click="openAddModal">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
            Add Product
          </button>
        </div>
      </div>

      <!-- ══════════════════════════════════════ -->
      <!--              PRODUCT TABLE            -->
      <!-- ══════════════════════════════════════ -->
      <div class="table-wrap">

        <!-- Loading / Error states -->
        <div v-if="loading" class="state-msg">Loading products…</div>
        <div v-else-if="fetchError" class="state-error">{{ fetchError }}</div>

        <template v-else>
          <table>
            <!-- Sortable headers — click a column to sort by it -->
            <thead>
              <tr>
                <th>#</th>
                <th class="sortable" @click="toggleSort('created_at')">Date{{ sortIcon('created_at') }}</th>
                <th class="sortable" @click="toggleSort('sku')">SKU{{ sortIcon('sku') }}</th>
                <th class="sortable" @click="toggleSort('name')">Name{{ sortIcon('name') }}</th>
                <th class="center">Image</th>
                <th class="center sortable" @click="toggleSort('stock')">Stock{{ sortIcon('stock') }}</th>
                <th class="sortable" @click="toggleSort('cost_price')">Cost (Rs.){{ sortIcon('cost_price') }}</th>
                <th class="sortable" @click="toggleSort('selling_price')">Selling (Rs.){{ sortIcon('selling_price') }}</th>
                <th class="sortable" @click="toggleSort('discount')">Discount (Rs.){{ sortIcon('discount') }}</th>
                <th style="text-align:right; padding-right:20px;">Actions</th>
              </tr>
            </thead>

            <tbody>
              <tr v-if="pagedProducts.length === 0">
                <td colspan="10" class="empty-row">No products found</td>
              </tr>

              <tr
                v-for="(p, index) in pagedProducts"
                :key="p.id"
                :style="{ animationDelay: (index * 0.03) + 's' }"
              >
                <!-- Row number -->
                <td>{{ (currentPage - 1) * PER_PAGE + index + 1 }}</td>

                <!-- Date (formatted from created_at) -->
                <td class="date-cell">{{ fmtDate(p.created_at) }}</td>

                <!-- SKU code -->
                <td class="sku-cell">{{ p.sku || '—' }}</td>

                <!-- Product name -->
                <td class="name-cell">{{ p.name }}</td>

                <!-- Image: show image if exists, otherwise show placeholder icon.
                     Hover shows large preview (like the cart in POSView) -->
                <td class="center-cell">
                  <div
                    class="img-cell-wrap"
                    @mouseenter="(e) => showImgPreview(e, p)"
                    @mouseleave="hideImgPreview"
                  >
                    <img
                      v-if="p.image_url"
                      class="product-thumb"
                      :src="p.image_url"
                      :alt="p.name"
                    />
                    <div v-else class="thumb-placeholder">
                      <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                        <rect x="3" y="3" width="18" height="18" rx="3"/>
                        <path d="M3 9l4-4 4 4 4-4 4 4"/>
                        <path d="M3 15l4 4 4-4 4 4 4-4"/>
                      </svg>
                    </div>
                  </div>
                </td>

                <!-- Stock badge (red if low, green if ok) -->
                <td class="center-cell">
                  <span class="qty-badge" :class="p.stock <= 1 ? 'low' : 'ok'">{{ p.stock }}</span>
                </td>

                <!-- Prices -->
                <td class="price-cell">{{ fmt(p.cost_price) }}</td>
                <td class="price-cell">{{ fmt(p.selling_price) }}</td>

                <!-- Discount (shown in green) -->
                <td class="price-cell discount-cell">{{ fmt(p.discount) }}</td>

                <!-- Action buttons -->
                <td>
                  <div class="actions">
                    <!-- Barcode — adds this product to the barcode print queue -->
                    <button class="action-btn" title="Add to barcode print queue" @click="addToBarcodeQueue(p)">
                      <svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" d="M3 5h2M7 5h2M3 12h2M7 12h2M3 19h2M7 19h2M13 5h2M17 5h2M13 12h2M17 12h2M13 19h2M17 19h2"/></svg>
                    </button>
                    <!-- View -->
                    <button class="action-btn" title="View" @click="viewProduct(p)">
                      <svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    </button>
                    <!-- Edit -->
                    <button class="action-btn" title="Edit" @click="editProduct(p)">
                      <svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                    </button>
                    <!-- Delete (deletes from Supabase) -->
                    <button class="action-btn danger" title="Delete" @click="deleteProduct(p.id)">
                      <svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path stroke-linecap="round" d="M10 11v6M14 11v6"/></svg>
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          <!-- ── PAGINATION BAR ── -->
          <div class="pagination">
            <span class="page-info">{{ pageInfoText }}</span>
            <div class="page-btns">
              <button class="page-btn" :disabled="currentPage === 1" @click="goToPage(currentPage - 1)">‹</button>
              <button
                v-for="(page, index) in paginationPages"
                :key="`${page}-${index}`"
                class="page-btn"
                :class="{ active: page === currentPage, ellipsis: page === '...' }"
                :disabled="page === '...'"
                @click="page !== '...' && goToPage(page as number)"
              >{{ page }}</button>
              <button class="page-btn" :disabled="currentPage >= totalPages" @click="goToPage(currentPage + 1)">›</button>
            </div>
          </div>
        </template>
      </div>
    </main>

    <!-- ══════════════════════════════════════ -->
    <!--    IMAGE PREVIEW (hover popup)        -->
    <!-- ══════════════════════════════════════ -->
    <Transition name="img-pop">
      <div
        v-if="previewImg"
        class="img-preview-fixed"
        :style="{ top: previewY + 'px', left: previewX + 'px' }"
      >
        <img :src="previewImg" class="img-preview-big" />
      </div>
    </Transition>

    <!-- ══════════════════════════════════════ -->
    <!--    ADD PRODUCT MODAL (AddClothModal)  -->
    <!-- ══════════════════════════════════════ -->
    <AddClothModal
      :modelValue="showAddModal"
      :isLight="isLight"
      @update:modelValue="onAddModalClose"
    />

    <!-- ══════════════════════════════════════ -->
    <!--    IMPORT PRODUCTS FROM CSV           -->
    <!-- ══════════════════════════════════════ -->
    <ImportProductsModal
      v-model="showImportModal"
      :isLight="isLight"
      :suppliers="allSuppliers"
      @imported="onImported"
    />

    <!-- ══════════════════════════════════════ -->
    <!--    EDIT PRODUCT MODAL                 -->
    <!-- ══════════════════════════════════════ -->
    <EditProductModal
      v-model="showEditModal"
      :isLight="isLight"
      :product="editingProduct"
      @saved="onEditSaved"
    />

    <!-- ── TOAST ── -->
    <Toast :message="toastMsg" :show="toastVisible" />

  </div>
</template>


<!-- ════════════════════════════════════════════ -->
<!--                SCOPED STYLES               -->
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
.page-title  { font-size: 26px; font-weight: 600; letter-spacing: -.02em; color: var(--text); }
.page-sub    { font-size: 13px; color: var(--text-sub); margin-top: 2px; }


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
  flex: 1; min-width: 140px;
  box-shadow: var(--shadow);
}

.stat-label { font-size: 11px; color: var(--text-sub); text-transform: uppercase; letter-spacing: .06em; font-weight: 500; }
.stat-value { font-size: 22px; font-weight: 600; margin-top: 4px; letter-spacing: -.02em; font-family: 'DM Mono', monospace; color: var(--text); }
.stat-value.low { color: var(--red); }
.stat-sub { font-size: 11px; color: var(--text-sub); margin-top: 2px; }


/* ══════════════════════════════════
   TOOLBAR
   ══════════════════════════════════ */
.toolbar {
  padding: 20px 32px 0;
  display: flex; flex-direction: column;
  gap: 10px;
}

.toolbar-row {
  display: flex; align-items: center;
  gap: 10px; flex-wrap: wrap;
}

.toolbar-actions { justify-content: flex-end; }

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

.search-box {
  display: flex; align-items: center; gap: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  flex: 1; min-width: 200px;
}
.search-box svg { width: 15px; height: 15px; color: var(--text-sub); flex-shrink: 0; }
.search-box input {
  border: none; background: transparent;
  font-family: 'DM Sans', sans-serif;
  font-size: 13px; color: var(--text);
  outline: none; width: 100%;
}
.search-box input::placeholder { color: var(--text-sub); }

.btn {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 8px;
  font-family: 'DM Sans', sans-serif;
  font-size: 13px; font-weight: 500;
  cursor: pointer; border: 1px solid transparent;
  transition: opacity .15s, background .15s;
}
.btn svg { width: 14px; height: 14px; }
.btn-primary { background: var(--accent); color: var(--accent-fg); }
.btn-primary:hover { opacity: .85; }
.btn-outline { background: var(--surface); border-color: var(--border); color: var(--text); }
.btn-outline:hover { background: var(--surface2); }

.btn-clear-filters {
  padding: 8px 14px; border-radius: 8px;
  border: 1px dashed var(--border); background: transparent;
  color: var(--text-sub); font-size: 12.5px; font-family: 'DM Sans', sans-serif;
  cursor: pointer; transition: color .15s, border-color .15s;
}
.btn-clear-filters:hover { color: var(--red); border-color: var(--red); }

.queue-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: 9px;
  background: var(--accent); color: var(--accent-fg);
  font-size: 10.5px; font-weight: 700;
  margin-left: 2px;
}


/* ══════════════════════════════════
   PRODUCT TABLE
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
thead th:first-child { padding-left: 20px; width: 54px; }
thead th.center { text-align: center; }
thead th.sortable { cursor: pointer; user-select: none; transition: color .15s; }
thead th.sortable:hover { color: var(--text); }

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

/* ── Quantity badge ── */
.qty-badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; height: 22px; border-radius: 6px;
  font-size: 12px; font-weight: 600;
  font-family: 'DM Mono', monospace;
}
.qty-badge.low { background: var(--red-bg); color: var(--red); }
.qty-badge.ok  { background: var(--green-bg); color: var(--green); }

/* ── Discount column (green) ── */
.discount-cell { text-align: center; }
.discount-value {
  font-size: 12px; font-weight: 600;
  font-family: 'DM Mono', monospace;
  color: var(--green);
}
.no-dis { color: var(--text-muted); font-size: 12px; }

/* ── Image cell with hover preview ── */
.img-cell-wrap { display: inline-block; cursor: zoom-in; }

.product-thumb {
  width: 44px; height: 44px; object-fit: cover;
  border-radius: 8px; border: 1px solid var(--border);
  background: var(--surface2); display: block;
}
.thumb-placeholder {
  width: 44px; height: 44px; border-radius: 8px;
  border: 1px solid var(--border); background: var(--surface2);
  display: grid; place-items: center; color: var(--text-sub);
}
.thumb-placeholder svg { width: 18px; height: 18px; }


/* ══════════════════════════════════
   IMAGE HOVER PREVIEW (fixed position)
   Same style as POSView cart hover
   ══════════════════════════════════ */
.img-preview-fixed {
  position: fixed;
  z-index: 9999;
  pointer-events: none;
}

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


/* ══════════════════════════════════
   ACTION BUTTONS (per row)
   ══════════════════════════════════ */
.actions { display: flex; gap: 4px; justify-content: flex-end; align-items: center; }

.action-btn {
  width: 32px; height: 32px;
  display: grid; place-items: center;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: var(--surface);
  cursor: pointer; color: var(--text-sub);
  transition: background .12s, color .12s, border-color .12s;
}
.action-btn:hover { background: var(--surface2); color: var(--text); }
.action-btn.danger:hover { background: var(--red-bg); color: var(--red); border-color: var(--red); }
.action-btn svg { width: 14px; height: 14px; }


/* ══════════════════════════════════
   PAGINATION BAR
   ══════════════════════════════════ */
.pagination {
  padding: 14px 20px;
  display: flex; align-items: center; justify-content: space-between;
  border-top: 1px solid var(--border);
  background: var(--surface2);
}
.page-info { font-size: 12px; color: var(--text-sub); }
.page-btns { display: flex; gap: 4px; }
.page-btn {
  width: 30px; height: 30px;
  display: grid; place-items: center;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--surface);
  font-size: 12px; font-weight: 500;
  cursor: pointer; color: var(--text);
  transition: background .12s;
}
.page-btn:hover { background: var(--bg); }
.page-btn.active { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
.page-btn:disabled { opacity: .35; cursor: default; }
.page-btn.ellipsis { border-color: transparent; background: transparent; }
.page-btn.ellipsis:hover { background: transparent; }
</style>

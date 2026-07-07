<!--
  EditProductModal.vue — Edit an existing product from the "products" table.
  Mirrors the same fields as AddClothModal but loads existing data and UPDATEs on save.
  Also allows changing / uploading an image.
-->

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { supabase } from '../../lib/supabase'
import Toast from '../Toast.vue'
import { fetchSizesForCategory } from '../../composables/useCategorySizes'

// ── PROPS & EMITS ──
// product : the full product row to edit (null = modal hidden)
// isLight : theme toggle from the parent
const props = defineProps<{
  modelValue: boolean
  isLight: boolean
  product: any | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void
  (e: 'saved'): void
}>()

// ── SIZES FOR THE SELECTED MAIN CATEGORY ──
// Loaded from Supabase based on which size groups are active for this category type.
const availableSizes = ref<string[]>(['Free Size'])

// ── SUPABASE: CATEGORIES ──
type Category = { id: string; name: string; code: string; type: string }
const allCategories    = ref<Category[]>([])
const selectedCategory = ref<Category | null>(null)
const selectedType     = ref('')

async function getAllCategories() {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, code, type')
    .eq('is_active', true)
  if (error) console.error('Category fetch error:', error)
  else allCategories.value = data || []
}

const categoryTypes = computed(() => {
  const seen = new Set<string>()
  for (const c of allCategories.value) seen.add(c.type)
  return Array.from(seen).sort()
})

const subCategories = computed(() =>
  allCategories.value.filter(c => c.type === selectedType.value)
)

// Whenever the sub-category changes (including when the product's existing
// sub-category is loaded below), refresh the size options configured for it
watch(selectedCategory, async (cat) => {
  availableSizes.value = await fetchSizesForCategory(cat?.id)
})

// ── SUPABASE: SUPPLIERS ──
type Supplier = { id: string; name: string; code: string }
const supplierList     = ref<Supplier[]>([])
const selectedSupplier = ref<Supplier | null>(null)

// ── SUPABASE: OWNERS ──
type Owner = { id: string; name: string; code: string }
const ownerList     = ref<Owner[]>([])
const selectedOwner = ref<Owner | null>(null)

async function getOwners() {
  const { data, error } = await supabase
    .from('owners')
    .select('id, name, code')
    .eq('is_active', true)
    .order('name')
  if (error) console.error('Owner fetch error:', error)
  else ownerList.value = data || []
}

async function getSuppliers() {
  const { data, error } = await supabase
    .from('suppliers')
    .select('id, name, code')
  if (error) console.error('Supplier fetch error:', error)
  else supplierList.value = data || []
}

// ── FORM FIELDS ──
const size          = ref('')
const name          = ref('')
const cost          = ref('')
const sellingPrice  = ref('')
const discount      = ref('')
const superDiscount = ref('')
const stock         = ref('')
const barcode       = ref('')
const lotNo         = ref('')
const designNo      = ref('')
const color         = ref('')

// ── IMAGE ──
const imagePreview    = ref<string | null>(null)
const imageFile       = ref<File | null>(null)
const existingImgUrl  = ref<string | null>(null)

function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width  = 256
      canvas.height = 256
      const ctx = canvas.getContext('2d')!
      const minSide = Math.min(img.width, img.height)
      const sx = (img.width  - minSide) / 2
      const sy = (img.height - minSide) / 2
      ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, 256, 256)
      canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.7)
    }
    img.src = URL.createObjectURL(file)
  })
}

async function onImagePick(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const compressed = await compressImage(file)
  imageFile.value  = new File([compressed], 'product.jpg', { type: 'image/jpeg' })
  const reader = new FileReader()
  reader.onload = (ev) => { imagePreview.value = ev.target?.result as string }
  reader.readAsDataURL(imageFile.value)
}

async function uploadImage(): Promise<string | null> {
  if (!imageFile.value) return existingImgUrl.value
  const fileName = `products/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
  const { error } = await supabase.storage
    .from('product-images')
    .upload(fileName, imageFile.value, { contentType: 'image/jpeg' })
  if (error) { console.error('Image upload error:', error); return existingImgUrl.value }
  const { data } = supabase.storage.from('product-images').getPublicUrl(fileName)
  return data.publicUrl
}

// ── SKU ──
const sku = computed(() => {
  const ownerCode  = selectedOwner.value?.code   || 'X'
  const supCode  = selectedSupplier.value?.code  || 'XX'
  const lot      = lotNo.value                   || '00'
  const des      = designNo.value                || '000'
  const catCode  = selectedCategory.value?.code  || 'XX'
  const sz       = size.value                    || 'X'
  return `${ownerCode}${supCode}/${lot}/${des}/${catCode}/${sz}`
})

// ── FORMATTED PRICE FOR LABEL PREVIEW ──
// Shows like "1,200.00" so it looks like a real price tag
const formattedPrice = computed(() => {
  const num = parseFloat(sellingPrice.value) || 0
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
})

// ── BARCODE GENERATOR ──
// Finds the highest existing barcode in the products table,
// adds 1, and formats as 000-000-000 — always unique
const generatingBarcode = ref(false)

async function generateBarcode() {
  generatingBarcode.value = true
  try {
    const { data } = await supabase
      .from('products')
      .select('barcode')
      .not('barcode', 'is', null)
      .not('barcode', 'eq', '')

    let maxNum = 0
    for (const row of data || []) {
      const num = parseInt((row.barcode || '').replace(/-/g, ''), 10)
      if (!isNaN(num) && num > maxNum) maxNum = num
    }

    const next = maxNum + 1
    const p = String(next).padStart(9, '0')
    barcode.value = `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6, 9)}`
  } finally {
    generatingBarcode.value = false
  }
}

// ── LOAD PRODUCT DATA INTO FORM ──
// When the modal opens, fill every field from the product prop
watch(() => props.modelValue, async (isOpen) => {
  if (isOpen && props.product) {
    await getAllCategories()
    await getSuppliers()
    await getOwners()

    const p = props.product
    name.value          = p.name || ''
    cost.value          = String(p.cost_price ?? '')
    sellingPrice.value  = String(p.selling_price ?? '')
    discount.value      = String(p.discount ?? '')
    superDiscount.value = String(p.super_discount ?? '')
    stock.value         = String(p.stock ?? '')
    barcode.value       = p.barcode || ''
    lotNo.value         = p.lot_no || ''
    designNo.value      = p.design_no || ''
    color.value         = p.color || ''
    size.value          = p.size || ''
    existingImgUrl.value = p.image_url || null
    imagePreview.value   = p.image_url || null
    imageFile.value      = null

    // Set main category type
    selectedType.value = p.main_category || ''

    // Match the sub-category by name
    setTimeout(() => {
      const match = allCategories.value.find(c => c.name === p.sub_category && c.type === p.main_category)
      selectedCategory.value = match || null
    }, 50)

    // Match supplier by id
    const supMatch = supplierList.value.find(s => s.id === p.supplier_id)
    selectedSupplier.value = supMatch || null

    // Match owner by name
    const ownerMatch = ownerList.value.find(o => o.name === p.owner)
    selectedOwner.value = ownerMatch || null

    window.addEventListener('keydown', onKey)
  } else {
    window.removeEventListener('keydown', onKey)
  }
})

// ── FORM STATE ──
const showErrors = ref(false)
const saving     = ref(false)
const saveError  = ref('')
const showToast  = ref(false)

function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close() }

function close() {
  emit('update:modelValue', false)
  showErrors.value = false
  saveError.value  = ''
}

// ── SAVE (UPDATE) ──
async function save() {
  if (!name.value.trim() || !cost.value) {
    showErrors.value = true
    return
  }

  saving.value    = true
  saveError.value = ''

  try {
    const image_url = await uploadImage()

    const { error } = await supabase
      .from('products')
      .update({
        name:           name.value.trim(),
        main_category:  selectedType.value || null,
        sub_category:   selectedCategory.value?.name || null,
        size:           size.value,
        cost_price:     parseFloat(cost.value)          || 0,
        selling_price:  parseFloat(sellingPrice.value)  || 0,
        discount:       parseFloat(discount.value)      || 0,
        super_discount: parseFloat(superDiscount.value) || 0,
        stock:          parseInt(stock.value) || 0,
        barcode:        barcode.value || null,
        lot_no:         lotNo.value,
        design_no:      designNo.value,
        color:          color.value,
        supplier_id:    selectedSupplier.value?.id || null,
        owner:          selectedOwner.value?.name || null,
        sku:            sku.value || null,
        image_url,
      })
      .eq('id', props.product.id)

    if (error) { saveError.value = error.message; return }
  } catch {
    saveError.value = 'Something went wrong. Please try again.'
    return
  } finally {
    saving.value = false
  }

  showToast.value = true
  emit('saved')
  close()
  setTimeout(() => { showToast.value = false }, 3000)
}
</script>

<template>
  <Transition name="fade">
    <div
      v-if="modelValue"
      class="modal-overlay"
      :class="{ light: props.isLight }"
      @click.self="close"
    >
      <div class="modal-box">

        <!-- ── HEADER ── -->
        <div class="modal-header">
          <div>
            <div class="modal-title">Edit Product</div>
            <div class="modal-sub">Update product details · changes save to database</div>
          </div>
          <div class="header-right">
            <div class="sku-badge">
              <div class="sku-label">SKU</div>
              <div class="sku-value">{{ sku }}</div>
            </div>
            <button class="modal-close" @click="close">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- ── BODY: 2 columns ── -->
        <div class="modal-body">
          <div class="two-col">

            <!-- ═══ LEFT COLUMN ═══ -->
            <div class="col">
              <!-- Main Category + Sub Category -->
              <div class="row-2">
                <div class="form-field">
                  <label class="form-label">Main Category</label>
                  <select v-model="selectedType" class="form-input form-select">
                    <option value="">Select type</option>
                    <option v-for="t in categoryTypes" :key="t" :value="t">{{ t }}</option>
                  </select>
                </div>
                <div class="form-field">
                  <label class="form-label">Sub Category</label>
                  <select v-model="selectedCategory" class="form-input form-select" :disabled="!selectedType">
                    <option :value="null">{{ selectedType ? 'Select category' : 'Pick main first' }}</option>
                    <option v-for="c in subCategories" :key="c.id" :value="c">{{ c.code }} – {{ c.name }}</option>
                  </select>
                </div>
              </div>

              <!-- Size -->
              <div class="form-field">
                <label class="form-label">Size</label>
                <select v-model="size" class="form-input form-select">
                  <option value="">Select size</option>
                  <option v-for="s in availableSizes" :key="s" :value="s">{{ s }}</option>
                </select>
              </div>

              <!-- Product Name -->
              <div class="form-field">
                <label class="form-label">Product Name <span class="req">*</span></label>
                <input v-model="name" class="form-input" :class="{ error: showErrors && !name }" placeholder="e.g. Chinos XL Blue" />
                <span v-if="showErrors && !name" class="form-error">Required</span>
              </div>

              <!-- Pricing -->
              <div class="form-field">
                <label class="form-label">Pricing <span class="req">*</span></label>
                <div class="row-2">
                  <div class="input-prefix-wrap">
                    <span class="input-prefix">Rs.</span>
                    <input v-model="cost" type="number" class="form-input has-prefix" :class="{ error: showErrors && !cost }" placeholder="Cost Price" />
                  </div>
                  <div class="input-prefix-wrap">
                    <span class="input-prefix">Rs.</span>
                    <input v-model="sellingPrice" type="number" class="form-input has-prefix" placeholder="Selling Price" />
                  </div>
                </div>
                <div class="row-2 sub-labels"><span>Cost Price</span><span>Selling Price</span></div>
                <div class="row-2" style="margin-top:8px">
                  <input v-model="discount" type="number" class="form-input" placeholder="Discount %" />
                  <input v-model="superDiscount" type="number" class="form-input" placeholder="Super Discount %" />
                </div>
                <div class="row-2 sub-labels"><span>Discount %</span><span>Super Discount %</span></div>
                <span v-if="showErrors && !cost" class="form-error">Cost price is required</span>
              </div>

              <!-- Stock -->
              <div class="form-field">
                <label class="form-label">Stock Quantity</label>
                <input v-model="stock" type="number" min="0" class="form-input" placeholder="0" />
              </div>

              <!-- Barcode -->
              <div class="form-field">
                <label class="form-label">Barcode</label>
                <div class="barcode-wrap">
                  <input v-model="barcode" class="form-input" placeholder="000-000-000" />
                  <button class="btn-gen" :disabled="generatingBarcode" @click="generateBarcode">
                    {{ generatingBarcode ? '…' : 'Gen' }}
                  </button>
                </div>
              </div>

              <!-- Details: Lot, Design, Color -->
              <div class="form-field">
                <label class="form-label">Details</label>
                <div class="row-3">
                  <input v-model="lotNo" class="form-input" placeholder="Lot No" />
                  <input v-model="designNo" class="form-input" placeholder="Design No" />
                  <input v-model="color" class="form-input" placeholder="Color" />
                </div>
                <div class="row-3 sub-labels"><span>Lot No</span><span>Design No</span><span>Color</span></div>
              </div>
            </div>

            <!-- ═══ RIGHT COLUMN ═══ -->
            <div class="col">
              <!-- Supplier + Owner -->
              <div class="row-2">
                <div class="form-field">
                  <label class="form-label">Supplier</label>
                  <select v-model="selectedSupplier" class="form-input form-select">
                    <option :value="null">Select supplier</option>
                    <option v-for="s in supplierList" :key="s.id" :value="s">{{ s.code }} – {{ s.name }}</option>
                  </select>
                </div>
                <div class="form-field">
                  <label class="form-label">Owner</label>
                  <select v-model="selectedOwner" class="form-input form-select">
                    <option :value="null">Select owner</option>
                    <option v-for="o in ownerList" :key="o.id" :value="o">{{ o.name }} ({{ o.code }})</option>
                  </select>
                </div>
              </div>

              <!-- Image upload -->
              <div class="form-field">
                <label class="form-label">Product Image</label>
                <div class="img-drop">
                  <img v-if="imagePreview" :src="imagePreview" class="img-preview" />
                  <template v-else>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
                      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
                    </svg>
                    <span class="img-hint">Click to upload or change image</span>
                  </template>
                  <input type="file" accept="image/*" class="img-file-input" @change="onImagePick" />
                </div>
              </div>

              <!-- SKU info card -->
              <div class="info-card">
                <div class="info-card-top">
                  <div class="info-card-label">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
                      <line x1="7" y1="7" x2="7.01" y2="7"/>
                    </svg>
                    Auto-generated SKU
                  </div>
                  <div class="info-card-value">{{ sku }}</div>
                </div>
              </div>

              <!-- Label preview — looks like the physical price tag -->
              <div class="info-card label-preview-card">
                <div class="label-preview-title">Label Preview</div>
                <div class="label-preview">
                  <div class="label-left">
                    <div class="label-logo">obello</div>
                    <div class="label-product-name">{{ name || 'Product Name' }}</div>
                    <!-- SVG barcode — fixed realistic pattern -->
                    <svg class="label-barcode-svg" viewBox="0 0 120 28" xmlns="http://www.w3.org/2000/svg">
                      <rect x="2"  y="0" width="2" height="28" fill="#111"/>
                      <rect x="6"  y="0" width="1" height="28" fill="#111"/>
                      <rect x="9"  y="0" width="3" height="28" fill="#111"/>
                      <rect x="14" y="0" width="1" height="28" fill="#111"/>
                      <rect x="17" y="0" width="2" height="28" fill="#111"/>
                      <rect x="21" y="0" width="1" height="28" fill="#111"/>
                      <rect x="24" y="0" width="3" height="28" fill="#111"/>
                      <rect x="29" y="0" width="1" height="28" fill="#111"/>
                      <rect x="32" y="0" width="2" height="28" fill="#111"/>
                      <rect x="36" y="0" width="1" height="28" fill="#111"/>
                      <rect x="39" y="0" width="3" height="28" fill="#111"/>
                      <rect x="44" y="0" width="2" height="28" fill="#111"/>
                      <rect x="48" y="0" width="1" height="28" fill="#111"/>
                      <rect x="51" y="0" width="2" height="28" fill="#111"/>
                      <rect x="55" y="0" width="3" height="28" fill="#111"/>
                      <rect x="60" y="0" width="1" height="28" fill="#111"/>
                      <rect x="63" y="0" width="2" height="28" fill="#111"/>
                      <rect x="67" y="0" width="1" height="28" fill="#111"/>
                      <rect x="70" y="0" width="3" height="28" fill="#111"/>
                      <rect x="75" y="0" width="1" height="28" fill="#111"/>
                      <rect x="78" y="0" width="2" height="28" fill="#111"/>
                      <rect x="82" y="0" width="1" height="28" fill="#111"/>
                      <rect x="85" y="0" width="3" height="28" fill="#111"/>
                      <rect x="90" y="0" width="2" height="28" fill="#111"/>
                      <rect x="94" y="0" width="1" height="28" fill="#111"/>
                      <rect x="97" y="0" width="2" height="28" fill="#111"/>
                      <rect x="101" y="0" width="3" height="28" fill="#111"/>
                      <rect x="106" y="0" width="1" height="28" fill="#111"/>
                      <rect x="109" y="0" width="2" height="28" fill="#111"/>
                      <rect x="113" y="0" width="1" height="28" fill="#111"/>
                      <rect x="116" y="0" width="2" height="28" fill="#111"/>
                    </svg>
                    <div class="label-barcode-num">{{ barcode || '000-000-000' }}</div>
                    <!-- SKU also shown under barcode on the label -->
                    <div class="label-sku">{{ sku }}</div>
                  </div>
                  <div class="label-right">
                    <div class="label-price">Rs {{ formattedPrice }}</div>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>

        <!-- Error -->
        <div v-if="saveError" class="save-error">{{ saveError }}</div>

        <!-- ── FOOTER ── -->
        <div class="modal-footer">
          <div class="footer-right">
            <button class="modal-cancel" :disabled="saving" @click="close">Cancel</button>
            <button class="modal-save" :disabled="saving" @click="save">
              {{ saving ? 'Saving…' : 'Update Product' }}
            </button>
          </div>
        </div>

      </div>
    </div>
  </Transition>

  <Toast message="Product updated successfully!" :show="showToast" />
</template>

<style scoped>
/* ── CSS VARIABLES (dark default) ── */
.modal-overlay {
  --bg-panel:    #181817;
  --bg-card:     #1f1f1e;
  --bg-hover:    #252524;
  --bg-input:    #161615;
  --border:      rgba(255,255,255,0.07);
  --border-mid:  rgba(255,255,255,0.13);
  --border-focus:rgba(255,255,255,0.3);
  --text:        #f5f2ee;
  --text-sub:    #888884;
  --text-muted:  #555551;
  --accent-bg:   #f5f2ee;
  --accent-text: #111110;
  --shadow-lg:   0 16px 60px rgba(0,0,0,0.8);
  --danger:      #ef4444;

  position: fixed; inset: 0;
  background: rgba(0,0,0,0.65);
  backdrop-filter: blur(7px);
  display: flex; align-items: center; justify-content: center;
  z-index: 999;
}

.modal-overlay.light {
  --bg-panel:    #ffffff;
  --bg-card:     #fafaf8;
  --bg-hover:    #f0ede9;
  --bg-input:    #ffffff;
  --border:      rgba(0,0,0,0.07);
  --border-mid:  rgba(0,0,0,0.13);
  --border-focus:rgba(0,0,0,0.4);
  --text:        #141412;
  --text-sub:    #7a776f;
  --text-muted:  #b0ada5;
  --accent-bg:   #141412;
  --accent-text: #f7f5f2;
  --shadow-lg:   0 16px 60px rgba(0,0,0,0.14);
  --danger:      #dc2626;
}

.modal-box {
  width: 860px; max-width: calc(100vw - 40px); max-height: 90vh;
  background: var(--bg-panel); border: 1px solid var(--border-mid);
  border-radius: 20px; box-shadow: var(--shadow-lg);
  display: flex; flex-direction: column; overflow: hidden;
}

.modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 22px 28px 18px; border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.modal-title { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 19px; letter-spacing: -0.4px; color: var(--text); }
.modal-sub { font-size: 12px; color: var(--text-muted); margin-top: 3px; }
.header-right { display: flex; align-items: center; gap: 10px; }
.sku-badge { padding: 6px 14px; border-radius: 8px; background: var(--bg-card); border: 1px solid var(--border); }
.sku-label { font-size: 9.5px; color: var(--text-muted); letter-spacing: 0.07em; text-transform: uppercase; margin-bottom: 2px; }
.sku-value { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 13px; letter-spacing: 0.04em; color: var(--text); }
.modal-close { width: 34px; height: 34px; border-radius: 9px; background: var(--bg-card); border: 1px solid var(--border); cursor: pointer; display: flex; align-items: center; justify-content: center; color: var(--text-sub); transition: background 0.15s, color 0.15s; }
.modal-close:hover { background: var(--bg-hover); color: var(--text); }

.modal-body { flex: 1; overflow-y: auto; padding: 24px 28px; min-height: 0; }
.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.col { display: flex; flex-direction: column; gap: 16px; }
.row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
.sub-labels { margin-top: 4px; padding: 0 2px; }
.sub-labels span { font-size: 10px; color: var(--text-muted); }

.form-field { display: flex; flex-direction: column; gap: 6px; }
.form-label { font-size: 11px; font-weight: 600; color: var(--text-sub); letter-spacing: 0.06em; text-transform: uppercase; }
.req { color: var(--danger); }
.form-input { width: 100%; padding: 10px 13px; background: var(--bg-input); border: 1px solid var(--border-mid); border-radius: 9px; color: var(--text); font-size: 13.5px; font-family: 'DM Sans', sans-serif; outline: none; transition: border-color 0.15s; }
.form-input::placeholder { color: var(--text-muted); opacity: 0.6; }
.form-input:focus { border-color: var(--border-focus); }
.form-input.error { border-color: var(--danger); }
.form-input:disabled { opacity: 0.45; cursor: not-allowed; }
.form-select { appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='none' stroke='%23888884' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round' d='M1 1l5 5 5-5'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 34px; cursor: pointer; }
.input-prefix-wrap { position: relative; display: flex; align-items: center; }
.input-prefix { position: absolute; left: 11px; font-size: 11px; color: var(--text-muted); pointer-events: none; z-index: 1; }
.has-prefix { padding-left: 30px; }
.form-error { font-size: 11px; color: var(--danger); }

.img-drop { height: 130px; border-radius: 12px; border: 1.5px dashed var(--border-mid); background: var(--bg-card); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; cursor: pointer; position: relative; overflow: hidden; color: var(--text-muted); transition: border-color 0.15s; }
.img-drop:hover { border-color: var(--border-focus); }
.img-preview { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; border-radius: 11px; }
.img-hint { font-size: 13px; color: var(--text-muted); }
.img-file-input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }

.info-card { padding: 14px 16px; border-radius: 12px; background: var(--bg-card); border: 1px solid var(--border); }
.info-card-top { display: flex; align-items: center; justify-content: space-between; }
.info-card-label { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-sub); }
.info-card-value { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 15px; letter-spacing: 0.04em; color: var(--text); }

/* ── BARCODE ── */
.barcode-wrap { display: flex; gap: 6px; align-items: center; }
.barcode-wrap .form-input { flex: 1; }

.btn-gen {
  flex-shrink: 0;
  padding: 0 14px;
  height: 40px;
  border-radius: 9px;
  border: 1px solid var(--border-mid);
  background: var(--bg-card);
  color: var(--text-sub);
  font-size: 12px;
  font-family: 'DM Sans', sans-serif;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.btn-gen:hover { background: var(--bg-hover); color: var(--text); }
.btn-gen:disabled { opacity: 0.5; cursor: not-allowed; }

/* ── LABEL PREVIEW CARD ── */
.label-preview-card { padding: 12px 14px; }

.label-preview-title {
  font-size: 10px; font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.07em; text-transform: uppercase;
  margin-bottom: 10px;
}

.label-preview {
  background: #ffffff;
  border-radius: 8px;
  border: 1px solid rgba(0,0,0,0.1);
  display: flex;
  align-items: stretch;
  overflow: hidden;
  min-height: 100px;
}

.label-left {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 10px 12px;
  gap: 3px;
}

.label-logo {
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 800;
  font-size: 12px;
  color: #ffffff;
  background: #111110;
  border-radius: 6px;
  padding: 2px 10px;
  letter-spacing: -0.5px;
  margin-bottom: 2px;
}

.label-product-name {
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 10px;
  color: #111110;
  text-align: center;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.label-barcode-svg {
  width: 120px;
  height: 28px;
  display: block;
}

.label-barcode-num {
  font-size: 8px;
  font-family: monospace;
  color: #333;
  letter-spacing: 0.08em;
  margin-top: 1px;
}

.label-sku {
  font-size: 7px;
  font-family: 'Space Grotesk', monospace;
  color: #888;
  letter-spacing: 0.04em;
}

.label-right {
  width: 32px;
  background: #f0f0f0;
  border-left: 1px solid rgba(0,0,0,0.08);
  display: flex;
  align-items: center;
  justify-content: center;
}

.label-price {
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 8px;
  color: #111110;
  white-space: nowrap;
  writing-mode: vertical-rl;
  text-orientation: mixed;
  transform: rotate(180deg);
  letter-spacing: 0.03em;
}

.save-error { margin: 0 28px; padding: 10px 14px; border-radius: 8px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: var(--danger); font-size: 12.5px; flex-shrink: 0; }

.modal-footer { display: flex; align-items: center; justify-content: flex-end; padding: 16px 28px 20px; border-top: 1px solid var(--border); flex-shrink: 0; }
.footer-right { display: flex; gap: 8px; }
.modal-cancel { padding: 10px 20px; border-radius: 9px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text-sub); font-size: 13px; font-family: 'DM Sans', sans-serif; cursor: pointer; transition: background 0.15s, color 0.15s; }
.modal-cancel:hover { background: var(--bg-hover); color: var(--text); }
.modal-save { padding: 10px 32px; border-radius: 9px; border: none; background: var(--accent-bg); color: var(--accent-text); font-size: 13px; font-weight: 600; font-family: 'DM Sans', sans-serif; cursor: pointer; min-width: 140px; transition: opacity 0.15s; }
.modal-save:hover { opacity: 0.85; }
.modal-save:disabled { opacity: 0.6; cursor: not-allowed; }

.modal-body::-webkit-scrollbar { width: 4px; }
.modal-body::-webkit-scrollbar-track { background: transparent; }
.modal-body::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.2); border-radius: 2px; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>

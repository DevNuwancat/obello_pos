<script setup lang="ts">
import { ref, watch } from 'vue'
import { supabase } from '../../lib/supabase'
import Toast from '../Toast.vue'

const props = defineProps<{ modelValue: boolean; isLight: boolean }>()
const emit  = defineEmits<{
  (e: 'update:modelValue', val: boolean): void
  (e: 'saved'): void
}>()

// ── STEP 1: FIND THE INVOICE ──
const invoiceQuery   = ref('')
const searching      = ref(false)
const searchError    = ref('')

interface FoundItem {
  id: string            // transaction_items.id
  transaction_id: string
  product_id: string | null
  product_name: string
  sku: string | null
  qty: number
  image_url: string | null
}

const foundItems  = ref<FoundItem[]>([])
const foundDate   = ref<string | null>(null)
const foundInvoice = ref('')

async function searchInvoice() {
  const q = invoiceQuery.value.trim()
  if (!q) { searchError.value = 'Enter an invoice number'; return }

  searching.value   = true
  searchError.value = ''
  foundItems.value  = []
  selectedItem.value = null

  try {
    const { data: txn, error: txnError } = await supabase
      .from('transactions')
      .select('id, invoice_no, created_at')
      .ilike('invoice_no', q)
      .maybeSingle()

    if (txnError) { searchError.value = txnError.message; return }
    if (!txn) { searchError.value = 'No sale found with that invoice number'; return }

    const { data: items, error: itemsError } = await supabase
      .from('transaction_items')
      .select('id, transaction_id, product_id, product_name, sku, qty, products(image_url)')
      .eq('transaction_id', txn.id)

    if (itemsError) { searchError.value = itemsError.message; return }

    foundDate.value    = txn.created_at
    foundInvoice.value = txn.invoice_no
    foundItems.value = (items ?? []).map((i: any) => ({
      id: i.id,
      transaction_id: i.transaction_id,
      product_id: i.product_id,
      product_name: i.product_name,
      sku: i.sku,
      qty: i.qty,
      image_url: i.products?.image_url ?? null,
    }))

    if (foundItems.value.length === 0) searchError.value = 'That invoice has no items on record'
  } catch {
    searchError.value = 'Something went wrong. Please try again.'
  } finally {
    searching.value = false
  }
}

// ── STEP 2: PICK THE ITEM BEING RETURNED ──
const selectedItem = ref<FoundItem | null>(null)
const returnQty     = ref(1)
const note          = ref('')

function selectItem(item: FoundItem) {
  selectedItem.value = item
  returnQty.value    = 1
}

// ── SAVE ──
const showErrors = ref(false)
const saving     = ref(false)
const saveError  = ref('')
const showToast  = ref(false)

async function save() {
  if (!selectedItem.value || returnQty.value < 1) {
    showErrors.value = true
    return
  }

  saving.value    = true
  saveError.value = ''

  try {
    const { error } = await supabase.from('product_returns').insert({
      product_id:     selectedItem.value.product_id,
      transaction_id: selectedItem.value.transaction_id,
      invoice_no:     foundInvoice.value,
      product_name:   selectedItem.value.product_name,
      sku:            selectedItem.value.sku,
      image_url:      selectedItem.value.image_url,
      qty:            returnQty.value,
      sold_at:        foundDate.value,
      note:           note.value || null,
    })

    if (error) { saveError.value = error.message; return }
  } catch {
    saveError.value = 'Something went wrong. Please try again.'
  } finally {
    saving.value = false
  }

  showToast.value = true
  emit('saved')
  close()
  setTimeout(() => { showToast.value = false }, 3000)
}

function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close() }

watch(() => props.modelValue, (isOpen) => {
  if (isOpen) window.addEventListener('keydown', onKey)
  else        window.removeEventListener('keydown', onKey)
})

function close() {
  emit('update:modelValue', false)
  invoiceQuery.value  = ''
  searchError.value   = ''
  foundItems.value    = []
  foundDate.value     = null
  foundInvoice.value  = ''
  selectedItem.value  = null
  returnQty.value     = 1
  note.value          = ''
  showErrors.value    = false
  saveError.value     = ''
}
</script>

<template>
  <Transition name="fade">
    <div v-if="modelValue" class="modal-overlay" :class="{ light: props.isLight }" @click.self="close">
      <div class="modal-box">

        <!-- Header -->
        <div class="modal-header">
          <div>
            <div class="modal-title">Add Return</div>
            <div class="modal-sub">Look up the original sale, then pick the item being returned</div>
          </div>
          <button class="modal-close" @click="close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div class="modal-body">

          <!-- Invoice search -->
          <div class="form-field">
            <label class="form-label">Invoice Number *</label>
            <div class="search-row">
              <input
                v-model="invoiceQuery"
                class="form-input"
                placeholder="e.g. INV-1782853283229"
                @keydown.enter="searchInvoice"
              />
              <button class="btn-find" :disabled="searching" @click="searchInvoice">
                {{ searching ? 'Searching…' : 'Find' }}
              </button>
            </div>
            <span v-if="searchError" class="form-error">{{ searchError }}</span>
          </div>

          <!-- Item picker -->
          <div v-if="foundItems.length" class="form-field">
            <label class="form-label">Which item was returned? *</label>
            <div class="item-list">
              <button
                v-for="item in foundItems"
                :key="item.id"
                type="button"
                class="item-row"
                :class="{ selected: selectedItem?.id === item.id }"
                @click="selectItem(item)"
              >
                <img v-if="item.image_url" :src="item.image_url" class="item-img" />
                <div v-else class="item-img item-img-placeholder">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>
                </div>
                <div class="item-info">
                  <div class="item-name">{{ item.product_name }}</div>
                  <div class="item-sku">{{ item.sku || '—' }} · sold qty {{ item.qty }}</div>
                </div>
              </button>
            </div>
            <span v-if="showErrors && !selectedItem" class="form-error">Pick which item was returned</span>
          </div>

          <!-- Qty + note, once an item is picked -->
          <template v-if="selectedItem">
            <div class="form-field">
              <label class="form-label">Quantity Returned *</label>
              <input v-model.number="returnQty" type="number" min="1" :max="selectedItem.qty" class="form-input" />
            </div>
            <div class="form-field">
              <label class="form-label">Note (optional)</label>
              <input v-model="note" class="form-input" placeholder="e.g. Wrong size, customer changed mind" />
            </div>
          </template>

        </div>

        <div v-if="saveError" class="save-error">{{ saveError }}</div>

        <div class="modal-footer">
          <button class="modal-cancel" :disabled="saving" @click="close">Cancel</button>
          <button class="modal-save" :disabled="saving || !selectedItem" @click="save">
            {{ saving ? 'Saving…' : 'Add to Return Bin' }}
          </button>
        </div>

      </div>
    </div>
  </Transition>

  <Toast message="Added to Return Bin" :show="showToast" />
</template>

<style scoped>
.modal-overlay {
  --bg-panel:    #181817;
  --bg-card:     #1f1f1e;
  --bg-hover:    #252524;
  --border:      rgba(255,255,255,0.07);
  --border-mid:  rgba(255,255,255,0.12);
  --text:        #F5F2EE;
  --text-sub:    #888884;
  --text-muted:  #555551;
  --accent-bg:   #F5F2EE;
  --accent-text: #111110;
  --shadow-lg:   0 8px 32px rgba(0,0,0,0.6);

  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
}

.modal-overlay.light {
  --bg-panel:    #FFFFFF;
  --bg-card:     #FAFAF8;
  --bg-hover:    #F0EDE9;
  --border:      rgba(0,0,0,0.07);
  --border-mid:  rgba(0,0,0,0.12);
  --text:        #141412;
  --text-sub:    #7A776F;
  --text-muted:  #B0ADA5;
  --accent-bg:   #141412;
  --accent-text: #F7F5F2;
  --shadow-lg:   0 8px 32px rgba(0,0,0,0.12);
}

.modal-box {
  width: 460px;
  max-height: 85vh;
  background: var(--bg-panel);
  border: 1px solid var(--border-mid);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 20px 24px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.modal-title { font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 16px; color: var(--text); }
.modal-sub { font-size: 12px; color: var(--text-muted); margin-top: 3px; }
.modal-close { width: 28px; height: 28px; border-radius: 6px; background: var(--bg-card); border: 1px solid var(--border); cursor: pointer; display: flex; align-items: center; justify-content: center; color: var(--text-muted); transition: color 0.15s, background 0.15s; flex-shrink: 0; }
.modal-close:hover { background: var(--bg-hover); color: var(--text); }

.modal-body { padding: 24px; display: flex; flex-direction: column; gap: 16px; overflow-y: auto; }

.form-field { display: flex; flex-direction: column; gap: 6px; }
.form-label { font-size: 11px; font-weight: 500; color: var(--text-muted); letter-spacing: 0.06em; text-transform: uppercase; }

.form-input { padding: 11px 14px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 9px; color: var(--text); font-size: 13.5px; font-family: 'DM Sans', sans-serif; outline: none; transition: border-color 0.15s; }
.form-input::placeholder { color: var(--text-muted); }
.form-input:focus { border-color: var(--border-mid); }

.search-row { display: flex; gap: 8px; }
.search-row .form-input { flex: 1; }

.btn-find { padding: 0 16px; border-radius: 9px; border: none; background: var(--accent-bg); color: var(--accent-text); font-size: 13px; font-weight: 600; font-family: 'DM Sans', sans-serif; cursor: pointer; transition: opacity .15s; }
.btn-find:hover { opacity: .85; }
.btn-find:disabled { opacity: .5; cursor: not-allowed; }

.form-error { font-size: 11px; color: #ef4444; }

.item-list { display: flex; flex-direction: column; gap: 6px; max-height: 220px; overflow-y: auto; }

.item-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: 9px;
  background: var(--bg-card); border: 1px solid var(--border);
  cursor: pointer; text-align: left; width: 100%;
  transition: border-color .15s, background .15s;
}
.item-row:hover { background: var(--bg-hover); }
.item-row.selected { border-color: var(--text-sub); background: var(--bg-hover); }

.item-img { width: 34px; height: 34px; object-fit: cover; border-radius: 7px; border: 1px solid var(--border); flex-shrink: 0; }
.item-img-placeholder { display: flex; align-items: center; justify-content: center; color: var(--text-muted); background: var(--bg-panel); }

.item-info { flex: 1; min-width: 0; }
.item-name { font-size: 12.5px; font-weight: 500; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.item-sku { font-size: 10.5px; color: var(--text-muted); margin-top: 1px; }

.save-error { margin: 0 24px; padding: 10px 14px; border-radius: 8px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); color: #ef4444; font-size: 12.5px; flex-shrink: 0; }

.modal-footer { display: flex; gap: 10px; justify-content: flex-end; padding: 16px 24px; border-top: 1px solid var(--border); flex-shrink: 0; }
.modal-cancel { padding: 10px 20px; border-radius: 9px; border: 1px solid var(--border); background: transparent; color: var(--text-sub); font-size: 13px; font-family: 'DM Sans', sans-serif; cursor: pointer; transition: background 0.15s, color 0.15s; }
.modal-cancel:hover { background: var(--bg-hover); color: var(--text); }
.modal-save { padding: 10px 24px; border-radius: 9px; border: none; background: var(--accent-bg); color: var(--accent-text); font-size: 13px; font-weight: 600; font-family: 'DM Sans', sans-serif; cursor: pointer; transition: opacity 0.15s; }
.modal-save:hover { opacity: 0.85; }
.modal-save:disabled { opacity: 0.5; cursor: not-allowed; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>

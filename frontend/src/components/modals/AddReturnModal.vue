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
  qty: number            // remaining qty on the bill, after past processed returns
  pendingReturnQty: number // qty of this same item already sitting in the return bin, not yet processed
  availableQty: number    // qty - pendingReturnQty — the real ceiling for a new return
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
  selectedQty.value.clear()

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

    // Anything already sitting in the return bin for this same sale counts
    // against how much is still returnable, even before it's been processed —
    // otherwise the same item could be added to the bin twice and refunded twice.
    const { data: pending, error: pendingError } = await supabase
      .from('product_returns')
      .select('product_id, qty')
      .eq('transaction_id', txn.id)

    if (pendingError) { searchError.value = pendingError.message; return }

    const pendingByProduct = new Map<string, number>()
    for (const p of pending ?? []) {
      if (!p.product_id) continue
      pendingByProduct.set(p.product_id, (pendingByProduct.get(p.product_id) ?? 0) + p.qty)
    }

    foundDate.value    = txn.created_at
    foundInvoice.value = txn.invoice_no
    foundItems.value = (items ?? []).map((i: any) => {
      const pendingQty = (i.product_id && pendingByProduct.get(i.product_id)) || 0
      return {
        id: i.id,
        transaction_id: i.transaction_id,
        product_id: i.product_id,
        product_name: i.product_name,
        sku: i.sku,
        qty: i.qty,
        pendingReturnQty: pendingQty,
        availableQty: Math.max(0, i.qty - pendingQty),
        image_url: i.products?.image_url ?? null,
      }
    })

    if (foundItems.value.length === 0) searchError.value = 'That invoice has no items on record'
  } catch {
    searchError.value = 'Something went wrong. Please try again.'
  } finally {
    searching.value = false
  }
}

// ── STEP 2: PICK THE ITEM(S) BEING RETURNED ──
// Multiple items can be returned in one go — selectedQty holds one entry per
// picked item (keyed by transaction_items.id), each with its own quantity.
const selectedQty = ref(new Map<string, number>())
const note        = ref('')

const selectedCount = () => selectedQty.value.size

function isSelected(item: FoundItem): boolean {
  return selectedQty.value.has(item.id)
}

function toggleItem(item: FoundItem) {
  if (item.availableQty <= 0) return // fully returned (or already pending) — nothing left to take back
  const next = new Map(selectedQty.value)
  if (next.has(item.id)) next.delete(item.id)
  else next.set(item.id, 1)
  selectedQty.value = next
}

function setQty(item: FoundItem, qty: number) {
  const next = new Map(selectedQty.value)
  next.set(item.id, qty)
  selectedQty.value = next
}

// ── SAVE ──
const showErrors = ref(false)
const saving     = ref(false)
const saveError  = ref('')
const showToast  = ref(false)

async function save() {
  const picked = foundItems.value.filter(i => selectedQty.value.has(i.id))

  if (picked.length === 0) {
    showErrors.value = true
    return
  }

  // Validate every picked item before sending anything
  for (const item of picked) {
    const qty = selectedQty.value.get(item.id) ?? 0
    if (qty < 1) { showErrors.value = true; return }
    if (qty > item.availableQty) {
      saveError.value = `Only ${item.availableQty} unit(s) of "${item.product_name}" are still returnable`
      return
    }
  }

  saving.value    = true
  saveError.value = ''

  try {
    const rows = picked.map(item => ({
      product_id:     item.product_id,
      transaction_id: item.transaction_id,
      invoice_no:     foundInvoice.value,
      product_name:   item.product_name,
      sku:            item.sku,
      image_url:      item.image_url,
      qty:            selectedQty.value.get(item.id) ?? 1,
      sold_at:        foundDate.value,
      note:           note.value || null,
    }))

    const { error } = await supabase.from('product_returns').insert(rows)

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
  selectedQty.value.clear()
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
            <div class="modal-sub">Look up the original sale, then pick the item(s) being returned</div>
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

          <!-- Item picker — tick as many items as were actually returned -->
          <div v-if="foundItems.length" class="form-field">
            <label class="form-label">Which item(s) were returned? *</label>
            <div class="item-list">
              <div
                v-for="item in foundItems"
                :key="item.id"
                class="item-row"
                :class="{ selected: isSelected(item), disabled: item.availableQty <= 0 }"
                :title="item.availableQty <= 0 ? 'This item has already been returned' : ''"
                @click="toggleItem(item)"
              >
                <div class="item-checkbox" :class="{ checked: isSelected(item) }">
                  <svg v-if="isSelected(item)" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>

                <img v-if="item.image_url" :src="item.image_url" class="item-img" />
                <div v-else class="item-img item-img-placeholder">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>
                </div>
                <div class="item-info">
                  <div class="item-name">{{ item.product_name }}</div>
                  <div class="item-sku">{{ item.sku || '—' }} · sold qty {{ item.qty }}</div>
                </div>

                <span v-if="item.availableQty <= 0" class="returned-badge">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                  Item Returned
                </span>
                <span v-else-if="item.pendingReturnQty > 0 && !isSelected(item)" class="pending-badge" title="Some units already sit in the return bin, awaiting processing">
                  {{ item.availableQty }} left
                </span>

                <!-- Per-item qty stepper, shown once this item is ticked -->
                <div v-if="isSelected(item)" class="qty-stepper" @click.stop>
                  <button type="button" class="qty-btn" :disabled="(selectedQty.get(item.id) ?? 1) <= 1" @click="setQty(item, (selectedQty.get(item.id) ?? 1) - 1)">−</button>
                  <input
                    type="number"
                    class="qty-input"
                    min="1"
                    :max="item.availableQty"
                    :value="selectedQty.get(item.id) ?? 1"
                    @input="setQty(item, Math.max(1, Math.min(item.availableQty, Number(($event.target as HTMLInputElement).value) || 1)))"
                  />
                  <button type="button" class="qty-btn" :disabled="(selectedQty.get(item.id) ?? 1) >= item.availableQty" @click="setQty(item, (selectedQty.get(item.id) ?? 1) + 1)">+</button>
                </div>
              </div>
            </div>
            <span v-if="showErrors && selectedCount() === 0" class="form-error">Pick at least one item that was returned</span>
          </div>

          <!-- Shared note, once at least one item is picked -->
          <div v-if="selectedCount() > 0" class="form-field">
            <label class="form-label">Note (optional)</label>
            <input v-model="note" class="form-input" placeholder="e.g. Wrong size, customer changed mind" />
          </div>

        </div>

        <div v-if="saveError" class="save-error">{{ saveError }}</div>

        <div class="modal-footer">
          <button class="modal-cancel" :disabled="saving" @click="close">Cancel</button>
          <button class="modal-save" :disabled="saving || selectedCount() === 0" @click="save">
            {{ saving ? 'Saving…' : selectedCount() > 1 ? `Add ${selectedCount()} Items to Return Bin` : 'Add to Return Bin' }}
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
  width: 500px;
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
.item-row.disabled { opacity: .55; cursor: not-allowed; }
.item-row.disabled:hover { background: var(--bg-card); }

.item-checkbox {
  width: 17px; height: 17px; border-radius: 5px; flex-shrink: 0;
  border: 1.5px solid var(--border-mid);
  display: flex; align-items: center; justify-content: center;
  color: var(--accent-text); transition: background .15s, border-color .15s;
}
.item-checkbox.checked { background: var(--accent-bg); border-color: var(--accent-bg); }

.item-img { width: 34px; height: 34px; object-fit: cover; border-radius: 7px; border: 1px solid var(--border); flex-shrink: 0; }
.item-img-placeholder { display: flex; align-items: center; justify-content: center; color: var(--text-muted); background: var(--bg-panel); }

.item-info { flex: 1; min-width: 0; }
.item-name { font-size: 12.5px; font-weight: 500; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.item-sku { font-size: 10.5px; color: var(--text-muted); margin-top: 1px; }

.returned-badge {
  display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0;
  padding: 3px 9px; border-radius: 5px; font-size: 9.5px; font-weight: 600;
  letter-spacing: .03em; text-transform: uppercase;
  border: 1px solid #ef4444; background: rgba(239,68,68,0.12); color: #ef4444;
}
.pending-badge {
  flex-shrink: 0; padding: 3px 9px; border-radius: 5px;
  font-size: 10px; font-weight: 600; color: var(--text-sub);
  background: var(--bg-panel); border: 1px solid var(--border);
}

.form-hint { font-size: 11px; color: var(--text-muted); }

.qty-stepper {
  display: flex; align-items: center; gap: 0; flex-shrink: 0;
  border: 1px solid var(--border); border-radius: 7px; overflow: hidden;
  cursor: default;
}
.qty-btn {
  width: 22px; height: 24px; border: none; background: var(--bg-panel);
  color: var(--text); font-size: 13px; font-weight: 600; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s;
}
.qty-btn:hover:not(:disabled) { background: var(--bg-hover); }
.qty-btn:disabled { opacity: .4; cursor: not-allowed; }
.qty-input {
  width: 30px; height: 24px; border: none; border-left: 1px solid var(--border); border-right: 1px solid var(--border);
  background: var(--bg-card); color: var(--text); text-align: center; font-size: 12px;
  font-family: 'DM Sans', sans-serif; outline: none;
  -moz-appearance: textfield;
}
.qty-input::-webkit-outer-spin-button, .qty-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }

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

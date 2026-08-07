<script setup lang="ts">
import { ref, watch } from 'vue'
import { supabase } from '../../lib/supabase'
import Toast from '../Toast.vue'

// isLight comes from parent so theme changes work in real time
const props = defineProps<{ modelValue: boolean; isLight: boolean }>()
const emit  = defineEmits<{ (e: 'update:modelValue', val: boolean): void }>()

// ── STATE ──
interface Supplier { id: string; name: string; code: string }

const suppliers   = ref<Supplier[]>([])
const loading     = ref(false)
const fetchError  = ref('')
const deletingId  = ref<string | null>(null)  // id of the row being deleted
const showToast   = ref(false)
const toastMsg    = ref('')

// ── EDIT ──
const editingId   = ref<string | null>(null)  // id of the row currently in edit mode
const editName    = ref('')
const editCode    = ref('')
const savingEdit  = ref(false)

// ── FETCH ──
// Load all suppliers from Supabase every time the modal opens
async function fetchSuppliers() {
  loading.value    = true
  fetchError.value = ''

  try {
    const { data, error } = await supabase
      .from('suppliers')
      .select('id, name, code')
      .order('name')

    if (error) { fetchError.value = error.message; return }
    suppliers.value = data ?? []
  } catch {
    fetchError.value = 'Could not load suppliers. Please try again.'
  } finally {
    loading.value = false
  }
}

// Watch: whenever the modal opens (modelValue flips to true), re-fetch
watch(() => props.modelValue, (isOpen) => { if (isOpen) fetchSuppliers() })

// ── DELETE ──
async function deleteSupplier(id: string) {
  deletingId.value = id

  try {
    const { error } = await supabase.from('suppliers').delete().eq('id', id)

    if (error) {
      toastMsg.value  = 'Delete failed: ' + error.message
      showToast.value = true
    } else {
      // Remove from the local list instantly — no need to re-fetch
      suppliers.value = suppliers.value.filter(s => s.id !== id)
      toastMsg.value  = 'Supplier deleted.'
      showToast.value = true
    }
  } catch {
    toastMsg.value  = 'Something went wrong. Please try again.'
    showToast.value = true
  } finally {
    deletingId.value = null
    setTimeout(() => { showToast.value = false }, 3000)
  }
}

// Open edit mode for a row and pre-fill the boxes with its current values
function startEdit(supplier: Supplier) {
  editingId.value = supplier.id
  editName.value  = supplier.name
  editCode.value  = supplier.code
}

function cancelEdit() {
  editingId.value = null
}

async function saveEdit(id: string) {
  const name = editName.value.trim()
  const code = editCode.value.trim()

  if (!name || !code) {
    toastMsg.value  = 'Name and ID can\'t be empty.'
    showToast.value = true
    setTimeout(() => { showToast.value = false }, 3000)
    return
  }

  savingEdit.value = true

  try {
    const { error } = await supabase.from('suppliers').update({ name, code }).eq('id', id)

    if (error) {
      toastMsg.value  = 'Update failed: ' + error.message
      showToast.value = true
    } else {
      // Update the row in the local list instantly — no need to re-fetch
      const s = suppliers.value.find(s => s.id === id)
      if (s) { s.name = name; s.code = code }
      toastMsg.value  = 'Supplier updated.'
      showToast.value = true
      editingId.value = null
    }
  } catch {
    toastMsg.value  = 'Something went wrong. Please try again.'
    showToast.value = true
  } finally {
    savingEdit.value = false
    setTimeout(() => { showToast.value = false }, 3000)
  }
}

function close() { emit('update:modelValue', false) }
</script>

<template>
  <Transition name="fade">
    <div v-if="modelValue" class="modal-overlay" :class="{ light: isLight }" @click.self="close">
      <div class="modal-box">

        <!-- Header -->
        <div class="modal-header">
          <div>
            <div class="modal-title">Supplier</div>
            <div class="modal-sub">All suppliers on record</div>
          </div>
          <button class="modal-close" @click="close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="18" y1="6"  x2="6"  y2="18"/>
              <line x1="6"  y1="6"  x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <!-- Body -->
        <div class="modal-body">

          <!-- Loading state -->
          <div v-if="loading" class="state-msg">Loading…</div>

          <!-- Error state -->
          <div v-else-if="fetchError" class="state-error">{{ fetchError }}</div>

          <!-- Empty state -->
          <div v-else-if="suppliers.length === 0" class="state-msg">No suppliers added yet.</div>

          <!-- Supplier list -->
          <div v-else class="supplier-list">
            <div
              v-for="supplier in suppliers"
              :key="supplier.id"
              class="supplier-row"
            >
              <!-- Letter avatar — first letter of supplier name -->
              <div class="avatar">{{ supplier.code}}</div>

              <!-- EDIT MODE: two small text boxes instead of plain text -->
              <div v-if="editingId === supplier.id" class="supplier-info edit-mode">
                <input
                  v-model="editName"
                  class="edit-input"
                  placeholder="Supplier name"
                  @keyup.enter="saveEdit(supplier.id)"
                  @keyup.esc="cancelEdit"
                />
                <input
                  v-model="editCode"
                  class="edit-input edit-input-code"
                  placeholder="ID"
                  @keyup.enter="saveEdit(supplier.id)"
                  @keyup.esc="cancelEdit"
                />
              </div>

              <!-- VIEW MODE: plain name and code -->
              <div v-else class="supplier-info">
                <div class="supplier-name">{{ supplier.name }}</div>
                <div class="supplier-code">{{ supplier.code }}</div>
              </div>

              <!-- EDIT MODE buttons: Save / Cancel -->
              <template v-if="editingId === supplier.id">
                <button
                  class="save-btn"
                  :disabled="savingEdit"
                  @click="saveEdit(supplier.id)"
                  title="Save changes"
                >
                  <span v-if="savingEdit" style="font-size:11px">…</span>
                  <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </button>
                <button
                  class="delete-btn"
                  :disabled="savingEdit"
                  @click="cancelEdit"
                  title="Cancel"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                    <line x1="18" y1="6"  x2="6"  y2="18"/>
                    <line x1="6"  y1="6"  x2="18" y2="18"/>
                  </svg>
                </button>
              </template>

              <!-- VIEW MODE buttons: Edit / Delete -->
              <template v-else>
                <button
                  class="edit-btn"
                  :disabled="deletingId === supplier.id"
                  @click="startEdit(supplier)"
                  title="Edit supplier"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 20h9"/>
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
                  </svg>
                </button>
                <button
                  class="delete-btn"
                  :disabled="deletingId === supplier.id"
                  @click="deleteSupplier(supplier.id)"
                  title="Delete supplier"
                >
                  <svg v-if="deletingId !== supplier.id" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/>
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                  </svg>
                  <span v-else style="font-size:11px">…</span>
                </button>
              </template>
            </div>
          </div>

        </div>
      </div>
    </div>
  </Transition>

  <Toast :message="toastMsg" :show="showToast" />
</template>

<style scoped>
.modal-overlay {
  --bg-panel:   #181817;
  --bg-card:    #1f1f1e;
  --bg-hover:   #252524;
  --border:     rgba(255,255,255,0.07);
  --border-mid: rgba(255,255,255,0.12);
  --text:       #F5F2EE;
  --text-sub:   #888884;
  --text-muted: #555551;
  --accent-bg:  #F5F2EE;
  --accent-text:#111110;
  --shadow-lg:  0 8px 32px rgba(0,0,0,0.6);

  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
}

.modal-overlay.light {
  --bg-panel:   #FFFFFF;
  --bg-card:    #FAFAF8;
  --bg-hover:   #F0EDE9;
  --border:     rgba(0,0,0,0.07);
  --border-mid: rgba(0,0,0,0.12);
  --text:       #141412;
  --text-sub:   #7A776F;
  --text-muted: #B0ADA5;
  --text-green: #19e864;
  --accent-bg:  #141412;
  --accent-text:#F7F5F2;
  --shadow-lg:  0 8px 32px rgba(0,0,0,0.12);
}

.modal-box {
  width: 480px;
  max-height: 75vh;         /* never taller than 75% of screen */
  background: var(--bg-panel);
  border: 1px solid var(--border-mid);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;         /* clips border-radius on children */
}

.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 22px 24px 18px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.modal-title {
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 600;
  font-size: 17px;
  color: var(--text);
}

.modal-sub {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 2px;
}

.modal-close {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  transition: color 0.15s, background 0.15s;
  flex-shrink: 0;
}

.modal-close:hover { background: var(--bg-hover); color: var(--text); }

.modal-body {
  flex: 1;          /* takes all remaining height after the header */
  overflow-y: auto; /* scroll up and down when list is long */
  overflow-x: hidden; /* never scroll left or right */
  padding: 8px 0;
  min-height: 0;    /* fixes a flex bug that ignores max-height without this */
}

/* Loading / empty / error text */
.state-msg {
  padding: 40px 24px;
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
}

.state-error {
  padding: 16px 24px;
  margin: 12px 24px;
  border-radius: 8px;
  background: rgba(239,68,68,0.1);
  border: 1px solid rgba(239,68,68,0.3);
  color: #ef4444;
  font-size: 12.5px;
}

.supplier-list { display: flex; flex-direction: column; }

.supplier-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 24px;
  border-bottom: 1px solid var(--border);
  transition: background 0.15s;
}

.supplier-row:last-child { border-bottom: none; }
.supplier-row:hover      { background: var(--bg-hover); }

/* Letter avatar circle */
.avatar {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--bg-card);
  border: 1px solid var(--border-mid);
  color: var(--text);
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.supplier-info { flex: 1; min-width: 0; }

.supplier-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
}

.supplier-code {
  font-size: 11.5px;
  color: var(--text-muted);
  margin-top: 2px;
  letter-spacing: 0.04em;
}

/* Delete button — red on hover */
.delete-btn {
  width: 30px;
  height: 30px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
  flex-shrink: 0;
}

.delete-btn:hover:not(:disabled) {
  color: #ef4444;
  background: rgba(239,68,68,0.08);
  border-color: rgba(239,68,68,0.3);
}

.delete-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* Edit button — same shape as delete, but highlights blue on hover */
.edit-btn {
  width: 30px;
  height: 30px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
  flex-shrink: 0;
}

.edit-btn:hover:not(:disabled) {
  color: #3b82f6;
  background: rgba(59,130,246,0.08);
  border-color: rgba(59,130,246,0.3);
}

.edit-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* Save button — green, shown while a row is in edit mode */
.save-btn {
  width: 30px;
  height: 30px;
  border-radius: 7px;
  border: 1px solid rgba(34,197,94,0.3);
  background: rgba(34,197,94,0.08);
  color: #22c55e;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.15s;
  flex-shrink: 0;
}

.save-btn:hover:not(:disabled) { opacity: 0.8; }
.save-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* Inline edit text boxes */
.edit-mode {
  display: flex;
  gap: 8px;
}

.edit-input {
  min-width: 0;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--border-mid);
  background: var(--bg-card);
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
}

.edit-input:focus { outline: none; border-color: #3b82f6; }

.edit-input-code { max-width: 70px; flex-shrink: 0; }

/* Scrollbar */
.modal-body::-webkit-scrollbar       { width: 4px; }
.modal-body::-webkit-scrollbar-track { background: transparent; }
.modal-body::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.2); border-radius: 2px; }

/* Fade animation */
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from,   .fade-leave-to     { opacity: 0; }
</style>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { supabase } from '../../lib/supabase'
import Toast from '../Toast.vue'
import CategorySizeLinksModal from './CategorySizeLinksModal.vue'
import { CATEGORY_TYPES } from '../../constants/categoryTypes'

const props = defineProps<{ modelValue: boolean; isLight: boolean }>()
const emit  = defineEmits<{ (e: 'update:modelValue', val: boolean): void }>()

// ── DATA SHAPE ──
// Each row we get back from Supabase looks like this
interface Category {
  id:         string
  name:       string
  code:       string
  type:       string
  is_active:  boolean
  created_at: string
}

// ── STATE ──
const categories  = ref<Category[]>([])
const loading     = ref(false)
const fetchError  = ref('')
const toastMsg    = ref('')
const showToast   = ref(false)

// ── SEARCH ──
// The text the user types into the search box
const searchQuery = ref('')

// ── SORT ──
// Two sort modes:
//   'date'  — newest created_at first (default)
//   'type'  — follows the custom category-type order below
const sortMode = ref<'date' | 'type'>('date')

// This defines the special order for category types.
// The lower the number, the higher up in the list it appears.
const TYPE_ORDER: Record<string, number> = {
  'Clothing & Accessories':             0,
  'Kitchen Essentials':                 1,
  'Household Items - Cloth-related':    2,
  'Household Items - Cleaning & Others':3,
  'Gardening Items':                    4,
  'Personal Items':                     5,
  'Electrical Items':                   6,
  'Stationery':                         7,
  'Bathroom Items':                     8,
  'Toys':                               9,
  'Tools':                             10,
  'Vehicle Items':                     11,
}

// ── FETCH ──
// Load all categories from Supabase every time the modal opens
async function fetchCategories() {
  loading.value    = true
  fetchError.value = ''

  try {
    const { data, error } = await supabase
      .from('categories')
      .select('id, name, code, type, is_active, created_at')
      .order('created_at', { ascending: false })

    if (error) { fetchError.value = error.message; return }
    categories.value = data ?? []
  } catch {
    fetchError.value = 'Could not load categories. Please try again.'
  } finally {
    loading.value = false
  }
}

// Re-fetch whenever the modal opens
watch(() => props.modelValue, (isOpen) => { if (isOpen) fetchCategories() })

// ── FILTERED + SORTED LIST ──
// This is what we actually show in the template.
// It starts from categories.value, then:
//   1. filters by the search box
//   2. sorts by the active sort mode
const displayList = computed(() => {
  // Step 1 — filter
  const q = searchQuery.value.toLowerCase().trim()
  const filtered = q
    ? categories.value.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q)
      )
    : categories.value

  // Step 2 — sort (we spread so we don't mutate the original array)
  return [...filtered].sort((a, b) => {
    if (sortMode.value === 'date') {
      // Newest first — bigger timestamp = earlier in list
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    } else {
      // Custom type order. If a type is not in the map, push it to the end (999)
      return (TYPE_ORDER[a.type] ?? 999) - (TYPE_ORDER[b.type] ?? 999)
    }
  })
})

// ── TOGGLE ENABLED ──
// Flips the enabled flag for one category in Supabase,
// then updates the local list immediately so the UI reflects the change
async function toggleEnabled(cat: Category) {
  const newVal = !cat.is_active

  try {
    const { error } = await supabase
      .from('categories')
      .update({ is_active: newVal })
      .eq('id', cat.id)

    if (error) {
      showMsg('Could not update status. Please try again.')
      return
    }

    // Update the local copy so the toggle flips instantly without re-fetching
    cat.is_active = newVal
  } catch {
    showMsg('Something went wrong. Please try again.')
  }
}

// ── DELETE ──
const deletingId = ref<string | null>(null)

async function deleteCategory(id: string) {
  deletingId.value = id

  try {
    const { error } = await supabase.from('categories').delete().eq('id', id)

    if (error) {
      showMsg('Delete failed: ' + error.message)
    } else {
      // Remove from local list instantly — no need to re-fetch
      categories.value = categories.value.filter(c => c.id !== id)
      showMsg('Category deleted.')
    }
  } catch {
    showMsg('Something went wrong. Please try again.')
  } finally {
    deletingId.value = null
  }
}

// ── EDIT ──
const editingId  = ref<string | null>(null)  // id of the row currently in edit mode
const editName   = ref('')
const editCode   = ref('')
const editType   = ref('')
const savingEdit = ref(false)

// Open edit mode for a row and pre-fill the boxes with its current values
function startEdit(cat: Category) {
  editingId.value = cat.id
  editName.value  = cat.name
  editCode.value  = cat.code
  editType.value  = cat.type
}

function cancelEdit() {
  editingId.value = null
}

async function saveEdit(id: string) {
  const name = editName.value.trim()
  const code = editCode.value.trim()
  const type = editType.value

  if (!name || !code || !type) {
    showMsg('Name, code and type can\'t be empty.')
    return
  }

  savingEdit.value = true

  try {
    const { error } = await supabase
      .from('categories')
      .update({ name, code, type })
      .eq('id', id)

    if (error) {
      showMsg('Update failed: ' + error.message)
    } else {
      // Update the row in the local list instantly — no need to re-fetch
      const cat = categories.value.find(c => c.id === id)
      if (cat) { cat.name = name; cat.code = code; cat.type = type }
      showMsg('Category updated.')
      editingId.value = null
    }
  } catch {
    showMsg('Something went wrong. Please try again.')
  } finally {
    savingEdit.value = false
  }
}

// ── MANAGE SIZES ──
// Clicking a category row opens the size-toggle screen for that specific sub-category
const showSizesModal   = ref(false)
const sizesForId       = ref('')
const sizesForName     = ref('')

function openSizes(cat: Category) {
  sizesForId.value    = cat.id
  sizesForName.value  = cat.name
  showSizesModal.value = true
}

// ── HELPER: show toast ──
function showMsg(msg: string) {
  toastMsg.value  = msg
  showToast.value = true
  setTimeout(() => { showToast.value = false }, 3000)
}

function close() {
  emit('update:modelValue', false)
  searchQuery.value = ''
  sortMode.value    = 'date'
}
</script>

<template>
  <Transition name="fade">
    <div v-if="modelValue" class="modal-overlay" :class="{ light: isLight }" @click.self="close">
      <div class="modal-box">

        <!-- ── HEADER ── -->
        <div class="modal-header">
          <div>
            <div class="modal-title">Main Categories</div>
            <div class="modal-sub">All categories on record</div>
          </div>
          <button class="modal-close" @click="close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="18" y1="6"  x2="6"  y2="18"/>
              <line x1="6"  y1="6"  x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <!-- ── TOOLBAR: search + sort buttons ── -->
        <div class="toolbar">

          <!-- Search box -->
          <div class="search-wrap">
            <svg class="search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              v-model="searchQuery"
              class="search-input"
              placeholder="Search by name or code…"
            />
          </div>

          <!-- Sort buttons -->
          <div class="sort-group">
            <button
              class="sort-btn"
              :class="{ active: sortMode === 'date' }"
              @click="sortMode = 'date'"
            >Date Created</button>
            <button
              class="sort-btn"
              :class="{ active: sortMode === 'type' }"
              @click="sortMode = 'type'"
            >Type Order</button>
          </div>

        </div>

        <!-- ── BODY ── -->
        <div class="modal-body">

          <div v-if="loading"     class="state-msg">Loading…</div>
          <div v-else-if="fetchError" class="state-error">{{ fetchError }}</div>
          <div v-else-if="displayList.length === 0" class="state-msg">
            {{ searchQuery ? 'No categories match your search.' : 'No categories added yet.' }}
          </div>

          <!-- Category list -->
          <div v-else class="cat-list">
            <div
              v-for="cat in displayList"
              :key="cat.id"
              class="cat-row"
              :title="editingId === cat.id ? '' : 'Click to manage sizes for this category'"
              @click="editingId === cat.id ? null : openSizes(cat)"
            >
              <!-- Code badge on the left -->
              <div class="code-badge">{{ cat.code }}</div>

              <!-- EDIT MODE: text boxes + type dropdown instead of plain text -->
              <div v-if="editingId === cat.id" class="cat-info edit-mode" @click.stop>
                <div class="edit-row">
                  <input
                    v-model="editName"
                    class="edit-input"
                    placeholder="Category name"
                    @keyup.enter="saveEdit(cat.id)"
                    @keyup.esc="cancelEdit"
                  />
                  <input
                    v-model="editCode"
                    class="edit-input edit-input-code"
                    placeholder="Code"
                    @keyup.enter="saveEdit(cat.id)"
                    @keyup.esc="cancelEdit"
                  />
                </div>
                <select v-model="editType" class="edit-select">
                  <option value="" disabled>Select a category type…</option>
                  <option v-for="t in CATEGORY_TYPES" :key="t" :value="t">{{ t }}</option>
                </select>
              </div>

              <!-- VIEW MODE: plain name, code, type text -->
              <div v-else class="cat-info">
                <div class="cat-name">{{ cat.name }}</div>
                <div class="cat-meta">
                  <span class="cat-code">{{ cat.code }}</span>
                  <span class="cat-dot">·</span>
                  <span class="cat-type">{{ cat.type }}</span>
                </div>
              </div>

              <!-- Enable / Disable toggle (hidden while editing — not enough room) -->
              <button
                v-if="editingId !== cat.id"
                class="toggle-btn"
                :class="{ enabled: cat.is_active }"
                :title="cat.is_active ? 'Click to disable' : 'Click to enable'"
                @click.stop="toggleEnabled(cat)"
              >
                <span class="toggle-track">
                  <span class="toggle-thumb"></span>
                </span>
                <span class="toggle-label">{{ cat.is_active ? 'Active' : 'Off' }}</span>
              </button>

              <!-- EDIT MODE buttons: Save / Cancel -->
              <template v-if="editingId === cat.id">
                <button
                  class="save-btn"
                  :disabled="savingEdit"
                  title="Save changes"
                  @click.stop="saveEdit(cat.id)"
                >
                  <span v-if="savingEdit" style="font-size:11px">…</span>
                  <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </button>
                <button
                  class="delete-btn"
                  :disabled="savingEdit"
                  title="Cancel"
                  @click.stop="cancelEdit"
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
                  :disabled="deletingId === cat.id"
                  title="Edit category"
                  @click.stop="startEdit(cat)"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 20h9"/>
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
                  </svg>
                </button>
                <button
                  class="delete-btn"
                  :disabled="deletingId === cat.id"
                  title="Delete category"
                  @click.stop="deleteCategory(cat.id)"
                >
                  <svg v-if="deletingId !== cat.id" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
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

  <CategorySizeLinksModal
    v-model="showSizesModal"
    :isLight="isLight"
    :categoryId="sizesForId"
    :categoryName="sizesForName"
  />

  <Toast :message="toastMsg" :show="showToast" />
</template>

<style scoped>
/* ── CSS VARIABLES (dark default) ── */
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

/* ── LIGHT THEME ── */
.modal-overlay.light {
  --bg-panel:   #FFFFFF;
  --bg-card:    #FAFAF8;
  --bg-hover:   #F0EDE9;
  --border:     rgba(0,0,0,0.07);
  --border-mid: rgba(0,0,0,0.12);
  --text:       #141412;
  --text-sub:   #7A776F;
  --text-muted: #B0ADA5;
  --accent-bg:  #141412;
  --accent-text:#F7F5F2;
  --shadow-lg:  0 8px 32px rgba(0,0,0,0.12);
}

.modal-box {
  width: 560px;
  max-height: 80vh;
  background: var(--bg-panel);
  border: 1px solid var(--border-mid);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── HEADER ── */
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

/* ── TOOLBAR ── */
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 24px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

/* Search box */
.search-wrap {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 11px;
  color: var(--text-muted);
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 8px 12px 8px 32px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-size: 13px;
  font-family: 'DM Sans', sans-serif;
  outline: none;
  transition: border-color 0.15s;
}

.search-input::placeholder { color: var(--text-muted); }
.search-input:focus         { border-color: var(--border-mid); }

/* Sort buttons */
.sort-group {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.sort-btn {
  padding: 7px 13px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  font-size: 11.5px;
  font-family: 'DM Sans', sans-serif;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  white-space: nowrap;
}

/* Active sort button gets a filled look */
.sort-btn.active {
  background: var(--accent-bg);
  color: var(--accent-text);
  border-color: transparent;
}

.sort-btn:not(.active):hover {
  background: var(--bg-hover);
  color: var(--text);
}

/* ── BODY ── */
.modal-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px 0;
  min-height: 0;
}

.state-msg {
  padding: 40px 24px;
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
}

.state-error {
  margin: 12px 24px;
  padding: 12px 14px;
  border-radius: 8px;
  background: rgba(239,68,68,0.1);
  border: 1px solid rgba(239,68,68,0.3);
  color: #ef4444;
  font-size: 12.5px;
}

/* ── CATEGORY LIST ── */
.cat-list { display: flex; flex-direction: column; }

.cat-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 13px 24px;
  border-bottom: 1px solid var(--border);
  transition: background 0.15s;
  cursor: pointer;
}

.cat-row:last-child { border-bottom: none; }
.cat-row:hover      { background: var(--bg-hover); }

/* Code badge — like the avatar in ViewSuppliersModal */
.code-badge {
  min-width: 36px;
  height: 36px;
  padding: 0 8px;
  border-radius: 8px;
  background: var(--bg-card);
  border: 1px solid var(--border-mid);
  color: var(--text-sub);
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 600;
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  letter-spacing: 0.02em;
  max-width: 64px;
  overflow: hidden;
  white-space: nowrap;
}

.cat-info { flex: 1; min-width: 0; }

.cat-name {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cat-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 2px;
}

.cat-code {
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.04em;
}

.cat-dot { font-size: 11px; color: var(--text-muted); }

.cat-type {
  font-size: 11px;
  color: var(--text-sub);
}

/* ── TOGGLE BUTTON ── */
.toggle-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}

.toggle-track {
  width: 32px;
  height: 18px;
  border-radius: 999px;
  background: var(--border-mid);
  display: flex;
  align-items: center;
  padding: 2px;
  transition: background 0.2s;
  flex-shrink: 0;
}

/* When enabled, the track turns green */
.toggle-btn.enabled .toggle-track { background: #22c55e; }

.toggle-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
  flex-shrink: 0;
}

/* Slide the thumb to the right when enabled */
.toggle-btn.enabled .toggle-thumb { transform: translateX(14px); }

.toggle-label {
  font-size: 11px;
  color: var(--text-muted);
  width: 26px;
  text-align: left;
}

.toggle-btn.enabled .toggle-label { color: #22c55e; }

/* ── DELETE BUTTON ── */
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

/* ── EDIT BUTTON ── */
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

/* ── SAVE BUTTON ── */
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

/* ── INLINE EDIT FIELDS ── */
.edit-mode {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.edit-row { display: flex; gap: 8px; }

.edit-input,
.edit-select {
  min-width: 0;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--border-mid);
  background: var(--bg-card);
  color: var(--text);
  font-size: 12.5px;
  font-family: inherit;
}

.edit-input:focus,
.edit-select:focus { outline: none; border-color: #3b82f6; }

.edit-input-code { max-width: 70px; flex-shrink: 0; }
.edit-select { width: 100%; }

/* ── SCROLLBAR ── */
.modal-body::-webkit-scrollbar       { width: 4px; }
.modal-body::-webkit-scrollbar-track { background: transparent; }
.modal-body::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.2); border-radius: 2px; }

/* ── FADE ANIMATION ── */
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from,   .fade-leave-to     { opacity: 0; }
</style>

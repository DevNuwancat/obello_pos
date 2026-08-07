<script setup lang="ts">
import { ref, watch } from 'vue'
import { supabase } from '../../lib/supabase'
import { markConnected, markError } from '../../lib/connectionStatus'
import Toast from '../Toast.vue'
import OwnerModal from './OwnerModal.vue'

const props = defineProps<{ modelValue: boolean; isLight: boolean }>()
const emit  = defineEmits<{ (e: 'update:modelValue', val: boolean): void }>()

// ── DATA SHAPE ──
interface Owner {
  id:         string
  name:       string
  code:       string
  is_active:  boolean
  created_at: string
}

// ── STATE ──
const owners      = ref<Owner[]>([])
const loading     = ref(false)
const fetchError  = ref('')
const toastMsg    = ref('')
const showToast   = ref(false)
const searchQuery = ref('')

// ── FETCH ──
async function fetchOwners() {
  loading.value    = true
  fetchError.value = ''

  try {
    const { data, error } = await supabase
      .from('owners')
      .select('id, name, code, is_active, created_at')
      .order('name')

    if (error) { fetchError.value = error.message; markError(); return }
    owners.value = data ?? []
    markConnected()
  } catch {
    fetchError.value = 'Could not load owners. Please try again.'
    markError()
  } finally {
    loading.value = false
  }
}

watch(() => props.modelValue, (isOpen) => { if (isOpen) fetchOwners() })

// ── FILTERED LIST ──
const displayList = () => {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return owners.value
  return owners.value.filter(o => o.name.toLowerCase().includes(q) || o.code.toLowerCase().includes(q))
}

// ── TOGGLE ENABLED ──
async function toggleEnabled(owner: Owner) {
  const newVal = !owner.is_active

  try {
    const { error } = await supabase
      .from('owners')
      .update({ is_active: newVal })
      .eq('id', owner.id)

    if (error) { showMsg('Could not update status. Please try again.'); return }
    owner.is_active = newVal
  } catch {
    showMsg('Something went wrong. Please try again.')
  }
}

// ── DELETE ──
const deletingId = ref<string | null>(null)

async function deleteOwner(id: string) {
  deletingId.value = id

  try {
    const { error } = await supabase.from('owners').delete().eq('id', id)

    if (error) {
      showMsg('Delete failed: ' + error.message)
    } else {
      owners.value = owners.value.filter(o => o.id !== id)
      showMsg('Owner deleted.')
    }
  } catch {
    showMsg('Something went wrong. Please try again.')
  } finally {
    deletingId.value = null
  }
}

// ── EDIT ──
const showEditModal = ref(false)
const editingOwner   = ref<{ id: string; name: string; code: string } | null>(null)

function openEdit(owner: Owner) {
  editingOwner.value = { id: owner.id, name: owner.name, code: owner.code }
  showEditModal.value = true
}

function onEditSaved() {
  fetchOwners()
}

function showMsg(msg: string) {
  toastMsg.value  = msg
  showToast.value = true
  setTimeout(() => { showToast.value = false }, 3000)
}

function close() {
  emit('update:modelValue', false)
  searchQuery.value = ''
}
</script>

<template>
  <Transition name="fade">
    <div v-if="modelValue" class="modal-overlay" :class="{ light: isLight }" @click.self="close">
      <div class="modal-box">

        <!-- ── HEADER ── -->
        <div class="modal-header">
          <div>
            <div class="modal-title">Owners</div>
            <div class="modal-sub">All owners on record</div>
          </div>
          <button class="modal-close" @click="close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="18" y1="6"  x2="6"  y2="18"/>
              <line x1="6"  y1="6"  x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <!-- ── TOOLBAR: search ── -->
        <div class="toolbar">
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
        </div>

        <!-- ── BODY ── -->
        <div class="modal-body">

          <div v-if="loading"     class="state-msg">Loading…</div>
          <div v-else-if="fetchError" class="state-error">{{ fetchError }}</div>
          <div v-else-if="displayList().length === 0" class="state-msg">
            {{ searchQuery ? 'No owners match your search.' : 'No owners added yet.' }}
          </div>

          <div v-else class="owner-list">
            <div
              v-for="owner in displayList()"
              :key="owner.id"
              class="owner-row"
            >
              <!-- Code badge on the left -->
              <div class="code-badge">{{ owner.code }}</div>

              <!-- Name and code -->
              <div class="owner-info">
                <div class="owner-name">{{ owner.name }}</div>
                <div class="owner-code">{{ owner.code }}</div>
              </div>

              <!-- Enable / Disable toggle -->
              <button
                class="toggle-btn"
                :class="{ enabled: owner.is_active }"
                :title="owner.is_active ? 'Click to disable' : 'Click to enable'"
                @click="toggleEnabled(owner)"
              >
                <span class="toggle-track">
                  <span class="toggle-thumb"></span>
                </span>
                <span class="toggle-label">{{ owner.is_active ? 'Active' : 'Off' }}</span>
              </button>

              <!-- Edit button -->
              <button class="edit-btn" title="Edit owner" @click="openEdit(owner)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>

              <!-- Delete button -->
              <button
                class="delete-btn"
                :disabled="deletingId === owner.id"
                title="Delete owner"
                @click="deleteOwner(owner.id)"
              >
                <svg v-if="deletingId !== owner.id" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6M14 11v6"/>
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
                <span v-else style="font-size:11px">…</span>
              </button>

            </div>
          </div>

        </div>
      </div>
    </div>
  </Transition>

  <OwnerModal
    v-model="showEditModal"
    :isLight="isLight"
    :editOwner="editingOwner"
    @saved="onEditSaved"
  />

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
  --accent-text: #111110;
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
  --accent-bg:  #141412;
  --accent-text: #F7F5F2;
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
}

.modal-close:hover { background: var(--bg-hover); color: var(--text); }

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 24px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

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

.owner-list { display: flex; flex-direction: column; }

.owner-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 13px 24px;
  border-bottom: 1px solid var(--border);
  transition: background 0.15s;
}

.owner-row:last-child { border-bottom: none; }
.owner-row:hover      { background: var(--bg-hover); }

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

.owner-info { flex: 1; min-width: 0; }

.owner-name {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.owner-code {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
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

.toggle-btn.enabled .toggle-track { background: #22c55e; }

.toggle-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
  flex-shrink: 0;
}

.toggle-btn.enabled .toggle-thumb { transform: translateX(14px); }

.toggle-label {
  font-size: 11px;
  color: var(--text-muted);
  width: 26px;
  text-align: left;
}

.toggle-btn.enabled .toggle-label { color: #22c55e; }

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

.edit-btn:hover { background: var(--bg-hover); color: var(--text); }

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

.modal-body::-webkit-scrollbar       { width: 4px; }
.modal-body::-webkit-scrollbar-track { background: transparent; }
.modal-body::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.2); border-radius: 2px; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from,   .fade-leave-to     { opacity: 0; }
</style>

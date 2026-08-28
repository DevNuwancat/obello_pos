<!--
  PayLaterCustomerBookModal.vue — the full Pay Later contact book.
  Unlike the main Pay Later ledger table (which only shows customers who owe
  money), this shows EVERY registered contact — including ones who were only
  ever added but never bought anything on credit yet. Search, edit, delete.
-->
<script setup lang="ts">
import { ref, watch } from 'vue'
import { supabase } from '../../lib/supabase'
import { markConnected, markError } from '../../lib/connectionStatus'
import Toast from '../Toast.vue'
import EditPayLaterCustomerModal from './EditPayLaterCustomerModal.vue'

const props = defineProps<{ modelValue: boolean; isLight: boolean }>()
const emit  = defineEmits<{
  (e: 'update:modelValue', val: boolean): void
  (e: 'changed'): void   // tells PayLaterView to refresh its own ledger table
}>()

// ── DATA SHAPE — same fields the pay_later_balances view already gives us ──
interface Contact {
  id: string
  name: string
  id_number: string | null
  phone: string | null
  address: string | null
  total_billed: number
  total_owed: number
}

// ── STATE ──
const contacts    = ref<Contact[]>([])
const loading     = ref(false)
const fetchError  = ref('')
const searchQuery = ref('')
const toastMsg     = ref('')
const showToast    = ref(false)

// ── FETCH ──
async function fetchContacts() {
  loading.value    = true
  fetchError.value = ''
  try {
    const { data, error } = await supabase
      .from('pay_later_balances')
      .select('id, name, id_number, phone, address, total_billed, total_owed')
      .order('name')
    if (error) { fetchError.value = error.message; markError(); return }
    contacts.value = data ?? []
    markConnected()
  } catch {
    fetchError.value = 'Could not load contacts. Please try again.'
    markError()
  } finally {
    loading.value = false
  }
}

watch(() => props.modelValue, (isOpen) => { if (isOpen) fetchContacts() })

// ── SEARCH ──
function displayList(): Contact[] {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return contacts.value
  return contacts.value.filter(c =>
    c.name.toLowerCase().includes(q) ||
    (c.phone ?? '').toLowerCase().includes(q) ||
    (c.id_number ?? '').toLowerCase().includes(q)
  )
}

// Small status badge per contact: not a buyer yet / owes money / fully paid
function statusLabel(c: Contact): string {
  if (c.total_billed === 0) return 'No purchases yet'
  if (c.total_owed > 0)     return 'Owes money'
  return 'Paid up'
}
function statusClass(c: Contact): string {
  if (c.total_billed === 0) return 'status-none'
  if (c.total_owed > 0)     return 'status-owes'
  return 'status-paid'
}

// ── DELETE ──
const deletingId = ref<string | null>(null)

async function deleteContact(c: Contact) {
  if (!confirm(`Delete ${c.name} from the contact book? This can't be undone.`)) return

  deletingId.value = c.id
  const { error } = await supabase.from('pay_later_customers').delete().eq('id', c.id)
  deletingId.value = null

  if (error) {
    // 23503 = foreign key violation — this contact still has bills or payments on record
    if (error.code === '23503') {
      showMsg('Could not delete — this contact still has bill or payment history')
    } else {
      showMsg('Delete failed: ' + error.message)
    }
    return
  }

  contacts.value = contacts.value.filter(x => x.id !== c.id)
  showMsg(`${c.name} removed`)
  emit('changed')
}

// ── EDIT ──
const showEditModal = ref(false)
const editingContact  = ref<Contact | null>(null)

function openEdit(c: Contact) {
  editingContact.value = c
  showEditModal.value  = true
}

function onEditSaved() {
  fetchContacts()
  emit('changed')
}

function showMsg(msg: string) {
  toastMsg.value  = msg
  showToast.value = true
  setTimeout(() => { showToast.value = false }, 2600)
}

function close() {
  emit('update:modelValue', false)
  searchQuery.value = ''
}
</script>

<template>
  <Transition name="fade">
    <div v-if="modelValue" class="modal-overlay" :class="{ light: isLight }">
      <div class="modal-box">

        <!-- HEADER -->
        <div class="modal-header">
          <div>
            <div class="modal-title">Customer Book</div>
            <div class="modal-sub">Every Pay Later contact — search, edit or remove</div>
          </div>
          <button class="modal-close" @click="close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <!-- SEARCH -->
        <div class="toolbar">
          <div class="search-wrap">
            <svg class="search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input v-model="searchQuery" class="search-input" placeholder="Search by name, phone or ID number…" />
          </div>
        </div>

        <!-- BODY -->
        <div class="modal-body">
          <div v-if="loading" class="state-msg">Loading contacts…</div>
          <div v-else-if="fetchError" class="state-error">{{ fetchError }}</div>
          <div v-else-if="displayList().length === 0" class="state-msg">
            {{ searchQuery ? 'No contacts match your search.' : 'No contacts registered yet.' }}
          </div>

          <div v-else class="contact-list">
            <div v-for="c in displayList()" :key="c.id" class="contact-row">
              <div class="cust-avatar">{{ c.name.charAt(0).toUpperCase() }}</div>

              <div class="cust-info">
                <div class="cust-name">{{ c.name }}</div>
                <div class="cust-meta">
                  <span v-if="c.phone">{{ c.phone }}</span>
                  <span v-if="c.phone && c.id_number"> · </span>
                  <span v-if="c.id_number">ID {{ c.id_number }}</span>
                </div>
              </div>

              <span class="status-badge" :class="statusClass(c)">{{ statusLabel(c) }}</span>

              <button class="edit-btn" title="Edit contact" @click="openEdit(c)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>

              <button class="delete-btn" :disabled="deletingId === c.id" title="Delete contact" @click="deleteContact(c)">
                <svg v-if="deletingId !== c.id" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
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

  <EditPayLaterCustomerModal
    v-model="showEditModal"
    :isLight="isLight"
    :customer="editingContact"
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
  --green:      #4ade80;
  --green-bg:   rgba(22,163,74,.15);
  --red:        #f87171;
  --red-bg:     rgba(220,38,38,.15);

  position: fixed; inset: 0; background: rgba(0,0,0,0.5); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
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
  --green:      #16a34a;
  --green-bg:   #dcfce7;
  --red:        #dc2626;
  --red-bg:     #fee2e2;
}

.modal-box { width: 620px; max-width: calc(100vw - 40px); max-height: 82vh; background: var(--bg-panel); border: 1px solid var(--border-mid); border-radius: 16px; box-shadow: var(--shadow-lg); display: flex; flex-direction: column; overflow: hidden; }

.modal-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 22px 24px 18px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.modal-title { font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 17px; color: var(--text); }
.modal-sub   { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
.modal-close { width: 28px; height: 28px; border-radius: 6px; background: var(--bg-card); border: 1px solid var(--border); cursor: pointer; display: flex; align-items: center; justify-content: center; color: var(--text-muted); transition: color 0.15s, background 0.15s; }
.modal-close:hover { background: var(--bg-hover); color: var(--text); }

.toolbar { display: flex; align-items: center; gap: 10px; padding: 14px 24px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.search-wrap { flex: 1; position: relative; display: flex; align-items: center; }
.search-icon { position: absolute; left: 11px; color: var(--text-muted); pointer-events: none; }
.search-input { width: 100%; padding: 8px 12px 8px 32px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 13px; font-family: 'DM Sans', sans-serif; outline: none; transition: border-color 0.15s; }
.search-input::placeholder { color: var(--text-muted); }
.search-input:focus { border-color: var(--border-mid); }

.modal-body { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 8px 0; min-height: 0; }
.state-msg { padding: 40px 24px; text-align: center; font-size: 13px; color: var(--text-muted); }
.state-error { margin: 12px 24px; padding: 12px 14px; border-radius: 8px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #ef4444; font-size: 12.5px; }

.contact-list { display: flex; flex-direction: column; }
.contact-row { display: flex; align-items: center; gap: 12px; padding: 12px 24px; border-bottom: 1px solid var(--border); transition: background 0.15s; }
.contact-row:last-child { border-bottom: none; }
.contact-row:hover { background: var(--bg-hover); }

.cust-avatar { width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0; background: var(--accent-bg); color: var(--accent-text); display: flex; align-items: center; justify-content: center; font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 13px; }

.cust-info { flex: 1; min-width: 0; }
.cust-name { font-size: 13.5px; font-weight: 500; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cust-meta { font-size: 11px; color: var(--text-muted); margin-top: 2px; }

.status-badge { flex-shrink: 0; padding: 3px 9px; border-radius: 999px; font-size: 10.5px; font-weight: 600; white-space: nowrap; }
.status-badge.status-none { background: var(--bg-card); border: 1px solid var(--border-mid); color: var(--text-muted); }
.status-badge.status-owes { background: var(--red-bg); color: var(--red); }
.status-badge.status-paid { background: var(--green-bg); color: var(--green); }

.edit-btn, .delete-btn { width: 28px; height: 28px; border-radius: 7px; border: 1px solid var(--border); background: transparent; color: var(--text-muted); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: color 0.15s, background 0.15s, border-color 0.15s; flex-shrink: 0; }
.edit-btn:hover { background: var(--bg-hover); color: var(--text); }
.delete-btn:hover:not(:disabled) { color: #ef4444; background: rgba(239,68,68,0.08); border-color: rgba(239,68,68,0.3); }
.delete-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.modal-body::-webkit-scrollbar { width: 4px; }
.modal-body::-webkit-scrollbar-track { background: transparent; }
.modal-body::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.2); border-radius: 2px; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>

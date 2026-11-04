<!--
  PayLaterCustomerBookModal.vue — the full Pay Later contact book.
  Unlike the main Pay Later ledger table (which only shows customers who owe
  money), this shows EVERY registered contact — including ones who were only
  ever added but never bought anything on credit yet. Search, edit, delete.
-->
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { supabase } from '../../lib/supabase'
import { markConnected, markError } from '../../lib/connectionStatus'
import Toast from '../Toast.vue'
import EditPayLaterCustomerModal from './EditPayLaterCustomerModal.vue'
import ConfirmModal from '../ConfirmModal.vue'
import PromptModal from '../PromptModal.vue'
import TagChips from '../TagChips.vue'
import TagFilter from '../TagFilter.vue'
import { useCustomerTags, TAG_COLORS, NO_TAG } from '../../composables/useCustomerTags'

const props = defineProps<{ modelValue: boolean; isLight: boolean }>()
const emit  = defineEmits<{
  (e: 'update:modelValue', val: boolean): void
  (e: 'changed'): void   // tells PayLaterView to refresh its own ledger table
  (e: 'newCustomer'): void   // the "+ New Customer" button: PayLaterView opens its add form
}>()

// ── DATA SHAPE — same fields the pay_later_balances view already gives us ──
interface Contact {
  id: string
  name: string
  id_number: string | null
  phone: string | null
  whatsapp: string | null
  nickname: string | null
  address: string | null
  total_billed: number
  total_owed: number
  total_loaned: number
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
      .select('id, name, id_number, phone, whatsapp, nickname, address, total_billed, total_owed, total_loaned')
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

// ── TAGS ──
const { tags, tagCounts, loadTags, tagsOf, matchesTag, tagSearchText, createTag, updateTag, deleteTag } = useCustomerTags()
const tagFilter = ref<string | null>(null)
const tagOptions = computed(() =>
  tags.value.map(t => ({ id: t.id, name: t.name, color: t.color, count: tagCounts.value.get(t.id) ?? 0 }))
)
const untaggedCount = computed(() => contacts.value.filter(c => matchesTag(c.id, NO_TAG)).length)

watch(() => props.modelValue, (isOpen) => { if (isOpen) { fetchContacts(); loadTags(true) } })

// ── MANAGE TAGS panel (create / rename / delete the tags themselves) ──
const showManage  = ref(false)
const newTagName  = ref('')
const newTagColor = ref(TAG_COLORS[0])
const tagMsg      = ref('')

async function addTag() {
  tagMsg.value = ''
  const res = await createTag(newTagName.value, newTagColor.value)
  if (res.error) { tagMsg.value = res.error; return }
  newTagName.value = ''
  // the next new tag gets the next colour, so tags look different by default
  newTagColor.value = TAG_COLORS[(tags.value.length) % TAG_COLORS.length]
}

// Rename: clicking the button opens our own pop-up; saving it runs the real rename
const renameTarget = ref<{ id: string; name: string; color: string } | null>(null)
const showRename   = ref(false)

function renameTag(id: string, current: string, color: string) {
  renameTarget.value = { id, name: current, color }
  showRename.value   = true
}

async function onRenameSubmit(name: string) {
  const t = renameTarget.value
  if (!t || name === t.name) return
  tagMsg.value = await updateTag(t.id, name, t.color)
}

async function recolorTag(id: string, name: string, color: string) {
  tagMsg.value = await updateTag(id, name, color)
}

// One shared "are you sure?" pop-up for both deletes (tag and contact)
const showConfirm    = ref(false)
const confirmTitle   = ref('')
const confirmMessage = ref('')
const confirmText    = ref('Delete')
const pendingAction  = ref<(() => void) | null>(null)

function askConfirm(title: string, message: string, action: () => void) {
  confirmTitle.value   = title
  confirmMessage.value = message
  pendingAction.value  = action
  showConfirm.value    = true
}

function runPendingAction() {
  pendingAction.value?.()
  pendingAction.value = null
}

function removeTag(id: string, name: string) {
  const n = tagCounts.value.get(id) ?? 0
  askConfirm(
    'Delete tag?',
    `Delete the tag "${name}"?${n ? ` It will be taken off ${n} customer${n === 1 ? '' : 's'}.` : ''}`,
    async () => {
      const err = await deleteTag(id)
      if (err) { tagMsg.value = err; return }
      if (tagFilter.value === id) tagFilter.value = null
      emit('changed')
    },
  )
}

// ── SEARCH ──
function displayList(): Contact[] {
  const q = searchQuery.value.toLowerCase().trim()
  const byTag = contacts.value.filter(c => matchesTag(c.id, tagFilter.value))
  if (!q) return byTag
  return byTag.filter(c =>
    c.name.toLowerCase().includes(q) ||
    (c.nickname ?? '').toLowerCase().includes(q) ||
    (c.phone ?? '').toLowerCase().includes(q) ||
    (c.id_number ?? '').toLowerCase().includes(q) ||
    tagSearchText(c.id).includes(q)
  )
}

// Small status badge per contact: not a buyer yet / owes money / fully paid
function statusLabel(c: Contact): string {
  if (Number(c.total_billed) + Number(c.total_loaned) === 0) return 'No purchases yet'
  if (c.total_owed > 0)     return 'Owes money'
  return 'Paid up'
}
function statusClass(c: Contact): string {
  if (Number(c.total_billed) + Number(c.total_loaned) === 0) return 'status-none'
  if (c.total_owed > 0)     return 'status-owes'
  return 'status-paid'
}

// ── DELETE ──
const deletingId = ref<string | null>(null)

function deleteContact(c: Contact) {
  askConfirm('Delete contact?', `Delete ${c.name} from the contact book? This can't be undone.`, () => doDeleteContact(c))
}

async function doDeleteContact(c: Contact) {
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
          <button class="new-btn" @click="emit('newCustomer')" title="Add a new customer">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Customer
          </button>
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
            <input v-model="searchQuery" class="search-input" placeholder="Search name, nickname, phone, ID or tag…" />
          </div>
          <button class="manage-btn" :class="{ active: showManage }" @click="showManage = !showManage" title="Create, rename or delete tags">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
            Tags
          </button>
        </div>

        <!-- TAG MANAGER: make the tags once, then give them to customers with the Edit button -->
        <Transition name="slide">
          <div v-if="showManage" class="tag-manager">
            <div class="tm-title">Tags <span>location / organization — e.g. Provincial Council, Pradeshiya Sabha</span></div>
            <div v-if="tags.length === 0" class="tm-empty">No tags yet. Create the first one below.</div>
            <div v-for="t in tags" :key="t.id" class="tm-row">
              <span class="tm-dot" :style="{ background: t.color }"></span>
              <span class="tm-name">{{ t.name }}</span>
              <span class="tm-count">{{ tagCounts.get(t.id) ?? 0 }} customer{{ (tagCounts.get(t.id) ?? 0) === 1 ? '' : 's' }}</span>
              <span class="tm-colors">
                <button v-for="c in TAG_COLORS" :key="c" class="tm-color" :class="{ on: t.color === c }" :style="{ background: c }" @click="recolorTag(t.id, t.name, c)"></button>
              </span>
              <button class="tm-act" @click="renameTag(t.id, t.name, t.color)">Rename</button>
              <button class="tm-act tm-del" @click="removeTag(t.id, t.name)">Delete</button>
            </div>
            <div class="tm-new">
              <input v-model="newTagName" class="tm-input" placeholder="New tag name…" @keydown.enter="addTag" />
              <span class="tm-colors">
                <button v-for="c in TAG_COLORS" :key="c" class="tm-color" :class="{ on: newTagColor === c }" :style="{ background: c }" @click="newTagColor = c"></button>
              </span>
              <button class="tm-add" @click="addTag">+ Add tag</button>
            </div>
            <div v-if="tagMsg" class="tm-msg">{{ tagMsg }}</div>
          </div>
        </Transition>

        <!-- TAG FILTER -->
        <div v-if="tags.length" class="tag-filter-row">
          <TagFilter v-model="tagFilter" compact :options="tagOptions" :allCount="contacts.length" :noTagCount="untaggedCount" />
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
                <div class="cust-name">{{ c.name }}<span v-if="c.nickname" class="cust-nick"> “{{ c.nickname }}”</span></div>
                <div v-if="tagsOf(c.id).length" class="cust-tags"><TagChips :tags="tagsOf(c.id)" :max="4" /></div>
                <div class="cust-meta">
                  <span v-if="c.phone">{{ c.phone }}</span>
                  <span v-if="c.whatsapp" class="wa-chip" :title="'WhatsApp: ' + c.whatsapp">WhatsApp{{ c.whatsapp === c.phone ? '' : ' ' + c.whatsapp }}</span>
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

  <PromptModal
    v-model="showRename"
    :isLight="isLight"
    title="Rename tag"
    label="Tag name"
    :initialValue="renameTarget?.name"
    @submit="onRenameSubmit"
  />

  <ConfirmModal
    v-model="showConfirm"
    :isLight="isLight"
    :title="confirmTitle"
    :message="confirmMessage"
    :confirmText="confirmText"
    danger
    @confirm="runPendingAction"
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
  --border:     rgba(0,0,0,0.16);
  --border-mid: rgba(0,0,0,0.26);
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


.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.wa-chip { margin-left: 6px; padding: 0 7px; border-radius: 999px; background: rgba(37,211,102,.14); color: #25D366; font-size: 10px; font-weight: 600; }
.cust-nick { font-weight: 400; font-style: italic; color: var(--text-sub); font-size: 12px; }
.cust-tags { margin: 3px 0 2px; }
.tag-filter-row { padding: 10px 24px; border-bottom: 1px solid var(--border); flex-shrink: 0; max-height: 84px; overflow-y: auto; }
.manage-btn {
  display: inline-flex; align-items: center; gap: 6px; padding: 8px 13px; border-radius: 9px; cursor: pointer;
  border: 1px solid var(--border-mid); background: var(--bg-card); color: var(--text-sub);
  font-size: 12.5px; font-family: 'DM Sans', sans-serif; transition: background .15s, color .15s;
}
.manage-btn:hover, .manage-btn.active { background: var(--accent-bg); color: var(--accent-text); border-color: var(--accent-bg); }
.tag-manager { padding: 14px 24px; border-bottom: 1px solid var(--border); background: var(--bg-card); display: flex; flex-direction: column; gap: 9px; flex-shrink: 0; max-height: 260px; overflow-y: auto; }
.tm-title { font-size: 13px; font-weight: 600; color: var(--text); }
.tm-title span { font-weight: 400; color: var(--text-muted); font-size: 11.5px; margin-left: 6px; }
.tm-empty { font-size: 12.5px; color: var(--text-muted); }
.tm-row, .tm-new { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.tm-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.tm-name { font-size: 13px; font-weight: 500; color: var(--text); }
.tm-count { font-size: 11.5px; color: var(--text-muted); }
.tm-colors { display: inline-flex; gap: 5px; margin-left: auto; }
.tm-new .tm-colors { margin-left: 0; }
.tm-color { width: 15px; height: 15px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0; }
.tm-color.on { border-color: var(--text); }
.tm-act { padding: 3px 10px; border-radius: 7px; border: 1px solid var(--border-mid); background: transparent; color: var(--text-sub); font-size: 11.5px; cursor: pointer; font-family: 'DM Sans', sans-serif; }
.tm-act:hover { color: var(--text); background: var(--bg-hover); }
.tm-del:hover { color: var(--red); border-color: var(--red); background: var(--red-bg); }
.tm-input { flex: 1; min-width: 140px; padding: 7px 11px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-panel); color: var(--text); font-size: 13px; font-family: 'DM Sans', sans-serif; outline: none; }
.tm-add { padding: 7px 14px; border-radius: 8px; border: none; background: var(--accent-bg); color: var(--accent-text); font-size: 12px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; }
.tm-msg { font-size: 12px; color: var(--red); }
.slide-enter-active, .slide-leave-active { transition: opacity .18s ease, max-height .22s ease; overflow: hidden; }
.slide-enter-from, .slide-leave-to { opacity: 0; max-height: 0; }
.new-btn {
  margin-left: auto; margin-right: 12px; display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 9px; border: none; cursor: pointer;
  background: var(--accent-bg); color: var(--accent-text); font-size: 12.5px; font-weight: 600; font-family: 'DM Sans', sans-serif;
  transition: opacity .15s;
}
.new-btn:hover { opacity: .85; }
</style>

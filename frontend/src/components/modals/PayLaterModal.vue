<!--
  PayLaterModal.vue — Shown when the cashier clicks Checkout on a Later Pay order.
  Two views:
    • "search" — find an existing customer, see their balance, select and confirm
    • "register" — add a brand-new customer, auto-select them, go back to search

  The parent (POSView.vue) is responsible for the actual Supabase writes.
  This modal just decides WHO the bill belongs to, then emits "confirm".
-->

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { supabase } from '../../lib/supabase'

// ── PROPS ──
const props = defineProps<{
  modelValue: boolean
  isLight: boolean
  orderTotal: number       // total Rs. of the current cart
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void
  (e: 'confirm', payload: { customerId: string; printBill: boolean }): void
}>()

// ── TYPES ──
// Row returned by the pay_later_balances view
interface CustomerBalance {
  id: string
  name: string
  id_number: string | null
  phone: string | null
  address: string | null
  total_owed: number
  last_bill_at: string | null
}

// ── VIEW STATE: 'search' or 'register' ──
type View = 'search' | 'register'
const view = ref<View>('search')

function goRegister() { view.value = 'register' }
function goSearch()   { view.value = 'search'; resetRegForm() }

// ── CUSTOMER LIST ──
const customers   = ref<CustomerBalance[]>([])
const listLoading = ref(false)
const listError   = ref('')

async function fetchCustomers() {
  listLoading.value = true
  listError.value   = ''
  const { data, error } = await supabase
    .from('pay_later_balances')
    .select('*')
  if (error) { listError.value = error.message }
  else { customers.value = data ?? [] }
  listLoading.value = false
}

// ── SEARCH + SORT ──
const searchQuery = ref('')
type SortMode = 'latest' | 'az'
const sortMode = ref<SortMode>('latest')

const filteredCustomers = computed(() => {
  const q = searchQuery.value.toLowerCase()
  let list = q
    ? customers.value.filter(c => c.name.toLowerCase().includes(q))
    : [...customers.value]

  if (sortMode.value === 'az') {
    list.sort((a, b) => a.name.localeCompare(b.name))
  } else {
    list.sort((a, b) => {
      if (!a.last_bill_at && !b.last_bill_at) return 0
      if (!a.last_bill_at) return 1
      if (!b.last_bill_at) return -1
      return new Date(b.last_bill_at).getTime() - new Date(a.last_bill_at).getTime()
    })
  }
  return list
})

// ── SELECTION ──
const selectedId = ref<string | null>(null)
const selectedCustomer = computed(() => customers.value.find(c => c.id === selectedId.value) ?? null)

function selectCustomer(c: CustomerBalance) {
  selectedId.value = selectedId.value === c.id ? null : c.id
}

// ── PRINT BILL toggle (separate from POSView's — user controls this per-order) ──
const printBill = ref(false)

// ── REGISTER FORM ──
const regName    = ref('')
const regIdNum   = ref('')
const regPhone   = ref('')
const regAddress = ref('')
const regError   = ref('')
const regSaving  = ref(false)
const regShowErr = ref(false)

function resetRegForm() {
  regName.value    = ''
  regIdNum.value   = ''
  regPhone.value   = ''
  regAddress.value = ''
  regError.value   = ''
  regShowErr.value = false
}

async function addAndSelect() {
  if (!regName.value.trim()) { regShowErr.value = true; return }
  regSaving.value = true
  regError.value  = ''
  const { data, error } = await supabase
    .from('pay_later_customers')
    .insert({
      name:       regName.value.trim(),
      id_number:  regIdNum.value || null,
      phone:      regPhone.value || null,
      address:    regAddress.value || null,
    })
    .select()
    .single()
  regSaving.value = false

  if (error) { regError.value = error.message; return }

  // Reload list, auto-select new customer, go back to search
  await fetchCustomers()
  selectedId.value = data.id
  goSearch()
}

// ── CONFIRM (emit to POSView to do the actual checkout) ──
function confirm() {
  if (!selectedId.value) return
  emit('confirm', { customerId: selectedId.value, printBill: printBill.value })
}

// ── CLOSE ──
function close() {
  emit('update:modelValue', false)
}

// ── HELPERS ──
function fmtRs(n: number): string {
  return `Rs. ${n.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(d: string | null): string {
  if (!d) return 'No bills yet'
  const dt = new Date(d)
  return dt.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ── LIFECYCLE ──
// Reload customers every time the modal opens; reset state when it closes
watch(() => props.modelValue, (open) => {
  if (open) {
    view.value       = 'search'
    selectedId.value = null
    searchQuery.value = ''
    sortMode.value   = 'latest'
    printBill.value  = false
    resetRegForm()
    fetchCustomers()
    window.addEventListener('keydown', onKey)
  } else {
    window.removeEventListener('keydown', onKey)
  }
})

function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close() }
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

        <!-- ════════════════════════════════════════ -->
        <!--  SEARCH VIEW — find or select customer  -->
        <!-- ════════════════════════════════════════ -->
        <template v-if="view === 'search'">

          <!-- HEADER -->
          <div class="modal-header">
            <div>
              <div class="modal-title">Pay Later Checkout</div>
              <div class="modal-sub">Select a customer · bill total {{ fmtRs(props.orderTotal) }}</div>
            </div>
            <div class="header-right">
              <button class="btn-register" @click="goRegister">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                New Customer
              </button>
              <button class="modal-close" @click="close">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>

          <!-- SEARCH + SORT BAR -->
          <div class="search-bar">
            <div class="search-input-wrap">
              <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                v-model="searchQuery"
                class="form-input search-input"
                placeholder="Search by name…"
                autocomplete="off"
              />
            </div>
            <div class="sort-chips">
              <button
                v-for="s in [{ key: 'latest', label: 'Latest' }, { key: 'az', label: 'A – Z' }] as const"
                :key="s.key"
                class="sort-chip"
                :class="{ active: sortMode === s.key }"
                @click="sortMode = s.key"
              >{{ s.label }}</button>
            </div>
          </div>

          <!-- CUSTOMER LIST -->
          <div class="modal-body customer-list-body">
            <div v-if="listLoading" class="list-state">Loading customers…</div>
            <div v-else-if="listError" class="list-error">{{ listError }}</div>
            <div v-else-if="filteredCustomers.length === 0" class="list-state">
              {{ searchQuery ? 'No customers match your search.' : 'No customers registered yet. Add one →' }}
            </div>

            <div
              v-for="c in filteredCustomers"
              :key="c.id"
              class="customer-row"
              :class="{ selected: selectedId === c.id }"
              @click="selectCustomer(c)"
            >
              <!-- Avatar initial -->
              <div class="cust-avatar">{{ c.name.charAt(0).toUpperCase() }}</div>

              <div class="cust-info">
                <div class="cust-name">{{ c.name }}</div>
                <div class="cust-meta">
                  <span v-if="c.phone">{{ c.phone }}</span>
                  <span v-if="c.phone && c.id_number"> · </span>
                  <span v-if="c.id_number">ID {{ c.id_number }}</span>
                </div>
              </div>

              <div class="cust-right">
                <div class="cust-owed" :class="{ 'owed-none': c.total_owed === 0 }">
                  {{ c.total_owed > 0 ? fmtRs(c.total_owed) : 'No balance' }}
                </div>
                <div class="cust-date">Last: {{ fmtDate(c.last_bill_at) }}</div>
              </div>

              <!-- Tick when selected -->
              <div v-if="selectedId === c.id" class="cust-tick">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
            </div>
          </div>

          <!-- FOOTER -->
          <div class="modal-footer">
            <div class="footer-left">
              <div class="print-row" @click="printBill = !printBill">
                <div class="checkbox" :class="{ checked: printBill }">
                  <svg v-if="printBill" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <span class="print-label">Print bill</span>
              </div>
            </div>
            <div class="footer-right">
              <button class="modal-cancel" @click="close">Cancel</button>
              <button
                class="modal-save"
                :disabled="!selectedId"
                @click="confirm"
              >
                {{ selectedCustomer ? `Pay Later · ${selectedCustomer.name}` : 'Select a Customer' }}
              </button>
            </div>
          </div>

        </template>


        <!-- ════════════════════════════════════════ -->
        <!--  REGISTER VIEW — add a new customer     -->
        <!-- ════════════════════════════════════════ -->
        <template v-else>

          <!-- HEADER -->
          <div class="modal-header">
            <div class="header-left">
              <button class="back-btn" @click="goSearch">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
              </button>
              <div>
                <div class="modal-title">Register Customer</div>
                <div class="modal-sub">Add a new Pay Later customer</div>
              </div>
            </div>
            <button class="modal-close" @click="close">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <!-- FORM -->
          <div class="modal-body">
            <!-- Name -->
            <div class="form-field">
              <label class="form-label">Full Name <span class="req">*</span></label>
              <input
                v-model="regName"
                class="form-input"
                :class="{ error: regShowErr && !regName.trim() }"
                placeholder="e.g. Shashika Nuwan"
                autocomplete="off"
              />
              <span v-if="regShowErr && !regName.trim()" class="form-error">Name is required</span>
            </div>

            <!-- ID Number -->
            <div class="form-field">
              <label class="form-label">ID Number</label>
              <input
                v-model="regIdNum"
                class="form-input"
                placeholder="National ID / Passport"
                autocomplete="off"
              />
            </div>

            <!-- Phone -->
            <div class="form-field">
              <label class="form-label">Phone Number</label>
              <input
                v-model="regPhone"
                class="form-input"
                placeholder="e.g. 077 123 4567"
                autocomplete="off"
                type="tel"
              />
            </div>

            <!-- Address -->
            <div class="form-field">
              <label class="form-label">Address</label>
              <textarea
                v-model="regAddress"
                class="form-input textarea"
                placeholder="Street, City…"
                rows="3"
              />
            </div>

            <div v-if="regError" class="save-error">{{ regError }}</div>
          </div>

          <!-- FOOTER -->
          <div class="modal-footer">
            <div class="footer-right">
              <button class="modal-cancel" :disabled="regSaving" @click="goSearch">Back</button>
              <button class="modal-save" :disabled="regSaving" @click="addAndSelect">
                {{ regSaving ? 'Saving…' : 'Add & Select' }}
              </button>
            </div>
          </div>

        </template>

      </div>
    </div>
  </Transition>
</template>


<style scoped>
/* ── CSS VARIABLES (dark default) — identical to AddClothModal ── */
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
  --green:       #22c55e;
  --green-bg:    rgba(34,197,94,0.12);

  position: fixed; inset: 0;
  background: rgba(0,0,0,0.65);
  backdrop-filter: blur(7px);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
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
  --green:       #16a34a;
  --green-bg:    rgba(22,163,74,0.1);
}

.modal-box {
  width: 560px;
  max-width: calc(100vw - 40px);
  max-height: 88vh;
  background: var(--bg-panel);
  border: 1px solid var(--border-mid);
  border-radius: 20px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── HEADER ── */
.modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 22px 24px 18px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.header-left  { display: flex; align-items: center; gap: 12px; }
.header-right { display: flex; align-items: center; gap: 8px; }

.modal-title { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 18px; letter-spacing: -0.4px; color: var(--text); }
.modal-sub   { font-size: 12px; color: var(--text-muted); margin-top: 2px; }

.modal-close {
  width: 34px; height: 34px; border-radius: 9px;
  background: var(--bg-card); border: 1px solid var(--border);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  color: var(--text-sub); transition: background 0.15s, color 0.15s;
}
.modal-close:hover { background: var(--bg-hover); color: var(--text); }

.back-btn {
  width: 34px; height: 34px; border-radius: 9px;
  background: var(--bg-card); border: 1px solid var(--border);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  color: var(--text-sub); transition: background 0.15s, color 0.15s; flex-shrink: 0;
}
.back-btn:hover { background: var(--bg-hover); color: var(--text); }

.btn-register {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 14px; border-radius: 8px;
  background: var(--bg-card); border: 1px solid var(--border-mid);
  color: var(--text-sub); font-size: 12.5px; font-family: 'DM Sans', sans-serif;
  cursor: pointer; transition: background 0.15s, color 0.15s;
}
.btn-register:hover { background: var(--bg-hover); color: var(--text); }

/* ── SEARCH BAR ── */
.search-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 24px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.search-input-wrap { flex: 1; position: relative; display: flex; align-items: center; }
.search-icon { position: absolute; left: 12px; color: var(--text-muted); pointer-events: none; flex-shrink: 0; }

.search-input { padding-left: 36px !important; }

.sort-chips { display: flex; gap: 6px; flex-shrink: 0; }
.sort-chip {
  padding: 6px 12px; border-radius: 8px;
  border: 1px solid var(--border); background: var(--bg-card);
  color: var(--text-sub); font-size: 12px; font-family: 'DM Sans', sans-serif;
  cursor: pointer; transition: all 0.15s;
}
.sort-chip.active { border-color: var(--accent-bg); background: var(--accent-bg); color: var(--accent-text); font-weight: 600; }

/* ── CUSTOMER LIST ── */
.customer-list-body { overflow-y: auto; flex: 1; padding: 8px 0; min-height: 0; }

.list-state { padding: 32px 24px; text-align: center; font-size: 13px; color: var(--text-muted); }
.list-error { margin: 12px 24px; padding: 10px 14px; border-radius: 8px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: var(--danger); font-size: 12.5px; }

.customer-row {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 24px;
  cursor: pointer;
  transition: background 0.12s;
  position: relative;
  border-bottom: 1px solid var(--border);
}
.customer-row:last-child { border-bottom: none; }
.customer-row:hover { background: var(--bg-hover); }
.customer-row.selected { background: var(--green-bg); }

.cust-avatar {
  width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0;
  background: var(--accent-bg); color: var(--accent-text);
  display: flex; align-items: center; justify-content: center;
  font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 14px;
}
.customer-row.selected .cust-avatar { background: var(--green); color: #fff; }

.cust-info { flex: 1; min-width: 0; }
.cust-name { font-size: 13.5px; font-weight: 500; color: var(--text); }
.cust-meta { font-size: 11px; color: var(--text-muted); margin-top: 2px; }

.cust-right { text-align: right; flex-shrink: 0; }
.cust-owed  { font-size: 13px; font-weight: 600; color: var(--text); font-family: 'DM Mono', monospace; }
.cust-owed.owed-none { color: var(--text-muted); font-weight: 400; font-family: 'DM Sans', sans-serif; font-size: 12px; }
.cust-date  { font-size: 10.5px; color: var(--text-muted); margin-top: 2px; }

.cust-tick {
  position: absolute; right: 24px;
  width: 22px; height: 22px; border-radius: 50%;
  background: var(--green); color: #fff;
  display: flex; align-items: center; justify-content: center;
}

/* ── FORM ── */
.modal-body { flex: 1; overflow-y: auto; padding: 22px 24px; min-height: 0; display: flex; flex-direction: column; gap: 16px; }

.form-field { display: flex; flex-direction: column; gap: 6px; }
.form-label { font-size: 11px; font-weight: 600; color: var(--text-sub); letter-spacing: 0.06em; text-transform: uppercase; }
.req { color: var(--danger); }

.form-input {
  width: 100%; padding: 10px 13px;
  background: var(--bg-input); border: 1px solid var(--border-mid);
  border-radius: 9px; color: var(--text); font-size: 13.5px;
  font-family: 'DM Sans', sans-serif; outline: none; transition: border-color 0.15s;
}
.form-input::placeholder { color: var(--text-muted); opacity: 0.6; }
.form-input:focus { border-color: var(--border-focus); }
.form-input.error { border-color: var(--danger); }
.form-input.textarea { resize: vertical; min-height: 76px; }
.form-error { font-size: 11px; color: var(--danger); }

.save-error { padding: 10px 14px; border-radius: 8px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: var(--danger); font-size: 12.5px; }

/* ── FOOTER ── */
.modal-footer {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 24px 18px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
.footer-left  { display: flex; align-items: center; }
.footer-right { display: flex; gap: 8px; margin-left: auto; }

.print-row {
  display: flex; align-items: center; gap: 8px;
  cursor: pointer; user-select: none;
}
.checkbox {
  width: 16px; height: 16px; border-radius: 4px;
  border: 1.5px solid var(--border-mid); background: transparent;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s; flex-shrink: 0;
}
.checkbox.checked { border-color: var(--green); background: var(--green); }
.checkbox.checked svg { color: #fff; }
.print-label { font-size: 12.5px; color: var(--text-sub); }

.modal-cancel {
  padding: 10px 20px; border-radius: 9px;
  border: 1px solid var(--border); background: var(--bg-card);
  color: var(--text-sub); font-size: 13px; font-family: 'DM Sans', sans-serif;
  cursor: pointer; transition: background 0.15s;
}
.modal-cancel:hover { background: var(--bg-hover); color: var(--text); }

.modal-save {
  padding: 10px 24px; border-radius: 9px; border: none;
  background: var(--accent-bg); color: var(--accent-text);
  font-size: 13px; font-weight: 600; font-family: 'DM Sans', sans-serif;
  cursor: pointer; min-width: 120px; transition: opacity 0.15s;
  white-space: nowrap;
}
.modal-save:hover { opacity: 0.85; }
.modal-save:disabled { opacity: 0.5; cursor: not-allowed; }

/* ── SCROLLBAR ── */
.customer-list-body::-webkit-scrollbar { width: 4px; }
.customer-list-body::-webkit-scrollbar-track { background: transparent; }
.customer-list-body::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.2); border-radius: 2px; }
.modal-body::-webkit-scrollbar { width: 4px; }
.modal-body::-webkit-scrollbar-track { background: transparent; }
.modal-body::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.2); border-radius: 2px; }

/* ── FADE ── */
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>

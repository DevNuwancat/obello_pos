<!--
  EditPayLaterCustomerModal.vue — small form to fix a Pay Later contact's
  saved details (name, ID number, phone, address). Always edits an existing
  row — creating new ones happens elsewhere (PayLaterView's "New Customer"
  button, or the Cart's Pay Later checkout "New Customer" button).
-->
<script setup lang="ts">
import { ref, watch } from 'vue'
import { supabase } from '../../lib/supabase'
import Toast from '../Toast.vue'

const props = defineProps<{
  modelValue: boolean
  isLight: boolean
  customer: { id: string; name: string; id_number: string | null; phone: string | null; address: string | null } | null
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void
  (e: 'saved'): void
}>()

// ── FORM FIELDS ──
const name     = ref('')
const idNumber = ref('')
const phone    = ref('')
const address  = ref('')

const showErrors = ref(false)
const saving      = ref(false)
const saveError   = ref('')
const showToast    = ref(false)

// Pre-fill the form every time this opens for a (possibly different) customer
watch(() => props.modelValue, (isOpen) => {
  if (isOpen && props.customer) {
    name.value     = props.customer.name
    idNumber.value = props.customer.id_number ?? ''
    phone.value    = props.customer.phone ?? ''
    address.value  = props.customer.address ?? ''
    showErrors.value = false
    saveError.value  = ''
  }
})

function close() {
  emit('update:modelValue', false)
}

async function save() {
  if (!props.customer) return
  if (!name.value.trim()) { showErrors.value = true; return }

  saving.value    = true
  saveError.value = ''

  const { error } = await supabase
    .from('pay_later_customers')
    .update({
      name:      name.value.trim(),
      id_number: idNumber.value.trim() || null,
      phone:     phone.value.trim() || null,
      address:   address.value.trim() || null,
    })
    .eq('id', props.customer.id)

  saving.value = false

  if (error) { saveError.value = error.message; return }

  showToast.value = true
  emit('saved')
  close()
  setTimeout(() => { showToast.value = false }, 2600)
}
</script>

<template>
  <Transition name="fade">
    <div v-if="modelValue" class="modal-overlay" :class="{ light: isLight }">
      <div class="modal-box">

        <div class="modal-header">
          <div class="modal-title">Edit Contact</div>
          <button class="modal-close" @click="close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div class="modal-body">
          <div class="form-field">
            <label class="form-label">Full Name *</label>
            <input v-model="name" class="form-input" :class="{ error: showErrors && !name.trim() }" placeholder="e.g. Shashika Nuwan" />
            <span v-if="showErrors && !name.trim()" class="form-error">Name is required</span>
          </div>
          <div class="form-field">
            <label class="form-label">ID Number</label>
            <input v-model="idNumber" class="form-input" placeholder="National ID / Passport" />
          </div>
          <div class="form-field">
            <label class="form-label">Phone Number</label>
            <input v-model="phone" class="form-input" type="tel" placeholder="e.g. 077 123 4567" />
          </div>
          <div class="form-field">
            <label class="form-label">Address</label>
            <textarea v-model="address" class="form-input textarea" rows="3" placeholder="Street, City…" />
          </div>
        </div>

        <div v-if="saveError" class="save-error">{{ saveError }}</div>

        <div class="modal-footer">
          <button class="modal-cancel" :disabled="saving" @click="close">Cancel</button>
          <button class="modal-save" :disabled="saving" @click="save">{{ saving ? 'Saving…' : 'Save Changes' }}</button>
        </div>

      </div>
    </div>
  </Transition>

  <Toast message="Contact updated" :show="showToast" />
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
  --danger:      #ef4444;

  position: fixed; inset: 0; background: rgba(0,0,0,0.55); backdrop-filter: blur(5px);
  display: flex; align-items: center; justify-content: center; z-index: 1100;
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
  --danger:      #dc2626;
}

.modal-box { width: 440px; max-width: calc(100vw - 40px); max-height: 88vh; background: var(--bg-panel); border: 1px solid var(--border-mid); border-radius: 18px; box-shadow: var(--shadow-lg); display: flex; flex-direction: column; overflow: hidden; }
.modal-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.modal-title { font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 16px; color: var(--text); }
.modal-close { width: 28px; height: 28px; border-radius: 6px; background: var(--bg-card); border: 1px solid var(--border); cursor: pointer; display: flex; align-items: center; justify-content: center; color: var(--text-muted); transition: background 0.15s, color 0.15s; }
.modal-close:hover { background: var(--bg-hover); color: var(--text); }

.modal-body { flex: 1; overflow-y: auto; padding: 22px 24px; min-height: 0; display: flex; flex-direction: column; gap: 16px; }
.form-field { display: flex; flex-direction: column; gap: 6px; }
.form-label { font-size: 11px; font-weight: 500; color: var(--text-muted); letter-spacing: 0.06em; text-transform: uppercase; }
.form-input { padding: 10px 13px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 9px; color: var(--text); font-size: 13.5px; font-family: 'DM Sans', sans-serif; outline: none; transition: border-color 0.15s; }
.form-input::placeholder { color: var(--text-muted); opacity: 0.6; }
.form-input:focus { border-color: var(--border-mid); }
.form-input.error { border-color: var(--danger); }
.form-input.textarea { resize: vertical; min-height: 68px; }
.form-error { font-size: 11px; color: var(--danger); }

.save-error { margin: 0 24px 16px; padding: 10px 14px; border-radius: 8px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: var(--danger); font-size: 12.5px; }

.modal-footer { display: flex; gap: 10px; justify-content: flex-end; padding: 16px 24px; border-top: 1px solid var(--border); flex-shrink: 0; }
.modal-cancel { padding: 10px 20px; border-radius: 9px; border: 1px solid var(--border); background: transparent; color: var(--text-sub); font-size: 13px; font-family: 'DM Sans', sans-serif; cursor: pointer; transition: background 0.15s, color 0.15s; }
.modal-cancel:hover { background: var(--bg-hover); color: var(--text); }
.modal-save { padding: 10px 22px; border-radius: 9px; border: none; background: var(--accent-bg); color: var(--accent-text); font-size: 13px; font-weight: 600; font-family: 'DM Sans', sans-serif; cursor: pointer; transition: opacity 0.15s; }
.modal-save:hover { opacity: 0.85; }
.modal-save:disabled { opacity: 0.5; cursor: not-allowed; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>

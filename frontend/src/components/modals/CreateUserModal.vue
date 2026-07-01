<!--
  CreateUserModal.vue — Admin-only: create a new staff login (auth + profile).
  Calls the "create-user" Supabase Edge Function, which holds the secret
  service_role key server-side (that key must never be in this frontend code).
-->

<script setup lang="ts">
import { ref, watch } from 'vue'
import { supabase } from '../../lib/supabase'

const props = defineProps<{
  modelValue: boolean
  isLight: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void
  (e: 'saved'): void
}>()

const ROLES = [
  { value: 'admin',   label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'cashier',  label: 'Cashier' },
]

// ── FORM FIELDS ──
const fullName = ref('')
const email    = ref('')
const password = ref('')
const role     = ref('cashier')

// ── FORM STATE ──
const showErrors = ref(false)
const saving     = ref(false)
const saveError  = ref('')

function resetForm() {
  fullName.value = ''
  email.value    = ''
  password.value = ''
  role.value     = 'cashier'
  showErrors.value = false
  saveError.value  = ''
}

function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close() }

watch(() => props.modelValue, (isOpen) => {
  if (isOpen) {
    resetForm()
    window.addEventListener('keydown', onKey)
  } else {
    window.removeEventListener('keydown', onKey)
  }
})

function close() {
  emit('update:modelValue', false)
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function save() {
  const nameOk  = !!fullName.value.trim()
  const emailOk = EMAIL_RE.test(email.value.trim())
  const passOk  = password.value.length >= 6

  if (!nameOk || !emailOk || !passOk) {
    showErrors.value = true
    return
  }

  saving.value    = true
  saveError.value = ''

  try {
    const { data, error } = await supabase.functions.invoke('create-user', {
      body: {
        full_name: fullName.value.trim(),
        email: email.value.trim(),
        password: password.value,
        role: role.value,
      },
    })

    if (error) {
      // supabase-js puts the parsed function response body on error.context for non-2xx replies
      const body = await (error as any).context?.json?.().catch(() => null)
      saveError.value = body?.error || error.message || 'Failed to create user'
      return
    }
    if (!data?.success) {
      saveError.value = data?.error || 'Failed to create user'
      return
    }

    emit('saved')
    close()
  } catch {
    saveError.value = 'Something went wrong. Please try again.'
  } finally {
    saving.value = false
  }
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
            <div class="modal-title">Create User</div>
            <div class="modal-sub">Admins only · sets up a new staff login</div>
          </div>
          <button class="modal-close" @click="close">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <!-- ── BODY ── -->
        <div class="modal-body">
          <div class="col">

            <div class="form-field">
              <label class="form-label">Full Name <span class="req">*</span></label>
              <input v-model="fullName" type="text" name="new-user-full-name" autocomplete="off" class="form-input" :class="{ error: showErrors && !fullName.trim() }" placeholder="e.g. Nimal Perera" />
              <span v-if="showErrors && !fullName.trim()" class="form-error">Required</span>
            </div>

            <div class="form-field">
              <label class="form-label">Email <span class="req">*</span></label>
              <input v-model="email" type="email" name="new-user-email" autocomplete="off" class="form-input" :class="{ error: showErrors && !EMAIL_RE.test(email.trim()) }" placeholder="name@example.com" />
              <span v-if="showErrors && !EMAIL_RE.test(email.trim())" class="form-error">Enter a valid email address</span>
            </div>

            <div class="form-field">
              <label class="form-label">Password <span class="req">*</span></label>
              <input v-model="password" type="password" name="new-user-password" autocomplete="new-password" class="form-input" :class="{ error: showErrors && password.length < 6 }" placeholder="At least 6 characters" />
              <span v-if="showErrors && password.length < 6" class="form-error">Must be at least 6 characters</span>
            </div>

            <div class="form-field">
              <label class="form-label">Role <span class="req">*</span></label>
              <select v-model="role" class="form-input form-select">
                <option v-for="r in ROLES" :key="r.value" :value="r.value">{{ r.label }}</option>
              </select>
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
              {{ saving ? 'Creating…' : 'Create User' }}
            </button>
          </div>
        </div>

      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* ── CSS VARIABLES (dark default) — same convention as EditProductModal ── */
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
  width: 460px; max-width: calc(100vw - 40px); max-height: 90vh;
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
.modal-close { width: 34px; height: 34px; border-radius: 9px; background: var(--bg-card); border: 1px solid var(--border); cursor: pointer; display: flex; align-items: center; justify-content: center; color: var(--text-sub); transition: background 0.15s, color 0.15s; }
.modal-close:hover { background: var(--bg-hover); color: var(--text); }

.modal-body { flex: 1; overflow-y: auto; padding: 24px 28px; min-height: 0; }
.col { display: flex; flex-direction: column; gap: 16px; }

.form-field { display: flex; flex-direction: column; gap: 6px; }
.form-label { font-size: 11px; font-weight: 600; color: var(--text-sub); letter-spacing: 0.06em; text-transform: uppercase; }
.req { color: var(--danger); }
.form-input { width: 100%; padding: 10px 13px; background: var(--bg-input); border: 1px solid var(--border-mid); border-radius: 9px; color: var(--text); font-size: 13.5px; font-family: 'DM Sans', sans-serif; outline: none; transition: border-color 0.15s; }
.form-input::placeholder { color: var(--text-muted); opacity: 0.6; }
.form-input:focus { border-color: var(--border-focus); }
.form-input.error { border-color: var(--danger); }
.form-select { appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='none' stroke='%23888884' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round' d='M1 1l5 5 5-5'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 34px; cursor: pointer; }
.form-error { font-size: 11px; color: var(--danger); }

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

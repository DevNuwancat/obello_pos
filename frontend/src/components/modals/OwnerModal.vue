<script setup lang="ts">
import { ref, watch } from 'vue'
import { supabase } from '../../lib/supabase'
import Toast from '../Toast.vue'

// editOwner, when set, means "editing an existing owner" instead of creating a new one
const props = defineProps<{
  modelValue: boolean
  isLight: boolean
  editOwner?: { id: string; name: string; code: string } | null
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void
  (e: 'saved'): void
}>()

// ── FORM FIELDS ──
const ownerName = ref('')
const ownerCode = ref('')

// showErrors turns true when Save is clicked with empty fields
const showErrors = ref(false)
// saving is true while we wait for Supabase to respond
const saving     = ref(false)
// saveError holds any error message from Supabase
const saveError  = ref('')
// showToast controls the green success popup
const showToast  = ref(false)

// ── KEYBOARD SHORTCUTS ──
function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter')  save()
  if (e.key === 'Escape') close()
}

watch(() => props.modelValue, (isOpen) => {
  if (isOpen) {
    window.addEventListener('keydown', onKey)
    // Pre-fill the form when opened in edit mode
    if (props.editOwner) {
      ownerName.value = props.editOwner.name
      ownerCode.value = props.editOwner.code
    }
  } else {
    window.removeEventListener('keydown', onKey)
  }
})

// ── CLOSE ──
function close() {
  emit('update:modelValue', false)
  ownerName.value  = ''
  ownerCode.value  = ''
  showErrors.value = false
  saveError.value  = ''
}

// ── SAVE ──
async function save() {
  if (!ownerName.value.trim() || !ownerCode.value.trim()) {
    showErrors.value = true
    return
  }

  saving.value    = true
  saveError.value = ''

  try {
    const payload = { name: ownerName.value.trim(), code: ownerCode.value.trim() }

    const { error } = props.editOwner
      ? await supabase.from('owners').update(payload).eq('id', props.editOwner.id)
      : await supabase.from('owners').insert(payload)

    if (error) {
      if (error.code === '23505') {
        if (error.message.includes('name')) {
          saveError.value = 'An owner with this name already exists.'
        } else if (error.message.includes('code')) {
          saveError.value = 'An owner with this code already exists.'
        } else {
          saveError.value = 'This owner name or code already exists.'
        }
      } else {
        saveError.value = error.message
      }
      return
    }
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
</script>

<template>
  <Transition name="fade">
    <div v-if="modelValue" class="modal-overlay" :class="{ light: props.isLight }" @click.self="close">
      <div class="modal-box">

        <!-- Header -->
        <div class="modal-header">
          <div class="modal-title">{{ editOwner ? 'Edit Owner' : 'Add Owner' }}</div>
          <button class="modal-close" @click="close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="18" y1="6"  x2="6"  y2="18"/>
              <line x1="6"  y1="6"  x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <!-- Body: two required inputs -->
        <div class="modal-body">

          <div class="form-field">
            <label class="form-label">Owner Name *</label>
            <input
              v-model="ownerName"
              class="form-input"
              :class="{ error: showErrors && !ownerName }"
              placeholder="Enter owner name…"
            />
            <span v-if="showErrors && !ownerName" class="form-error">This field is required</span>
          </div>

          <div class="form-field">
            <label class="form-label">Owner Code *</label>
            <input
              v-model="ownerCode"
              class="form-input"
              :class="{ error: showErrors && !ownerCode }"
              placeholder="Enter owner code…"
            />
            <span v-if="showErrors && !ownerCode" class="form-error">This field is required</span>
          </div>

        </div>

        <!-- Error message from Supabase -->
        <div v-if="saveError" class="save-error">{{ saveError }}</div>

        <!-- Footer -->
        <div class="modal-footer">
          <button class="modal-cancel" :disabled="saving" @click="close">Cancel</button>
          <button class="modal-save"   :disabled="saving" @click="save">
            {{ saving ? 'Saving…' : 'Save' }}
          </button>
        </div>

      </div>
    </div>
  </Transition>

  <Toast :message="editOwner ? 'Owner updated successfully!' : 'New owner added successfully!'" :show="showToast" />
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
  width: 420px;
  background: var(--bg-panel);
  border: 1px solid var(--border-mid);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border);
}

.modal-title {
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 600;
  font-size: 16px;
  color: var(--text);
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

.modal-body {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.form-input {
  padding: 11px 14px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 9px;
  color: var(--text);
  font-size: 13.5px;
  font-family: 'DM Sans', sans-serif;
  outline: none;
  transition: border-color 0.15s;
}

.form-input::placeholder { color: var(--text-muted); }
.form-input:focus        { border-color: var(--border-mid); }
.form-input.error        { border-color: #ef4444; }

.form-error {
  font-size: 11px;
  color: #ef4444;
}

.save-error {
  margin: 0 24px;
  padding: 10px 14px;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #ef4444;
  font-size: 12.5px;
}

.modal-footer {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  padding: 16px 24px;
  border-top: 1px solid var(--border);
}

.modal-cancel {
  padding: 10px 20px;
  border-radius: 9px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-sub);
  font-size: 13px;
  font-family: 'DM Sans', sans-serif;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.modal-cancel:hover { background: var(--bg-hover); color: var(--text); }

.modal-save {
  padding: 10px 24px;
  border-radius: 9px;
  border: none;
  background: var(--accent-bg);
  color: var(--accent-text);
  font-size: 13px;
  font-weight: 600;
  font-family: 'DM Sans', sans-serif;
  cursor: pointer;
  transition: opacity 0.15s;
}

.modal-save:hover { opacity: 0.85; }

.fade-enter-active,
.fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from,
.fade-leave-to     { opacity: 0; }
</style>

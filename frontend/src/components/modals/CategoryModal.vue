<script setup lang="ts">
import { ref, watch } from 'vue'
import { supabase } from '../../lib/supabase'
import Toast from '../Toast.vue'

// ── PROPS & EMITS ──
// modelValue controls whether this modal is visible (true = open, false = closed)
// isLight comes from the parent so theme changes update the modal in real time
const props = defineProps<{ modelValue: boolean; isLight: boolean }>()
const emit  = defineEmits<{ (e: 'update:modelValue', val: boolean): void }>()

// ── HARDCODED CATEGORY LIST ──
// These are the fixed category types the user can choose from.
// value = what gets saved to the database (lowercase, underscores)
// label = what the user sees in the dropdown
const categoryOptions = [
  { value: 'Clothing & Accessories',          label: 'Clothing & Accessories' },
  { value: 'Kitchen Essentials',             label: 'Kitchen Essentials' },
  { value: 'Household Items - Cloth-related',label: 'Household Items - Cloth-related' },
  { value: 'Household Items - Cleaning & Others', label: 'Household Items - Cleaning & Others' },
  { value: 'Gardening Items',                label: 'Gardening Items' },
  { value: 'Personal Items',                 label: 'Personal Items' },
  { value: 'Electrical Items',               label: 'Electrical Items' },
  { value: 'Stationery',                     label: 'Stationery' },
  { value: 'Bathroom Items',                 label: 'Bathroom Items' },
  { value: 'Toys',                           label: 'Toys' },
  { value: 'Tools',                          label: 'Tools' },
  { value: 'Vehicle Items',                  label: 'Vehicle Items' },
]

// ── FORM FIELDS ──
const categoryName = ref('')
const categoryCode = ref('')
const categoryType = ref('')

// codeWasEdited flips to true if the user types directly into the Code field.
// Once true, we stop auto-generating the code from the name.
const codeWasEdited = ref(false)

// showErrors turns true when Save is clicked with empty fields
const showErrors = ref(false)
// saving is true while we wait for Supabase to respond
const saving     = ref(false)
// saveError holds any error message from Supabase
const saveError  = ref('')
// showToast controls the green success popup
const showToast  = ref(false)

// ── AUTO-GENERATE CODE FROM NAME ──
// This function turns a category name into a clean code:
//   "Kitchen Basics" → "kitchen_basics"
//   "Kids & Toys"    → "kids_toys"


// Watch categoryName — whenever the user types a name, auto-fill the Code field.
// But only if the user has NOT already manually edited the Code field.


// ── KEYBOARD SHORTCUTS ──
// Enter = save, Escape = cancel
function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter')  save()
  if (e.key === 'Escape') close()
}

watch(() => props.modelValue, (isOpen) => {
  if (isOpen) window.addEventListener('keydown', onKey)
  else        window.removeEventListener('keydown', onKey)
})

// ── CLOSE ──
// Tells the parent "please close me", then resets everything back to blank
function close() {
  emit('update:modelValue', false)
  categoryName.value  = ''
  categoryCode.value  = ''
  categoryType.value  = ''
  codeWasEdited.value = false
  showErrors.value    = false
  saveError.value     = ''
}

// ── SAVE ──
// Validates all three fields, then inserts a new row into Supabase
async function save() {
  if (!categoryName.value.trim() || !categoryCode.value.trim() || !categoryType.value) {
    showErrors.value = true
    return
  }

  saving.value    = true
  saveError.value = ''

  try {
    const { error } = await supabase.from('categories').insert({
      name: categoryName.value,
      code: categoryCode.value.trim(),
      type: categoryType.value,
    })

    if (error) {
      // error.code 23505 means a UNIQUE constraint was broken (duplicate)
      if (error.code === '23505') {
        if (error.message.includes('name')) {
          saveError.value = 'A category with this name already exists.'
        } else if (error.message.includes('code')) {
          saveError.value = 'A category with this code already exists.'
        } else {
          saveError.value = 'This category name or code already exists.'
        }
      } else {
        saveError.value = error.message
      }
      return
    }
  } catch {
    saveError.value = 'Something went wrong. Please try again.'
  } finally {
    // finally ALWAYS runs — whether there was an error or not — so saving never gets stuck
    saving.value = false
  }

  // Show green toast, close modal, then hide toast after 3 seconds
  showToast.value = true
  close()
  setTimeout(() => { showToast.value = false }, 3000)
}
</script>

<template>
  <Transition name="fade">
    <!-- The dark overlay — clicking outside the box closes the modal -->
    <div v-if="modelValue" class="modal-overlay" :class="{ light: props.isLight }" @click.self="close">

      <div class="modal-box">

        <!-- Header -->
        <div class="modal-header">
          <div class="modal-title">Add Main Category</div>
          <button class="modal-close" @click="close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="18" y1="6"  x2="6"  y2="18"/>
              <line x1="6"  y1="6"  x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <!-- Body: three required fields -->
        <div class="modal-body">

          <!-- Field 1: Category Name -->
          <div class="form-field">
            <label class="form-label">Category Name *</label>
            <input
              v-model="categoryName"
              class="form-input"
              :class="{ error: showErrors && !categoryName }"
              placeholder="e.g. Oversize T-shirts"
            />
            <span v-if="showErrors && !categoryName" class="form-error">This field is required</span>
          </div>

          <!-- Field 2: Code (auto-generated but editable) -->
          <div class="form-field">
            <label class="form-label">Code * <span class="form-hint">(auto-generated)</span></label>
            <input
              v-model="categoryCode"
              class="form-input"
              :class="{ error: showErrors && !categoryCode }"
              placeholder="e.g. A12"
              @input="codeWasEdited = true"
            />
            <span v-if="showErrors && !categoryCode" class="form-error">This field is required</span>
          </div>

          <!-- Field 3: Category Type dropdown -->
          <div class="form-field">
            <label class="form-label">Category Type *</label>
            <select
              v-model="categoryType"
              class="form-input form-select"
              :class="{ error: showErrors && !categoryType }"
            >
              <option value="" disabled>Select a category type…</option>
              <option
                v-for="opt in categoryOptions"
                :key="opt.value"
                :value="opt.value"
              >{{ opt.label }}</option>
            </select>
            <span v-if="showErrors && !categoryType" class="form-error">Please select a category type</span>
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

  <!-- Green success toast — appears bottom-right after saving -->
  <Toast message="New category added successfully!" :show="showToast" />
</template>

<style scoped>
/* ── CSS VARIABLES ── copied from SupplierModal so colours match across all modals */
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

/* ── LIGHT THEME OVERRIDES ── */
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

/* Small grey hint shown next to the Code label */
.form-hint {
  font-size: 10px;
  color: var(--text-muted);
  text-transform: none;
  letter-spacing: 0;
  font-weight: 400;
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

/* The select dropdown needs a few extra rules so it matches the text inputs */
.form-select {
  appearance: none;
  /* Small down-arrow icon drawn with CSS */
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888884' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 14px center;
  padding-right: 36px;
  cursor: pointer;
}

/* Red error message shown under empty fields */
.form-error {
  font-size: 11px;
  color: #ef4444;
}

/* Red box shown if Supabase returns an error */
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

/* Smooth fade in/out animation */
.fade-enter-active,
.fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from,
.fade-leave-to     { opacity: 0; }
</style>

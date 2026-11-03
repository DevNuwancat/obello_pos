<!--
  PhoneFields.vue — the "Mobile number" + "WhatsApp number" pair used by every
  customer form (Pay Later, Customer Book, Edit contact).

  Most people use the same number for calls and WhatsApp, so there is a
  "Same as mobile" switch: ON = the WhatsApp number follows the mobile number
  as you type; OFF = you type a different WhatsApp number (or leave it empty).

  v-model:mobile / v-model:whatsapp  → the two values live in the parent form
  startSame → true for brand-new customers (switch starts ON); when editing,
              it starts ON only if the saved WhatsApp already equals the mobile.
-->
<script setup lang="ts">
import { ref, watch } from 'vue'
import { phoneError, whatsappError } from '../lib/phone'

const props = defineProps<{
  showErrors?: boolean
  startSame?: boolean
  // A saved customer who already has this mobile number (the parent works it out)
  duplicate?: { id: string; name: string } | null
}>()
const emit = defineEmits<{ (e: 'useExisting', id: string): void }>()
const mobile   = defineModel<string>('mobile', { default: '' })
const whatsapp = defineModel<string>('whatsapp', { default: '' })

// Is the WhatsApp number the same as the mobile number?
const same = ref(props.startSame ?? (whatsapp.value.trim() !== '' && whatsapp.value.trim() === mobile.value.trim()))

// While the switch is ON, copy the mobile number across (now, and on every keystroke)
watch([same, mobile], () => { if (same.value) whatsapp.value = mobile.value }, { immediate: true })

function toggleSame() {
  same.value = !same.value
  // Switching OFF keeps the copied number so it can be edited; switching ON copies again (watch above)
}
</script>

<template>
  <div class="pf">
    <!-- Mobile -->
    <div class="pf-field">
      <label class="pf-label">Mobile Number <span class="pf-req">*</span></label>
      <input
        v-model="mobile"
        class="pf-input"
        :class="{ error: showErrors && phoneError(mobile) }"
        type="tel"
        placeholder="e.g. 077 123 4567"
        autocomplete="off"
      />
      <span v-if="showErrors && phoneError(mobile)" class="pf-error">{{ phoneError(mobile) }}</span>

      <!-- This number already belongs to a saved customer -->
      <div v-if="duplicate" class="pf-dup">
        <span>This number is already saved for <b>{{ duplicate.name }}</b>.</span>
        <button type="button" class="pf-dup-btn" @click="emit('useExisting', duplicate.id)">Use {{ duplicate.name }}</button>
      </div>
    </div>

    <!-- WhatsApp -->
    <div class="pf-field">
      <div class="pf-label-row">
        <label class="pf-label">
          <svg class="pf-wa-icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1-.2.3-.8.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.4-2.3-1.4-.8-.8-1.4-1.7-1.6-2-.2-.3 0-.4.1-.6l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5-.1-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.4.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.7-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z"/></svg>
          WhatsApp Number
        </label>
        <!-- "Same as mobile" switch -->
        <button type="button" class="pf-same" :class="{ on: same }" :aria-pressed="same" @click="toggleSame">
          <span class="pf-same-track"><span class="pf-same-dot"></span></span>
          Same as mobile
        </button>
      </div>

      <div class="pf-wa-wrap" :class="{ locked: same }">
        <input
          v-model="whatsapp"
          class="pf-input"
          :class="{ error: showErrors && !same && whatsappError(whatsapp) }"
          type="tel"
          :readonly="same"
          :tabindex="same ? -1 : 0"
          :placeholder="same ? 'Same as the mobile number' : 'Optional — e.g. 077 123 4567'"
          autocomplete="off"
        />
        <span v-if="same && mobile.trim()" class="pf-tick" title="Using the mobile number">✓</span>
      </div>
      <span v-if="showErrors && !same && whatsappError(whatsapp)" class="pf-error">{{ whatsappError(whatsapp) }}</span>
    </div>
  </div>
</template>

<style scoped>
.pf { display: flex; flex-direction: column; gap: 16px; }
.pf-field { display: flex; flex-direction: column; gap: 6px; }
.pf-label-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.pf-label {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--text-muted, var(--text-sub));
}
.pf-req { color: var(--danger, var(--red, #ef4444)); }
.pf-wa-icon { color: #25D366; }

.pf-input {
  width: 100%;
  padding: 10px 13px;
  background: var(--bg-card, var(--bg));
  border: 1px solid var(--border);
  border-radius: 9px;
  color: var(--text);
  font-size: 13.5px;
  font-family: 'DM Sans', sans-serif;
  outline: none;
  transition: border-color .15s, background .15s, opacity .15s;
}
.pf-input::placeholder { color: var(--text-muted, var(--text-sub)); opacity: .6; }
.pf-input:focus { border-color: var(--border-mid, var(--text-muted)); }
.pf-input.error { border-color: var(--danger, var(--red, #ef4444)); }
.pf-dup {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
  padding: 8px 11px; border-radius: 8px; font-size: 12px;
  background: rgba(251, 191, 36, 0.12); border: 1px solid rgba(251, 191, 36, 0.4); color: #f59e0b;
  animation: pf-pop-in .2s ease;
}
.pf-dup-btn {
  padding: 4px 11px; border-radius: 7px; border: none; cursor: pointer;
  background: #f59e0b; color: #fff; font-size: 11.5px; font-weight: 600; font-family: 'DM Sans', sans-serif;
}
.pf-dup-btn:hover { opacity: .88; }
@keyframes pf-pop-in { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }
.pf-error { font-size: 11px; color: var(--danger, var(--red, #ef4444)); }

/* locked while "Same as mobile" is on: green tint + tick */
.pf-wa-wrap { position: relative; }
.pf-wa-wrap.locked .pf-input {
  background: rgba(37, 211, 102, 0.08);
  border-color: rgba(37, 211, 102, 0.35);
  cursor: default;
  padding-right: 34px;
}
.pf-tick {
  position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
  font-size: 13px; font-weight: 700; color: #25D366;
  animation: pf-pop .25s cubic-bezier(.2, .9, .3, 1.4);
}
@keyframes pf-pop { from { transform: translateY(-50%) scale(0); } to { transform: translateY(-50%) scale(1); } }

/* the little switch */
.pf-same {
  display: inline-flex; align-items: center; gap: 7px;
  background: transparent; border: none; padding: 0; cursor: pointer;
  font-family: 'DM Sans', sans-serif; font-size: 11.5px; color: var(--text-sub);
  transition: color .15s;
}
.pf-same.on { color: #25D366; font-weight: 600; }
.pf-same-track {
  width: 28px; height: 16px; border-radius: 999px; padding: 2px;
  background: var(--border-mid, var(--border)); display: inline-flex; align-items: center;
  transition: background .2s;
}
.pf-same.on .pf-same-track { background: #25D366; }
.pf-same-dot {
  width: 12px; height: 12px; border-radius: 50%; background: #fff;
  transition: transform .2s cubic-bezier(.2, .9, .3, 1.2);
}
.pf-same.on .pf-same-dot { transform: translateX(12px); }
</style>

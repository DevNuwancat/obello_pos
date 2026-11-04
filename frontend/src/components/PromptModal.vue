<!--
  PromptModal.vue — a styled replacement for the browser's native prompt().
  Generic and reusable: pass a title + starting value, listen for @submit.
-->
<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'

const props = defineProps<{
  modelValue: boolean
  isLight: boolean
  title: string
  label?: string
  initialValue?: string
  placeholder?: string
  confirmText?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void
  (e: 'submit', value: string): void
}>()

const value    = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

function cancel() {
  emit('update:modelValue', false)
}

function submit() {
  if (!value.value.trim()) return   // never submit an empty name
  emit('submit', value.value.trim())
  emit('update:modelValue', false)
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') cancel()
}

watch(() => props.modelValue, async (isOpen) => {
  if (isOpen) {
    value.value = props.initialValue ?? ''
    window.addEventListener('keydown', onKey)
    await nextTick()
    inputRef.value?.focus()
    inputRef.value?.select()   // highlight the old text so typing replaces it
  } else {
    window.removeEventListener('keydown', onKey)
  }
})
</script>

<template>
  <Transition name="fade">
    <div v-if="modelValue" class="prompt-overlay" :class="{ light: isLight }" @click.self="cancel">
      <div class="prompt-box">
        <div class="prompt-title">{{ title }}</div>
        <label v-if="label" class="prompt-label">{{ label }}</label>
        <input
          ref="inputRef"
          v-model="value"
          class="prompt-input"
          :placeholder="placeholder"
          @keydown.enter="submit"
        />
        <div class="prompt-actions">
          <button class="prompt-btn prompt-cancel" @click="cancel">Cancel</button>
          <button class="prompt-btn prompt-ok" :disabled="!value.trim()" @click="submit">{{ confirmText || 'Save' }}</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.prompt-overlay {
  --bg-panel:   #181817;
  --bg-card:    #1f1f1e;
  --border:     rgba(255,255,255,0.08);
  --border-mid: rgba(255,255,255,0.16);
  --text:       #F5F2EE;
  --text-sub:   #888884;
  --accent-bg:  #F5F2EE;
  --accent-text:#111110;
  --shadow-lg:  0 16px 50px rgba(0,0,0,0.6);

  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.55);
  backdrop-filter: blur(5px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
}

.prompt-overlay.light {
  --bg-panel:   #FFFFFF;
  --bg-card:    #FAFAF8;
  --border:     rgba(0,0,0,0.16);
  --border-mid: rgba(0,0,0,0.28);
  --text:       #141412;
  --text-sub:   #7A776F;
  --accent-bg:  #141412;
  --accent-text:#F7F5F2;
  --shadow-lg:  0 16px 50px rgba(0,0,0,0.16);
}

.prompt-box {
  width: 380px;
  max-width: calc(100vw - 40px);
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 18px;
  box-shadow: var(--shadow-lg);
  padding: 24px 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  animation: popIn .18s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

@keyframes popIn {
  from { opacity: 0; transform: scale(0.92) translateY(6px); }
  to   { opacity: 1; transform: none; }
}

.prompt-title { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 16.5px; color: var(--text); }
.prompt-label { font-size: 11px; font-weight: 500; color: var(--text-sub); letter-spacing: 0.06em; text-transform: uppercase; margin-top: 4px; }

.prompt-input {
  padding: 11px 14px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 10px;
  color: var(--text);
  font-size: 14px;
  font-family: 'DM Sans', sans-serif;
  outline: none;
  transition: border-color .15s;
}
.prompt-input:focus { border-color: var(--border-mid); }

.prompt-actions { display: flex; gap: 10px; margin-top: 14px; }

.prompt-btn {
  flex: 1;
  padding: 11px 0;
  border-radius: 10px;
  font-size: 13.5px;
  font-weight: 600;
  font-family: 'DM Sans', sans-serif;
  cursor: pointer;
  border: 1px solid transparent;
  transition: opacity .15s;
}
.prompt-cancel { background: var(--bg-card); border-color: var(--border); color: var(--text-sub); }
.prompt-cancel:hover { color: var(--text); }
.prompt-ok { background: var(--accent-bg); color: var(--accent-text); }
.prompt-ok:hover { opacity: .85; }
.prompt-ok:disabled { opacity: .4; cursor: not-allowed; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.15s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>

<!--
  ConfirmModal.vue — a styled replacement for the browser's native confirm().
  Generic and reusable: pass a title + message, listen for @confirm.
-->
<script setup lang="ts">
import { watch } from 'vue'

const props = defineProps<{
  modelValue: boolean
  isLight: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean   // true = red confirm button (destructive actions)
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void
  (e: 'confirm'): void
}>()

function cancel() {
  emit('update:modelValue', false)
}

function confirmAction() {
  emit('confirm')
  emit('update:modelValue', false)
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') cancel()
  if (e.key === 'Enter')  confirmAction()
}

watch(() => props.modelValue, (isOpen) => {
  if (isOpen) window.addEventListener('keydown', onKey)
  else        window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <Transition name="fade">
    <div v-if="modelValue" class="confirm-overlay" :class="{ light: isLight }" @click.self="cancel">
      <div class="confirm-box">
        <div class="confirm-icon" :class="{ danger }">
          <svg v-if="danger" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <svg v-else width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
        </div>

        <div class="confirm-title">{{ title }}</div>
        <div class="confirm-message">{{ message }}</div>

        <div class="confirm-actions">
          <button class="confirm-btn confirm-cancel" @click="cancel">{{ cancelText || 'Cancel' }}</button>
          <button class="confirm-btn confirm-ok" :class="{ danger }" @click="confirmAction">{{ confirmText || 'Confirm' }}</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.confirm-overlay {
  --bg-panel:   #181817;
  --bg-card:    #1f1f1e;
  --border:     rgba(255,255,255,0.08);
  --text:       #F5F2EE;
  --text-sub:   #888884;
  --accent-bg:  #F5F2EE;
  --accent-text:#111110;
  --green:      #4ade80;
  --green-bg:   rgba(22,163,74,.15);
  --red:        #f87171;
  --red-bg:     rgba(220,38,38,.18);
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

.confirm-overlay.light {
  --bg-panel:   #FFFFFF;
  --bg-card:    #FAFAF8;
  --border:     rgba(0,0,0,0.08);
  --text:       #141412;
  --text-sub:   #7A776F;
  --accent-bg:  #141412;
  --accent-text:#F7F5F2;
  --green:      #16a34a;
  --green-bg:   #dcfce7;
  --red:        #dc2626;
  --red-bg:     #fee2e2;
  --shadow-lg:  0 16px 50px rgba(0,0,0,0.16);
}

.confirm-box {
  width: 360px;
  max-width: calc(100vw - 40px);
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 18px;
  box-shadow: var(--shadow-lg);
  padding: 28px 26px 22px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  animation: popIn .18s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

@keyframes popIn {
  from { opacity: 0; transform: scale(0.92) translateY(6px); }
  to   { opacity: 1; transform: none; }
}

.confirm-icon {
  width: 52px; height: 52px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--green-bg); color: var(--green);
  margin-bottom: 14px;
}
.confirm-icon.danger { background: var(--red-bg); color: var(--red); }

.confirm-title {
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 16.5px;
  color: var(--text);
  margin-bottom: 6px;
}

.confirm-message {
  font-size: 13px;
  color: var(--text-sub);
  line-height: 1.5;
}

.confirm-actions {
  display: flex;
  gap: 10px;
  margin-top: 22px;
  width: 100%;
}

.confirm-btn {
  flex: 1;
  padding: 11px 0;
  border-radius: 10px;
  font-size: 13.5px;
  font-weight: 600;
  font-family: 'DM Sans', sans-serif;
  cursor: pointer;
  border: 1px solid transparent;
  transition: opacity .15s, background .15s;
}

.confirm-cancel {
  background: var(--bg-card);
  border-color: var(--border);
  color: var(--text-sub);
}
.confirm-cancel:hover { color: var(--text); }

.confirm-ok {
  background: var(--accent-bg);
  color: var(--accent-text);
}
.confirm-ok:hover { opacity: .85; }
.confirm-ok.danger { background: var(--red); color: #fff; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.15s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>

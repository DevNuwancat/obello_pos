<script setup lang="ts">
// ── PROPS ──
// message : the text to show inside the toast
// show    : true = visible, false = hidden
defineProps<{ message: string; show: boolean }>()
</script>

<template>
  <Transition name="toast">
    <div v-if="show" class="toast">
      <!-- Green checkmark circle -->
      <div class="toast-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
      {{ message }}
    </div>
  </Transition>
</template>

<style scoped>
/* Fixed to bottom-right corner of the screen */
.toast {
  position: fixed;
  bottom: 32px;
  right: 32px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 20px;
  background: #18a558;
  color: #ffffff;
  font-family: 'DM Sans', sans-serif;
  font-size: 13.5px;
  font-weight: 500;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  z-index: 9999;
}

.toast-icon {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

/* Slides up from below and fades in */
.toast-enter-active { transition: opacity 0.25s ease, transform 0.25s ease; }
.toast-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.toast-enter-from   { opacity: 0; transform: translateY(12px); }
.toast-leave-to     { opacity: 0; transform: translateY(12px); }
</style>

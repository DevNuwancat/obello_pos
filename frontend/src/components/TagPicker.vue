<!--
  TagPicker.vue — choose the tags of ONE customer inside a form.
  Click a tag to add / remove it. "+ New tag" lets you make a brand-new tag
  right here (name + colour) without leaving the form.

  v-model = the list of chosen tag ids
-->
<script setup lang="ts">
import { ref } from 'vue'
import { useCustomerTags, TAG_COLORS } from '../composables/useCustomerTags'

const { tags, createTag } = useCustomerTags()
const selected = defineModel<string[]>({ default: () => [] })

function toggle(id: string) {
  selected.value = selected.value.includes(id) ? selected.value.filter(x => x !== id) : [...selected.value, id]
}

// ── make a new tag on the spot ──
const adding   = ref(false)
const newName  = ref('')
const newColor = ref(TAG_COLORS[0])
const error    = ref('')
const saving   = ref(false)

async function addTag() {
  saving.value = true
  error.value = ''
  const res = await createTag(newName.value, newColor.value)
  saving.value = false
  if (res.error) { error.value = res.error; return }
  selected.value = [...selected.value, res.tag!.id]   // the new tag is selected straight away
  newName.value = ''
  adding.value = false
}
</script>

<template>
  <div class="tp">
    <div class="tp-label">Tags <span class="tp-hint">(location / organization)</span></div>

    <div class="tp-list">
      <button
        v-for="t in tags"
        :key="t.id"
        type="button"
        class="tp-chip"
        :class="{ on: selected.includes(t.id) }"
        :style="selected.includes(t.id)
          ? { background: t.color, borderColor: t.color, color: '#fff' }
          : { borderColor: t.color + '66', color: t.color }"
        @click="toggle(t.id)"
      >
        <span v-if="selected.includes(t.id)">✓</span>{{ t.name }}
      </button>

      <button v-if="!adding" type="button" class="tp-chip tp-new" @click="adding = true">+ New tag</button>
      <span v-if="tags.length === 0 && !adding" class="tp-empty">No tags yet</span>
    </div>

    <div v-if="adding" class="tp-form">
      <input v-model="newName" class="tp-input" placeholder="e.g. Provincial Council" @keydown.enter.prevent="addTag" />
      <div class="tp-colors">
        <button
          v-for="c in TAG_COLORS"
          :key="c"
          type="button"
          class="tp-color"
          :class="{ on: newColor === c }"
          :style="{ background: c }"
          @click="newColor = c"
        ></button>
      </div>
      <div class="tp-actions">
        <button type="button" class="tp-btn tp-btn-ghost" @click="adding = false; error = ''">Cancel</button>
        <button type="button" class="tp-btn" :disabled="saving" @click="addTag">{{ saving ? 'Saving…' : 'Create tag' }}</button>
      </div>
      <span v-if="error" class="tp-error">{{ error }}</span>
    </div>
  </div>
</template>

<style scoped>
.tp { display: flex; flex-direction: column; gap: 8px; }
.tp-label { font-size: 11px; font-weight: 500; letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted, var(--text-sub)); }
.tp-hint { text-transform: none; letter-spacing: 0; opacity: .8; }
.tp-list { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; }
.tp-chip {
  padding: 5px 12px; border-radius: 999px; border: 1px solid; background: transparent; cursor: pointer;
  font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 600; transition: transform .15s, background .15s;
}
.tp-chip:hover { transform: translateY(-1px); }
.tp-chip.on span { margin-right: 4px; }
.tp-new { border-style: dashed; border-color: var(--border-mid, var(--border)); color: var(--text-sub); font-weight: 500; }
.tp-empty { font-size: 12px; color: var(--text-muted, var(--text-sub)); }
.tp-form {
  display: flex; flex-direction: column; gap: 9px; padding: 11px; border-radius: 10px;
  background: var(--bg-hover, var(--surface2)); border: 1px solid var(--border);
  animation: tp-in .18s ease;
}
@keyframes tp-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
.tp-input {
  padding: 8px 11px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card, var(--bg));
  color: var(--text); font-size: 13px; font-family: 'DM Sans', sans-serif; outline: none;
}
.tp-colors { display: flex; gap: 7px; }
.tp-color { width: 20px; height: 20px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; transition: transform .15s; }
.tp-color.on { border-color: var(--text); transform: scale(1.15); }
.tp-actions { display: flex; justify-content: flex-end; gap: 8px; }
.tp-btn {
  padding: 6px 14px; border-radius: 8px; border: none; cursor: pointer; font-size: 12px; font-weight: 600;
  font-family: 'DM Sans', sans-serif; background: var(--accent-bg, var(--accent, #222)); color: var(--accent-text, var(--accent-fg, #fff));
}
.tp-btn:disabled { opacity: .5; cursor: not-allowed; }
.tp-btn-ghost { background: transparent; color: var(--text-sub); border: 1px solid var(--border); }
.tp-error { font-size: 11.5px; color: var(--danger, var(--red, #ef4444)); }
</style>

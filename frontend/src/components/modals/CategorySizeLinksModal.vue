<script setup lang="ts">
import { ref, watch } from 'vue'
import { supabase } from '../../lib/supabase'
import Toast from '../Toast.vue'

// categoryId/categoryName: which sub-category (e.g. "Oversize T-Shirt") we're
// managing sizes for — the parent decides this, so this modal just shows
// the toggle list straight away.
const props = defineProps<{ modelValue: boolean; isLight: boolean; categoryId: string; categoryName: string }>()
const emit  = defineEmits<{ (e: 'update:modelValue', val: boolean): void }>()

// ── SIZE GROUPS + LINKS ──
interface SizeGroup { id: string; name: string; is_active: boolean }
const allGroups = ref<SizeGroup[]>([])
// Set of size_group_id's that are linked+active for this sub-category
const activeLinkIds = ref<Set<string>>(new Set())
// Maps size_group_id -> category_size_links.id, so we know whether to insert or update
const linkRowIds = ref<Map<string, string>>(new Map())

const loading    = ref(false)
const toastMsg   = ref('')
const showToast  = ref(false)

async function loadGroupsAndLinks() {
  loading.value = true

  try {
    const { data: groups, error: groupsError } = await supabase
      .from('size_groups')
      .select('id, name, is_active')
      .eq('is_active', true)
      .order('name')

    if (groupsError) { showMsg(groupsError.message); return }
    allGroups.value = groups || []

    const { data: links, error: linksError } = await supabase
      .from('category_size_links')
      .select('id, size_group_id, is_active')
      .eq('category_id', props.categoryId)

    if (linksError) { showMsg(linksError.message); return }

    const activeIds = new Set<string>()
    const rowIds    = new Map<string, string>()
    for (const link of links || []) {
      rowIds.set(link.size_group_id, link.id)
      if (link.is_active) activeIds.add(link.size_group_id)
    }
    activeLinkIds.value = activeIds
    linkRowIds.value    = rowIds
  } catch {
    showMsg('Could not load size groups. Please try again.')
  } finally {
    loading.value = false
  }
}

watch(() => props.modelValue, (isOpen) => { if (isOpen) loadGroupsAndLinks() })

// ── TOGGLE A SIZE GROUP ON/OFF FOR THIS SUB-CATEGORY ──
async function toggleLink(group: SizeGroup) {
  const turningOn = !activeLinkIds.value.has(group.id)
  const existingRowId = linkRowIds.value.get(group.id)

  try {
    if (existingRowId) {
      const { error } = await supabase
        .from('category_size_links')
        .update({ is_active: turningOn })
        .eq('id', existingRowId)
      if (error) { showMsg(error.message); return }
    } else {
      const { data, error } = await supabase
        .from('category_size_links')
        .insert({ category_id: props.categoryId, size_group_id: group.id, is_active: true })
        .select()
        .single()
      if (error) { showMsg(error.message); return }
      linkRowIds.value.set(group.id, data.id)
    }

    const next = new Set(activeLinkIds.value)
    if (turningOn) next.add(group.id)
    else next.delete(group.id)
    activeLinkIds.value = next
  } catch {
    showMsg('Something went wrong. Please try again.')
  }
}

function showMsg(msg: string) {
  toastMsg.value  = msg
  showToast.value = true
  setTimeout(() => { showToast.value = false }, 3000)
}

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <Transition name="fade">
    <div v-if="modelValue" class="modal-overlay" :class="{ light: isLight }" @click.self="close">
      <div class="modal-box">

        <!-- ── HEADER ── -->
        <div class="modal-header">
          <div>
            <div class="modal-title">{{ categoryName }}</div>
            <div class="modal-sub">Turn on the size groups this category should use</div>
          </div>
          <button class="modal-close" @click="close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="18" y1="6"  x2="6"  y2="18"/>
              <line x1="6"  y1="6"  x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <!-- ── BODY: size-group toggles for this category type ── -->
        <div class="modal-body">
          <div v-if="loading" class="state-msg">Loading…</div>
          <div v-else-if="allGroups.length === 0" class="state-msg">
            No size groups yet — add one from the Sizes section first.
          </div>
          <div v-else class="group-list">
            <div v-for="group in allGroups" :key="group.id" class="group-row">
              <span class="group-name">{{ group.name }}</span>
              <button
                class="toggle-btn"
                :class="{ enabled: activeLinkIds.has(group.id) }"
                @click="toggleLink(group)"
              >
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
                <span class="toggle-label">{{ activeLinkIds.has(group.id) ? 'Active' : 'Off' }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>

  <Toast :message="toastMsg" :show="showToast" />
</template>

<style scoped>
.modal-overlay {
  --bg-panel:   #181817;
  --bg-card:    #1f1f1e;
  --bg-hover:   #252524;
  --border:     rgba(255,255,255,0.07);
  --border-mid: rgba(255,255,255,0.12);
  --text:       #F5F2EE;
  --text-sub:   #888884;
  --text-muted: #555551;
  --shadow-lg:  0 8px 32px rgba(0,0,0,0.6);

  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
}

.modal-overlay.light {
  --bg-panel:   #FFFFFF;
  --bg-card:    #FAFAF8;
  --bg-hover:   #F0EDE9;
  --border:     rgba(0,0,0,0.07);
  --border-mid: rgba(0,0,0,0.12);
  --text:       #141412;
  --text-sub:   #7A776F;
  --text-muted: #B0ADA5;
  --shadow-lg:  0 8px 32px rgba(0,0,0,0.12);
}

.modal-box {
  width: 480px;
  max-height: 80vh;
  background: var(--bg-panel);
  border: 1px solid var(--border-mid);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 22px 24px 18px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.modal-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 600;
  font-size: 16px;
  color: var(--text);
}

.modal-sub {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 2px;
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
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
  min-height: 0;
}

.state-msg {
  padding: 40px 24px;
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
}

/* ── GROUP LIST ── */
.group-list { display: flex; flex-direction: column; }

.group-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px 24px;
  border-bottom: 1px solid var(--border);
}

.group-row:last-child { border-bottom: none; }
.group-name { font-size: 13.5px; color: var(--text); }

.toggle-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}

.toggle-track {
  width: 32px;
  height: 18px;
  border-radius: 999px;
  background: var(--border-mid);
  display: flex;
  align-items: center;
  padding: 2px;
  transition: background 0.2s;
}

.toggle-btn.enabled .toggle-track { background: #22c55e; }

.toggle-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
}

.toggle-btn.enabled .toggle-thumb { transform: translateX(14px); }

.toggle-label {
  font-size: 11px;
  color: var(--text-muted);
  width: 26px;
  text-align: left;
}

.toggle-btn.enabled .toggle-label { color: #22c55e; }

.modal-body::-webkit-scrollbar       { width: 4px; }
.modal-body::-webkit-scrollbar-track { background: transparent; }
.modal-body::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.2); border-radius: 2px; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from,   .fade-leave-to     { opacity: 0; }
</style>

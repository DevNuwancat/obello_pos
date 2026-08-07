<!--
  UserManagementView.vue — Admin-only page to view staff accounts and
  create new ones. Actual account creation happens via the "create-user"
  Supabase Edge Function (see CreateUserModal.vue), never directly from here.
-->

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import Slidebar from '../components/Slidebar.vue'
import CreateUserModal from '../components/modals/CreateUserModal.vue'
import Toast from '../components/Toast.vue'
import { supabase } from '../lib/supabase'
import { markConnected, markError } from '../lib/connectionStatus'

interface UserRow {
  id: string
  email: string
  full_name: string | null
  role: string
  is_active: boolean
  created_at: string
}

const isLight = ref(localStorage.getItem('theme') === 'light')

const users      = ref<UserRow[]>([])
const loading    = ref(false)
const fetchError = ref('')

async function fetchUsers() {
  loading.value    = true
  fetchError.value = ''
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, full_name, role, is_active, created_at')
      .order('created_at', { ascending: false })
    if (error) { fetchError.value = error.message; markError(); return }
    users.value = data ?? []
    markConnected()
  } catch {
    fetchError.value = 'Could not load users.'
    markError()
  } finally {
    loading.value = false
  }
}

function fmtDate(dateStr: string): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}

// ── CREATE USER MODAL ──
const showCreateModal = ref(false)

function onUserCreated() {
  fetchUsers()
  showToastMsg('User created successfully!')
}

// ── DEACTIVATE / RESTORE ──
// We never hard-delete a user — old sales still reference their id — so
// "removing" someone just flips is_active off (they can no longer log in).
const changingId = ref<string | null>(null)

async function toggleActive(u: UserRow) {
  const goingActive = !u.is_active
  const verb = goingActive ? 'restore' : 'deactivate'
  if (!confirm(`Are you sure you want to ${verb} ${u.full_name || u.email}?`)) return

  changingId.value = u.id
  try {
    const { data, error } = await supabase.functions.invoke('set-user-active', {
      body: { user_id: u.id, is_active: goingActive },
    })
    if (error) {
      const body = await (error as any).context?.json?.().catch(() => null)
      showToastMsg(body?.error || error.message || 'Failed to update user')
      return
    }
    if (!data?.success) {
      showToastMsg(data?.error || 'Failed to update user')
      return
    }
    u.is_active = goingActive
    showToastMsg(`User ${goingActive ? 'restored' : 'deactivated'}`)
  } catch {
    showToastMsg('Failed to update user')
  } finally {
    changingId.value = null
  }
}

// ── TOAST ──
const toastMsg     = ref('')
const toastVisible = ref(false)

function showToastMsg(msg: string) {
  toastMsg.value     = msg
  toastVisible.value = true
  setTimeout(() => { toastVisible.value = false }, 2600)
}

onMounted(fetchUsers)
</script>

<template>
  <div class="page-wrap" :class="{ light: isLight }">
    <Slidebar v-model:isLight="isLight" />

    <main class="main">
      <div class="page-header">
        <div>
          <h1 class="page-title">Users</h1>
          <p class="page-sub">Manage staff accounts and roles</p>
        </div>
        <button class="btn btn-primary" @click="showCreateModal = true">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
          Create User
        </button>
      </div>

      <div class="table-wrap">
        <div v-if="loading" class="state-msg">Loading users…</div>
        <div v-else-if="fetchError" class="state-error">{{ fetchError }}</div>

        <table v-else>
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Email</th>
              <th class="center">Role</th>
              <th class="center">Status</th>
              <th>Created</th>
              <th style="text-align:right; padding-right:20px;">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="users.length === 0">
              <td colspan="7" class="empty-row">No users found</td>
            </tr>
            <tr v-for="(u, index) in users" :key="u.id">
              <td>{{ index + 1 }}</td>
              <td class="name-cell">{{ u.full_name || '—' }}</td>
              <td>{{ u.email }}</td>
              <td class="center-cell"><span class="role-chip" :class="u.role">{{ u.role }}</span></td>
              <td class="center-cell">
                <span class="status-chip" :class="{ active: u.is_active }">{{ u.is_active ? 'Active' : 'Inactive' }}</span>
              </td>
              <td class="date-cell">{{ fmtDate(u.created_at) }}</td>
              <td style="text-align:right; padding-right:20px;">
                <button
                  class="btn-remove"
                  :class="{ restore: !u.is_active }"
                  :disabled="changingId === u.id"
                  @click="toggleActive(u)"
                >
                  {{ u.is_active ? 'Remove' : 'Restore' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </main>

    <CreateUserModal
      v-model="showCreateModal"
      :isLight="isLight"
      @saved="onUserCreated"
    />

    <Toast :message="toastMsg" :show="toastVisible" />
  </div>
</template>

<style scoped>
.page-wrap {
  --bg:        #111110;
  --surface:   #1c1c1b;
  --surface2:  #242423;
  --border:    rgba(255,255,255,0.07);
  --text:      #F5F2EE;
  --text-sub:  #888884;
  --text-muted:#555551;
  --accent:    #F5F2EE;
  --accent-fg: #111110;
  --shadow:    0 1px 3px rgba(0,0,0,.5);
  --radius:    12px;
}

.page-wrap.light {
  --bg:        #F7F5F2;
  --surface:   #ffffff;
  --surface2:  #f7f5f2;
  --border:    rgba(0,0,0,0.08);
  --text:      #1a1a1a;
  --text-sub:  #6b6660;
  --text-muted:#B0ADA5;
  --accent:    #1a1a1a;
  --accent-fg: #ffffff;
  --shadow:    0 1px 3px rgba(0,0,0,.08), 0 4px 16px rgba(0,0,0,.04);
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

.page-wrap {
  display: flex;
  min-height: 100vh;
  width: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: 'DM Sans', sans-serif;
  transition: background .3s, color .3s;
}

.main { flex: 1; display: flex; flex-direction: column; min-height: 100vh; overflow-y: auto; }

.page-header {
  padding: 32px 32px 0;
  display: flex; align-items: flex-start; justify-content: space-between;
}
.page-title { font-size: 26px; font-weight: 600; letter-spacing: -.02em; color: var(--text); }
.page-sub   { font-size: 13px; color: var(--text-sub); margin-top: 2px; }

.btn {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 8px;
  font-family: 'DM Sans', sans-serif;
  font-size: 13px; font-weight: 500;
  cursor: pointer; border: 1px solid transparent;
  transition: opacity .15s, background .15s;
}
.btn svg { width: 14px; height: 14px; }
.btn-primary { background: var(--accent); color: var(--accent-fg); }
.btn-primary:hover { opacity: .85; }

.table-wrap {
  margin: 24px 32px 32px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
}

.state-msg { padding: 40px 24px; text-align: center; font-size: 13px; color: var(--text-muted); }
.state-error { margin: 12px 24px; padding: 12px 14px; border-radius: 8px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #f87171; font-size: 12.5px; }

table { width: 100%; border-collapse: collapse; font-size: 13px; }
thead tr { background: var(--surface2); border-bottom: 1px solid var(--border); }
thead th { padding: 11px 14px; text-align: left; font-weight: 600; font-size: 12px; letter-spacing: .04em; color: var(--text-sub); white-space: nowrap; }
thead th:first-child { padding-left: 20px; width: 54px; }
thead th.center { text-align: center; }

tbody tr { border-bottom: 1px solid var(--border); transition: background .12s; }
tbody tr:last-child { border-bottom: none; }
tbody tr:hover { background: var(--surface2); }
tbody td { padding: 12px 14px; vertical-align: middle; color: var(--text); }
tbody td:first-child { padding-left: 20px; color: var(--text-sub); font-family: 'DM Mono', monospace; font-size: 12px; }

.empty-row { text-align: center; color: var(--text-muted); padding: 40px 14px !important; }
.name-cell { font-weight: 500; }
.date-cell { color: var(--text-sub); font-size: 12px; }
.center-cell { text-align: center; }

.role-chip {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 4px 10px; border-radius: 6px;
  font-size: 11px; font-weight: 600; text-transform: capitalize;
  background: var(--surface2); color: var(--text-sub);
}
.role-chip.admin   { background: rgba(239,68,68,0.12); color: #f87171; }
.role-chip.manager { background: rgba(59,130,246,0.12); color: #60a5fa; }
.role-chip.cashier { background: rgba(34,197,94,0.12); color: #4ade80; }

.status-chip {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 4px 10px; border-radius: 6px;
  font-size: 11px; font-weight: 600;
  background: rgba(148,148,148,0.15); color: var(--text-sub);
}
.status-chip.active { background: rgba(34,197,94,0.12); color: #4ade80; }

.btn-remove {
  padding: 6px 14px; border-radius: 7px;
  border: 1px solid rgba(239,68,68,0.3);
  background: rgba(239,68,68,0.08); color: #f87171;
  font-size: 12px; font-weight: 600; font-family: 'DM Sans', sans-serif;
  cursor: pointer; transition: background .12s, opacity .12s;
}
.btn-remove:hover { background: rgba(239,68,68,0.15); }
.btn-remove:disabled { opacity: .5; cursor: not-allowed; }
.btn-remove.restore {
  border-color: var(--border); background: var(--surface2); color: var(--text-sub);
}
.btn-remove.restore:hover { color: var(--text); }
</style>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../store/auth'

// ── PROPS & EMITS ──
// Props are values the PARENT sends INTO this component
// Emits are events this component sends BACK to the parent
const props = defineProps<{ isLight: boolean }>()
const emit  = defineEmits<{ (e: 'update:isLight', val: boolean): void }>()


const router = useRouter()
const route  = useRoute()
const auth   = useAuthStore()

// ── NAV ──
// Cashiers can only access the Cart. Admins additionally get the Users page.
const navItems = computed(() => {
  if (auth.userRole === 'cashier') {
    return [{ key: 'pos', label: 'Cart', path: '/' }]
  }
  const items = [
    { key: 'pos',            label: 'Cart',          path: '/' },
    { key: 'add-new',        label: 'Add New',        path: '/add-new' },
    { key: 'product-list',   label: 'Product List',   path: '/product-list' },
    { key: 'barcode-print',  label: 'Barcode Print',  path: '/barcode-print' },
    { key: 'today-business', label: 'Today Business', path: '/today-business' },
    { key: 'owner-earnings', label: 'Owner Earnings', path: '/owner-earnings' },
    { key: 'pay-later',      label: 'Pay Later List', path: '/pay-later' },
  ]
  if (auth.isAdmin) items.push({ key: 'users', label: 'Users', path: '/users' })
  return items
})

const currentNav  = computed(() => route.name as string)
const userInitial = computed(() => (auth.userName ?? '?').charAt(0).toUpperCase())

// Full page reload on every nav click (instead of instant in-app switching).
// This sidesteps pages sometimes showing stale/empty data on soft navigation.
function goTo(path: string) {
  if (path === route.path) return
  window.location.href = path
}

// ── THEME ──
// When the toggle is clicked, tell the parent the new value
function toggleTheme() {
  const newVal = !props.isLight
  localStorage.setItem('theme', newVal ? 'light' : 'dark')
  emit('update:isLight', newVal)
}

// ── LOGOUT ──
async function handleLogout() {
  await auth.logout()
  router.push('/login')
}
</script>

<template>
  <!-- :class="{ light: isLight }" lets this component know if light mode is on -->
  <aside class="sidebar" :class="{ light: isLight }">

    <!-- ── TOP: LOGO ── -->
    <div class="sidebar-top">
      <div class="logo-row">
        <div class="logo-icon"><span class="logo-letter">O</span></div>
        <div class="logo-text-col">
          <span class="logo-name">obello</span>
          <span class="logo-sub">POS v2.0</span>
        </div>
      </div>
    </div>

    <!-- ── NAV LINKS ── -->
    <nav class="nav">
      <button
        v-for="item in navItems"
        :key="item.key"
        class="nav-item"
        :class="{ active: currentNav === item.key }"
        @click="goTo(item.path)"
      >
        <!-- Cart icon -->
        <svg v-if="item.key === 'pos'" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
        <!-- Add icon -->
        <svg v-else-if="item.key === 'add-new'" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <!-- List icon -->
        <svg v-else-if="item.key === 'product-list'" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        <!-- Barcode icon -->
        <svg v-else-if="item.key === 'barcode-print'" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path stroke-linecap="round" d="M3 5h2M7 5h2M3 12h2M7 12h2M3 19h2M7 19h2M13 5h2M17 5h2M13 12h2M17 12h2M13 19h2M17 19h2"/></svg>
        <!-- Chart icon -->
        <svg v-else-if="item.key === 'today-business'" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        <!-- Clock icon -->
        <svg v-else-if="item.key === 'owner-earnings'" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
        <!-- Pay Later card icon -->
        <svg v-else-if="item.key === 'pay-later'" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
        <!-- Users icon -->
        <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        {{ item.label }}
      </button>
    </nav>

    <!-- ── BOTTOM: USER + THEME ── -->
    <div class="sidebar-bottom">

      <!-- User card -->
      <div class="user-card">
        <div class="user-avatar">{{ userInitial }}</div>
        <div class="user-info">
          <div class="user-name-text">{{ auth.userName }}</div>
          <div class="user-role-text">{{ auth.userRole }}</div>
        </div>
        <button class="logout-btn" @click="handleLogout" title="Log out">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        </button>
      </div>

      <!-- Theme toggle -->
      <div class="theme-toggle" @click="toggleTheme">
        <div class="theme-toggle-left">
          <svg v-if="!isLight" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
          <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          <span style="font-size:12px">{{ isLight ? 'Dark mode' : 'Light mode' }}</span>
        </div>
        <div class="toggle-track" :class="{ on: isLight }">
          <div class="toggle-thumb"></div>
        </div>
      </div>

      <div class="version-tag">Obello · Version 2.0</div>
    </div>

  </aside>
</template>

<style scoped>
/* ── SIDEBAR ── */
.sidebar {
  /* Dark theme CSS variables — default */
  --bg-panel:        #181817;
  --bg-card:         #1f1f1e;
  --bg-hover:        #252524;
  --border:          rgba(255,255,255,0.07);
  --border-mid:      rgba(255,255,255,0.12);
  --text:            #F5F2EE;
  --text-sub:        #888884;
  --text-muted:      #555551;
  --accent-bg:       #F5F2EE;
  --accent-text:     #111110;
  --chip:            #252524;
  --active-nav:      #1f1f1e;
  --active-nav-text: #F5F2EE;

  width: 220px;
  min-width: 220px;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  z-index: 10;
  transition: background 0.3s;
}

/* ── LIGHT THEME OVERRIDES ── */
/* When .light class is on the sidebar, switch all variables to light colours */
.sidebar.light {
  --bg-panel:        #FFFFFF;
  --bg-card:         #FAFAF8;
  --bg-hover:        #F0EDE9;
  --border:          rgba(0,0,0,0.07);
  --border-mid:      rgba(0,0,0,0.12);
  --text:            #141412;
  --text-sub:        #7A776F;
  --text-muted:      #B0ADA5;
  --accent-bg:       #141412;
  --accent-text:     #F7F5F2;
  --chip:            #EDEBE7;
  --active-nav:      #141412;
  --active-nav-text: #F7F5F2;
}

/* ── LOGO ── */
.sidebar-top {
  padding: 28px 20px 20px;
  border-bottom: 1px solid var(--border);
}

.logo-row { display: flex; align-items: center; gap: 12px; }

.logo-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: rgba(245,242,238,0.12);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.3s;
}

/* In light mode, the logo icon background flips */
.sidebar.light .logo-icon { background: rgba(20,20,18,0.08); }

.logo-letter {
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 18px;
  color: var(--text);
}

.logo-text-col { display: flex; flex-direction: column; }

.logo-name {
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 18px;
  letter-spacing: -0.5px;
  color: var(--text);
  line-height: 1.1;
}

.logo-sub {
  font-size: 10px;
  color: var(--text-muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-top: 2px;
}

/* ── NAV ── */
.nav {
  flex: 1;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 11px 12px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13.5px;
  font-weight: 400;
  letter-spacing: -0.1px;
  color: var(--text-sub);
  background: transparent;
  border: none;
  width: 100%;
  text-align: left;
  font-family: 'DM Sans', sans-serif;
  transition: background 0.15s, color 0.15s;
}

.nav-item:hover { background: var(--bg-hover); color: var(--text); }

.nav-item.active {
  background: var(--active-nav);
  color: var(--active-nav-text);
  font-weight: 500;
}

/* ── BOTTOM ── */
.sidebar-bottom {
  padding: 16px 12px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ── USER CARD ── */
.user-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--bg-card);
  border: 1px solid var(--border);
}

.user-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--accent-bg);
  color: var(--accent-text);
  font-size: 13px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-family: 'Space Grotesk', sans-serif;
}

.user-info { flex: 1; min-width: 0; }

.user-name-text {
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-role-text {
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-top: 1px;
}

.logout-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border-radius: 6px;
  transition: color 0.15s, background 0.15s;
  flex-shrink: 0;
}

.logout-btn:hover { color: #ef4444; background: rgba(239,68,68,0.1); }

/* ── THEME TOGGLE ── */
.theme-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  background: var(--bg-card);
  border: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-sub);
  user-select: none;
  transition: background 0.2s;
}

.theme-toggle:hover { background: var(--bg-hover); }

.theme-toggle-left { display: flex; align-items: center; gap: 7px; }

.toggle-track {
  width: 32px;
  height: 18px;
  border-radius: 9px;
  background: var(--chip);
  position: relative;
  transition: background 0.2s;
  border: 1px solid var(--border-mid);
  flex-shrink: 0;
}

.toggle-track.on { background: var(--text); }

.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--text-sub);
  transition: left 0.2s, background 0.2s;
}

.toggle-track.on .toggle-thumb { left: 14px; background: var(--accent-text); }

.version-tag {
  font-size: 10px;
  color: var(--text-muted);
  text-align: center;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 4px 0;
}
</style>

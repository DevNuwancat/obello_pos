import { createClient } from "@supabase/supabase-js"

// Superbase form env. load
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
})

// ──────────────────────────────────────────────
// KEEP-ALIVE FIX
// ──────────────────────────────────────────────
// Problem: Supabase's login token normally renews itself quietly in the
// background using a timer. But if the computer sits idle for a while
// (screen dims, laptop naps, Wi-Fi briefly drops, the browser tab gets
// "throttled" to save battery), that timer can be paused or delayed.
// When you come back and click something, the request goes out with an
// old/expired token and silently fails — nothing seems to happen. A full
// page refresh fixes it because it grabs a brand-new session from scratch.
//
// Fix: every time the tab becomes visible again (you switch back to it,
// wake the laptop, etc.), we proactively ask Supabase "is my session still
// good?" — which forces it to renew the token right then if needed, BEFORE
// you click anything. This runs quietly with no visible effect when
// everything is fine.
let lastCheck = Date.now()

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return

  const idleMs = Date.now() - lastCheck
  lastCheck = Date.now()

  // Only bother re-checking if we've actually been away for a bit —
  // no need to do this on every tiny tab switch.
  if (idleMs > 60_000) {
    supabase.auth.getSession().catch((e) => {
      console.warn('Session refresh check failed:', e)
    })
  }
})

// Some browsers/OS combos fire "focus" without a visibility change
// (e.g. waking from sleep while the POS tab was already the active one).
// Covering both events makes this reliable across setups.
window.addEventListener('focus', () => {
  const idleMs = Date.now() - lastCheck
  lastCheck = Date.now()
  if (idleMs > 60_000) {
    supabase.auth.getSession().catch((e) => {
      console.warn('Session refresh check failed:', e)
    })
  }
})
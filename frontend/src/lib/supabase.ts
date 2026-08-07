import { createClient } from "@supabase/supabase-js"
import { markConnected, markError } from "./connectionStatus"

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
// Fix: we proactively ask Supabase "is my session still good?" in two ways —
//   1) An always-running background timer (every 4 minutes, no matter what
//      the tab is doing). This is the main safety net — it doesn't depend
//      on any browser event firing correctly.
//   2) Extra checks when the tab becomes visible again / the window regains
//      focus, so a stale token gets caught the instant someone comes back,
//      not up to 4 minutes later.
// Both call the same function below, so there's only one place this logic
// lives. getSession() forces Supabase to renew the token if it's expired,
// so this runs quietly with no visible effect when everything is fine.
let lastCheck = Date.now()

// This same check now also feeds the shared green/amber/red connection
// status (see connectionStatus.ts) — if Supabase answers, we're green;
// if the request itself fails (not just "no session"), we're red.
function checkSession() {
  lastCheck = Date.now()
  supabase.auth.getSession()
    .then(() => markConnected())
    .catch((e) => {
      console.warn('Session refresh check failed:', e)
      markError()
    })
}

// Run once immediately (so the connection light turns green right away
// on app open, instead of staying amber for up to 4 minutes), then keep
// checking on the timer below.
checkSession()

// Main safety net: check every 4 minutes, always, regardless of whether
// the tab is visible/focused. This is what makes it work "like Facebook" —
// it doesn't wait for you to click back into the tab.
setInterval(checkSession, 4 * 60 * 1000)

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return

  // Only bother re-checking if we've actually been away for a bit —
  // no need to do this on every tiny tab switch.
  if (Date.now() - lastCheck > 60_000) checkSession()
})

// Some browsers/OS combos fire "focus" without a visibility change
// (e.g. waking from sleep while the POS tab was already the active one).
// Covering both events makes this reliable across setups.
window.addEventListener('focus', () => {
  if (Date.now() - lastCheck > 60_000) checkSession()
})

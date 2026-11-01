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
const SESSION_TIMEOUT_MS = 8000

// Gives up on a promise after `ms` milliseconds, so a stuck request turns
// into an error we can show instead of freezing the page forever.
function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    Promise.resolve(promise).then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

// Makes sure we have a valid login token RIGHT NOW. Returns true if good.
// Pages can `await ensureFreshSession()` before an important save.
// Note: getSession() does NOT throw when it fails, it returns { error },
// so we have to look at `error` ourselves.
export async function ensureFreshSession(): Promise<boolean> {
  lastCheck = Date.now()
  try {
    const { data, error } = await withTimeout(supabase.auth.getSession(), SESSION_TIMEOUT_MS)
    if (error || !data.session) { markError(); return false }

    // Token about to expire (under 60s left)? Renew it now.
    const expiresAtMs = (data.session.expires_at ?? 0) * 1000
    if (expiresAtMs - Date.now() < 60_000) {
      const { error: refreshError } = await withTimeout(supabase.auth.refreshSession(), SESSION_TIMEOUT_MS)
      if (refreshError) { markError(); return false }
    }

    markConnected()
    return true
  } catch (e) {
    console.warn('Session check failed:', e)
    markError()
    return false
  }
}

function checkSession() {
  void ensureFreshSession()
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

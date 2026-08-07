import { ref } from 'vue'

// ──────────────────────────────────────────────
// SHARED CONNECTION STATUS
// ──────────────────────────────────────────────
// One single "is everything working?" light that every page/modal can read
// from and report to. Instead of each screen silently failing on its own
// when a save/load doesn't work, they all point at this one shared value —
// so the sidebar can show a single green/amber/red indicator that's always
// accurate no matter which page you're on.
//
// States:
//   'connected' — green.  Everything's working, like a local app.
//   'checking'  — amber.  We're actively confirming right now (app just
//                 opened, or we're re-testing after a failure).
//   'error'     — red.    A real load/network failure just happened
//                 somewhere — a page couldn't fetch its data, the login
//                 session couldn't be verified, or the browser itself says
//                 there's no internet.
//
// Important: this is only for CONNECTION problems — not for normal mistakes
// like a duplicate SKU or an empty required field when saving something.
// Those already show their own inline message right where they happened.
// This status only reacts to "the request never worked" style failures.
export const connectionStatus = ref<'connected' | 'checking' | 'error'>('checking')

export function markConnected() {
  connectionStatus.value = 'connected'
}

export function markChecking() {
  connectionStatus.value = 'checking'
}

export function markError() {
  connectionStatus.value = 'error'
}

// The browser tells us instantly, for free, when the network itself drops —
// no request needed. This catches WiFi/cable disconnects the moment they
// happen, faster than waiting for the next periodic Supabase check.
window.addEventListener('offline', markError)
window.addEventListener('online', markChecking)

# The "Frozen After Switching Apps" Bug

## What the users saw
- Add items to the cart, switch to WhatsApp (or leave the tab idle) for a few minutes.
- Come back and click **Checkout** -> nothing happens. No error.
- Other pages also just show "loading..." forever.
- Refreshing the page fixes it.

## The reason (in simple words)

Think of the login token like a **key card** for the database. Every time the
app talks to the database, it must first pick up the key card from a **single
desk**. Only **one person can use the desk at a time** (this is called a *lock*).

When you come back to the tab, Supabase renews the key card. It sits at the
desk (holds the lock) and says: "I'll tell the app that the card changed."

Our app's listener (in `store/auth.ts`) heard that and said:
"Wait! First let me load the user's profile from the database."

But loading the profile needs the key card, and the key card is at the desk
that Supabase is still sitting at. So:

- Supabase waits for our listener to finish.
- Our listener waits for Supabase to leave the desk.

**Both wait forever.** This is called a **deadlock**. Every later request
(checkout, loading products, anything) also waits in line at the desk, so the
whole app looks frozen. No error is shown because nothing "failed" - it is just
waiting. Refreshing the page throws away the stuck desk and starts clean.

## Where the bug was
`frontend/src/store/auth.ts` - the `onAuthStateChange` listener ran
`await this.fetchProfile()` inside the callback.

## Other weak spots we found
1. `frontend/src/lib/supabase.ts` - the keep-alive check ignored errors, so the
   sidebar could say "Connected" even when the login was broken.
2. `frontend/src/views/POSView.vue` - checkout never checked the login first and
   had no time limit, so it could stay on "Processing..." forever.
3. (Not fixed yet) Checkout saves in 4 separate steps. If one fails in the
   middle, a sale can be half-saved.

## How we fixed it
1. **auth.ts** - the listener no longer waits for the database. It uses
   `setTimeout(() => this.fetchProfile(), 0)`, which means "do this a moment
   later, after Supabase leaves the desk". No more deadlock. It also skips
   reloading the profile when the token is only silently renewed.
2. **supabase.ts** - new function `ensureFreshSession()`:
   - checks the `error` that `getSession()` returns (it does not throw),
   - renews the token if it expires in under 60 seconds,
   - gives up after 8 seconds so it can never hang forever.
3. **POSView.vue** - checkout calls `ensureFreshSession()` first. If the
   login is bad, the cashier sees a clear message and the cart stays safe.

## How to test
1. `npm run dev` and log in.
2. Add items to the cart.
3. Switch to another app for 6+ minutes.
4. Come back, click Checkout, and click through other pages.

## Lessons
- A bug on every page means the problem is in shared code, not one page.
- Never `await` a Supabase call inside `onAuthStateChange`.
- "No error and nothing happens" often means something is waiting forever.
- Always add a time limit (timeout) to things that wait.

## Ideas for later
- Make checkout one database function so a sale is all-or-nothing.
- Add timeouts to page data loading.

import { defineStore } from "pinia";
import { supabase } from "../lib/supabase";

export const useAuthStore = defineStore("auth", {
  state: () => ({
    user: null as any,
    profile: null as any, // name, role etc from public.users
    loading: false,
    // Set when fetchProfile fails (e.g. expired token). Lets the UI tell the
    // difference between "this is genuinely a cashier" and "we couldn't
    // check who you are right now" — see fetchProfile() below.
    profileError: null as string | null,
  }),

  getters: {
    isLoggedIn: (state) => !!state.user,
    isAdmin: (state) => state.profile?.role === "admin",
    isManager: (state) => state.profile?.role === "manager",
    isCashier: (state) => state.profile?.role === "cashier",
    userRole: (state) => state.profile?.role ?? "cashier",
    userName: (state) => state.profile?.full_name ?? state.user?.email,
  },

  actions: {
    // Call this on app startup
    async init() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.user) {
          this.user = session.user;
          await this.fetchProfile();
        }

        // Listen for login/logout changes
        supabase.auth.onAuthStateChange(async (_event, session) => {
          this.user = session?.user ?? null;
          if (this.user) {
            await this.fetchProfile();
          } else {
            this.profile = null;
          }
        });
      } catch (e) {
        console.error('Supabase init failed:', e)
      }
    },

    // Get role + name from public.users table
    async fetchProfile() {
      const { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("id", this.user.id)
        .maybeSingle();

      if (error) {
        // BUG FIX: this used to always run `this.profile = data`, even on
        // error — and on error `data` is null. That wiped out whatever role
        // the user actually had, and userRole's `?? "cashier"` fallback
        // below then silently treated ANY logged-in user as a cashier,
        // collapsing their sidebar to just "Cart". A blip like an expired
        // token should show as "couldn't check your account", not quietly
        // demote you. So now: keep the last known-good profile and just
        // flag the error for the UI to show instead.
        console.error("fetchProfile failed:", error.message)
        this.profileError = error.message
        return
      }

      this.profileError = null
      this.profile = data
    },

    // Login
    async login(email: string, password: string) {
      this.loading = true;
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      this.loading = false;
      if (error) throw error;
      this.user = data.user;
      await this.fetchProfile();
    },

    // Logout
    async logout() {
      await supabase.auth.signOut();
      this.user = null;
      this.profile = null;
    },
  },
});

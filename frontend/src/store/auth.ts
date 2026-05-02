import { defineStore } from "pinia";
import { supabase } from "../lib/supabase";

export const useAuthStore = defineStore("auth", {
  state: () => ({
    user: null as any,
    profile: null as any, // name, role etc from public.users
    loading: false,
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
      const { data } = await supabase
        .from("users")
        .select("*")
        .eq("id", this.user.id)
        .single();
      this.profile = data;
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

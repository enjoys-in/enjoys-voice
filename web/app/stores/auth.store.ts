import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User, SipConfig } from "../types";

interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  sipConfig: SipConfig | null;
  isAuthenticated: boolean;
  login: (user: User, token: string, refreshToken: string, sipConfig: SipConfig) => void;
  setTokens: (token: string, refreshToken: string) => void;
  setUser: (user: User) => void;
  setSipConfig: (sipConfig: SipConfig) => void;
  /**
   * Reconcile the client store with the session the server resolved from the
   * httpOnly cookie. `extension` → mark authenticated (seeding a minimal user
   * if none is cached, which a background `/me` then fills in); `null` → ensure
   * we're logged out locally. Never calls the network.
   */
  applyServerSession: (extension: string | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      refreshToken: null,
      sipConfig: null,
      isAuthenticated: false,
      login: (user, token, refreshToken, sipConfig) =>
        set({ user, token, refreshToken, sipConfig, isAuthenticated: true }),
      setTokens: (token, refreshToken) => set({ token, refreshToken }),
      setUser: (user) => set({ user }),
      setSipConfig: (sipConfig) => set({ sipConfig }),
      applyServerSession: (extension) =>
        set((state) => {
          if (!extension) {
            // Server says there's no valid session. Clear any stale persisted
            // user so we don't render the app for a signed-out browser. No
            // server logout call (there's nothing to clear) and no cache reset.
            if (!state.isAuthenticated && !state.user) return state;
            return {
              user: null,
              token: null,
              refreshToken: null,
              sipConfig: null,
              isAuthenticated: false,
            };
          }
          // Authenticated per the cookie. Reuse the cached profile when it's the
          // same user; otherwise seed a placeholder until `/me` returns.
          const sameUser = state.user?.extension === extension;
          const user = sameUser
            ? state.user!
            : { extension, username: extension, name: extension };
          return { user, isAuthenticated: true };
        }),
      logout: () => {
        // Lazy imports to avoid circular deps (hooks import from stores)
        // Tell the server to clear the httpOnly auth cookies (JS can't).
        import("../lib/go-api").then((m) => m.goApi.auth.logout());
        import("../hooks/useCallHistory").then((m) => m.resetCallHistoryCache());
        import("../hooks/useSettingsSync").then((m) => m.resetSettingsCache());
        import("./voicemail.store").then((m) => m.useVoicemailStore.getState().reset());
        set({ user: null, token: null, refreshToken: null, sipConfig: null, isAuthenticated: false });
      },
    }),
    {
      name: "callnet-auth",
      // Persist only non-sensitive fields for instant paint. The access/refresh
      // tokens are NOT stored in localStorage (XSS-hardening) — the httpOnly
      // cookies are the source of truth, and `isAuthenticated` is re-derived
      // from the server session on each load.
      partialize: (state) => ({ user: state.user, sipConfig: state.sipConfig }),
    }
  )
);

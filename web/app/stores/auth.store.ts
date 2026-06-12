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
      logout: () => {
        // Lazy imports to avoid circular deps (hooks import from stores)
        import("../hooks/useCallHistory").then((m) => m.resetCallHistoryCache());
        import("../hooks/useSettingsSync").then((m) => m.resetSettingsCache());
        import("./voicemail.store").then((m) => m.useVoicemailStore.getState().reset());
        set({ user: null, token: null, refreshToken: null, sipConfig: null, isAuthenticated: false });
      },
    }),
    {
      name: "callnet-auth",
    }
  )
);

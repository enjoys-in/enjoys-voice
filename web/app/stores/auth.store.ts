import { create } from "zustand";
import type { User, SipConfig } from "../types";

interface AuthState {
  user: User | null;
  token: string | null;
  sipConfig: SipConfig | null;
  isAuthenticated: boolean;
  login: (user: User, token: string, sipConfig: SipConfig) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  sipConfig: null,
  isAuthenticated: false,
  login: (user, token, sipConfig) =>
    set({ user, token, sipConfig, isAuthenticated: true }),
  logout: () =>
    set({ user: null, token: null, sipConfig: null, isAuthenticated: false }),
}));

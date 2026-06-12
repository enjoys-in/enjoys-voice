import { create } from "zustand";
import type { UserSettings } from "../types";

// Display name is kept in localStorage so it persists across reloads.
const DISPLAY_NAME_KEY = "voip.displayName";
const initialDisplayName =
  typeof window !== "undefined" ? window.localStorage.getItem(DISPLAY_NAME_KEY) || "" : "";

const DEFAULT_SETTINGS: UserSettings = {
  displayName: initialDisplayName,
  callerTune: "caller_tune.wav",
  ringtone: "ringtone.wav",
  soundsEnabled: true,
  dtmfEnabled: true,
  pstnEnabled: false,
  pstnMobile: "",
  pstnCountryCode: "+91",
  pstnForwardToBrowser: false,
  pstnForwardTarget: "",
  recordingEnabled: false,
  voicemailEnabled: false,
  forwarding: {},
  blockedNumbers: [],
};

interface SettingsStore {
  settings: UserSettings;
  loading: boolean;
  setSettings: (settings: Partial<UserSettings>) => void;
  setLoading: (loading: boolean) => void;
  addBlockedNumber: (number: string) => void;
  removeBlockedNumber: (number: string) => void;
  setForwarding: (type: "busy" | "noAnswer" | "unavailable", target: string | undefined) => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: DEFAULT_SETTINGS,
  loading: false,
  setSettings: (updates) =>
    set((state) => {
      // Persist display name so it survives reloads.
      if (typeof window !== "undefined" && updates.displayName !== undefined) {
        window.localStorage.setItem(DISPLAY_NAME_KEY, updates.displayName);
      }
      return { settings: { ...state.settings, ...updates } };
    }),
  setLoading: (loading) => set({ loading }),
  addBlockedNumber: (number) =>
    set((state) => ({
      settings: {
        ...state.settings,
        blockedNumbers: [...state.settings.blockedNumbers, number],
      },
    })),
  removeBlockedNumber: (number) =>
    set((state) => ({
      settings: {
        ...state.settings,
        blockedNumbers: state.settings.blockedNumbers.filter((n) => n !== number),
      },
    })),
  setForwarding: (type, target) =>
    set((state) => ({
      settings: {
        ...state.settings,
        forwarding: { ...state.settings.forwarding, [type]: target },
      },
    })),
}));

import { create } from "zustand";
import type { ActiveCall } from "../types";

type ToneType = "dialing" | "ringback" | "ringtone" | "busy" | null;

interface CallStore {
  activeCall: ActiveCall | null;
  currentTone: ToneType;
  muted: boolean;
  speakerOn: boolean;

  startCall: (call: ActiveCall) => void;
  updateCall: (updates: Partial<ActiveCall>) => void;
  endCall: () => void;
  setTone: (tone: ToneType) => void;
  toggleMute: () => void;
  toggleSpeaker: () => void;
}

export const useCallStore = create<CallStore>((set) => ({
  activeCall: null,
  currentTone: null,
  muted: false,
  speakerOn: false,

  startCall: (call) => set({ activeCall: call, currentTone: "dialing" }),
  updateCall: (updates) =>
    set((state) => ({
      activeCall: state.activeCall ? { ...state.activeCall, ...updates } : null,
    })),
  endCall: () => set({ activeCall: null, currentTone: null, muted: false, speakerOn: false }),
  setTone: (tone) => set({ currentTone: tone }),
  toggleMute: () => set((s) => ({ muted: !s.muted })),
  toggleSpeaker: () => set((s) => ({ speakerOn: !s.speakerOn })),
}));

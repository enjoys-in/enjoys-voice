import { create } from "zustand";
import type { VoicemailRecord } from "../lib/api";

interface VoicemailStore {
  voicemails: VoicemailRecord[];
  setVoicemails: (voicemails: VoicemailRecord[]) => void;
  addVoicemail: (vm: VoicemailRecord) => void;
  markRead: (id: string) => void;
  remove: (id: string) => void;
  unreadCount: () => number;
}

export const useVoicemailStore = create<VoicemailStore>((set, get) => ({
  voicemails: [],
  setVoicemails: (voicemails) => set({ voicemails }),
  addVoicemail: (vm) =>
    set((s) => ({
      voicemails: s.voicemails.some((v) => v.id === vm.id)
        ? s.voicemails
        : [vm, ...s.voicemails],
    })),
  markRead: (id) =>
    set((s) => ({
      voicemails: s.voicemails.map((v) =>
        v.id === id ? { ...v, read: true } : v
      ),
    })),
  remove: (id) =>
    set((s) => ({ voicemails: s.voicemails.filter((v) => v.id !== id) })),
  unreadCount: () => get().voicemails.filter((v) => !v.read).length,
}));

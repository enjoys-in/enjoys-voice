import { create } from "zustand";
import { api, type VoicemailRecord } from "../lib/api";

// How long a voicemail fetch stays "fresh". Within this window, repeat callers
// (AppShell preload + VoicemailScreen mount) reuse the cached list instead of
// hitting the API again. WebSocket events and the manual refresh button force.
const STALE_MS = 60_000;

interface VoicemailStore {
  voicemails: VoicemailRecord[];
  loading: boolean;
  loadedAt: number;
  setVoicemails: (voicemails: VoicemailRecord[]) => void;
  fetchVoicemails: (ext: string, force?: boolean) => Promise<void>;
  addVoicemail: (vm: VoicemailRecord) => void;
  markRead: (id: string) => void;
  remove: (id: string) => void;
  reset: () => void;
  unreadCount: () => number;
}

export const useVoicemailStore = create<VoicemailStore>((set, get) => ({
  voicemails: [],
  loading: false,
  loadedAt: 0,
  setVoicemails: (voicemails) => set({ voicemails, loadedAt: Date.now() }),
  fetchVoicemails: async (ext, force = false) => {
    if (!ext) return;
    const { loading, loadedAt } = get();
    // Skip if a request is already in flight or the cache is still fresh.
    if (loading) return;
    if (!force && Date.now() - loadedAt < STALE_MS) return;
    set({ loading: true });
    try {
      const res = await api.getVoicemails(ext);
      set({ voicemails: res.voicemails, loadedAt: Date.now() });
    } catch {
      /* ignore */
    } finally {
      set({ loading: false });
    }
  },
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
  reset: () => set({ voicemails: [], loadedAt: 0, loading: false }),
  unreadCount: () => get().voicemails.filter((v) => !v.read).length,
}));


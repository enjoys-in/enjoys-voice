import { create } from "zustand";
import type { ConferenceRoom, ConferenceInvite } from "../types";

interface ConferenceStore {
  /** The conference room the user is currently in (live roster), if any. */
  room: ConferenceRoom | null;
  /** A pending incoming invitation awaiting accept/decline, if any. */
  invite: ConferenceInvite | null;

  setRoom: (room: ConferenceRoom | null) => void;
  setInvite: (invite: ConferenceInvite | null) => void;
  /** Clear everything (call ended / room closed). */
  clear: () => void;
}

export const useConferenceStore = create<ConferenceStore>((set) => ({
  room: null,
  invite: null,

  setRoom: (room) => set({ room }),
  setInvite: (invite) => set({ invite }),
  clear: () => set({ room: null, invite: null }),
}));

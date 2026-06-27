import { create } from "zustand";
import { api } from "../lib/api";
import { goApi, type GoContact } from "../lib/go-api";
import { useAuthStore } from "./auth.store";
import type { Contact } from "../types";

/** Map a persisted Go contact to the app's Contact shape. Presence flags are
 * unknown for an address-book entry (it may be an external number) — they're
 * resolved live against the directory in findContact / the UI. */
function toContact(c: GoContact): Contact {
  return {
    id: c.id,
    extension: c.extension,
    name: c.name,
    username: c.username || c.extension,
    online: false,
    registered: false,
  };
}

/**
 * Exclude the logged-in user from their own contact directory — you are not a
 * contact of yourself. Applied at every ingestion point (WebSocket presence via
 * setContacts and the HTTP seed via fetchContacts) so the Contacts tab, Recents
 * name resolution and the dialer never list the current user. The admin panel
 * reads api.getUsers() directly and is intentionally unaffected (admins see all).
 */
function excludeSelf(contacts: Contact[]): Contact[] {
  const me = useAuthStore.getState().user?.extension;
  return me ? contacts.filter((c) => c.extension !== me) : contacts;
}

interface ContactStore {
  // ── Global SIP directory (live presence; drives name resolution) ──
  contacts: Contact[];
  searchQuery: string;
  /** 0 = never loaded. Set by the first WS presence snapshot or fetchContacts. */
  loadedAt: number;
  loading: boolean;
  setContacts: (contacts: Contact[]) => void;
  setSearch: (query: string) => void;
  /**
   * Seed the contact directory from the HTTP user list. WebSocket presence is
   * the live source, but it only arrives once the socket connects — this lets
   * name resolution (e.g. in Recents) work before/without a live socket. It is
   * fetched once and then cached: subsequent calls are a no-op unless `force`
   * is passed (the Contacts refresh button / pull-to-refresh), so opening the
   * Contacts tab never re-hits the API. Merges by extension, preserving any
   * live `online` flag already set by presence.
   */
  fetchContacts: (force?: boolean) => Promise<void>;
  findContact: (numberOrExt: string) => Contact | undefined;

  // ── Personal address book (per-user, persisted via the Go API) ──
  myContacts: Contact[];
  /** 0 = never loaded. */
  myLoadedAt: number;
  myLoading: boolean;
  /** Load the caller's own contacts once; `force` re-fetches (refresh button). */
  fetchMyContacts: (force?: boolean) => Promise<void>;
  addContact: (input: { name: string; extension: string }) => Promise<void>;
  updateContact: (id: number, data: { name?: string; extension?: string }) => Promise<void>;
  removeContact: (id: number) => Promise<void>;
  filteredMyContacts: () => Contact[];
}

export const useContactStore = create<ContactStore>((set, get) => ({
  contacts: [],
  searchQuery: "",
  loadedAt: 0,
  loading: false,
  myContacts: [],
  myLoadedAt: 0,
  myLoading: false,
  setContacts: (contacts) => set({ contacts: excludeSelf(contacts), loadedAt: Date.now() }),
  setSearch: (query) => set({ searchQuery: query }),
  fetchContacts: async (force = false) => {
    const { loading, loadedAt } = get();
    if (loading) return;
    // Loaded once already (via WS presence or a prior fetch) → don't auto-refetch.
    // Only an explicit refresh (force) re-hits the API.
    if (!force && loadedAt > 0) return;
    set({ loading: true });
    try {
      const users = await api.getUsers();
      const byExt = new Map(get().contacts.map((c) => [c.extension, c]));
      for (const u of users) {
        const prev = byExt.get(u.extension);
        byExt.set(u.extension, {
          extension: u.extension,
          name: u.name,
          username: u.username,
          // Trust fresh presence on a forced refresh; otherwise keep the live
          // online flag WS may have already set for a known contact.
          online: prev && !force ? prev.online : u.registered,
          registered: u.registered,
        });
      }
      set({ contacts: excludeSelf(Array.from(byExt.values())), loadedAt: Date.now() });
    } catch {
      /* ignore — WebSocket presence remains the live source */
    } finally {
      set({ loading: false });
    }
  },
  fetchMyContacts: async (force = false) => {
    const { myLoading, myLoadedAt } = get();
    if (myLoading) return;
    // Loaded once already → don't auto-refetch; only an explicit refresh re-hits.
    if (!force && myLoadedAt > 0) return;
    set({ myLoading: true });
    try {
      const rows = await goApi.contacts.list();
      set({ myContacts: rows.map(toContact), myLoadedAt: Date.now() });
    } catch {
      /* ignore — keep any previously loaded contacts */
    } finally {
      set({ myLoading: false });
    }
  },
  addContact: async (input) => {
    const created = await goApi.contacts.create({
      name: input.name,
      extension: input.extension,
    });
    set((s) => ({ myContacts: [...s.myContacts, toContact(created)] }));
  },
  updateContact: async (id, data) => {
    const updated = await goApi.contacts.update(id, data);
    set((s) => ({
      myContacts: s.myContacts.map((c) => (c.id === id ? toContact(updated) : c)),
    }));
  },
  removeContact: async (id) => {
    await goApi.contacts.remove(id);
    set((s) => ({ myContacts: s.myContacts.filter((c) => c.id !== id) }));
  },
  filteredMyContacts: () => {
    const { myContacts, searchQuery } = get();
    const q = searchQuery.toLowerCase();
    const filtered = q
      ? myContacts.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.extension.includes(q)
        )
      : myContacts;
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  },
  findContact: (numberOrExt) => {
    if (!numberOrExt) return undefined;
    const digits = numberOrExt.replace(/\D/g, "");
    const match = (c: Contact) => {
      const ext = c.extension.replace(/\D/g, "");
      const user = c.username.replace(/\D/g, "");
      return (
        c.extension === numberOrExt ||
        c.username === numberOrExt ||
        (!!digits && (ext === digits || user === digits || ext.endsWith(digits) || digits.endsWith(ext)))
      );
    };
    // Personal contacts take priority (a user's own naming), then the directory.
    return get().myContacts.find(match) ?? get().contacts.find(match);
  },
}));

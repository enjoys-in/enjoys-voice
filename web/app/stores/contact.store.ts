import { create } from "zustand";
import { api } from "../lib/api";
import { useAuthStore } from "./auth.store";
import type { Contact } from "../types";

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
  addContact: (contact: Contact) => void;
  updateContact: (extension: string, data: Partial<Contact>) => void;
  removeContact: (extension: string) => void;
  filteredContacts: () => Contact[];
  findContact: (numberOrExt: string) => Contact | undefined;
}

export const useContactStore = create<ContactStore>((set, get) => ({
  contacts: [],
  searchQuery: "",
  loadedAt: 0,
  loading: false,
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
  addContact: (contact) => set((s) => ({ contacts: [...s.contacts, contact] })),
  updateContact: (extension, data) =>
    set((s) => ({
      contacts: s.contacts.map((c) => (c.extension === extension ? { ...c, ...data } : c)),
    })),
  removeContact: (extension) =>
    set((s) => ({ contacts: s.contacts.filter((c) => c.extension !== extension) })),
  filteredContacts: () => {
    const { contacts, searchQuery } = get();
    const q = searchQuery.toLowerCase();
    const filtered = q
      ? contacts.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.extension.includes(q)
        )
      : contacts;
    // Online users first
    return filtered.sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0));
  },
  findContact: (numberOrExt) => {
    if (!numberOrExt) return undefined;
    const digits = numberOrExt.replace(/\D/g, "");
    return get().contacts.find((c) => {
      const ext = c.extension.replace(/\D/g, "");
      const user = c.username.replace(/\D/g, "");
      return (
        c.extension === numberOrExt ||
        c.username === numberOrExt ||
        (!!digits && (ext === digits || user === digits || ext.endsWith(digits) || digits.endsWith(ext)))
      );
    });
  },
}));

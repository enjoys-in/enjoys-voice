import { create } from "zustand";
import type { Contact } from "../types";

interface ContactStore {
  contacts: Contact[];
  searchQuery: string;
  setContacts: (contacts: Contact[]) => void;
  setSearch: (query: string) => void;
  filteredContacts: () => Contact[];
}

export const useContactStore = create<ContactStore>((set, get) => ({
  contacts: [],
  searchQuery: "",
  setContacts: (contacts) => set({ contacts }),
  setSearch: (query) => set({ searchQuery: query }),
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
}));

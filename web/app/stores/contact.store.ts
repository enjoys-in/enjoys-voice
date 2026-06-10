import { create } from "zustand";
import type { Contact } from "../types";

interface ContactStore {
  contacts: Contact[];
  searchQuery: string;
  setContacts: (contacts: Contact[]) => void;
  setSearch: (query: string) => void;
  addContact: (contact: Contact) => void;
  updateContact: (extension: string, data: Partial<Contact>) => void;
  removeContact: (extension: string) => void;
  filteredContacts: () => Contact[];
}

export const useContactStore = create<ContactStore>((set, get) => ({
  contacts: [],
  searchQuery: "",
  setContacts: (contacts) => set({ contacts }),
  setSearch: (query) => set({ searchQuery: query }),
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
}));

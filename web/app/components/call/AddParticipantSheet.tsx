"use client";

import { useMemo, useState } from "react";
import { Search, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useContactStore } from "../../stores";

interface AddParticipantSheetProps {
  open: boolean;
  onClose: () => void;
  /** Extensions already in the call/room — hidden from the list. */
  exclude: string[];
  /** Title shown at the top of the sheet. */
  title?: string;
  /** Invoked with the chosen contact's extension. */
  onPick: (extension: string) => void;
}

/**
 * Bottom sheet that lists online contacts so the user can pull someone into a
 * call/conference. Sourced from the shared contact store (live presence), with
 * the current members excluded. Offline contacts are shown but disabled, since
 * they can't be auto-joined into a room.
 */
export function AddParticipantSheet({ open, onClose, exclude, title = "Add to call", onPick }: AddParticipantSheetProps) {
  const contacts = useContactStore((s) => s.contacts);
  const [query, setQuery] = useState("");

  const list = useMemo(() => {
    const ex = new Set(exclude);
    const q = query.trim().toLowerCase();
    return contacts
      .filter((c) => !ex.has(c.extension))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.extension.includes(q) || c.username.toLowerCase().includes(q))
      .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  }, [contacts, exclude, query]);

  const handlePick = (extension: string) => {
    onPick(extension);
    setQuery("");
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) { setQuery(""); onClose(); } }}>
      <SheetContent side="bottom" className="rounded-t-2xl p-0 h-[70dvh] flex flex-col">
        <SheetHeader className="px-5 pt-5 pb-2">
          <SheetTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" /> {title}
          </SheetTitle>
        </SheetHeader>

        {/* Search */}
        <div className="px-5 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search contacts"
              className="w-full rounded-lg bg-muted/50 pl-9 pr-9 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-600/40"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Contact list */}
        <div className="flex-1 overflow-y-auto px-3 pb-5">
          {list.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-10">No contacts found</p>
          ) : (
            list.map((c) => (
              <button
                key={c.extension}
                disabled={!c.online}
                onClick={() => handlePick(c.extension)}
                className="w-full flex items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-muted/60 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <div className="relative">
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-semibold">
                    {c.name.slice(0, 2).toUpperCase()}
                  </div>
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background ${c.online ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{c.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {c.extension}{!c.online && " · offline"}
                  </p>
                </div>
                <UserPlus className="h-4 w-4 text-emerald-500" />
              </button>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

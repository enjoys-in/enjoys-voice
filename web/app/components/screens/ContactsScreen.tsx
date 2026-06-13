"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Phone, Search, ShieldBan, Plus, Pencil, Trash2, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { EmptyState } from "../ui/EmptyState";
import { ListItem } from "../ui/ListItem";
import { useContactStore, useSettingsStore } from "../../stores";

interface ContactsScreenProps {
  onCall: (target: string, name?: string) => void;
}

export function ContactsScreen({ onCall }: ContactsScreenProps) {
  const { searchQuery, setSearch, filteredContacts, addContact, updateContact, removeContact, fetchContacts, loading } = useContactStore();
  const { addBlockedNumber, settings } = useSettingsStore();
  const contacts = filteredContacts();
  const [blockTarget, setBlockTarget] = useState<{ ext: string; name: string } | null>(null);
  const [editContact, setEditContact] = useState<{ extension: string; name: string } | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ ext: string; name: string } | null>(null);
  const [pulling, setPulling] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);

  // Seed the directory once on first open. No-op if WebSocket presence already
  // populated it (or it was fetched earlier) — opening this tab never re-hits
  // the API. Only the refresh button / pull-to-refresh below force a re-fetch.
  useEffect(() => {
    void fetchContacts();
  }, [fetchContacts]);

  const handleRefresh = useCallback(async () => {
    setPulling(true);
    await fetchContacts(true);
    setPulling(false);
  }, [fetchContacts]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback(async (e: React.TouchEvent) => {
    const diff = e.changedTouches[0].clientY - startY.current;
    if (diff > 80 && scrollRef.current?.scrollTop === 0) {
      await handleRefresh();
    }
  }, [handleRefresh]);

  const handleBlock = useCallback(() => {
    if (blockTarget) {
      addBlockedNumber(blockTarget.ext);
      setBlockTarget(null);
    }
  }, [blockTarget, addBlockedNumber]);

  const handleAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const name = (form.elements.namedItem("name") as HTMLInputElement).value.trim();
    const ext = (form.elements.namedItem("extension") as HTMLInputElement).value.trim();
    if (!name || !ext) return;
    addContact({ extension: ext, name, username: ext, online: false, registered: false });
    setShowAddDialog(false);
  };

  const handleEdit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editContact) return;
    const form = e.currentTarget;
    const name = (form.elements.namedItem("name") as HTMLInputElement).value.trim();
    if (!name) return;
    updateContact(editContact.extension, { name });
    setEditContact(null);
  };

  const handleDelete = () => {
    if (deleteTarget) {
      removeContact(deleteTarget.ext);
      setDeleteTarget(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-6 pb-3 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Contacts</h1>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={handleRefresh}
              disabled={loading || pulling}
              title="Refresh contacts"
            >
              <RefreshCw className={`h-4 w-4 ${loading || pulling ? "animate-spin" : ""}`} />
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search contacts..."
            className="pl-9 bg-muted/50"
            value={searchQuery}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Pull indicator */}
      {pulling && (
        <div className="flex justify-center py-2">
          <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Contact list */}
      <ScrollArea className="flex-1 px-4" ref={scrollRef}>
        <div
          className="space-y-1"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {contacts.length === 0 ? (
            <EmptyState
              title={searchQuery ? "No contacts found" : "No users online"}
              description="Users will appear as they connect"
            />
          ) : (
            contacts.map((contact) => (
              <ListItem
                key={contact.extension}
                onLongPress={() => setBlockTarget({ ext: contact.extension, name: contact.name })}
                onClick={() => onCall(contact.extension, contact.name)}
                leading={
                  <div className="relative">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className="text-xs bg-muted">
                        {contact.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    {contact.online && (
                      <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-background" />
                    )}
                  </div>
                }
                title={contact.name}
                subtitle={`ext. ${contact.extension}${settings.blockedNumbers.includes(contact.extension) ? " · blocked" : ""}`}
                trailing={
                  <div className="flex items-center gap-1">
                    <Badge variant={contact.online ? "default" : "secondary"} className="text-[10px] px-1.5 py-0">
                      {contact.online ? "online" : "offline"}
                    </Badge>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={(e) => { e.stopPropagation(); setEditContact({ extension: contact.extension, name: contact.name }); }}
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget({ ext: contact.extension, name: contact.name }); }}
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={(e) => { e.stopPropagation(); onCall(contact.extension, contact.name); }}
                      title="Call"
                    >
                      <Phone className="h-3.5 w-3.5 text-emerald-500" />
                    </Button>
                  </div>
                }
              />
            ))
          )}
        </div>
      </ScrollArea>

      {/* Add Contact dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Add Contact</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-3 mt-2">
            <div className="space-y-1">
              <Label className="text-xs">Name</Label>
              <Input name="name" placeholder="Contact name" required />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Extension</Label>
              <Input name="extension" placeholder="e.g. 1001" required />
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="secondary" size="sm" onClick={() => setShowAddDialog(false)}>Cancel</Button>
              <Button type="submit" size="sm">Add</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Contact dialog */}
      <Dialog open={!!editContact} onOpenChange={() => setEditContact(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Edit Contact</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-3 mt-2">
            <div className="space-y-1">
              <Label className="text-xs">Name</Label>
              <Input name="name" defaultValue={editContact?.name || ""} required />
            </div>
            <p className="text-xs text-muted-foreground">Extension: {editContact?.extension}</p>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="secondary" size="sm" onClick={() => setEditContact(null)}>Cancel</Button>
              <Button type="submit" size="sm">Save</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Delete Contact</DialogTitle>
            <DialogDescription>
              Remove <strong>{deleteTarget?.name}</strong> ({deleteTarget?.ext}) from your contacts?
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 justify-end mt-2">
            <Button variant="secondary" size="sm" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={handleDelete}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Block confirmation dialog */}
      <Dialog open={!!blockTarget} onOpenChange={() => setBlockTarget(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldBan className="h-4 w-4 text-destructive" /> Block Contact
            </DialogTitle>
            <DialogDescription>
              Block <strong>{blockTarget?.name}</strong> ({blockTarget?.ext})? They won&apos;t be able to call you.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 justify-end mt-2">
            <Button variant="secondary" size="sm" onClick={() => setBlockTarget(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={handleBlock}>Block</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

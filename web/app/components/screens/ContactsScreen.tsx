"use client";

import { useState, useCallback } from "react";
import { Phone, Search, ShieldBan } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { EmptyState } from "../ui/EmptyState";
import { ListItem } from "../ui/ListItem";
import { useContactStore, useSettingsStore } from "../../stores";

interface ContactsScreenProps {
  onCall: (target: string, name?: string) => void;
}

export function ContactsScreen({ onCall }: ContactsScreenProps) {
  const { searchQuery, setSearch, filteredContacts } = useContactStore();
  const { addBlockedNumber, settings } = useSettingsStore();
  const contacts = filteredContacts();
  const [blockTarget, setBlockTarget] = useState<{ ext: string; name: string } | null>(null);

  const handleBlock = useCallback(() => {
    if (blockTarget) {
      addBlockedNumber(blockTarget.ext);
      setBlockTarget(null);
    }
  }, [blockTarget, addBlockedNumber]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-6 pb-3 space-y-3">
        <h1 className="text-2xl font-bold">Contacts</h1>
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

      {/* Contact list */}
      <ScrollArea className="flex-1 px-4">
        <div className="space-y-1">
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
                onClick={() => contact.online && onCall(contact.extension, contact.name)}
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
                  <div className="flex items-center gap-2">
                    <Badge variant={contact.online ? "default" : "secondary"} className="text-[10px] px-1.5 py-0">
                      {contact.online ? "online" : "offline"}
                    </Badge>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => { e.stopPropagation(); onCall(contact.extension, contact.name); }}
                      disabled={!contact.online}
                    >
                      <Phone className="h-4 w-4 text-emerald-500" />
                    </Button>
                  </div>
                }
              />
            ))
          )}
        </div>
      </ScrollArea>

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

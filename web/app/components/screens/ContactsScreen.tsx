"use client";

import { Phone, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useContactStore } from "../../stores";

interface ContactsScreenProps {
  onCall: (target: string, name?: string) => void;
}

export function ContactsScreen({ onCall }: ContactsScreenProps) {
  const { searchQuery, setSearch, filteredContacts } = useContactStore();
  const contacts = filteredContacts();

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
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <p className="text-sm">
                {searchQuery ? "No contacts found" : "No users online"}
              </p>
            </div>
          ) : (
            contacts.map((contact) => (
              <div
                key={contact.extension}
                className="flex items-center gap-3 p-3 rounded-xl hover:bg-accent/50 transition-colors group"
              >
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
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{contact.name}</p>
                  <p className="text-xs text-muted-foreground">ext. {contact.extension}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={contact.online ? "default" : "secondary"} className="text-[10px] px-1.5 py-0">
                    {contact.online ? "online" : "offline"}
                  </Badge>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => onCall(contact.extension, contact.name)}
                    disabled={!contact.online}
                  >
                    <Phone className="h-4 w-4 text-emerald-500" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CallRecord } from "../../types";

// Demo data — in production this would come from API/store
const DEMO_CALLS: CallRecord[] = [
  { id: "1", from: "1001", to: "1002", fromName: "Alice", status: "answered", direction: "outbound", startTime: new Date(Date.now() - 3600000).toISOString(), duration: 125 },
  { id: "2", from: "1003", to: "1001", fromName: "Charlie", status: "missed", direction: "inbound", startTime: new Date(Date.now() - 7200000).toISOString() },
  { id: "3", from: "1001", to: "1004", fromName: "David", status: "ended", direction: "outbound", startTime: new Date(Date.now() - 86400000).toISOString(), duration: 45 },
];

interface CallsScreenProps {
  onCall: (target: string, name?: string) => void;
}

export function CallsScreen({ onCall }: CallsScreenProps) {
  const [calls] = useState<CallRecord[]>(DEMO_CALLS);

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return "";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const getCallIcon = (call: CallRecord) => {
    if (call.status === "missed") return <PhoneMissed className="h-4 w-4 text-destructive" />;
    if (call.direction === "outbound") return <PhoneOutgoing className="h-4 w-4 text-emerald-500" />;
    return <PhoneIncoming className="h-4 w-4 text-blue-500" />;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-6 pb-3">
        <h1 className="text-2xl font-bold">Recents</h1>
      </div>

      {/* Call list */}
      <ScrollArea className="flex-1 px-4">
        <div className="space-y-1">
          {calls.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Phone className="h-12 w-12 mb-3 opacity-30" />
              <p className="text-sm">No recent calls</p>
            </div>
          ) : (
            calls.map((call) => (
              <div
                key={call.id}
                className="flex items-center gap-3 p-3 rounded-xl hover:bg-accent/50 transition-colors group"
              >
                <Avatar className="h-10 w-10">
                  <AvatarFallback className="text-xs bg-muted">
                    {call.fromName.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {getCallIcon(call)}
                    <span className={`text-sm font-medium truncate ${call.status === "missed" ? "text-destructive" : ""}`}>
                      {call.fromName}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {call.direction === "outbound" ? call.to : call.from}
                    {call.duration ? ` · ${formatDuration(call.duration)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{formatTime(call.startTime)}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => onCall(call.direction === "outbound" ? call.to : call.from, call.fromName)}
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

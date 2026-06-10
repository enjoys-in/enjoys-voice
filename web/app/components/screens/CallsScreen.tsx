"use client";

import { useCallback, useRef, useState } from "react";
import { Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, RefreshCw, Trash2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "../ui/EmptyState";
import { useCallHistory } from "../../hooks/useCallHistory";
import type { CallRecordResponse } from "../../lib/api";

interface CallsScreenProps {
  onCall: (target: string, name?: string) => void;
}

export function CallsScreen({ onCall }: CallsScreenProps) {
  const { calls, loading, refresh, clearHistory } = useCallHistory();
  const [pulling, setPulling] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);

  // Pull-to-refresh handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback(async (e: React.TouchEvent) => {
    const diff = e.changedTouches[0].clientY - startY.current;
    if (diff > 80 && scrollRef.current?.scrollTop === 0) {
      setPulling(true);
      await refresh();
      setPulling(false);
    }
  }, [refresh]);

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

  const getCallIcon = (call: CallRecordResponse) => {
    if (call.status === "missed") return <PhoneMissed className="h-4 w-4 text-destructive" />;
    if (call.direction === "outbound") return <PhoneOutgoing className="h-4 w-4 text-emerald-500" />;
    return <PhoneIncoming className="h-4 w-4 text-blue-500" />;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-6 pb-3 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Recents</h1>
        <div className="flex gap-1">
          {calls.length > 0 && (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={clearHistory}
              title="Clear recents"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={refresh}
            disabled={loading || pulling}
          >
            <RefreshCw className={`h-4 w-4 ${loading || pulling ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Pull indicator */}
      {pulling && (
        <div className="flex justify-center py-2">
          <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Call list */}
      <ScrollArea className="flex-1 px-4" ref={scrollRef}>
        <div
          className="space-y-1"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {calls.length === 0 && !loading ? (
            <EmptyState
              icon={<Phone className="h-12 w-12" />}
              title="No recent calls"
              description="Your call history will appear here"
            />
          ) : (
            calls.map((call) => (
              <div
                key={call.id}
                className="flex items-center gap-3 p-3 rounded-xl hover:bg-accent/50 transition-colors group"
              >
                <Avatar className="h-10 w-10">
                  <AvatarFallback className="text-xs bg-muted">
                    {(call.fromName || call.from).slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {getCallIcon(call)}
                    <span className={`text-sm font-medium truncate ${call.status === "missed" ? "text-destructive" : ""}`}>
                      {call.fromName || call.from}
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
                    onClick={() => onCall(call.direction === "outbound" ? call.to : call.from, call.fromName || call.from)}
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

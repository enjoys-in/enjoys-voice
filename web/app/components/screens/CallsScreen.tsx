"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, PhoneOff, Voicemail, RefreshCw, Trash2, ChevronRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "../ui/EmptyState";
import { ListScreenSkeleton } from "./ScreenSkeletons";
import { useCallHistory } from "../../hooks/useCallHistory";
import { useAuthStore, useContactStore } from "../../stores";
import { formatPhone } from "../../lib/phone";
import { CallRecordStatus, type CallRecord } from "../../types";

interface CallsScreenProps {
  onCall: (target: string, name?: string) => void;
}

export function CallsScreen({ onCall }: CallsScreenProps) {
  const { calls, loading, refresh, clearHistory } = useCallHistory();
  const { user } = useAuthStore();
  const myExt = user?.extension;
  // Subscribe to the contact directory so Recents shows saved names instead of
  // raw numbers, and re-renders when contacts load/update. Seed it once (no-op
  // if WS presence already populated it); we never auto-refetch here.
  const contacts = useContactStore((s) => s.contacts);
  const findContact = useContactStore((s) => s.findContact);
  const fetchContacts = useContactStore((s) => s.fetchContacts);
  const [pulling, setPulling] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);

  useEffect(() => {
    void fetchContacts();
  }, [fetchContacts]);

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
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return "";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // Direction relative to the logged-in user: a call I placed is "outbound",
  // regardless of how the server stored it globally.
  const isOutbound = useCallback(
    (call: CallRecord) => !!myExt && call.from === myExt,
    [myExt],
  );

  // The OTHER party (never yourself).
  const peerOf = useCallback(
    (call: CallRecord) => (isOutbound(call) ? call.to : call.from),
    [isOutbound],
  );
  // Prefer a saved contact's name; otherwise fall back to the server-provided
  // caller name (inbound only) and finally the raw number. `contacts` is in the
  // deps so labels refresh once the directory loads.
  const peerLabelOf = useCallback(
    (call: CallRecord) => {
      const peer = isOutbound(call) ? call.to : call.from;
      const contact = findContact(peer);
      if (contact?.name) return contact.name;
      return isOutbound(call) ? call.to : call.fromName || call.from;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isOutbound, findContact, contacts],
  );

  const getCallIcon = (call: CallRecord) => {
    if (call.status === CallRecordStatus.Voicemail) return <Voicemail className="h-4 w-4 text-amber-500" />;
    if (call.status === CallRecordStatus.Unreachable) return <PhoneOff className="h-4 w-4 text-destructive" />;
    if (call.status === CallRecordStatus.Missed) return <PhoneMissed className="h-4 w-4 text-destructive" />;
    if (isOutbound(call)) return <PhoneOutgoing className="h-4 w-4 text-emerald-500" />;
    return <PhoneIncoming className="h-4 w-4 text-blue-500" />;
  };

  const dateLabel = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const yest = new Date(now);
    yest.setDate(now.getDate() - 1);
    if (d.toDateString() === now.toDateString()) return "Today";
    if (d.toDateString() === yest.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  };

  // Build: [ { label: "Today", rows: [ { key, peer, peerLabel, calls[] } ] } ]
  // Consecutive calls (same date + same peer) are merged into one row with a count.
  const groups = useMemo(() => {
    const out: {
      label: string;
      rows: { key: string; peer: string; peerLabel: string; calls: CallRecord[] }[];
    }[] = [];
    let curLabel = "";
    for (const call of calls) {
      const label = dateLabel(call.startTime);
      if (label !== curLabel) {
        out.push({ label, rows: [] });
        curLabel = label;
      }
      const section = out[out.length - 1];
      const peer = peerOf(call);
      const last = section.rows[section.rows.length - 1];
      if (last && last.peer === peer) {
        last.calls.push(call);
      } else {
        section.rows.push({ key: `${label}:${peer}:${call.id}`, peer, peerLabel: peerLabelOf(call), calls: [call] });
      }
    }
    return out;
  }, [calls, peerOf, peerLabelOf]);

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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
          {calls.length === 0 && loading ? (
            <ListScreenSkeleton rows={6} />
          ) : calls.length === 0 && !loading ? (
            <EmptyState
              icon={<Phone className="h-12 w-12" />}
              title="No recent calls"
              description="Your call history will appear here"
            />
          ) : (
            groups.map((section) => (
              <div key={section.label} className="mb-3">
                <h2 className="px-1 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {section.label}
                </h2>
                {section.rows.map((row) => {
                  const latest = row.calls[0];
                  const count = row.calls.length;
                  const isOpen = expanded.has(row.key);
                  return (
                    <div key={row.key}>
                      <div className="flex items-center gap-3 p-3 rounded-xl hover:bg-accent/50 transition-colors group">
                        <Avatar className="h-10 w-10">
                          <AvatarFallback className="text-xs bg-muted">
                            {row.peerLabel.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <button
                          type="button"
                          className="flex-1 min-w-0 text-left"
                          onClick={() => count > 1 && toggleExpand(row.key)}
                        >
                          <div className="flex items-center gap-2">
                            {getCallIcon(latest)}
                            <span className={`text-sm font-medium truncate ${latest.status === CallRecordStatus.Missed || latest.status === CallRecordStatus.Unreachable ? "text-destructive" : ""}`}>
                              {formatPhone(row.peerLabel)}
                            </span>
                            {count > 1 && (
                              <span className="text-xs text-muted-foreground">({count})</span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {formatPhone(row.peer)}
                            {latest.duration ? ` · ${formatDuration(latest.duration)}` : ""}
                          </p>
                        </button>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{formatTime(latest.startTime)}</span>
                          {count > 1 && (
                            <ChevronRight
                              className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}
                              onClick={() => toggleExpand(row.key)}
                            />
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => onCall(row.peer, row.peerLabel)}
                          >
                            <Phone className="h-4 w-4 text-emerald-500" />
                          </Button>
                        </div>
                      </div>

                      {/* Expanded per-call history for this number */}
                      {isOpen && count > 1 && (
                        <div className="ml-12 pl-2 border-l border-border/60 space-y-1 mb-1">
                          {row.calls.map((c) => (
                            <div key={c.id} className="flex items-center gap-2 py-1.5 text-xs">
                              {getCallIcon(c)}
                              <span className={`capitalize ${c.status === CallRecordStatus.Missed || c.status === CallRecordStatus.Unreachable ? "text-destructive" : "text-muted-foreground"}`}>
                                {c.status}
                              </span>
                              <span className="text-muted-foreground/70">
                                {c.duration ? formatDuration(c.duration) : ""}
                              </span>
                              <span className="ml-auto text-muted-foreground">{formatTime(c.startTime)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

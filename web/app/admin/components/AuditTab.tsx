"use client";

import { useMemo } from "react";
import {
  ScrollText,
  PhoneCall,
  Voicemail,
  ListTree,
  Network,
  ShieldAlert,
  LogIn,
  UserPlus,
  PhoneForwarded,
  Radio,
  Circle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLiveAudit, type AuditEntry } from "../../hooks/useLiveAudit";

/** Visual treatment for an event category: accent colour + icon. */
type EventStyle = { tone: string; Icon: typeof PhoneCall };

/**
 * Map a raw audit event to a category style. Matched by prefix so new
 * `call_*` / `trunk_*` / `voicemail_*` events inherit the right look for free.
 */
function styleFor(event: string): EventStyle {
  if (event.startsWith("call_blocked") || event === "block" || event === "unblock") {
    return { tone: "text-red-400 bg-red-500/10 border-red-500/20", Icon: ShieldAlert };
  }
  if (event.startsWith("call_")) {
    return { tone: "text-sky-400 bg-sky-500/10 border-sky-500/20", Icon: PhoneCall };
  }
  if (event.startsWith("voicemail_")) {
    return { tone: "text-purple-400 bg-purple-500/10 border-purple-500/20", Icon: Voicemail };
  }
  if (event.startsWith("ivr_")) {
    return { tone: "text-amber-400 bg-amber-500/10 border-amber-500/20", Icon: ListTree };
  }
  if (event.startsWith("trunk_")) {
    return { tone: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20", Icon: Network };
  }
  if (event === "register" || event === "unregister") {
    return { tone: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", Icon: Radio };
  }
  if (event === "login") {
    return { tone: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", Icon: LogIn };
  }
  if (event === "signup") {
    return { tone: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", Icon: UserPlus };
  }
  if (event === "forwarding_set") {
    return { tone: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20", Icon: PhoneForwarded };
  }
  return { tone: "text-muted-foreground bg-muted/40 border-border", Icon: Circle };
}

/** "call ended" from "call_ended". */
function prettyEvent(event: string): string {
  return event.replace(/_/g, " ");
}

/** Compact relative time like "12s", "5m", "3h"; falls back to a date. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

/** Render up to a few metadata fields as small key=value chips. */
function MetaChips({ metadata }: { metadata?: Record<string, unknown> }) {
  const pairs = useMemo(() => {
    if (!metadata) return [];
    return Object.entries(metadata)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .slice(0, 4)
      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
  }, [metadata]);

  if (pairs.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {pairs.map((p) => (
        <span
          key={p}
          className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground font-mono truncate max-w-50"
          title={p}
        >
          {p}
        </span>
      ))}
    </div>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const { tone, Icon } = styleFor(entry.event);
  return (
    <div className="flex gap-3 px-4 py-3 border-b border-border/40 last:border-0 hover:bg-accent/30 transition-colors">
      <div className={`shrink-0 h-8 w-8 rounded-full border flex items-center justify-center ${tone}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium capitalize">{prettyEvent(entry.event)}</span>
          {entry.extension && (
            <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0">
              ext {entry.extension}
            </Badge>
          )}
          {entry.ip && <span className="text-[11px] text-muted-foreground font-mono">{entry.ip}</span>}
        </div>
        <MetaChips metadata={entry.metadata} />
      </div>
      <time
        className="shrink-0 text-[11px] text-muted-foreground whitespace-nowrap pt-0.5"
        title={new Date(entry.timestamp).toLocaleString()}
      >
        {relativeTime(entry.timestamp)}
      </time>
    </div>
  );
}

/**
 * Real-time audit feed for the admin panel. Streams live activity over the
 * signaling WebSocket (see `useLiveAudit`). Long-term/searchable history is
 * served separately by the Go audit API.
 */
export function AuditTab() {
  const { entries, connected } = useLiveAudit();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <ScrollText className="h-5 w-5 text-primary" />
            Activity Feed
          </h2>
          <p className="text-sm text-muted-foreground">Live stream of system & call events.</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/50"}`}
          />
          <span className={connected ? "text-emerald-400" : "text-muted-foreground"}>
            {connected ? "Live" : "Connecting…"}
          </span>
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
              <Radio className="h-8 w-8 opacity-40" />
              <p className="text-sm">{connected ? "Waiting for activity…" : "Connecting to live feed…"}</p>
            </div>
          ) : (
            <ScrollArea className="h-[60vh]">
              {entries.map((e) => (
                <AuditRow key={e.id} entry={e} />
              ))}
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

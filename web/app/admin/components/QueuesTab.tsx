"use client";

import { useMemo } from "react";
import {
  Headphones,
  PhoneIncoming,
  Clock,
  Users,
  UserCheck,
  CircleDot,
  PauseCircle,
  PhoneCall,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLiveQueues } from "../../hooks/useLiveQueues";
import { useAuthStore } from "../../stores";
import type { QueueAgentState, QueueAgentSnapshot, QueueCallerState } from "../../types";

/** mm:ss for a wait/idle duration in seconds. */
function fmtSecs(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Accent treatment for an agent state. */
function agentStyle(state: QueueAgentState): { tone: string; label: string } {
  switch (state) {
    case "available":
      return { tone: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", label: "Available" };
    case "ringing":
      return { tone: "text-amber-400 bg-amber-500/10 border-amber-500/20", label: "Ringing" };
    case "busy":
      return { tone: "text-sky-400 bg-sky-500/10 border-sky-500/20", label: "On Call" };
    case "paused":
      return { tone: "text-orange-400 bg-orange-500/10 border-orange-500/20", label: "Paused" };
    default:
      return { tone: "text-muted-foreground bg-muted/40 border-border", label: "Offline" };
  }
}

/** Accent treatment for a waiting/connected caller. */
function callerStyle(state: QueueCallerState): string {
  switch (state) {
    case "connected":
      return "text-sky-400 bg-sky-500/10 border-sky-500/20";
    case "ringing":
      return "text-amber-400 bg-amber-500/10 border-amber-500/20";
    default:
      return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
  }
}

/** One small stat with an icon, for the queue header strip. */
function Stat({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <div className="leading-tight">
        <div className="text-sm font-semibold">{value}</div>
        <div className="text-[11px] text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function AgentCard({
  agent,
  isSelf,
  onTogglePause,
}: {
  agent: QueueAgentSnapshot;
  isSelf: boolean;
  onTogglePause: (paused: boolean) => void;
}) {
  const style = agentStyle(agent.state);
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{agent.name}</span>
          <span className="text-xs text-muted-foreground">{agent.extension}</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <Badge variant="outline" className={`px-1.5 py-0 text-[10px] ${style.tone}`}>
            <CircleDot className="mr-1 h-2.5 w-2.5" />
            {style.label}
          </Badge>
          <span className="text-[11px] text-muted-foreground">{agent.callsHandled} handled</span>
        </div>
      </div>
      {/* Only the logged-in agent may toggle their own availability (the server
          authorizes by the authenticated connection, so others are read-only). */}
      {isSelf && agent.state !== "offline" && (
        <div className="flex items-center gap-2">
          <PauseCircle className="h-3.5 w-3.5 text-muted-foreground" />
          <Switch
            checked={agent.paused}
            onCheckedChange={(checked) => onTogglePause(checked)}
            aria-label="Toggle availability"
          />
        </div>
      )}
    </div>
  );
}

export function QueuesTab() {
  const { queues, connected, setPaused } = useLiveQueues();
  const myExt = useAuthStore((s) => s.user?.extension ?? "");

  const sorted = useMemo(
    () => [...queues].sort((a, b) => a.name.localeCompare(b.name)),
    [queues],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Headphones className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Call Queues</h2>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-muted-foreground"}`} />
          {connected ? "Live" : "Reconnecting…"}
        </div>
      </div>

      {sorted.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <Headphones className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No queues configured</p>
            <p className="max-w-md text-xs text-muted-foreground">
              Define queues with the <code className="rounded bg-muted px-1">QUEUES</code> environment
              variable, e.g. <code className="rounded bg-muted px-1">sales:Sales:1001,1002:longest-idle</code>.
              Callers reach a queue by dialing <code className="rounded bg-muted px-1">queue-&lt;id&gt;</code>.
            </p>
          </CardContent>
        </Card>
      ) : (
        sorted.map((q) => (
          <Card key={q.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  {q.name}
                  <span className="text-xs font-normal text-muted-foreground">queue-{q.id}</span>
                </CardTitle>
                <Badge variant="outline" className="text-[10px]">{q.strategy}</Badge>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat icon={PhoneIncoming} label="Waiting" value={q.stats.waiting} />
                <Stat icon={PhoneCall} label="Connected" value={q.stats.connected} />
                <Stat icon={UserCheck} label="Agents free" value={`${q.stats.agentsAvailable}/${q.stats.agentsTotal}`} />
                <Stat icon={Clock} label="Longest wait" value={fmtSecs(q.stats.longestWaitSecs)} />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Waiting / connected callers */}
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <PhoneIncoming className="h-3.5 w-3.5" /> Callers
                </div>
                {q.callers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No callers in queue.</p>
                ) : (
                  <ScrollArea className="max-h-44">
                    <div className="space-y-2 pr-2">
                      {q.callers.map((c) => (
                        <div
                          key={c.id}
                          className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{c.fromName || c.from}</div>
                            <div className="text-[11px] text-muted-foreground">{c.from}</div>
                          </div>
                          <div className="flex items-center gap-3">
                            {c.state !== "waiting" && c.agent && (
                              <span className="text-[11px] text-muted-foreground">→ {c.agent}</span>
                            )}
                            <Badge variant="outline" className={`px-1.5 py-0 text-[10px] ${callerStyle(c.state)}`}>
                              {c.state === "ringing" && <Loader2 className="mr-1 h-2.5 w-2.5 animate-spin" />}
                              {c.state}
                            </Badge>
                            <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                              {fmtSecs(c.waitingSecs)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </div>

              {/* Agent roster */}
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Users className="h-3.5 w-3.5" /> Agents
                </div>
                {q.agents.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No agents assigned.</p>
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {q.agents.map((a) => (
                      <AgentCard
                        key={a.extension}
                        agent={a}
                        isSelf={a.extension === myExt}
                        onTogglePause={(paused) => setPaused(paused, q.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

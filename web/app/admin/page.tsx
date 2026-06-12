"use client";

import { useState, useEffect } from "react";
import { Users, Phone, Activity, Settings, Shield, PhoneForwarded, LogOut, PhoneIncoming } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type UserResponse, type CallRecordResponse, type HealthResponse } from "../lib/api";
import { CallRecordStatus } from "../types";

type Tab = "overview" | "users" | "calls" | "config";

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [users, setUsers] = useState<UserResponse[]>([]);
  const [calls, setCalls] = useState<CallRecordResponse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [h, u, c] = await Promise.all([
        api.health(),
        api.getUsers(),
        api.getCalls(),
      ]);
      setHealth(h);
      setUsers(u);
      setCalls(c);
    } catch (err) {
      console.error("Failed to load admin data:", err);
    } finally {
      setLoading(false);
    }
  };

  const navItems: { id: Tab; label: string; icon: typeof Users }[] = [
    { id: "overview", label: "Overview", icon: Activity },
    { id: "users", label: "Users", icon: Users },
    { id: "calls", label: "Call Logs", icon: Phone },
    { id: "config", label: "Config", icon: Settings },
  ];

  return (
    <div className="flex h-dvh">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border/50 bg-card/30 flex flex-col">
        <div className="p-4 border-b border-border/50">
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Admin Panel
          </h1>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                tab === id
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
          {/* IVR builder lives on its own route (full-screen canvas). */}
          <a
            href="/admin/ivr"
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-muted-foreground hover:text-foreground hover:bg-accent/50"
          >
            <PhoneIncoming className="h-4 w-4" />
            IVR Flows
          </a>
        </nav>
        <div className="p-3 border-t border-border/50">
          <a href="/" className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors">
            <LogOut className="h-4 w-4" /> Back to App
          </a>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-6 space-y-6 max-w-5xl">
            {tab === "overview" && <OverviewTab health={health} users={users} calls={calls} loading={loading} />}
            {tab === "users" && <UsersTab users={users} loading={loading} onRefresh={loadData} />}
            {tab === "calls" && <CallsTab calls={calls} loading={loading} />}
            {tab === "config" && <ConfigTab />}
          </div>
        </ScrollArea>
      </main>
    </div>
  );
}

// ─── Overview Tab ──────────────────────────────────────

function OverviewTab({
  health,
  users,
  calls,
  loading,
}: {
  health: HealthResponse | null;
  users: UserResponse[];
  calls: CallRecordResponse[];
  loading: boolean;
}) {
  if (loading) return <OverviewSkeleton />;

  const online = users.filter((u) => u.registered).length;

  return (
    <>
      <h2 className="text-2xl font-bold">Dashboard</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Status" value={health?.status === "ok" ? "Online" : "Offline"} color={health?.status === "ok" ? "text-emerald-500" : "text-destructive"} />
        <StatCard title="Users" value={`${online} / ${users.length}`} sub="online / total" />
        <StatCard title="Calls" value={calls.length.toString()} sub="total logged" />
        <StatCard title="Uptime" value={health ? formatUptime(health.uptime) : "-"} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">System</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="SIP Connected" value={health?.sipConnected ? "Yes" : "No"} />
            <Row label="IVR Active" value={health?.ivrActive ? "Yes" : "No"} />
            <Row label="Trunk Enabled" value={health?.trunkEnabled ? "Yes" : "No"} />
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Recent Calls</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {calls.slice(0, 5).map((c) => (
              <div key={c.id} className="flex justify-between text-muted-foreground">
                <span>{c.from} → {c.to}</span>
                <Badge variant="secondary" className="text-[10px]">{c.status}</Badge>
              </div>
            ))}
            {calls.length === 0 && <p className="text-muted-foreground">No calls yet</p>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

// ─── Users Tab ─────────────────────────────────────────

function UsersTab({ users, loading, onRefresh }: { users: UserResponse[]; loading: boolean; onRefresh: () => void }) {
  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Users ({users.length})</h2>
        <Button size="sm" variant="secondary" onClick={onRefresh}>Refresh</Button>
      </div>
      <Card className="border-border/50 bg-card/50">
        <CardContent className="p-0">
          <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-4 px-4 py-2 border-b border-border/50 text-xs font-medium text-muted-foreground">
            <span>Extension</span>
            <span>Name</span>
            <span>Username</span>
            <span>Status</span>
          </div>
          {loading ? (
            <TableSkeleton cols={4} />
          ) : (
            users.map((u) => (
              <div key={u.extension} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-4 px-4 py-3 border-b border-border/30 last:border-0 text-sm">
                <span className="font-mono">{u.extension}</span>
                <span>{u.name}</span>
                <span className="text-muted-foreground">{u.username}</span>
                <Badge variant={u.registered ? "default" : "secondary"} className="text-[10px]">
                  {u.registered ? "online" : "offline"}
                </Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </>
  );
}

// ─── Calls Tab ─────────────────────────────────────────

function CallsTab({ calls, loading }: { calls: CallRecordResponse[]; loading: boolean }) {
  return (
    <>
      <h2 className="text-2xl font-bold">Call Logs ({calls.length})</h2>
      <Card className="border-border/50 bg-card/50">
        <CardContent className="p-0">
          <div className="grid grid-cols-[1fr_1fr_1fr_auto_auto] gap-4 px-4 py-2 border-b border-border/50 text-xs font-medium text-muted-foreground">
            <span>From</span>
            <span>To</span>
            <span>Time</span>
            <span>Direction</span>
            <span>Status</span>
          </div>
          {loading ? (
            <TableSkeleton cols={5} />
          ) : calls.length === 0 ? (
            <p className="px-4 py-8 text-center text-muted-foreground text-sm">No calls logged</p>
          ) : (
            calls.map((c) => (
              <div key={c.id} className="grid grid-cols-[1fr_1fr_1fr_auto_auto] gap-4 px-4 py-3 border-b border-border/30 last:border-0 text-sm">
                <span>{c.fromName || c.from}</span>
                <span>{c.to}</span>
                <span className="text-muted-foreground text-xs">{new Date(c.startTime).toLocaleString()}</span>
                <Badge variant="secondary" className="text-[10px]">{c.direction}</Badge>
                <Badge
                  variant={c.status === CallRecordStatus.Answered ? "default" : "secondary"}
                  className={`text-[10px] ${c.status === CallRecordStatus.Missed ? "text-destructive" : ""}`}
                >
                  {c.status}
                </Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </>
  );
}

// ─── Config Tab ────────────────────────────────────────

// Module-level cache so switching away from and back to the Config tab
// (which unmounts/remounts this component) does not re-hit the API.
let cachedConfig: Record<string, string | number | boolean> | null = null;

function ConfigTab() {
  const [config, setConfig] = useState<Record<string, string | number | boolean> | null>(cachedConfig);

  useEffect(() => {
    if (cachedConfig) return;
    api
      .getConfig()
      .then((c) => {
        cachedConfig = c as unknown as Record<string, string | number | boolean>;
        setConfig(cachedConfig);
      })
      .catch(() => {});
  }, []);

  return (
    <>
      <h2 className="text-2xl font-bold">Configuration</h2>
      <Card className="border-border/50 bg-card/50">
        <CardContent className="p-4 space-y-2 text-sm">
          {config ? (
            Object.entries(config).map(([key, val]) => (
              <Row key={key} label={key} value={String(val)} />
            ))
          ) : (
            <ConfigSkeleton />
          )}
        </CardContent>
      </Card>
    </>
  );
}

// ─── Skeletons ─────────────────────────────────────────

function OverviewSkeleton() {
  return (
    <>
      <Skeleton className="h-8 w-40" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-44 w-full rounded-xl" />
      </div>
    </>
  );
}

function TableSkeleton({ cols, rows = 6 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="grid gap-4 px-4 py-3 border-b border-border/30 last:border-0"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-4 w-full" />
          ))}
        </div>
      ))}
    </>
  );
}

function ConfigSkeleton() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex justify-between">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </>
  );
}

// ─── Helpers ───────────────────────────────────────────

function StatCard({ title, value, sub, color }: { title: string; value: string; sub?: string; color?: string }) {
  return (
    <Card className="border-border/50 bg-card/50">
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground mb-1">{title}</p>
        <p className={`text-2xl font-bold ${color || ""}`}>{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

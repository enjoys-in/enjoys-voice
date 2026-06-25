"use client";

import { useState, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { Users, Phone, Activity, Settings, Shield, PhoneForwarded, LogOut, PhoneIncoming, Palette, Save, RotateCcw, Check, Receipt, ScrollText, Radio, Headphones, KeyRound, Link2, Clock, Voicemail } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { api, type UserResponse, type HealthResponse } from "../lib/api";
import { goApi, type CallStats, type SystemSettings as SystemSettingsT, type RatePlan } from "../lib/go-api";
import { RatesTab } from "./components/RatesTab";
import { AuditTab } from "./components/AuditTab";
import { TrunksTab } from "./components/TrunksTab";
import { QueuesTab } from "./components/QueuesTab";
import { ApiKeysTab } from "./components/ApiKeysTab";
import { ConnectorsTab } from "./components/ConnectorsTab";
import { HoursTab } from "./components/HoursTab";
import { useLiveMetrics } from "../hooks/useLiveMetrics";
import { useBranding } from "../hooks/useBranding";
import { useAuthStore } from "../stores";
import { VoicemailScreen } from "../components/screens/VoicemailScreen";
import { CallRecordStatus, type CallRecord } from "../types";

type Tab = "overview" | "users" | "calls" | "voicemail" | "customization" | "rates" | "trunks" | "queues" | "hours" | "apikeys" | "connectors" | "audit" | "config";

// Selectable stats windows (days) for the dashboard aggregate metrics/charts.
const RANGE_OPTIONS = [7, 14, 30] as const;

// Tabs a non-admin (read-only) user is allowed to see in the Control Plane.
// Everything else is admin-only and hidden from regular users.
const USER_TABS: Tab[] = ["overview", "calls", "voicemail", "audit"];

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [users, setUsers] = useState<UserResponse[]>([]);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<CallStats | null>(null);
  const [statsDays, setStatsDays] = useState<number>(7);
  const [statsLoading, setStatsLoading] = useState(true);
  const { brandName } = useBranding();
  const { user } = useAuthStore();
  const isAdmin = !!user?.isAdmin;
  const myExt = user?.extension ?? "";

  useEffect(() => {
    loadData();
    // Re-run once the persisted user hydrates / role resolves so admins fetch
    // the system-wide datasets and users stay on their own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  // Aggregate stats reload whenever the selected range changes (independent of
  // the health/users/calls load so switching ranges only re-hits /stats).
  useEffect(() => {
    let active = true;
    setStatsLoading(true);
    goApi
      .getStats(statsDays)
      .then((s) => {
        if (active) setStats(s);
      })
      .catch((err) => console.error("Failed to load stats:", err))
      .finally(() => {
        if (active) setStatsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [statsDays]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (isAdmin) {
        const [h, u, c] = await Promise.all([
          api.health(),
          api.getUsers(),
          goApi.getCalls(),
        ]);
        setHealth(h);
        setUsers(u);
        setCalls(c);
      } else {
        // Regular users may only read their own call history; the health and
        // user-directory endpoints are admin-only (would 403).
        setCalls(await goApi.getCalls());
      }
    } catch (err) {
      console.error("Failed to load Control Plane data:", err);
    } finally {
      setLoading(false);
    }
  };

  const navItems: { id: Tab; label: string; icon: typeof Users }[] = [
    { id: "overview", label: "Overview", icon: Activity },
    { id: "users", label: "Users", icon: Users },
    { id: "calls", label: "Call Logs", icon: Phone },
    { id: "voicemail", label: "Voicemail", icon: Voicemail },
    { id: "customization", label: "Customization", icon: Palette },
    { id: "rates", label: "Rates", icon: Receipt },
    { id: "trunks", label: "Trunks", icon: Radio },
    { id: "queues", label: "Queues", icon: Headphones },
    { id: "hours", label: "Working Hours", icon: Clock },
    { id: "apikeys", label: "API Keys", icon: KeyRound },
    { id: "connectors", label: "Connectors", icon: Link2 },
    { id: "audit", label: "Activity", icon: ScrollText },
    { id: "config", label: "Config", icon: Settings },
  ];

  // Non-admins get a read-only subset; admins get the full panel.
  const visibleNav = isAdmin ? navItems : navItems.filter((n) => USER_TABS.includes(n.id));

  // Guard so a non-admin can never land on an admin-only tab.
  const selectTab = (t: Tab) => {
    if (!isAdmin && !USER_TABS.includes(t)) return;
    setTab(t);
  };

  const currentLabel = navItems.find((n) => n.id === tab)?.label ?? "Control Plane";

  return (
    <div className="flex h-dvh">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border/50 bg-card/30 flex flex-col">
        <div className="p-4 border-b border-border/50">
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Control Plane
          </h1>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {visibleNav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => selectTab(id)}
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
          <Link
            href="/admin/ivr"
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-muted-foreground hover:text-foreground hover:bg-accent/50"
          >
            <PhoneIncoming className="h-4 w-4" />
            IVR Flows
          </Link>
        </nav>
        <div className="p-3 border-t border-border/50">
          <Link href="/" className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors">
            <LogOut className="h-4 w-4" /> Back to App
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Static header */}
        <header className="flex shrink-0 items-center justify-between gap-4 px-6 py-3 border-b border-border/50 bg-background/80 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">{currentLabel}</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-xs text-muted-foreground">{brandName}</span>
            <Badge variant="secondary" className="text-[10px]">{isAdmin ? "Admin" : "Read-only"}</Badge>
          </div>
        </header>
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-6 space-y-6">
            {tab === "overview" && (
              <OverviewTab
                health={health}
                users={users}
                calls={calls}
                loading={loading}
                stats={stats}
                statsDays={statsDays}
                statsLoading={statsLoading}
                onRangeChange={setStatsDays}
                isAdmin={isAdmin}
              />
            )}
            {tab === "users" && <UsersTab users={users} loading={loading} onRefresh={loadData} />}
            {tab === "calls" && <CallsTab calls={calls} loading={loading} />}
            {tab === "voicemail" && <VoicemailScreen />}
            {tab === "customization" && <CustomizationTab />}
            {tab === "rates" && <RatesTab />}
            {tab === "trunks" && <TrunksTab />}
            {tab === "queues" && <QueuesTab />}
            {tab === "hours" && <HoursTab users={users} />}
            {tab === "apikeys" && <ApiKeysTab />}
            {tab === "connectors" && <ConnectorsTab />}
            {tab === "audit" && <AuditTab extension={isAdmin ? undefined : myExt} />}
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
  stats,
  statsDays,
  statsLoading,
  onRangeChange,
  isAdmin,
}: {
  health: HealthResponse | null;
  users: UserResponse[];
  calls: CallRecord[];
  loading: boolean;
  stats: CallStats | null;
  statsDays: number;
  statsLoading: boolean;
  onRangeChange: (days: number) => void;
  isAdmin: boolean;
}) {
  // Live engine metrics (active concurrency / peak CPS). Hook is called before
  // any early return to satisfy the rules of hooks.
  const { metrics: live, connected } = useLiveMetrics();

  if (loading) return <OverviewSkeleton />;

  const online = users.filter((u) => u.registered).length;
  const connRate = stats ? Math.round(stats.connectionRate * 100) : null;
  const abandonRate = stats ? Math.round(stats.abandonedRate * 100) : null;
  // Average spend per call over the period (guard divide-by-zero).
  const avgCost = stats && stats.totalCalls > 0 ? stats.totalCost / stats.totalCalls : null;

  return (
    <>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-2xl font-bold">Dashboard</h2>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/40"}`} />
                {connected ? "Live" : "Offline"}
              </span>
              <Separator orientation="vertical" className="h-5" />
            </>
          )}
          <div className="flex rounded-lg border border-border/50 p-0.5">
            {RANGE_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => onRangeChange(d)}
                className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                  statsDays === d
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Live engine metrics */}
      {isAdmin && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Live</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Active Calls"
              value={live ? live.activeTotal.toString() : "-"}
              sub={live ? `${live.activeInbound} in · ${live.activeOutbound} out` : "in / out"}
              color={live && live.activeTotal > 0 ? "text-emerald-500" : undefined}
            />
            <StatCard title="Max Concurrent" value={live ? live.maxConcurrent.toString() : "-"} sub="since start" />
            <StatCard title="Peak Inbound Channels" value={live ? live.peakInboundConcurrent.toString() : "-"} sub="concurrent" />
            <StatCard
              title="Outbound CPS"
              value={live ? live.outboundCurrentCps.toString() : "-"}
              sub={live ? `peak ${live.outboundPeakCps}/s` : "calls / sec"}
            />
          </div>
        </div>
      )}

      {/* Aggregate metrics (last N days) */}
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
          Last {statsDays} days
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Number of Calls" value={stats ? stats.totalCalls.toLocaleString() : "-"} sub={`${stats?.inbound ?? 0} in · ${stats?.outbound ?? 0} out`} />
          <StatCard
            title="Connection Rate"
            value={connRate !== null ? `${connRate}%` : "-"}
            sub="answered / total"
            color={connRate !== null && connRate >= 50 ? "text-emerald-500" : connRate !== null ? "text-amber-500" : undefined}
          />
          <StatCard
            title="Abandoned Calls"
            value={abandonRate !== null ? `${abandonRate}%` : "-"}
            sub="missed + failed"
            color={abandonRate !== null && abandonRate > 30 ? "text-destructive" : undefined}
          />
          <StatCard title="Avg Duration" value={stats ? formatDuration(stats.avgDuration) : "-"} sub="answered calls" />
          <StatCard
            title="Total Spend"
            value={stats ? `${stats.totalCost.toFixed(2)}${stats.currency ? ` ${stats.currency}` : ""}` : "-"}
            sub="billed this period"
            color={stats && stats.totalCost > 0 ? "text-emerald-500" : undefined}
          />
          <StatCard
            title="Avg Cost / Call"
            value={avgCost !== null ? `${avgCost.toFixed(4)}${stats?.currency ? ` ${stats.currency}` : ""}` : "-"}
            sub="spend / total calls"
          />
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="border-border/50 bg-card/50 lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Calls Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-64 w-full rounded-lg" />
            ) : stats && stats.series.length > 0 ? (
              <CallsOverTimeChart series={stats.series} />
            ) : (
              <EmptyChart label="No calls in this range" />
            )}
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-64 w-full rounded-lg" />
            ) : stats && stats.statusBreakdown.length > 0 ? (
              <StatusBreakdownChart data={stats.statusBreakdown} />
            ) : (
              <EmptyChart label="No data" />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Spend over time — only shown once any cost has been billed */}
      {stats && stats.totalCost > 0 && (
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Spend Over Time{stats.currency ? ` (${stats.currency})` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-56 w-full rounded-lg" />
            ) : (
              <SpendOverTimeChart series={stats.series} />
            )}
          </CardContent>
        </Card>
      )}

      {/* System + recent calls */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {isAdmin && (
          <Card className="border-border/50 bg-card/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">System</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Status" value={health?.status === "ok" ? "Online" : "Offline"} />
              <Row label="SIP Connected" value={health?.sipConnected ? "Yes" : "No"} />
              <Row label="IVR Active" value={health?.ivrActive ? "Yes" : "No"} />
              <Row label="Trunk Enabled" value={health?.trunkEnabled ? "Yes" : "No"} />
              <Row label="Users Online" value={`${online} / ${users.length}`} />
              <Row label="Uptime" value={health ? formatUptime(health.uptime) : "-"} />
            </CardContent>
          </Card>
        )}
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

// ─── Dashboard charts ──────────────────────────────────

// Status → fill color (theme-independent so bars stay legible in both modes).
const STATUS_COLORS: Record<string, string> = {
  answered: "#10b981",
  ended: "#10b981",
  ringing: "#0ea5e9",
  voicemail: "#8b5cf6",
  missed: "#f59e0b",
  failed: "#ef4444",
  unreachable: "#ef4444",
};

const CHART_TOOLTIP_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--popover-foreground)",
} as const;

function CallsOverTimeChart({ series }: { series: CallStats["series"] }) {
  const data = series.map((b) => ({
    date: b.date.slice(5), // MM-DD
    Inbound: b.inbound,
    Outbound: b.outbound,
  }));
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="inboundFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.5} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="outboundFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.5} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={32} />
          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area type="monotone" dataKey="Inbound" stroke="#6366f1" strokeWidth={2} fill="url(#inboundFill)" />
          <Area type="monotone" dataKey="Outbound" stroke="#10b981" strokeWidth={2} fill="url(#outboundFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function SpendOverTimeChart({ series }: { series: CallStats["series"] }) {
  const data = series.map((b) => ({
    date: b.date.slice(5), // MM-DD
    Spend: Number(b.cost.toFixed(4)),
  }));
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.5} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={44} />
          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
          <Area type="monotone" dataKey="Spend" stroke="#10b981" strokeWidth={2} fill="url(#spendFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function StatusBreakdownChart({ data }: { data: CallStats["statusBreakdown"] }) {
  const rows = data.map((d) => ({ status: d.status, count: d.count }));
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="status" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={78} />
          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={{ fill: "var(--accent)", opacity: 0.3 }} />
          <Bar dataKey="count" radius={[0, 4, 4, 0]}>
            {rows.map((r) => (
              <Cell key={r.status} fill={STATUS_COLORS[r.status] ?? "#64748b"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-64 w-full flex items-center justify-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}


// ─── Users Tab ─────────────────────────────────────────

function UsersTab({ users, loading, onRefresh }: { users: UserResponse[]; loading: boolean; onRefresh: () => void }) {
  // Rate plans for the per-user billing selector. Loaded once for the tab and
  // shared across rows (so N user rows don't each refetch the plan list).
  const [plans, setPlans] = useState<RatePlan[] | null>(null);

  useEffect(() => {
    goApi
      .getRatePlans()
      .then(setPlans)
      .catch(() => setPlans([]));
  }, []);

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Users ({users.length})</h2>
        <Button size="sm" variant="secondary" onClick={onRefresh}>Refresh</Button>
      </div>
      <Card className="border-border/50 bg-card/50">
        <CardContent className="p-0">
          <div className="grid grid-cols-[1fr_1fr_1fr_auto_180px] gap-4 px-4 py-2 border-b border-border/50 text-xs font-medium text-muted-foreground">
            <span>Extension</span>
            <span>Name</span>
            <span>Username</span>
            <span>Status</span>
            <span>Rate plan</span>
          </div>
          {loading ? (
            <TableSkeleton cols={5} />
          ) : (
            users.map((u) => (
              <div key={u.extension} className="grid grid-cols-[1fr_1fr_1fr_auto_180px] gap-4 px-4 py-3 border-b border-border/30 last:border-0 text-sm items-center">
                <span className="font-mono">{u.extension}</span>
                <span>{u.name}</span>
                <span className="text-muted-foreground">{u.username}</span>
                <Badge variant={u.registered ? "default" : "secondary"} className="text-[10px]">
                  {u.registered ? "online" : "offline"}
                </Badge>
                <UserRatePlanSelect extension={u.extension} plans={plans} />
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </>
  );
}

// Per-user billing rate-plan selector. Lazy-loads the user's current settings
// on mount to show their assigned plan, then PATCHes rate_plan_id on change
// (0 = clear → workspace default). `plans` is provided by the parent so the
// option list is fetched once for the whole table.
function UserRatePlanSelect({ extension, plans }: { extension: string; plans: RatePlan[] | null }) {
  const [value, setValue] = useState<string | null>(null); // null until loaded
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    goApi
      .getSettings(extension)
      .then((s) => {
        if (active) setValue(s.rate_plan_id ? String(s.rate_plan_id) : "0");
      })
      .catch(() => {
        if (active) setValue("0");
      });
    return () => {
      active = false;
    };
  }, [extension]);

  const handleChange = async (next: string | null) => {
    if (next === null) return;
    const prev = value;
    setValue(next);
    setSaving(true);
    try {
      // Send a number; the Go API treats 0/null as "clear → default".
      await goApi.updateSettings(extension, { rate_plan_id: Number(next) });
    } catch (err) {
      console.error("Failed to assign rate plan:", err);
      setValue(prev); // revert on failure
    } finally {
      setSaving(false);
    }
  };

  if (value === null || plans === null) {
    return <Skeleton className="h-8 w-full" />;
  }

  return (
    <Select value={value} onValueChange={handleChange} disabled={saving}>
      <SelectTrigger className="h-8 text-xs">
        <SelectValue placeholder="Default" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="0">Default plan</SelectItem>
        {plans.map((p) => (
          <SelectItem key={p.id} value={String(p.id)}>
            {p.name} ({p.currency})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─── Calls Tab ─────────────────────────────────────────

function CallsTab({ calls, loading }: { calls: CallRecord[]; loading: boolean }) {
  return (
    <>
      <h2 className="text-2xl font-bold">Call Logs ({calls.length})</h2>
      <Card className="border-border/50 bg-card/50">
        <CardContent className="p-0">
          <div className="grid grid-cols-[1fr_1fr_1fr_auto_auto_auto] gap-4 px-4 py-2 border-b border-border/50 text-xs font-medium text-muted-foreground">
            <span>From</span>
            <span>To</span>
            <span>Time</span>
            <span>Direction</span>
            <span>Status</span>
            <span className="text-right">Cost</span>
          </div>
          {loading ? (
            <TableSkeleton cols={6} />
          ) : calls.length === 0 ? (
            <p className="px-4 py-8 text-center text-muted-foreground text-sm">No calls logged</p>
          ) : (
            calls.map((c) => (
              <div key={c.id} className="grid grid-cols-[1fr_1fr_1fr_auto_auto_auto] gap-4 px-4 py-3 border-b border-border/30 last:border-0 text-sm">
                <span>{c.fromName || c.from}</span>
                <span>{c.to}</span>
                <span className="text-muted-foreground text-xs">{new Date(c.startTime).toLocaleString()}</span>
                <Badge variant="secondary" className="text-[10px]">{c.direction}</Badge>
                <Badge
                  variant={c.status === CallRecordStatus.Answered ? "default" : "secondary"}
                  className={`text-[10px] ${c.status === CallRecordStatus.Missed || c.status === CallRecordStatus.Unreachable ? "text-destructive" : ""}`}
                >
                  {c.status}
                </Badge>
                <span className="text-right tabular-nums text-xs text-muted-foreground">
                  {c.cost && c.cost > 0 ? `${c.cost.toFixed(4)} ${c.currency || ""}`.trim() : "—"}
                </span>
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
// ─── Customization Tab (SaaS branding + default policies) ──────────────

// Cached across tab switches so re-opening Customization doesn't re-fetch/flash.
let cachedSystemSettings: SystemSettingsT | null = null;

function CustomizationTab() {
  const [baseline, setBaseline] = useState<SystemSettingsT | null>(cachedSystemSettings);
  const [form, setForm] = useState<SystemSettingsT | null>(cachedSystemSettings);
  const [loadErr, setLoadErr] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (cachedSystemSettings) return;
    goApi
      .getSystemSettings()
      .then((s) => {
        cachedSystemSettings = s;
        setBaseline(s);
        setForm(s);
      })
      .catch(() => setLoadErr(true));
  }, []);

  const patch = (updates: Partial<SystemSettingsT>) =>
    setForm((f) => (f ? { ...f, ...updates } : f));

  const dirty = !!form && !!baseline && JSON.stringify(form) !== JSON.stringify(baseline);

  const handleSave = async () => {
    if (!form || !dirty || saving) return;
    setSaving(true);
    setSaved(false);
    try {
      const updated = await goApi.updateSystemSettings(form);
      cachedSystemSettings = updated;
      setBaseline(updated);
      setForm(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("Failed to save system settings:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => baseline && setForm(baseline);

  if (loadErr) {
    return (
      <>
        <h2 className="text-2xl font-bold">Customization</h2>
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm text-muted-foreground">
            Couldn&apos;t load workspace settings. Check the API connection and try again.
          </CardContent>
        </Card>
      </>
    );
  }

  if (!form) return <CustomizationSkeleton />;

  const accent = form.accent_color || "#6366f1";

  return (
    <>
      {/* Header + save bar */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold">Customization</h2>
          <p className="text-sm text-muted-foreground">
            Brand the workspace and set the defaults new accounts inherit.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <Button variant="ghost" size="sm" onClick={handleReset} disabled={saving}>
              <RotateCcw className="h-4 w-4 mr-1.5" /> Reset
            </Button>
          )}
          <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
            {saved ? (
              <><Check className="h-4 w-4 mr-1.5" /> Saved</>
            ) : (
              <><Save className="h-4 w-4 mr-1.5" /> {saving ? "Saving…" : "Save changes"}</>
            )}
          </Button>
        </div>
      </div>

      {/* Live brand preview */}
      <Card className="overflow-hidden border-border/50">
        <div className="h-1.5 w-full" style={{ background: accent }} />
        <CardContent className="p-4 flex items-center gap-3">
          <div
            className="h-11 w-11 rounded-xl flex items-center justify-center text-base font-bold text-white shrink-0"
            style={{ background: accent }}
          >
            {(form.brand_name || "E").trim().charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="font-semibold truncate">{form.brand_name || "Brand name"}</p>
            <p className="text-xs text-muted-foreground truncate">
              {form.brand_tagline || "Your tagline appears here"}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Branding */}
      <Card className="border-border/50 bg-card/50">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Palette className="h-4 w-4" /> Branding
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-2 grid gap-4 sm:grid-cols-2">
          <Field label="Brand name">
            <Input value={form.brand_name} maxLength={120}
              onChange={(e) => patch({ brand_name: e.target.value })} />
          </Field>
          <Field label="Tagline">
            <Input value={form.brand_tagline} maxLength={200}
              placeholder="Cloud telephony, simplified"
              onChange={(e) => patch({ brand_tagline: e.target.value })} />
          </Field>
          <Field label="Accent color">
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Accent color"
                value={/^#[0-9a-fA-F]{6}$/.test(accent) ? accent : "#6366f1"}
                onChange={(e) => patch({ accent_color: e.target.value })}
                className="h-9 w-10 rounded-md border border-border bg-transparent p-1 cursor-pointer"
              />
              <Input value={form.accent_color} maxLength={9}
                onChange={(e) => patch({ accent_color: e.target.value })} />
            </div>
          </Field>
          <Field label="Support email">
            <Input type="email" value={form.support_email} maxLength={200}
              placeholder="support@example.com"
              onChange={(e) => patch({ support_email: e.target.value })} />
          </Field>
          <Field label="Logo URL" className="sm:col-span-2">
            <Input value={form.logo_url} maxLength={500}
              placeholder="https://…/logo.svg"
              onChange={(e) => patch({ logo_url: e.target.value })} />
          </Field>
        </CardContent>
      </Card>

      {/* Default policies */}
      <Card className="border-border/50 bg-card/50">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Shield className="h-4 w-4" /> Default user policies
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-2 space-y-1">
          <ToggleRow
            label="Call recording"
            hint="Record calls by default for new accounts."
            checked={form.default_recording}
            onChange={(v) => patch({ default_recording: v })}
          />
          <Separator className="opacity-40" />
          <ToggleRow
            label="Voicemail"
            hint="Enable voicemail by default for new accounts."
            checked={form.default_voicemail}
            onChange={(v) => patch({ default_voicemail: v })}
          />
          <Separator className="opacity-40" />
          <ToggleRow
            label="Allow Do Not Disturb"
            hint="Let users silence incoming calls from their settings."
            checked={form.allow_user_dnd}
            onChange={(v) => patch({ allow_user_dnd: v })}
          />
        </CardContent>
      </Card>

      {/* Limits & retention */}
      <Card className="border-border/50 bg-card/50">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Settings className="h-4 w-4" /> Limits &amp; retention
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-2 grid gap-4 sm:grid-cols-2">
          <Field label="Recording retention (days)">
            <Input type="number" min={0} value={form.recording_retention_days}
              onChange={(e) => patch({ recording_retention_days: Math.max(0, Number(e.target.value) || 0) })} />
          </Field>
          <Field label="Max concurrent calls" hint="0 = unlimited">
            <Input type="number" min={0} value={form.max_concurrent_calls}
              onChange={(e) => patch({ max_concurrent_calls: Math.max(0, Number(e.target.value) || 0) })} />
          </Field>
        </CardContent>
      </Card>
    </>
  );
}

function Field({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <div className={`space-y-1.5 ${className || ""}`}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function CustomizationSkeleton() {
  return (
    <>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-56 w-full rounded-xl" />
      <Skeleton className="h-44 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </>
  );
}

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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Skeleton className="h-80 w-full rounded-xl lg:col-span-2" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Skeleton className="h-52 w-full rounded-xl" />
        <Skeleton className="h-52 w-full rounded-xl" />
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

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "0s";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

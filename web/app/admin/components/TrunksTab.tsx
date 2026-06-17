"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Save,
  Loader2,
  Radio,
  Wifi,
  CheckCircle2,
  AlertCircle,
  PhoneOutgoing,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  goApi,
  type GoTrunk,
  type GoTrunkInput,
  type GoTrunkTestResult,
} from "../../lib/go-api";

// ─── Trunks Tab ─────────────────────────────────────────
//
// Manage upstream SIP trunks (PSTN gateways / ITSPs): the host/port/transport,
// auth credentials, outbound caller number, dial prefix and codec list. Each
// trunk can be probed with a SIP OPTIONS ping for a quick reachability check.
// Server-side every endpoint is admin-only (ADMIN_EXTENSIONS).

export function TrunksTab() {
  const [trunks, setTrunks] = useState<GoTrunk[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [draft, setDraft] = useState<GoTrunk | null>(null);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<GoTrunk | null>(null);
  const [testing, setTesting] = useState<number | null>(null);
  const [results, setResults] = useState<Record<number, GoTrunkTestResult>>({});

  const load = async () => {
    try {
      setTrunks(await goApi.trunks.list());
    } catch (err) {
      console.error("Failed to load trunks:", err);
      setLoadErr(true);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    setCreating(true);
    setDraft({
      id: 0,
      name: "",
      host: "",
      port: 5060,
      transport: "udp",
      username: "",
      has_password: false,
      caller_number: "",
      prefix: "",
      codecs: "",
      enabled: true,
      last_status: "",
      last_tested_at: null,
      created_at: "",
      updated_at: "",
    });
  };

  const openEdit = (trunk: GoTrunk) => {
    setCreating(false);
    setDraft(trunk);
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    const id = toDelete.id;
    setToDelete(null);
    try {
      await goApi.trunks.remove(id);
      await load();
    } catch (err) {
      console.error("Failed to delete trunk:", err);
    }
  };

  const handleTest = async (id: number) => {
    setTesting(id);
    try {
      const res = await goApi.trunks.test(id);
      setResults((r) => ({ ...r, [id]: res }));
      await load(); // refresh persisted last_status / last_tested_at
    } catch (err) {
      console.error("Trunk test failed:", err);
      setResults((r) => ({
        ...r,
        [id]: { ok: false, latency_ms: 0, error: "Request failed" },
      }));
    } finally {
      setTesting(null);
    }
  };

  if (loadErr) {
    return (
      <>
        <h2 className="text-2xl font-bold">SIP Trunks</h2>
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm text-muted-foreground">
            Couldn&apos;t load trunks. Trunk management is admin-only — make sure
            your extension is in <code className="font-mono">ADMIN_EXTENSIONS</code>.
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold">SIP Trunks</h2>
          <p className="text-sm text-muted-foreground">
            Upstream PSTN gateways external calls are routed through.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1.5" /> Add trunk
        </Button>
      </div>

      {trunks === null ? (
        <div className="space-y-2 mt-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : trunks.length === 0 ? (
        <Card className="border-border/50 bg-card/40 mt-4">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            <Radio className="h-8 w-8 mx-auto mb-3 opacity-40" />
            No trunks configured yet. Add one to route external calls to a carrier.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 mt-4">
          {trunks.map((t) => (
            <TrunkRow
              key={t.id}
              trunk={t}
              testing={testing === t.id}
              result={results[t.id]}
              onEdit={() => openEdit(t)}
              onDelete={() => setToDelete(t)}
              onTest={() => handleTest(t.id)}
            />
          ))}
        </div>
      )}

      <TrunkDialog
        draft={draft}
        creating={creating}
        onClose={() => setDraft(null)}
        onSaved={async () => {
          setDraft(null);
          await load();
        }}
      />

      <ConfirmDialog
        open={!!toDelete}
        title={`Delete “${toDelete?.name}”?`}
        description="This removes the trunk configuration. Calls will no longer route through it. This can't be undone."
        confirmLabel="Delete trunk"
        onCancel={() => setToDelete(null)}
        onConfirm={handleDelete}
      />
    </>
  );
}

// ─── Trunk row ──────────────────────────────────────────

function TrunkRow({
  trunk,
  testing,
  result,
  onEdit,
  onDelete,
  onTest,
}: {
  trunk: GoTrunk;
  testing: boolean;
  result?: GoTrunkTestResult;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
}) {
  return (
    <Card className="border-border/50 bg-card/40">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Radio className="h-4 w-4 text-primary shrink-0" />
              <h3 className="font-semibold truncate">{trunk.name}</h3>
              {!trunk.enabled && (
                <Badge variant="outline" className="text-[10px]">disabled</Badge>
              )}
              <StatusBadge status={trunk.last_status} />
            </div>
            <p className="text-sm text-muted-foreground mt-1 font-mono">
              {trunk.host}:{trunk.port}/{trunk.transport}
            </p>
            <div className="flex items-center gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground flex-wrap">
              {trunk.username && <span>user: {trunk.username}</span>}
              {trunk.has_password && <span>· auth set</span>}
              {trunk.caller_number && (
                <span className="flex items-center gap-1">
                  <PhoneOutgoing className="h-3 w-3" /> {trunk.caller_number}
                </span>
              )}
              {trunk.prefix && <span>prefix: {trunk.prefix}</span>}
              {trunk.codecs && <span>codecs: {trunk.codecs}</span>}
            </div>
            {result && (
              <div
                className={`mt-2 inline-flex items-center gap-1.5 text-xs ${
                  result.ok ? "text-emerald-500" : "text-destructive"
                }`}
              >
                {result.ok ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5" />
                )}
                {result.ok
                  ? `Reachable — ${result.response || "SIP response"} (${result.latency_ms}ms)`
                  : `Unreachable — ${result.error || "no response"}`}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="outline" size="sm" onClick={onTest} disabled={testing}>
              {testing ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Wifi className="h-4 w-4 mr-1.5" />
              )}
              Test
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit} aria-label="Edit trunk">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={onDelete}
              aria-label="Delete trunk"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ok")
    return (
      <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-500">
        online
      </Badge>
    );
  if (status === "unreachable")
    return (
      <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive">
        offline
      </Badge>
    );
  return null;
}

// ─── Trunk dialog ───────────────────────────────────────

function TrunkDialog({
  draft,
  creating,
  onClose,
  onSaved,
}: {
  draft: GoTrunk | null;
  creating: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(5060);
  const [transport, setTransport] = useState<"udp" | "tcp" | "tls">("udp");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [callerNumber, setCallerNumber] = useState("");
  const [prefix, setPrefix] = useState("");
  const [codecs, setCodecs] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (draft) {
      setName(draft.name);
      setHost(draft.host);
      setPort(draft.port || 5060);
      setTransport(draft.transport || "udp");
      setUsername(draft.username);
      setPassword("");
      setCallerNumber(draft.caller_number);
      setPrefix(draft.prefix);
      setCodecs(draft.codecs);
      setEnabled(draft.enabled);
    }
  }, [draft]);

  const valid = name.trim() !== "" && host.trim() !== "";

  const handleSave = async () => {
    if (!draft || saving || !valid) return;
    setSaving(true);
    const payload: GoTrunkInput = {
      name: name.trim(),
      host: host.trim(),
      port,
      transport,
      username: username.trim(),
      caller_number: callerNumber.trim(),
      prefix: prefix.trim(),
      codecs: codecs.trim(),
      enabled,
    };
    // Only send a password when the operator typed one — blank keeps the stored secret.
    if (password.trim()) payload.password = password;
    try {
      if (creating) {
        await goApi.trunks.create(payload);
      } else {
        await goApi.trunks.update(draft.id, payload);
      }
      onSaved();
    } catch (err) {
      console.error("Failed to save trunk:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!draft} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{creating ? "New trunk" : "Edit trunk"}</DialogTitle>
          <DialogDescription>
            A trunk is an upstream SIP gateway external calls egress through.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <DialogField label="Name">
            <Input
              autoFocus
              value={name}
              maxLength={80}
              placeholder="My carrier"
              onChange={(e) => setName(e.target.value)}
            />
          </DialogField>
          <div className="grid grid-cols-[1fr,auto,auto] gap-3">
            <DialogField label="Host">
              <Input
                value={host}
                maxLength={255}
                placeholder="sip.provider.com"
                onChange={(e) => setHost(e.target.value)}
              />
            </DialogField>
            <DialogField label="Port">
              <Input
                type="number"
                min={1}
                max={65535}
                className="w-24"
                value={port}
                onChange={(e) => setPort(Number(e.target.value) || 5060)}
              />
            </DialogField>
            <DialogField label="Transport">
              <Select value={transport} onValueChange={(v) => setTransport(v as "udp" | "tcp" | "tls")}>
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="udp">UDP</SelectItem>
                  <SelectItem value="tcp">TCP</SelectItem>
                  <SelectItem value="tls">TLS</SelectItem>
                </SelectContent>
              </Select>
            </DialogField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <DialogField label="Username" hint="SIP auth user (optional)">
              <Input
                value={username}
                maxLength={120}
                placeholder="account"
                onChange={(e) => setUsername(e.target.value)}
              />
            </DialogField>
            <DialogField
              label="Password"
              hint={!creating && draft?.has_password ? "Leave blank to keep current" : "SIP auth secret"}
            >
              <Input
                type="password"
                value={password}
                maxLength={255}
                placeholder={!creating && draft?.has_password ? "••••••••" : "secret"}
                onChange={(e) => setPassword(e.target.value)}
              />
            </DialogField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <DialogField label="Caller number" hint="Outbound caller ID">
              <Input
                value={callerNumber}
                maxLength={40}
                placeholder="+15551234567"
                onChange={(e) => setCallerNumber(e.target.value)}
              />
            </DialogField>
            <DialogField label="Dial prefix" hint="Prepended to dialed digits">
              <Input
                value={prefix}
                maxLength={20}
                placeholder="optional"
                onChange={(e) => setPrefix(e.target.value)}
              />
            </DialogField>
          </div>
          <DialogField label="Codecs" hint="Comma-separated, e.g. PCMU,PCMA,G729">
            <Input
              value={codecs}
              maxLength={120}
              placeholder="PCMU,PCMA"
              onChange={(e) => setCodecs(e.target.value)}
            />
          </DialogField>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 p-3">
            <div>
              <p className="text-sm font-medium">Enabled</p>
              <p className="text-xs text-muted-foreground">Disabled trunks are skipped for routing.</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !valid}>
            {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
            {creating ? "Create trunk" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Shared bits ────────────────────────────────────────

function DialogField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

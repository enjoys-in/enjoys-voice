"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Save,
  Loader2,
  KeyRound,
  Copy,
  Check,
  Code2,
  ShieldAlert,
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
  type GoApiKey,
  type GoApiKeyInput,
  type GoApiKeyRouteType,
} from "../../lib/go-api";

// ─── API Keys Tab ───────────────────────────────────────
//
// Manage developer API keys for the embeddable click-to-call widget. Each key
// is locked to a SINGLE destination number and gated by an allowed-Origin list
// (which websites may embed it) plus an optional source-IP allow-list. The
// publishable key (pk_…) ships in the website/widget; the secret (sk_…) is for
// server-to-server use and is shown exactly ONCE at creation. Keys are
// owner-scoped server-side (the owning extension comes from the JWT).

// Short labels shown on the key row badge.
const ROUTE_TYPE_LABELS: Record<GoApiKeyRouteType, string> = {
  trunk: "PSTN",
  ivr: "IVR",
  extension: "extension",
};

// Per-route-type help text for the "Destination" field in the dialog.
const ROUTE_TYPE_HINTS: Record<GoApiKeyRouteType, string> = {
  trunk: "The phone number every call dials",
  ivr: "The IVR menu extension every call reaches",
  extension: "The internal SIP extension every call rings",
};

const ROUTE_TYPE_PLACEHOLDERS: Record<GoApiKeyRouteType, string> = {
  trunk: "+15551234567",
  ivr: "5000",
  extension: "1001",
};

export function ApiKeysTab() {
  const [keys, setKeys] = useState<GoApiKey[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [draft, setDraft] = useState<GoApiKey | null>(null);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<GoApiKey | null>(null);
  // The freshly-created key, including its one-time plaintext secret.
  const [created, setCreated] = useState<GoApiKey | null>(null);
  // The key whose embed snippet is being shown.
  const [embedFor, setEmbedFor] = useState<GoApiKey | null>(null);

  const load = async () => {
    try {
      setKeys(await goApi.apiKeys.list());
    } catch (err) {
      console.error("Failed to load API keys:", err);
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
      label: "",
      public_key: "",
      has_secret: false,
      allowed_origins: [],
      allowed_ips: [],
      destination_number: "",
      caller_id: "",
      route_type: "trunk",
      daily_cap: 0,
      dev_mode: false,
      active: true,
      last_used_at: null,
      created_at: "",
      updated_at: "",
    });
  };

  const openEdit = (key: GoApiKey) => {
    setCreating(false);
    setDraft(key);
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    const id = toDelete.id;
    setToDelete(null);
    try {
      await goApi.apiKeys.remove(id);
      await load();
    } catch (err) {
      console.error("Failed to revoke API key:", err);
    }
  };

  if (loadErr) {
    return (
      <>
        <h2 className="text-2xl font-bold">API Keys</h2>
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm text-muted-foreground">
            Couldn&apos;t load API keys. Please try again, or check that the API
            service is reachable.
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold">API Keys</h2>
          <p className="text-sm text-muted-foreground">
            Issue keys to embed the click-to-call widget on your sites — locked
            to one number and your allowed domains.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1.5" /> Create key
        </Button>
      </div>

      {keys === null ? (
        <div className="space-y-2 mt-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : keys.length === 0 ? (
        <Card className="border-border/50 bg-card/40 mt-4">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            <KeyRound className="h-8 w-8 mx-auto mb-3 opacity-40" />
            No API keys yet. Create one to embed the click-to-call widget on a
            website.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 mt-4">
          {keys.map((k) => (
            <ApiKeyRow
              key={k.id}
              apiKey={k}
              onEdit={() => openEdit(k)}
              onDelete={() => setToDelete(k)}
              onEmbed={() => setEmbedFor(k)}
            />
          ))}
        </div>
      )}

      <ApiKeyDialog
        draft={draft}
        creating={creating}
        onClose={() => setDraft(null)}
        onSaved={async (createdKey) => {
          setDraft(null);
          await load();
          // A create response carries the one-time secret — surface it.
          if (createdKey && createdKey.secret) setCreated(createdKey);
        }}
      />

      <SecretRevealDialog apiKey={created} onClose={() => setCreated(null)} />

      <EmbedDialog apiKey={embedFor} onClose={() => setEmbedFor(null)} />

      <ConfirmDialog
        open={!!toDelete}
        title={`Revoke “${toDelete?.label || toDelete?.public_key}”?`}
        description="This permanently revokes the key. Any site or service using it will immediately stop being able to place calls. This can't be undone."
        confirmLabel="Revoke key"
        onCancel={() => setToDelete(null)}
        onConfirm={handleDelete}
      />
    </>
  );
}

// ─── API key row ────────────────────────────────────────

function ApiKeyRow({
  apiKey,
  onEdit,
  onDelete,
  onEmbed,
}: {
  apiKey: GoApiKey;
  onEdit: () => void;
  onDelete: () => void;
  onEmbed: () => void;
}) {
  return (
    <Card className="border-border/50 bg-card/40">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <KeyRound className="h-4 w-4 text-primary shrink-0" />
              <h3 className="font-semibold truncate">
                {apiKey.label || "Untitled key"}
              </h3>
              {!apiKey.active && (
                <Badge variant="outline" className="text-[10px]">disabled</Badge>
              )}
              <Badge variant="outline" className="text-[10px]">
                {ROUTE_TYPE_LABELS[apiKey.route_type] ?? apiKey.route_type}
              </Badge>
              {apiKey.dev_mode && (
                <Badge variant="outline" className="text-[10px]">dev mode</Badge>
              )}
              {apiKey.has_secret && (
                <Badge variant="outline" className="text-[10px]">secret set</Badge>
              )}
            </div>
            <div className="mt-1.5">
              <CopyField value={apiKey.public_key} />
            </div>
            <div className="flex items-center gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1">
                <PhoneOutgoing className="h-3 w-3" /> {apiKey.destination_number}
              </span>
              {apiKey.caller_id && <span>caller-ID: {apiKey.caller_id}</span>}
              <span>
                origins:{" "}
                {apiKey.allowed_origins.length
                  ? apiKey.allowed_origins.join(", ")
                  : "none"}
              </span>
              <span>
                IPs:{" "}
                {apiKey.allowed_ips.length
                  ? apiKey.allowed_ips.join(", ")
                  : "any"}
              </span>
              {apiKey.daily_cap > 0 && <span>cap: {apiKey.daily_cap}/day</span>}
              {apiKey.last_used_at && (
                <span>
                  last used: {new Date(apiKey.last_used_at).toLocaleString()}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="outline" size="sm" onClick={onEmbed}>
              <Code2 className="h-4 w-4 mr-1.5" /> Embed
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit} aria-label="Edit key">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={onDelete}
              aria-label="Revoke key"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── API key dialog (create / edit) ─────────────────────

function ApiKeyDialog({
  draft,
  creating,
  onClose,
  onSaved,
}: {
  draft: GoApiKey | null;
  creating: boolean;
  onClose: () => void;
  onSaved: (created?: GoApiKey) => void;
}) {
  const [label, setLabel] = useState("");
  const [destination, setDestination] = useState("");
  const [callerId, setCallerId] = useState("");
  const [routeType, setRouteType] = useState<GoApiKeyRouteType>("trunk");
  const [origins, setOrigins] = useState("");
  const [ips, setIps] = useState("");
  const [dailyCap, setDailyCap] = useState(0);
  const [active, setActive] = useState(true);
  const [devMode, setDevMode] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (draft) {
      setLabel(draft.label);
      setDestination(draft.destination_number);
      setCallerId(draft.caller_id);
      setRouteType(draft.route_type || "trunk");
      setOrigins(draft.allowed_origins.join(", "));
      setIps(draft.allowed_ips.join(", "));
      setDailyCap(draft.daily_cap || 0);
      setActive(draft.active);
      setDevMode(draft.dev_mode);
    }
  }, [draft]);

  const valid = destination.trim() !== "";

  const handleSave = async () => {
    if (!draft || saving || !valid) return;
    setSaving(true);
    const payload: GoApiKeyInput = {
      label: label.trim(),
      destination_number: destination.trim(),
      route_type: routeType,
      allowed_origins: splitList(origins),
      allowed_ips: splitList(ips),
      daily_cap: Math.max(0, Math.floor(dailyCap) || 0),
      dev_mode: devMode,
      active,
    };
    try {
      if (creating) {
        const createdKey = await goApi.apiKeys.create(payload);
        onSaved(createdKey);
      } else {
        await goApi.apiKeys.update(draft.id, payload);
        onSaved();
      }
    } catch (err) {
      console.error("Failed to save API key:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!draft} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{creating ? "Create API key" : "Edit API key"}</DialogTitle>
          <DialogDescription>
            The key dials only the destination below, and only from the domains
            (and IPs) you allow.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-1 max-h-[65vh] overflow-y-auto px-0.5">
          <DialogField label="Label" hint="A name to recognize this key">
            <Input
              autoFocus
              value={label}
              maxLength={80}
              placeholder="Acme marketing site"
              onChange={(e) => setLabel(e.target.value)}
            />
          </DialogField>
          <div className="grid grid-cols-2 gap-3">
            <DialogField label="Destination" hint={ROUTE_TYPE_HINTS[routeType]}>
              <Input
                value={destination}
                maxLength={40}
                placeholder={ROUTE_TYPE_PLACEHOLDERS[routeType]}
                onChange={(e) => setDestination(e.target.value)}
              />
            </DialogField>
            <DialogField label="Caller ID" hint="Your extension — automatic">
              <Input
                value={callerId}
                disabled
                readOnly
                placeholder="Your extension"
              />
            </DialogField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <DialogField label="Route type" hint="Where calls are sent">
              <Select value={routeType} onValueChange={(v) => setRouteType(v as GoApiKeyRouteType)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="trunk">Phone number (PSTN trunk)</SelectItem>
                  <SelectItem value="ivr">IVR menu (internal)</SelectItem>
                  <SelectItem value="extension">Browser → extension</SelectItem>
                </SelectContent>
              </Select>
            </DialogField>
            <DialogField label="Daily call cap" hint="0 = unlimited">
              <Input
                type="number"
                min={0}
                value={dailyCap}
                onChange={(e) => setDailyCap(Number(e.target.value) || 0)}
              />
            </DialogField>
          </div>
          <DialogField
            label="Allowed origins"
            hint="Comma-separated site origins allowed to embed the widget."
          >
            <Input
              value={origins}
              placeholder="https://acme.com, https://app.acme.com"
              onChange={(e) => setOrigins(e.target.value)}
            />
          </DialogField>
          <DialogField
            label="Allowed IPs"
            hint="Optional comma-separated IPs / CIDRs. Blank = any source IP."
          >
            <Input
              value={ips}
              placeholder="203.0.113.4, 198.51.100.0/24"
              onChange={(e) => setIps(e.target.value)}
            />
          </DialogField>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border/50 p-2.5">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-[11px] text-muted-foreground">Off = calls rejected.</p>
              </div>
              <Switch checked={active} onCheckedChange={setActive} />
            </div>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border/50 p-2.5">
              <div>
                <p className="text-sm font-medium">Dev mode</p>
                <p className="text-[11px] text-muted-foreground">Allow localhost; skips origin/IP.</p>
              </div>
              <Switch checked={devMode} onCheckedChange={setDevMode} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !valid}>
            {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
            {creating ? "Create key" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── One-time secret reveal ─────────────────────────────

function SecretRevealDialog({
  apiKey,
  onClose,
}: {
  apiKey: GoApiKey | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!apiKey} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Key created</DialogTitle>
          <DialogDescription>
            Copy your secret now — it&apos;s shown only once and can&apos;t be
            retrieved later.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Publishable key (safe to embed)
            </Label>
            <CopyField value={apiKey?.public_key || ""} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Secret key (server-to-server only)
            </Label>
            <CopyField value={apiKey?.secret || ""} mono />
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">
            <ShieldAlert className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <span>
              Store the secret in your backend&apos;s environment. Never put the
              secret in browser/widget code — use the publishable key there.
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Embed snippet ──────────────────────────────────────

function EmbedDialog({
  apiKey,
  onClose,
}: {
  apiKey: GoApiKey | null;
  onClose: () => void;
}) {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://your-domain";
  const pk = apiKey?.public_key || "pk_live_…";
  const scriptSnippet = `<script
  src="${origin}/widget.js"
  data-enjoys-key="${pk}"
  defer
></script>`;
  const npmSnippet = `import { CallWidget } from "@enjoys/voice-widget";

CallWidget.init({ publicKey: "${pk}" });`;

  return (
    <Dialog open={!!apiKey} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Embed the widget</DialogTitle>
          <DialogDescription>
            Drop the snippet into your site. The widget refuses to load if the
            key, domain, or IP isn&apos;t allowed.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              HTML — one-line script tag
            </Label>
            <CodeBlock code={scriptSnippet} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              npm — @enjoys/voice-widget
            </Label>
            <CodeBlock code={npmSnippet} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
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

/** A read-only value with a copy-to-clipboard button. */
function CopyField({ value, mono }: { value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <div className="flex items-center gap-2">
      <code className={`flex-1 truncate rounded bg-muted/60 px-2 py-1 text-xs ${mono ? "font-mono" : ""}`}>
        {value}
      </code>
      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={copy} aria-label="Copy">
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

/** A multi-line code block with a copy button. */
function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border border-border/50 bg-muted/40 p-3 text-xs leading-relaxed">
        <code className="font-mono whitespace-pre">{code}</code>
      </pre>
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-1.5 top-1.5 h-7 w-7"
        onClick={copy}
        aria-label="Copy snippet"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
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

/** Split a comma/whitespace/newline-separated list into trimmed, non-empty entries. */
function splitList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

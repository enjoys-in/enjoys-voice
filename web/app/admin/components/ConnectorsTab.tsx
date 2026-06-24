"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Save,
  Loader2,
  Mail,
  Webhook,
  KeyRound,
  Link2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
  type GoConnector,
  type GoConnectorInput,
  type GoConnectorType,
  type GoEmailConnectorConfig,
  type GoWebhookConnectorConfig,
} from "../../lib/go-api";

// ─── Connectors Tab ─────────────────────────────────────
//
// Manage reusable outbound integrations the IVR flow builder can trigger:
//   • email   — SMTP credentials used by the experimental "Send email" block
//   • webhook — an HTTP endpoint to POST events to
// Secret fields (SMTP password / webhook signing secret) are write-only: the
// API never returns them, so a blank value on edit keeps the stored one.

const HTTP_METHODS = ["POST", "GET", "PUT", "PATCH", "DELETE"] as const;

export function ConnectorsTab() {
  const [connectors, setConnectors] = useState<GoConnector[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [draft, setDraft] = useState<GoConnector | null>(null);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<GoConnector | null>(null);

  const load = async () => {
    try {
      setConnectors(await goApi.connectors.list());
    } catch (err) {
      console.error("Failed to load connectors:", err);
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
      type: "email",
      enabled: true,
      config: {},
      has_secret: false,
      createdAt: "",
      updatedAt: "",
    });
  };

  const openEdit = (c: GoConnector) => {
    setCreating(false);
    setDraft(c);
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    const id = toDelete.id;
    setToDelete(null);
    try {
      await goApi.connectors.remove(id);
      await load();
    } catch (err) {
      console.error("Failed to delete connector:", err);
    }
  };

  if (loadErr) {
    return (
      <>
        <h2 className="text-2xl font-bold">Connectors</h2>
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm text-muted-foreground">
            Couldn&apos;t load connectors. Please try again.
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold">Connectors</h2>
          <p className="text-sm text-muted-foreground">
            Reusable email &amp; webhook integrations the IVR builder can trigger.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1.5" /> Add connector
        </Button>
      </div>

      {connectors === null ? (
        <div className="space-y-2 mt-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : connectors.length === 0 ? (
        <Card className="border-border/50 bg-card/40 mt-4">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            <Link2 className="h-8 w-8 mx-auto mb-3 opacity-40" />
            No connectors yet. Add an email connector to power the experimental
            &ldquo;Send email&rdquo; IVR block.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 mt-4">
          {connectors.map((c) => (
            <ConnectorRow
              key={c.id}
              connector={c}
              onEdit={() => openEdit(c)}
              onDelete={() => setToDelete(c)}
            />
          ))}
        </div>
      )}

      <ConnectorDialog
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
        description="This removes the connector. IVR blocks referencing it will stop sending. This can't be undone."
        confirmLabel="Delete connector"
        onCancel={() => setToDelete(null)}
        onConfirm={handleDelete}
      />
    </>
  );
}

// ─── Connector row ──────────────────────────────────────

function ConnectorRow({
  connector,
  onEdit,
  onDelete,
}: {
  connector: GoConnector;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isEmail = connector.type === "email";
  const Icon = isEmail ? Mail : Webhook;
  const cfg = connector.config;
  const summary = isEmail
    ? [cfg.host && `${cfg.host}${cfg.port ? `:${cfg.port}` : ""}`, cfg.fromEmail]
        .filter(Boolean)
        .join(" · ")
    : [cfg.method || "POST", cfg.url].filter(Boolean).join(" ");

  return (
    <Card className="border-border/50 bg-card/40">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Icon className="h-4 w-4 text-primary shrink-0" />
              <h3 className="font-semibold truncate">{connector.name}</h3>
              <Badge variant="outline" className="text-[10px] capitalize">
                {connector.type}
              </Badge>
              {!connector.enabled && (
                <Badge variant="outline" className="text-[10px]">
                  disabled
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1 font-mono truncate">
              {summary || "—"}
            </p>
            <div className="flex items-center gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground flex-wrap">
              {isEmail && cfg.username && <span>user: {cfg.username}</span>}
              {connector.has_secret && (
                <span className="flex items-center gap-1">
                  <KeyRound className="h-3 w-3" /> secret set
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onEdit}
              aria-label="Edit connector"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={onDelete}
              aria-label="Delete connector"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Connector dialog ───────────────────────────────────

function headersToText(headers?: Record<string, string>): string {
  if (!headers) return "";
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

function textToHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function ConnectorDialog({
  draft,
  creating,
  onClose,
  onSaved,
}: {
  draft: GoConnector | null;
  creating: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<GoConnectorType>("email");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  // email
  const [host, setHost] = useState("");
  const [port, setPort] = useState(587);
  const [secure, setSecure] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");

  // webhook
  const [url, setUrl] = useState("");
  const [method, setMethod] = useState<string>("POST");
  const [headers, setHeaders] = useState("");
  const [secret, setSecret] = useState("");

  useEffect(() => {
    if (!draft) return;
    setName(draft.name);
    setType(draft.type);
    setEnabled(draft.enabled);
    const cfg = draft.config ?? {};
    const e = cfg as GoEmailConnectorConfig;
    const w = cfg as GoWebhookConnectorConfig;
    setHost(e.host ?? "");
    setPort(e.port ?? 587);
    setSecure(e.secure ?? false);
    setUsername(e.username ?? "");
    setPassword("");
    setFromEmail(e.fromEmail ?? "");
    setFromName(e.fromName ?? "");
    setUrl(w.url ?? "");
    setMethod(w.method ?? "POST");
    setHeaders(headersToText(w.headers));
    setSecret("");
  }, [draft]);

  const valid =
    name.trim() !== "" &&
    (type === "email" ? host.trim() !== "" : url.trim() !== "");

  const handleSave = async () => {
    if (!draft || saving || !valid) return;
    setSaving(true);

    let config: GoConnectorInput["config"];
    if (type === "email") {
      const cfg: GoEmailConnectorConfig = {
        host: host.trim(),
        port,
        secure,
        username: username.trim(),
        fromEmail: fromEmail.trim(),
        fromName: fromName.trim(),
      };
      // Only send the password when typed — blank keeps the stored secret.
      if (password.trim()) cfg.password = password;
      config = cfg;
    } else {
      const cfg: GoWebhookConnectorConfig = {
        url: url.trim(),
        method,
        headers: textToHeaders(headers),
      };
      if (secret.trim()) cfg.secret = secret;
      config = cfg;
    }

    const payload: GoConnectorInput = {
      name: name.trim(),
      type,
      enabled,
      config,
    };

    try {
      if (creating) {
        await goApi.connectors.create(payload);
      } else {
        await goApi.connectors.update(draft.id, payload);
      }
      onSaved();
    } catch (err) {
      console.error("Failed to save connector:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!draft} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{creating ? "New connector" : "Edit connector"}</DialogTitle>
          <DialogDescription>
            A reusable integration the IVR builder can trigger.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-[1fr,auto] gap-3">
            <DialogField label="Name">
              <Input
                autoFocus
                value={name}
                maxLength={120}
                placeholder="Ops email"
                onChange={(e) => setName(e.target.value)}
              />
            </DialogField>
            <DialogField label="Type">
              <Select
                value={type}
                onValueChange={(v) => setType(v as GoConnectorType)}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="webhook">Webhook</SelectItem>
                </SelectContent>
              </Select>
            </DialogField>
          </div>

          {type === "email" ? (
            <>
              <div className="grid grid-cols-[1fr,auto,auto] gap-3">
                <DialogField label="SMTP host">
                  <Input
                    value={host}
                    maxLength={255}
                    placeholder="smtp.example.com"
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
                    onChange={(e) => setPort(Number(e.target.value) || 587)}
                  />
                </DialogField>
                <DialogField label="TLS">
                  <div className="flex h-9 items-center">
                    <Switch checked={secure} onCheckedChange={setSecure} />
                  </div>
                </DialogField>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <DialogField label="Username" hint="SMTP auth user">
                  <Input
                    value={username}
                    maxLength={255}
                    placeholder="apikey / user"
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </DialogField>
                <DialogField
                  label="Password"
                  hint={
                    !creating && draft?.has_secret
                      ? "Leave blank to keep current"
                      : "SMTP auth secret"
                  }
                >
                  <Input
                    type="password"
                    value={password}
                    maxLength={255}
                    placeholder={
                      !creating && draft?.has_secret ? "••••••••" : "secret"
                    }
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </DialogField>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <DialogField label="From email">
                  <Input
                    value={fromEmail}
                    maxLength={255}
                    placeholder="noreply@example.com"
                    onChange={(e) => setFromEmail(e.target.value)}
                  />
                </DialogField>
                <DialogField label="From name" hint="Optional display name">
                  <Input
                    value={fromName}
                    maxLength={120}
                    placeholder="Support"
                    onChange={(e) => setFromName(e.target.value)}
                  />
                </DialogField>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-[auto,1fr] gap-3">
                <DialogField label="Method">
                  <Select value={method} onValueChange={(v) => v && setMethod(v)}>
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HTTP_METHODS.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </DialogField>
                <DialogField label="URL">
                  <Input
                    value={url}
                    maxLength={2000}
                    placeholder="https://hooks.example.com/ivr"
                    onChange={(e) => setUrl(e.target.value)}
                  />
                </DialogField>
              </div>
              <DialogField
                label="Headers"
                hint="One per line, e.g. Authorization: Bearer xyz"
              >
                <Textarea
                  value={headers}
                  rows={3}
                  placeholder={"Content-Type: application/json\nX-Source: callnet"}
                  className="font-mono text-xs"
                  onChange={(e) => setHeaders(e.target.value)}
                />
              </DialogField>
              <DialogField
                label="Signing secret"
                hint={
                  !creating && draft?.has_secret
                    ? "Leave blank to keep current"
                    : "Optional HMAC secret"
                }
              >
                <Input
                  type="password"
                  value={secret}
                  maxLength={255}
                  placeholder={
                    !creating && draft?.has_secret ? "••••••••" : "optional"
                  }
                  onChange={(e) => setSecret(e.target.value)}
                />
              </DialogField>
            </>
          )}

          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 p-3">
            <div>
              <p className="text-sm font-medium">Enabled</p>
              <p className="text-xs text-muted-foreground">
                Disabled connectors won&apos;t fire.
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !valid}>
            {saving ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-1.5" />
            )}
            {creating ? "Create connector" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Shared bits ────────────────────────────────────────

function DialogField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
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
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

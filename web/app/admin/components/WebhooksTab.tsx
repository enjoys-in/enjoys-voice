"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Save,
  Loader2,
  Webhook,
  Link2,
  KeyRound,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
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
  GO_WEBHOOK_EVENTS,
  type GoWebhook,
  type GoWebhookInput,
  type GoWebhookEvent,
} from "../../lib/go-api";

// ─── Webhooks Tab ───────────────────────────────────────
//
// Per-user, self-service outbound webhooks. A user registers a URL and the call
// events they care about; the SIP engine POSTs a signed JSON payload to that URL
// — asynchronously, off the call path — whenever a matching call involving the
// user occurs (inbound to them or outbound from them). Webhooks are strictly
// owner-scoped: every endpoint returns/edits only the caller's own webhooks.

// Friendly labels for each canonical call event.
const EVENT_META: Record<GoWebhookEvent, { label: string; hint: string }> = {
  "call.ringing": { label: "Ringing", hint: "Inbound call started ringing" },
  "call.answered": { label: "Answered", hint: "Call connected" },
  "call.completed": { label: "Completed", hint: "Call ended normally" },
  "call.missed": { label: "Missed", hint: "No answer" },
  "call.failed": { label: "Failed", hint: "Setup/teardown failure" },
  "call.unreachable": { label: "Unreachable", hint: "Destination unreachable" },
  "call.voicemail": { label: "Voicemail", hint: "Caller left a voicemail" },
  "call.transferred": { label: "Transferred", hint: "Call was forwarded/transferred" },
  "call.routed": { label: "Routed", hint: "A routing rule redirected the call" },
};

export function WebhooksTab() {
  const [hooks, setHooks] = useState<GoWebhook[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [draft, setDraft] = useState<GoWebhook | null>(null);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<GoWebhook | null>(null);

  const load = async () => {
    try {
      setHooks(await goApi.webhooks.list());
    } catch (err) {
      console.error("Failed to load webhooks:", err);
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
      ownerExtension: "",
      name: "",
      url: "",
      events: [],
      hasSecret: false,
      enabled: true,
      createdAt: "",
      updatedAt: "",
    });
  };

  const openEdit = (hook: GoWebhook) => {
    setCreating(false);
    setDraft(hook);
  };

  const toggleEnabled = async (hook: GoWebhook) => {
    try {
      await goApi.webhooks.update(hook.id, { enabled: !hook.enabled });
      await load();
    } catch (err) {
      console.error("Failed to toggle webhook:", err);
    }
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    const id = toDelete.id;
    setToDelete(null);
    try {
      await goApi.webhooks.remove(id);
      await load();
    } catch (err) {
      console.error("Failed to delete webhook:", err);
    }
  };

  if (loadErr) {
    return (
      <>
        <h2 className="text-2xl font-bold">Webhooks</h2>
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm text-muted-foreground">
            Couldn&apos;t load your webhooks. Please try again.
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold">Webhooks</h2>
          <p className="text-sm text-muted-foreground">
            Get a signed HTTP callback whenever your calls ring, answer, end, or
            hit voicemail. Deliveries are sent asynchronously and never block a
            call.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1.5" /> Add webhook
        </Button>
      </div>

      {hooks === null ? (
        <div className="space-y-2 mt-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : hooks.length === 0 ? (
        <Card className="border-border/50 bg-card/40 mt-4">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            <Webhook className="h-8 w-8 mx-auto mb-3 opacity-40" />
            No webhooks yet. Add one to receive real-time call events at your own
            endpoint.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 mt-4">
          {hooks.map((h) => (
            <WebhookRow
              key={h.id}
              hook={h}
              onEdit={() => openEdit(h)}
              onDelete={() => setToDelete(h)}
              onToggle={() => toggleEnabled(h)}
            />
          ))}
        </div>
      )}

      <WebhookDialog
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
        title="Delete this webhook?"
        description="You'll stop receiving call events at this endpoint. This can't be undone."
        confirmLabel="Delete webhook"
        onCancel={() => setToDelete(null)}
        onConfirm={handleDelete}
      />
    </>
  );
}

// ─── Webhook row ────────────────────────────────────────

function WebhookRow({
  hook,
  onEdit,
  onDelete,
  onToggle,
}: {
  hook: GoWebhook;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  // An empty events array means "all events" (the engine treats it that way).
  const events = hook.events.length > 0 ? hook.events : GO_WEBHOOK_EVENTS;
  const allEvents = hook.events.length === 0;
  return (
    <Card className="border-border/50 bg-card/40">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Webhook className="h-4 w-4 text-primary shrink-0" />
              <h3 className="font-semibold truncate">{hook.name}</h3>
              {!hook.enabled && (
                <Badge variant="outline" className="text-[10px]">
                  disabled
                </Badge>
              )}
              {hook.hasSecret && (
                <Badge variant="outline" className="text-[10px] gap-1">
                  <KeyRound className="h-2.5 w-2.5" /> signed
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-1.5 text-sm text-muted-foreground min-w-0">
              <Link2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate font-mono text-xs">{hook.url}</span>
            </div>
            <div className="flex items-center gap-1 mt-2 flex-wrap">
              {allEvents ? (
                <Badge variant="secondary" className="text-[10px]">
                  all events
                </Badge>
              ) : (
                events.map((e) => (
                  <Badge key={e} variant="secondary" className="text-[10px]">
                    {EVENT_META[e]?.label ?? e}
                  </Badge>
                ))
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Switch
              checked={hook.enabled}
              onCheckedChange={onToggle}
              aria-label="Toggle webhook"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onEdit}
              aria-label="Edit webhook"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={onDelete}
              aria-label="Delete webhook"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Webhook dialog ─────────────────────────────────────

function WebhookDialog({
  draft,
  creating,
  onClose,
  onSaved,
}: {
  draft: GoWebhook | null;
  creating: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [events, setEvents] = useState<GoWebhookEvent[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (draft) {
      setName(draft.name);
      setUrl(draft.url);
      setSecret("");
      setEvents(draft.events);
      setEnabled(draft.enabled);
    }
  }, [draft]);

  const toggleEvent = (e: GoWebhookEvent) => {
    setEvents((cur) =>
      cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]
    );
  };

  const validUrl = /^https?:\/\/.+/i.test(url.trim());
  const valid = name.trim() !== "" && validUrl;

  const handleSave = async () => {
    if (!draft || saving || !valid) return;
    setSaving(true);
    const payload: GoWebhookInput = {
      name: name.trim(),
      url: url.trim(),
      events,
      enabled,
    };
    // Only send the secret when the user typed one (a non-empty value rotates
    // the signing key; an empty field leaves the existing secret untouched).
    if (secret.trim() !== "") payload.secret = secret.trim();
    try {
      if (creating) {
        await goApi.webhooks.create(payload);
      } else {
        await goApi.webhooks.update(draft.id, payload);
      }
      onSaved();
    } catch (err) {
      console.error("Failed to save webhook:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!draft} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{creating ? "New webhook" : "Edit webhook"}</DialogTitle>
          <DialogDescription>
            Choose an endpoint and the call events to deliver. Payloads are signed
            with HMAC-SHA256.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <DialogField label="Name" hint="A label to recognize this webhook.">
            <Input
              value={name}
              maxLength={120}
              placeholder="My CRM"
              onChange={(e) => setName(e.target.value)}
            />
          </DialogField>

          <DialogField
            label="Endpoint URL"
            hint={
              url.trim() !== "" && !validUrl
                ? "Must be a valid http(s) URL."
                : "We POST a JSON payload here on each matching event."
            }
          >
            <Input
              value={url}
              maxLength={512}
              placeholder="https://example.com/hooks/calls"
              onChange={(e) => setUrl(e.target.value)}
            />
          </DialogField>

          <DialogField
            label="Events"
            hint="Select which events to receive. None selected = all events."
          >
            <div className="flex flex-wrap gap-1.5">
              {GO_WEBHOOK_EVENTS.map((e) => {
                const on = events.includes(e);
                return (
                  <button
                    key={e}
                    type="button"
                    onClick={() => toggleEvent(e)}
                    title={EVENT_META[e].hint}
                    className={
                      "rounded-full border px-2.5 py-1 text-xs transition-colors " +
                      (on
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border/60 text-muted-foreground hover:bg-muted/50")
                    }
                  >
                    {EVENT_META[e].label}
                  </button>
                );
              })}
            </div>
          </DialogField>

          <DialogField
            label="Signing secret"
            hint={
              creating
                ? "Used to HMAC-SHA256 sign each delivery. Leave blank to auto-generate one."
                : draft?.hasSecret
                ? "A secret is set. Type a new value to rotate it, or leave blank to keep it."
                : "No secret set. Type one to sign deliveries."
            }
          >
            <Input
              type="password"
              value={secret}
              maxLength={200}
              placeholder={draft?.hasSecret ? "•••••••• (unchanged)" : "whsec_…"}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="new-password"
            />
          </DialogField>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 p-3">
            <div>
              <p className="text-sm font-medium">Enabled</p>
              <p className="text-xs text-muted-foreground">
                Disabled webhooks receive no deliveries.
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
            {creating ? "Create webhook" : "Save"}
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

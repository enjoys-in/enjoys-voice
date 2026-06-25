"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Save,
  Loader2,
  Waypoints,
  Workflow,
  PhoneCall,
  PhoneOutgoing,
  Voicemail,
  Bot,
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
  type GoRoutingRule,
  type GoRoutingRuleInput,
  type GoRoutingMatchType,
  type GoRoutingDestinationType,
  type GoAiAgent,
} from "../../lib/go-api";
import type { IvrFlowSummary } from "../ivr/ivr.types";
import { useAuthStore } from "../../stores";

// ─── Routing Tab ────────────────────────────────────────
//
// Per-user, self-service inbound call routing. A user decides where calls
// reaching them go: into one of their own IVR flows, to another extension, out
// to a PSTN number, or straight to voicemail. Rules are strictly owner-scoped —
// every endpoint returns/edits only the caller's own rules, with no admin
// intervention. A matching enabled rule is enforced live by the SIP engine.

const DEST_META: Record<
  GoRoutingDestinationType,
  { label: string; icon: typeof Workflow }
> = {
  ivr: { label: "IVR flow", icon: Workflow },
  extension: { label: "Extension", icon: PhoneCall },
  pstn: { label: "PSTN number", icon: PhoneOutgoing },
  voicemail: { label: "Voicemail", icon: Voicemail },
  ai_agent: { label: "AI agent", icon: Bot },
};

export function RoutingTab() {
  const myExt = useAuthStore((s) => s.user?.extension) ?? "";
  const [rules, setRules] = useState<GoRoutingRule[] | null>(null);
  const [flows, setFlows] = useState<IvrFlowSummary[]>([]);
  const [agents, setAgents] = useState<GoAiAgent[]>([]);
  const [loadErr, setLoadErr] = useState(false);
  const [draft, setDraft] = useState<GoRoutingRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<GoRoutingRule | null>(null);

  const load = async () => {
    try {
      const [list, flowList, agentList] = await Promise.all([
        goApi.routing.list(),
        goApi.ivr.listFlows().catch(() => [] as IvrFlowSummary[]),
        goApi.aiAgents.list().catch(() => [] as GoAiAgent[]),
      ]);
      setRules(list);
      setFlows(flowList);
      setAgents(agentList);
    } catch (err) {
      console.error("Failed to load routing rules:", err);
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
      ownerExtension: myExt,
      matchType: "all",
      matchNumber: "",
      destinationType: "ivr",
      destinationValue: "",
      enabled: true,
      createdAt: "",
      updatedAt: "",
    });
  };

  const openEdit = (rule: GoRoutingRule) => {
    setCreating(false);
    setDraft(rule);
  };

  const toggleEnabled = async (rule: GoRoutingRule) => {
    try {
      await goApi.routing.update(rule.id, { enabled: !rule.enabled });
      await load();
    } catch (err) {
      console.error("Failed to toggle routing rule:", err);
    }
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    const id = toDelete.id;
    setToDelete(null);
    try {
      await goApi.routing.remove(id);
      await load();
    } catch (err) {
      console.error("Failed to delete routing rule:", err);
    }
  };

  if (loadErr) {
    return (
      <>
        <h2 className="text-2xl font-bold">Call Routing</h2>
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm text-muted-foreground">
            Couldn&apos;t load your routing rules. Please try again.
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold">Call Routing</h2>
          <p className="text-sm text-muted-foreground">
            Send your inbound calls to an IVR flow, another extension, a phone
            number, or voicemail.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1.5" /> Add rule
        </Button>
      </div>

      {rules === null ? (
        <div className="space-y-2 mt-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : rules.length === 0 ? (
        <Card className="border-border/50 bg-card/40 mt-4">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            <Waypoints className="h-8 w-8 mx-auto mb-3 opacity-40" />
            No routing rules yet. Add one to send your inbound calls to an IVR
            flow, another extension, a phone number, or voicemail.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 mt-4">
          {rules.map((r) => (
            <RoutingRow
              key={r.id}
              rule={r}
              flows={flows}
              agents={agents}
              onEdit={() => openEdit(r)}
              onDelete={() => setToDelete(r)}
              onToggle={() => toggleEnabled(r)}
            />
          ))}
        </div>
      )}

      <RoutingDialog
        draft={draft}
        creating={creating}
        flows={flows}
        agents={agents}
        myExt={myExt}
        onClose={() => setDraft(null)}
        onSaved={async () => {
          setDraft(null);
          await load();
        }}
      />

      <ConfirmDialog
        open={!!toDelete}
        title="Delete this routing rule?"
        description="Calls will fall back to the default routing. This can't be undone."
        confirmLabel="Delete rule"
        onCancel={() => setToDelete(null)}
        onConfirm={handleDelete}
      />
    </>
  );
}

// ─── Routing row ────────────────────────────────────────

function RoutingRow({
  rule,
  flows,
  agents,
  onEdit,
  onDelete,
  onToggle,
}: {
  rule: GoRoutingRule;
  flows: IvrFlowSummary[];
  agents: GoAiAgent[];
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const meta = DEST_META[rule.destinationType];
  const DestIcon = meta.icon;
  return (
    <Card className="border-border/50 bg-card/40">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Waypoints className="h-4 w-4 text-primary shrink-0" />
              <h3 className="font-semibold truncate">
                {rule.matchType === "all"
                  ? "All inbound calls"
                  : `Calls to ${rule.matchNumber}`}
              </h3>
              {!rule.enabled && (
                <Badge variant="outline" className="text-[10px]">
                  disabled
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-1.5 text-sm text-muted-foreground">
              <DestIcon className="h-3.5 w-3.5 shrink-0" />
              <span>
                {meta.label}
                {describeDestination(rule, flows, agents)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Switch
              checked={rule.enabled}
              onCheckedChange={onToggle}
              aria-label="Toggle rule"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onEdit}
              aria-label="Edit rule"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={onDelete}
              aria-label="Delete rule"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// describeDestination renders the human-readable target for a rule's row.
function describeDestination(
  rule: GoRoutingRule,
  flows: IvrFlowSummary[],
  agents: GoAiAgent[],
): string {
  if (rule.destinationType === "voicemail") return "";
  if (rule.destinationType === "ivr") {
    const flow = flows.find((f) => f.extension === rule.destinationValue);
    return flow ? ` · ${flow.name} (${flow.extension})` : ` · ${rule.destinationValue}`;
  }
  if (rule.destinationType === "ai_agent") {
    const agent = agents.find((a) => String(a.id) === rule.destinationValue);
    return agent ? ` · ${agent.name}` : ` · #${rule.destinationValue}`;
  }
  return ` · ${rule.destinationValue}`;
}

// ─── Routing dialog ─────────────────────────────────────

function RoutingDialog({
  draft,
  creating,
  flows,
  agents,
  myExt,
  onClose,
  onSaved,
}: {
  draft: GoRoutingRule | null;
  creating: boolean;
  flows: IvrFlowSummary[];
  agents: GoAiAgent[];
  myExt: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [matchType, setMatchType] = useState<GoRoutingMatchType>("all");
  const [matchNumber, setMatchNumber] = useState("");
  const [destinationType, setDestinationType] =
    useState<GoRoutingDestinationType>("ivr");
  const [destinationValue, setDestinationValue] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (draft) {
      setMatchType(draft.matchType);
      setMatchNumber(draft.matchNumber ?? "");
      setDestinationType(draft.destinationType);
      setDestinationValue(draft.destinationValue ?? "");
      setEnabled(draft.enabled);
    }
  }, [draft]);

  const needsValue = destinationType !== "voicemail";
  const valid =
    (matchType === "all" || matchNumber.trim() !== "") &&
    (!needsValue || destinationValue.trim() !== "");

  const handleSave = async () => {
    if (!draft || saving || !valid) return;
    setSaving(true);
    const payload: GoRoutingRuleInput = {
      matchType,
      matchNumber: matchType === "number" ? matchNumber.trim() : "",
      destinationType,
      destinationValue: needsValue ? destinationValue.trim() : "",
      enabled,
    };
    try {
      if (creating) {
        await goApi.routing.create(payload);
      } else {
        await goApi.routing.update(draft.id, payload);
      }
      onSaved();
    } catch (err) {
      console.error("Failed to save routing rule:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!draft} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{creating ? "New routing rule" : "Edit routing rule"}</DialogTitle>
          <DialogDescription>
            Choose which inbound calls to match and where to send them.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <DialogField
            label="Match"
            hint={
              matchType === "all"
                ? `Applies to all calls reaching your extension${myExt ? ` (${myExt})` : ""}.`
                : "Applies only when this exact number is dialed."
            }
          >
            <Select
              value={matchType}
              onValueChange={(v) => setMatchType(v as GoRoutingMatchType)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All inbound calls</SelectItem>
                <SelectItem value="number">A specific dialed number</SelectItem>
              </SelectContent>
            </Select>
          </DialogField>

          {matchType === "number" && (
            <DialogField label="Dialed number" hint="e.g. 6000 or a DID you receive on">
              <Input
                value={matchNumber}
                maxLength={40}
                placeholder="6000"
                onChange={(e) => setMatchNumber(e.target.value)}
              />
            </DialogField>
          )}

          <DialogField label="Send to">
            <Select
              value={destinationType}
              onValueChange={(v) => {
                setDestinationType(v as GoRoutingDestinationType);
                setDestinationValue("");
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ivr">IVR flow</SelectItem>
                <SelectItem value="extension">Internal extension</SelectItem>
                <SelectItem value="pstn">PSTN number</SelectItem>
                <SelectItem value="voicemail">Voicemail</SelectItem>
                <SelectItem value="ai_agent">AI agent</SelectItem>
              </SelectContent>
            </Select>
          </DialogField>

          {destinationType === "ivr" && (
            <DialogField
              label="IVR flow"
              hint={
                flows.length === 0
                  ? "You have no IVR flows yet — build one in the IVR builder first."
                  : "One of your own IVR flows."
              }
            >
              <Select
                value={destinationValue}
                onValueChange={(v) => setDestinationValue(v ?? "")}
                disabled={flows.length === 0}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a flow" />
                </SelectTrigger>
                <SelectContent>
                  {flows.map((f) => (
                    <SelectItem key={f.id} value={f.extension}>
                      {f.name} ({f.extension})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </DialogField>
          )}

          {destinationType === "ai_agent" && (
            <DialogField
              label="AI agent"
              hint={
                agents.length === 0
                  ? "You have no AI agents yet — create one in the AI Agents tab first."
                  : "One of your own AI voice agents answers the call."
              }
            >
              <Select
                value={destinationValue}
                onValueChange={(v) => setDestinationValue(v ?? "")}
                disabled={agents.length === 0}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select an agent" />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </DialogField>
          )}

          {destinationType === "extension" && (
            <DialogField label="Extension" hint="An internal extension to ring.">
              <Input
                value={destinationValue}
                maxLength={40}
                placeholder="1002"
                onChange={(e) => setDestinationValue(e.target.value)}
              />
            </DialogField>
          )}

          {destinationType === "pstn" && (
            <DialogField label="PSTN number" hint="An external phone number to forward to.">
              <Input
                value={destinationValue}
                maxLength={40}
                placeholder="+15551234567"
                onChange={(e) => setDestinationValue(e.target.value)}
              />
            </DialogField>
          )}

          {destinationType === "voicemail" && (
            <p className="text-xs text-muted-foreground">
              Matching callers go straight to your voicemail.
            </p>
          )}

          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 p-3">
            <div>
              <p className="text-sm font-medium">Enabled</p>
              <p className="text-xs text-muted-foreground">
                Disabled rules are ignored; calls use the default routing.
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
            {creating ? "Create rule" : "Save"}
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

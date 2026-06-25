"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Save,
  Loader2,
  Bot,
  Mic,
  Brain,
  Volume2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
  GO_AI_AGENT_STT_PROVIDERS,
  GO_AI_AGENT_LLM_PROVIDERS,
  GO_AI_AGENT_TTS_PROVIDERS,
  type GoAiAgent,
  type GoAiAgentInput,
} from "../../lib/go-api";

// ─── AI Agents Tab ──────────────────────────────────────
//
// Per-user, self-service AI voice agents. A user defines an agent's persona
// (greeting + system prompt) and picks the speech-to-text, LLM, and
// text-to-speech providers. When an inbound call falls through to AI (the owner
// is offline, or a routing rule / IVR node selects an agent), the media engine
// builds a brain from this config per call. Provider API keys are NOT stored
// here — they live server-side in the engine's env — so nothing here is secret.

export function AiAgentsTab() {
  const [agents, setAgents] = useState<GoAiAgent[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [draft, setDraft] = useState<GoAiAgent | null>(null);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<GoAiAgent | null>(null);

  const load = async () => {
    try {
      setAgents(await goApi.aiAgents.list());
    } catch (err) {
      console.error("Failed to load AI agents:", err);
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
      greeting: "",
      language: "en",
      sttProvider: GO_AI_AGENT_STT_PROVIDERS[0],
      llmProvider: GO_AI_AGENT_LLM_PROVIDERS[0],
      llmModel: "gpt-4o-mini",
      systemPrompt: "",
      temperature: 0.7,
      ttsProvider: GO_AI_AGENT_TTS_PROVIDERS[1], // deepgram
      ttsVoice: "",
      enabled: true,
      createdAt: "",
      updatedAt: "",
    });
  };

  const openEdit = (agent: GoAiAgent) => {
    setCreating(false);
    setDraft(agent);
  };

  const toggleEnabled = async (agent: GoAiAgent) => {
    try {
      await goApi.aiAgents.update(agent.id, { enabled: !agent.enabled });
      await load();
    } catch (err) {
      console.error("Failed to toggle AI agent:", err);
    }
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    const id = toDelete.id;
    setToDelete(null);
    try {
      await goApi.aiAgents.remove(id);
      await load();
    } catch (err) {
      console.error("Failed to delete AI agent:", err);
    }
  };

  if (loadErr) {
    return (
      <>
        <h2 className="text-2xl font-bold">AI Agents</h2>
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm text-muted-foreground">
            Couldn&apos;t load your AI agents. Please try again.
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold">AI Agents</h2>
          <p className="text-sm text-muted-foreground">
            Build a voice agent that answers your calls — pick its persona and the
            speech, language-model, and voice providers. Attach an agent to a
            routing rule, an IVR node, or use it as your offline fallback.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1.5" /> Add agent
        </Button>
      </div>

      {agents === null ? (
        <div className="space-y-2 mt-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : agents.length === 0 ? (
        <Card className="border-border/50 bg-card/40 mt-4">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            <Bot className="h-8 w-8 mx-auto mb-3 opacity-40" />
            No AI agents yet. Add one to let a voice agent answer your calls.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 mt-4">
          {agents.map((a) => (
            <AgentRow
              key={a.id}
              agent={a}
              onEdit={() => openEdit(a)}
              onDelete={() => setToDelete(a)}
              onToggle={() => toggleEnabled(a)}
            />
          ))}
        </div>
      )}

      <AgentDialog
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
        title="Delete this AI agent?"
        description="Calls that use this agent will fall back to the default voice agent. This can't be undone."
        confirmLabel="Delete agent"
        onCancel={() => setToDelete(null)}
        onConfirm={handleDelete}
      />
    </>
  );
}

// ─── Agent row ──────────────────────────────────────────

function AgentRow({
  agent,
  onEdit,
  onDelete,
  onToggle,
}: {
  agent: GoAiAgent;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  return (
    <Card className="border-border/50 bg-card/40">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Bot className="h-4 w-4 text-primary shrink-0" />
              <h3 className="font-semibold truncate">{agent.name}</h3>
              <Badge variant="outline" className="text-[10px] uppercase">
                {agent.language}
              </Badge>
              {!agent.enabled && (
                <Badge variant="outline" className="text-[10px]">
                  disabled
                </Badge>
              )}
            </div>
            {agent.greeting && (
              <p className="mt-1.5 text-sm text-muted-foreground line-clamp-1">
                “{agent.greeting}”
              </p>
            )}
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              <Badge variant="secondary" className="text-[10px] gap-1">
                <Mic className="h-2.5 w-2.5" /> {agent.sttProvider}
              </Badge>
              <Badge variant="secondary" className="text-[10px] gap-1">
                <Brain className="h-2.5 w-2.5" /> {agent.llmProvider}
                {agent.llmModel ? ` · ${agent.llmModel}` : ""}
              </Badge>
              <Badge variant="secondary" className="text-[10px] gap-1">
                <Volume2 className="h-2.5 w-2.5" /> {agent.ttsProvider}
                {agent.ttsVoice ? ` · ${agent.ttsVoice}` : ""}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Switch
              checked={agent.enabled}
              onCheckedChange={onToggle}
              aria-label="Toggle agent"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onEdit}
              aria-label="Edit agent"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={onDelete}
              aria-label="Delete agent"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Agent dialog ───────────────────────────────────────

function AgentDialog({
  draft,
  creating,
  onClose,
  onSaved,
}: {
  draft: GoAiAgent | null;
  creating: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [greeting, setGreeting] = useState("");
  const [language, setLanguage] = useState("en");
  const [sttProvider, setSttProvider] = useState<string>(GO_AI_AGENT_STT_PROVIDERS[0]);
  const [llmProvider, setLlmProvider] = useState<string>(GO_AI_AGENT_LLM_PROVIDERS[0]);
  const [llmModel, setLlmModel] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [temperature, setTemperature] = useState("0.7");
  const [ttsProvider, setTtsProvider] = useState<string>(GO_AI_AGENT_TTS_PROVIDERS[1]);
  const [ttsVoice, setTtsVoice] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (draft) {
      setName(draft.name);
      setGreeting(draft.greeting);
      setLanguage(draft.language || "en");
      setSttProvider(draft.sttProvider || GO_AI_AGENT_STT_PROVIDERS[0]);
      setLlmProvider(draft.llmProvider || GO_AI_AGENT_LLM_PROVIDERS[0]);
      setLlmModel(draft.llmModel);
      setSystemPrompt(draft.systemPrompt);
      setTemperature(String(draft.temperature ?? 0.7));
      setTtsProvider(draft.ttsProvider || GO_AI_AGENT_TTS_PROVIDERS[1]);
      setTtsVoice(draft.ttsVoice);
      setEnabled(draft.enabled);
    }
  }, [draft]);

  const tempNum = Number(temperature);
  const tempValid = Number.isFinite(tempNum) && tempNum >= 0 && tempNum <= 2;
  const valid = name.trim() !== "" && tempValid;

  const handleSave = async () => {
    if (!draft || saving || !valid) return;
    setSaving(true);
    const payload: GoAiAgentInput = {
      name: name.trim(),
      greeting: greeting.trim(),
      language: language.trim() || "en",
      sttProvider,
      llmProvider,
      llmModel: llmModel.trim(),
      systemPrompt: systemPrompt.trim(),
      temperature: tempNum,
      ttsProvider,
      ttsVoice: ttsVoice.trim(),
      enabled,
    };
    try {
      if (creating) {
        await goApi.aiAgents.create(payload);
      } else {
        await goApi.aiAgents.update(draft.id, payload);
      }
      onSaved();
    } catch (err) {
      console.error("Failed to save AI agent:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!draft} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{creating ? "New AI agent" : "Edit AI agent"}</DialogTitle>
          <DialogDescription>
            Define the persona and choose the speech, language-model, and voice
            providers. API keys are configured server-side.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <DialogField label="Name" hint="A label to recognize this agent.">
            <Input
              value={name}
              maxLength={120}
              placeholder="Front desk"
              onChange={(e) => setName(e.target.value)}
            />
          </DialogField>

          <DialogField
            label="Greeting"
            hint="Spoken to the caller when the agent answers."
          >
            <Textarea
              value={greeting}
              maxLength={500}
              rows={2}
              placeholder="Hi, thanks for calling. How can I help you today?"
              onChange={(e) => setGreeting(e.target.value)}
            />
          </DialogField>

          <div className="grid grid-cols-2 gap-3">
            <DialogField label="Language" hint="STT/TTS language tag, e.g. en.">
              <Input
                value={language}
                maxLength={16}
                placeholder="en"
                onChange={(e) => setLanguage(e.target.value)}
              />
            </DialogField>
            <DialogField
              label="Temperature"
              hint={tempValid ? "LLM creativity, 0–2." : "Must be 0–2."}
            >
              <Input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
              />
            </DialogField>
          </div>

          <DialogField label="Speech-to-text" hint="Transcribes the caller.">
            <ChipSelect
              options={GO_AI_AGENT_STT_PROVIDERS}
              value={sttProvider}
              onChange={setSttProvider}
            />
          </DialogField>

          <DialogField label="Language model" hint="Generates the agent's replies.">
            <ChipSelect
              options={GO_AI_AGENT_LLM_PROVIDERS}
              value={llmProvider}
              onChange={setLlmProvider}
            />
          </DialogField>

          <DialogField
            label="Model"
            hint="Model id for the chosen LLM, e.g. gpt-4o-mini or gemini-1.5-flash."
          >
            <Input
              value={llmModel}
              maxLength={120}
              placeholder="gpt-4o-mini"
              onChange={(e) => setLlmModel(e.target.value)}
            />
          </DialogField>

          <DialogField
            label="System prompt"
            hint="Shapes the agent's persona and task."
          >
            <Textarea
              value={systemPrompt}
              maxLength={4000}
              rows={4}
              placeholder="You are a friendly receptionist for Acme Inc. Keep replies short and helpful."
              onChange={(e) => setSystemPrompt(e.target.value)}
            />
          </DialogField>

          <DialogField label="Text-to-speech" hint="Speaks the agent's replies.">
            <ChipSelect
              options={GO_AI_AGENT_TTS_PROVIDERS}
              value={ttsProvider}
              onChange={setTtsProvider}
            />
          </DialogField>

          <DialogField
            label="Voice"
            hint="Provider-specific voice id. Leave blank for the provider default."
          >
            <Input
              value={ttsVoice}
              maxLength={120}
              placeholder="aura-2-thalia-en"
              onChange={(e) => setTtsVoice(e.target.value)}
            />
          </DialogField>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 p-3">
            <div>
              <p className="text-sm font-medium">Enabled</p>
              <p className="text-xs text-muted-foreground">
                Disabled agents are never selected to answer calls.
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
            {creating ? "Create agent" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Shared bits ────────────────────────────────────────

/** Single-select pill group (shadcn has no Checkbox here, so we use chips). */
function ChipSelect({
  options,
  value,
  onChange,
}: {
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = o === value;
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            className={
              "rounded-full border px-3 py-1 text-xs capitalize transition-colors " +
              (on
                ? "border-primary bg-primary/15 text-primary"
                : "border-border/60 text-muted-foreground hover:bg-muted/50")
            }
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

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

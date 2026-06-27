/**
 * Right inspector — edit the selected node's properties.
 *
 * Renders a different form per node kind. The menu editor exposes the core
 * "press a digit → branch" model: each option is a digit + label whose source
 * handle is wired to the next node on the canvas.
 */
"use client";

import { useEffect, useState } from "react";
import { Trash2, Plus } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { goApi, type GoConnector, type GoAiAgent } from "../../../lib/go-api";
import { useBuilderStore } from "../store/builder.store";
import {
  NODE_META,
  OPERATOR_LABELS,
  VARIABLE_LABELS,
} from "../ivr.constants";
import {
  CONDITION_OPERATORS,
  CONDITION_VARIABLES,
  DTMF_DIGITS,
  type ConditionOperator,
  type ConditionVariable,
  type DtmfDigit,
  type EmailNodeData,
  type AiAgentNodeData,
  type IvrNode,
} from "../ivr.types";
import { PromptEditor } from "./PromptEditor";

// ─── small field helpers ────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (n: number) => void;
}) {
  return (
    <Field label={label}>
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="text-sm"
      />
    </Field>
  );
}

// ─── inspector ──────────────────────────────────────────

export function NodeInspector() {
  const node = useBuilderStore((s) =>
    s.nodes.find((n) => n.id === s.selectedNodeId) ?? null,
  );
  const updateNodeData = useBuilderStore((s) => s.updateNodeData);
  const removeNode = useBuilderStore((s) => s.removeNode);
  const addMenuOption = useBuilderStore((s) => s.addMenuOption);
  const updateMenuOption = useBuilderStore((s) => s.updateMenuOption);
  const removeMenuOption = useBuilderStore((s) => s.removeMenuOption);
  const readOnly = useBuilderStore((s) => s.readOnly);

  if (!node) {
    return (
      <div className="w-80 shrink-0 border-l border-border/50 bg-card/30 p-4">
        <p className="text-sm text-muted-foreground">
          Select a block to edit its properties.
        </p>
      </div>
    );
  }

  const meta = NODE_META[node.data.kind];
  const Icon = meta.icon;

  return (
    <div className="flex w-80 shrink-0 flex-col border-l border-border/50 bg-card/30">
      <div className="flex items-center gap-2 border-b border-border/50 p-3">
        <Icon className={cn("h-4 w-4", meta.accent.split(" ")[0])} />
        <span className="flex-1 text-sm font-semibold">{meta.title}</span>
        {node.data.kind !== "start" && !readOnly && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={() => removeNode(node.id)}
            title="Delete block"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <fieldset disabled={readOnly} className="flex-1 space-y-4 overflow-y-auto p-4 min-w-0">
        <Field label="Label">
          <Input
            value={node.data.label}
            onChange={(e) => updateNodeData(node.id, { label: e.target.value })}
            className="text-sm"
          />
        </Field>

        <NodeFields
          node={node}
          updateNodeData={updateNodeData}
          addMenuOption={addMenuOption}
          updateMenuOption={updateMenuOption}
          removeMenuOption={removeMenuOption}
        />
      </fieldset>
    </div>
  );
}

// ─── per-kind fields ────────────────────────────────────

function NodeFields({
  node,
  updateNodeData,
  addMenuOption,
  updateMenuOption,
  removeMenuOption,
}: {
  node: IvrNode;
  updateNodeData: (id: string, patch: Record<string, unknown>) => void;
  addMenuOption: (nodeId: string, digit: DtmfDigit) => void;
  updateMenuOption: (
    nodeId: string,
    optionId: string,
    patch: Partial<{ digit: DtmfDigit; label: string }>,
  ) => void;
  removeMenuOption: (nodeId: string, optionId: string) => void;
}) {
  const data = node.data;

  switch (data.kind) {
    case "start":
      return (
        <>
          <Field label="Entry extension (DID)">
            <Input
              value={data.extension}
              placeholder="e.g. 6000"
              onChange={(e) => updateNodeData(node.id, { extension: e.target.value })}
              className="text-sm font-mono"
            />
          </Field>
          <PromptEditor
            label="Greeting"
            value={data.greeting}
            onChange={(greeting) => updateNodeData(node.id, { greeting })}
          />
        </>
      );

    case "menu": {
      // Digits not yet used, offered when adding a new option.
      const used = new Set(data.options.map((o) => o.digit));
      const nextDigit = DTMF_DIGITS.find((d) => !used.has(d)) ?? "0";
      return (
        <>
          <PromptEditor
            label="Prompt (text to say)"
            value={data.prompt}
            onChange={(prompt) => updateNodeData(node.id, { prompt })}
          />
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Tries"
              value={data.tries}
              min={1}
              max={5}
              onChange={(tries) => updateNodeData(node.id, { tries })}
            />
            <NumberField
              label="Timeout (ms)"
              value={data.timeoutMs}
              min={1000}
              max={30000}
              onChange={(timeoutMs) => updateNodeData(node.id, { timeoutMs })}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Options (press → branch)</Label>
              <span className="font-mono text-[11px] text-muted-foreground">
                valid: {data.validDigits || "—"}
              </span>
            </div>

            {data.options.map((opt) => (
              <div key={opt.id} className="flex items-center gap-2">
                <Select
                  value={opt.digit}
                  onValueChange={(digit) =>
                    updateMenuOption(node.id, opt.id, {
                      digit: digit as DtmfDigit,
                    })
                  }
                >
                  <SelectTrigger className="h-8 w-16 font-mono">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DTMF_DIGITS.map((d) => (
                      <SelectItem key={d} value={d} className="font-mono">
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={opt.label}
                  placeholder="Label (e.g. Sales)"
                  onChange={(e) =>
                    updateMenuOption(node.id, opt.id, { label: e.target.value })
                  }
                  className="h-8 flex-1 text-sm"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => removeMenuOption(node.id, opt.id)}
                  title="Remove option"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}

            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => addMenuOption(node.id, nextDigit)}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Add option
            </Button>
            <p className="text-[11px] text-muted-foreground/70">
              Drag from each option’s handle on the canvas to the block it should
              route to.
            </p>
          </div>
        </>
      );
    }

    case "play":
      return (
        <>
          <PromptEditor
            label="Message"
            value={data.prompt}
            onChange={(prompt) => updateNodeData(node.id, { prompt })}
          />
          <div className="flex items-center justify-between">
            <Label className="text-xs">Allow barge-in</Label>
            <Switch
              checked={data.bargeIn}
              onCheckedChange={(bargeIn) => updateNodeData(node.id, { bargeIn })}
            />
          </div>
        </>
      );

    case "condition": {
      const valueHint =
        data.operator === "in_range"
          ? "min,max (e.g. 9,17)"
          : data.operator === "regex"
            ? "pattern (e.g. ^1800)"
            : "value to match";
      return (
        <>
          <Field label="Variable to test">
            <Select
              value={data.variable}
              onValueChange={(variable) =>
                updateNodeData(node.id, {
                  variable: variable as ConditionVariable,
                })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONDITION_VARIABLES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {VARIABLE_LABELS[v]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {data.variable === "custom" && (
            <Field label="Channel variable name">
              <Input
                value={data.customVariable ?? ""}
                placeholder="e.g. vip_caller"
                onChange={(e) =>
                  updateNodeData(node.id, { customVariable: e.target.value })
                }
                className="text-sm font-mono"
              />
            </Field>
          )}

          <Field label="Operator">
            <Select
              value={data.operator}
              onValueChange={(operator) =>
                updateNodeData(node.id, {
                  operator: operator as ConditionOperator,
                })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONDITION_OPERATORS.map((op) => (
                  <SelectItem key={op} value={op}>
                    {OPERATOR_LABELS[op]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Value">
            <Input
              value={data.value}
              placeholder={valueHint}
              onChange={(e) => updateNodeData(node.id, { value: e.target.value })}
              className="text-sm font-mono"
            />
          </Field>

          <div className="flex items-center justify-between">
            <Label className="text-xs">Ignore case</Label>
            <Switch
              checked={data.ignoreCase}
              onCheckedChange={(ignoreCase) =>
                updateNodeData(node.id, { ignoreCase })
              }
            />
          </div>

          <p className="text-[11px] text-muted-foreground/70">
            Wire the{" "}
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              if true
            </span>{" "}
            and{" "}
            <span className="font-medium text-rose-600 dark:text-rose-400">
              else
            </span>{" "}
            handles to the next blocks.
          </p>
        </>
      );
    }

    case "transfer":
      return (
        <>
          <Field label="Department">
            <Input
              value={data.department ?? ""}
              placeholder="e.g. sales"
              onChange={(e) => updateNodeData(node.id, { department: e.target.value })}
              className="text-sm"
            />
          </Field>
          <Field label="Or extension">
            <Input
              value={data.extension ?? ""}
              placeholder="e.g. 1001"
              onChange={(e) => updateNodeData(node.id, { extension: e.target.value })}
              className="text-sm font-mono"
            />
          </Field>
          <NumberField
            label="Ring seconds"
            value={data.ringSeconds}
            min={5}
            max={120}
            onChange={(ringSeconds) => updateNodeData(node.id, { ringSeconds })}
          />
          <div className="flex items-center justify-between">
            <Label className="text-xs">Attended transfer</Label>
            <Switch
              checked={data.attended}
              onCheckedChange={(attended) => updateNodeData(node.id, { attended })}
            />
          </div>
        </>
      );

    case "voicemail":
      return (
        <>
          <Field label="Mailbox (blank = caller ext)">
            <Input
              value={data.mailbox ?? ""}
              placeholder="e.g. 1001"
              onChange={(e) => updateNodeData(node.id, { mailbox: e.target.value })}
              className="text-sm font-mono"
            />
          </Field>
          <NumberField
            label="Max seconds"
            value={data.maxSeconds}
            min={10}
            max={600}
            onChange={(maxSeconds) => updateNodeData(node.id, { maxSeconds })}
          />
          <PromptEditor
            label="Greeting"
            value={data.greeting}
            onChange={(greeting) => updateNodeData(node.id, { greeting })}
          />
        </>
      );

    case "email":
      return (
        <EmailFields
          nodeId={node.id}
          data={data}
          updateNodeData={updateNodeData}
        />
      );

    case "ai_agent":
      return (
        <AiAgentFields
          nodeId={node.id}
          data={data}
          updateNodeData={updateNodeData}
        />
      );

    case "hangup":
      return (
        <p className="text-sm text-muted-foreground">
          This block ends the call. No further configuration.
        </p>
      );
  }
}

// ─── email (experimental) ───────────────────────────────

function EmailFields({
  nodeId,
  data,
  updateNodeData,
}: {
  nodeId: string;
  data: EmailNodeData;
  updateNodeData: (id: string, patch: Record<string, unknown>) => void;
}) {
  const [connectors, setConnectors] = useState<GoConnector[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    goApi.connectors
      .list()
      .then((all) => {
        if (active) setConnectors(all.filter((c) => c.type === "email"));
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "Failed to load connectors");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
        Experimental — sends an email through the selected connector when a call
        reaches this block, then continues the flow.
      </p>

      <Field label="Email connector">
        <Select
          value={data.connectorId || undefined}
          onValueChange={(connectorId) =>
            updateNodeData(nodeId, { connectorId })
          }
          disabled={loading || connectors.length === 0}
        >
          <SelectTrigger className="w-full">
            <SelectValue
              placeholder={
                loading
                  ? "Loading…"
                  : connectors.length === 0
                    ? "No email connectors"
                    : "Select a connector"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {connectors.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name}
                {!c.enabled && " (disabled)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {error && (
          <p className="text-[11px] text-destructive">{error}</p>
        )}
        {!loading && !error && connectors.length === 0 && (
          <p className="text-[11px] text-muted-foreground/70">
            Add an email connector under Admin → Connectors first.
          </p>
        )}
      </Field>

      <Field label="To">
        <Input
          value={data.to}
          placeholder="ops@example.com, ${caller_id}"
          onChange={(e) => updateNodeData(nodeId, { to: e.target.value })}
          className="text-sm"
        />
      </Field>

      <Field label="Subject">
        <Input
          value={data.subject}
          placeholder="New IVR call"
          onChange={(e) => updateNodeData(nodeId, { subject: e.target.value })}
          className="text-sm"
        />
      </Field>

      <Field label="Body">
        <Textarea
          value={data.body}
          rows={4}
          placeholder="Message body. You can reference ${caller_id}, ${destination_number}…"
          onChange={(e) => updateNodeData(nodeId, { body: e.target.value })}
          className="text-sm"
        />
      </Field>
    </>
  );
}

// ─── ai agent ───────────────────────────────────────────

function AiAgentFields({
  nodeId,
  data,
  updateNodeData,
}: {
  nodeId: string;
  data: AiAgentNodeData;
  updateNodeData: (id: string, patch: Record<string, unknown>) => void;
}) {
  const [agents, setAgents] = useState<GoAiAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    goApi.aiAgents
      .list()
      .then((all) => {
        if (active) setAgents(all);
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "Failed to load AI agents");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <p className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-2 text-[11px] leading-snug text-cyan-700 dark:text-cyan-400">
        Hands the live call to an AI voice agent. The agent talks with the caller
        and owns the call from here — this is a terminal block.
      </p>

      <Field label="AI agent">
        <Select
          value={data.agentId || undefined}
          onValueChange={(agentId) => updateNodeData(nodeId, { agentId })}
          disabled={loading || agents.length === 0}
        >
          <SelectTrigger className="w-full">
            <SelectValue
              placeholder={
                loading
                  ? "Loading…"
                  : agents.length === 0
                    ? "No AI agents"
                    : "Select an agent"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {agents.map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>
                {a.name}
                {!a.enabled && " (disabled)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {error && <p className="text-[11px] text-destructive">{error}</p>}
        {!loading && !error && agents.length === 0 && (
          <p className="text-[11px] text-muted-foreground/70">
            Create an AI agent under Admin → AI Agents first.
          </p>
        )}
      </Field>
    </>
  );
}


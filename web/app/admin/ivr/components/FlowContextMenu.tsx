/**
 * Custom right-click context menu for the IVR canvas.
 *
 * Three flavours depending on what was right-clicked:
 *   • node  → Copy / Cut / Duplicate / Delete   (Start is locked)
 *   • edge  → Delete connection
 *   • pane  → Paste / Add block ▸ / Fit view / Clear canvas
 *
 * Positioned `fixed` at the cursor and clamped into the viewport.
 */
"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { useReactFlow } from "@xyflow/react";
import {
  Copy,
  Scissors,
  CopyPlus,
  ClipboardPaste,
  Trash2,
  Maximize2,
  Eraser,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";

import { useBuilderStore } from "../store/builder.store";
import { NODE_META, PALETTE_KINDS } from "../ivr.constants";

export type FlowMenuState =
  | { type: "node"; nodeId: string; x: number; y: number }
  | { type: "edge"; edgeId: string; x: number; y: number }
  | { type: "pane"; x: number; y: number }
  | null;

// ─── primitives ─────────────────────────────────────────

function MenuItem({
  icon: Icon,
  label,
  shortcut,
  onClick,
  disabled,
  danger,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        disabled
          ? "cursor-not-allowed text-muted-foreground/40"
          : danger
            ? "text-destructive hover:bg-destructive/10"
            : "hover:bg-accent",
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      {shortcut && (
        <span className="ml-3 font-mono text-[10px] text-muted-foreground/70">
          {shortcut}
        </span>
      )}
    </button>
  );
}

function Separator() {
  return <div className="my-1 h-px bg-border/60" />;
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
      {children}
    </div>
  );
}

// ─── menu ────────────────────────────────────────────────

export function FlowContextMenu({
  menu,
  onClose,
}: {
  menu: FlowMenuState;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: -9999, y: -9999 });

  const { fitView, screenToFlowPosition } = useReactFlow();
  const nodes = useBuilderStore((s) => s.nodes);
  const clipboard = useBuilderStore((s) => s.clipboard);
  const copyNode = useBuilderStore((s) => s.copyNode);
  const cutNode = useBuilderStore((s) => s.cutNode);
  const pasteNode = useBuilderStore((s) => s.pasteNode);
  const duplicateNode = useBuilderStore((s) => s.duplicateNode);
  const removeNode = useBuilderStore((s) => s.removeNode);
  const removeEdge = useBuilderStore((s) => s.removeEdge);
  const addNode = useBuilderStore((s) => s.addNode);
  const clearAll = useBuilderStore((s) => s.clearAll);

  // Clamp into the viewport before paint (no flash).
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const { offsetWidth: w, offsetHeight: h } = ref.current;
    setPos({
      x: Math.max(8, Math.min(menu.x, window.innerWidth - w - 8)),
      y: Math.max(8, Math.min(menu.y, window.innerHeight - h - 8)),
    });
  }, [menu]);

  // Dismiss on Escape / scroll / resize.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  let body: React.ReactNode = null;

  if (menu.type === "node") {
    const node = nodes.find((n) => n.id === menu.nodeId);
    const isStart = node?.type === "start";
    body = isStart ? (
      <>
        <GroupLabel>Entry node</GroupLabel>
        <MenuItem icon={Lock} label="Locked — cannot be removed" disabled />
      </>
    ) : (
      <>
        <MenuItem icon={Copy} label="Copy" shortcut="Ctrl C" onClick={run(() => copyNode(menu.nodeId))} />
        <MenuItem icon={Scissors} label="Cut" shortcut="Ctrl X" onClick={run(() => cutNode(menu.nodeId))} />
        <MenuItem icon={CopyPlus} label="Duplicate" shortcut="Ctrl D" onClick={run(() => duplicateNode(menu.nodeId))} />
        <Separator />
        <MenuItem icon={Trash2} label="Delete" shortcut="Del" danger onClick={run(() => removeNode(menu.nodeId))} />
      </>
    );
  } else if (menu.type === "edge") {
    body = (
      <MenuItem
        icon={Trash2}
        label="Delete connection"
        shortcut="Del"
        danger
        onClick={run(() => removeEdge(menu.edgeId))}
      />
    );
  } else {
    const flowPos = screenToFlowPosition({ x: menu.x, y: menu.y });
    body = (
      <>
        <MenuItem
          icon={ClipboardPaste}
          label="Paste"
          shortcut="Ctrl V"
          disabled={!clipboard}
          onClick={run(() => pasteNode(flowPos))}
        />
        <Separator />
        <GroupLabel>Add block</GroupLabel>
        {PALETTE_KINDS.map((kind) => {
          const meta = NODE_META[kind];
          return (
            <MenuItem
              key={kind}
              icon={meta.icon}
              label={meta.title}
              onClick={run(() => addNode(kind, flowPos))}
            />
          );
        })}
        <Separator />
        <MenuItem icon={Maximize2} label="Fit view" onClick={run(() => fitView({ duration: 300 }))} />
        <MenuItem
          icon={Eraser}
          label="Clear canvas"
          danger
          onClick={run(() => {
            if (window.confirm("Remove all blocks except Start?")) clearAll();
          })}
        />
      </>
    );
  }

  return (
    <div
      ref={ref}
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-50 min-w-47.5 rounded-lg border border-border/70 bg-popover p-1 text-popover-foreground shadow-lg"
      onContextMenu={(e) => e.preventDefault()}
    >
      {body}
    </div>
  );
}

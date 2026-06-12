/**
 * IVR admin route: lists flows, or opens the visual builder for one.
 */
"use client";

import { useState } from "react";
import { FlowList } from "./components/FlowList";
import { IvrBuilder } from "./components/IvrBuilder";
import { useBuilderStore } from "./store/builder.store";
import { ivrApi } from "./ivr.api";

export default function IvrPage() {
  const [editing, setEditing] = useState(false);
  const loadFlow = useBuilderStore((s) => s.loadFlow);
  const startNewFlow = useBuilderStore((s) => s.startNewFlow);
  const reset = useBuilderStore((s) => s.reset);

  const openFlow = async (id: string) => {
    const flow = await ivrApi.getFlow(id);
    if (flow) {
      loadFlow(flow);
      setEditing(true);
    }
  };

  const createFlow = (name: string, extension: string) => {
    startNewFlow(name, extension);
    setEditing(true);
  };

  const back = () => {
    reset();
    setEditing(false);
  };

  if (editing) return <IvrBuilder onBack={back} />;

  return (
    <div className="min-h-dvh">
      <div className="border-b border-border/50 px-6 py-3">
        <a href="/admin" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to Admin
        </a>
      </div>
      <FlowList onOpen={openFlow} onCreate={createFlow} />
    </div>
  );
}

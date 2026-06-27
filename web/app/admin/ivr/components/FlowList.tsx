/**
 * Flow list — shows saved IVR flows and a "create" dialog.
 */
"use client";

import { useEffect, useState } from "react";
import { Plus, Phone, Trash2, Pencil, PhoneIncoming } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ivrApi } from "../ivr.api";
import type { IvrFlowSummary } from "../ivr.types";

/**
 * The seeded demo IVR on extension 5000 is the always-available example flow
 * (see server/migrations/002_seed_demo_ivr.sql). It must not be deletable, so
 * its delete button is hidden in the list.
 */
function isProtectedFlow(f: IvrFlowSummary): boolean {
  return f.id === "demo-ivr-5000" || f.extension === "5000";
}

export function FlowList({
  onOpen,
  onCreate,
  canEdit = true,
}: {
  onOpen: (id: string) => void;
  onCreate: (name: string, extension: string) => void;
  canEdit?: boolean;
}) {
  const [flows, setFlows] = useState<IvrFlowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [extension, setExtension] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      setFlows(await ivrApi.listFlows());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = () => {
    if (!name.trim() || !extension.trim()) return;
    onCreate(name.trim(), extension.trim());
    setShowCreate(false);
    setName("");
    setExtension("");
  };

  const handleDelete = async (id: string) => {
    await ivrApi.deleteFlow(id);
    load();
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold">
            <PhoneIncoming className="h-6 w-6 text-primary" />
            IVR Flows
          </h2>
          <p className="text-sm text-muted-foreground">
            Visual call-flow agents. Each flow answers one entry extension.
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="mr-1 h-4 w-4" /> New flow
          </Button>
        )}
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : flows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <PhoneIncoming className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              {canEdit ? "No flows yet. Create your first IVR agent." : "No flows yet."}
            </p>
            {canEdit && (
              <Button onClick={() => setShowCreate(true)}>
                <Plus className="mr-1 h-4 w-4" /> New flow
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {flows.map((f) => (
            <Card key={f.id} className="group transition-colors hover:border-primary/40">
              <CardContent className="flex items-start justify-between gap-3 p-4">
                <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(f.id)}>
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{f.name}</span>
                    <Badge variant={f.enabled ? "default" : "secondary"}>
                      {f.enabled ? "on" : "off"}
                    </Badge>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1 font-mono">
                      <Phone className="h-3 w-3" /> {f.extension}
                    </span>
                    <span>{f.nodeCount} blocks</span>
                  </div>
                </button>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => onOpen(f.id)}
                    title={canEdit ? "Edit" : "View"}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {canEdit && !isProtectedFlow(f) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(f.id)}
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New IVR flow</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Flow name</Label>
              <Input
                value={name}
                placeholder="e.g. Main reception"
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Entry extension (DID)</Label>
              <Input
                value={extension}
                placeholder="e.g. 6000"
                className="font-mono"
                onChange={(e) => setExtension(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!name.trim() || !extension.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

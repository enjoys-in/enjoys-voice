/**
 * Builder toolbar — flow name, entry extension, enabled toggle, save / back.
 */
"use client";

import { ArrowLeft, Save, Loader2, Eye } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useBuilderStore } from "../store/builder.store";

export function Toolbar({ onBack }: { onBack: () => void }) {
  const name = useBuilderStore((s) => s.name);
  const extension = useBuilderStore((s) => s.extension);
  const enabled = useBuilderStore((s) => s.enabled);
  const dirty = useBuilderStore((s) => s.dirty);
  const saving = useBuilderStore((s) => s.saving);
  const readOnly = useBuilderStore((s) => s.readOnly);
  const setMeta = useBuilderStore((s) => s.setMeta);
  const save = useBuilderStore((s) => s.save);

  return (
    <div className="flex items-center gap-3 border-b border-border/50 bg-card/40 px-4 py-2.5">
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack} title="Back to flows">
        <ArrowLeft className="h-4 w-4" />
      </Button>

      <Input
        value={name}
        placeholder="Flow name"
        onChange={(e) => setMeta({ name: e.target.value })}
        disabled={readOnly}
        className="h-8 w-52 text-sm font-medium"
      />

      <div className="flex items-center gap-1.5">
        <Label className="text-xs text-muted-foreground">Ext</Label>
        <Input
          value={extension}
          placeholder="6000"
          onChange={(e) => setMeta({ extension: e.target.value })}
          disabled={readOnly}
          className="h-8 w-24 text-sm font-mono"
        />
      </div>

      <div className="flex items-center gap-1.5">
        <Label className="text-xs text-muted-foreground">Enabled</Label>
        <Switch checked={enabled} disabled={readOnly} onCheckedChange={(v) => setMeta({ enabled: v })} />
      </div>

      <div className="ml-auto flex items-center gap-2">
        {readOnly ? (
          <Badge variant="secondary" className="gap-1">
            <Eye className="h-3.5 w-3.5" />
            Read-only
          </Badge>
        ) : (
          <>
            {dirty && <span className="text-xs text-amber-500">Unsaved changes</span>}
            <Button size="sm" onClick={() => save()} disabled={saving || !dirty}>
              {saving ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1 h-4 w-4" />
              )}
              Save
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

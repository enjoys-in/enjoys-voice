/**
 * Builder toolbar — flow name, entry extension, enabled toggle, save / back.
 */
"use client";

import { useRef, useState } from "react";
import { ArrowLeft, Save, Loader2, Eye, Download, Upload } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useBuilderStore } from "../store/builder.store";

/** Turn a flow name/extension into a filesystem-safe file stem. */
function safeFileStem(name: string, extension: string): string {
  const base = (name || extension || "ivr-flow").trim();
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `ivr-${slug || "flow"}`;
}

export function Toolbar({ onBack }: { onBack: () => void }) {
  const name = useBuilderStore((s) => s.name);
  const extension = useBuilderStore((s) => s.extension);
  const enabled = useBuilderStore((s) => s.enabled);
  const dirty = useBuilderStore((s) => s.dirty);
  const saving = useBuilderStore((s) => s.saving);
  const readOnly = useBuilderStore((s) => s.readOnly);
  const setMeta = useBuilderStore((s) => s.setMeta);
  const save = useBuilderStore((s) => s.save);
  const exportFlow = useBuilderStore((s) => s.exportFlow);
  const importFlow = useBuilderStore((s) => s.importFlow);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const handleExport = () => {
    const data = exportFlow();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeFileStem(name, extension)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-importing the same file
    if (!file) return;
    setImportError(null);
    try {
      const parsed = JSON.parse(await file.text());
      const result = importFlow(parsed);
      if (!result.ok) setImportError(result.error);
    } catch {
      setImportError("Could not read the file — expected valid JSON.");
    }
  };

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
        {importError && (
          <span className="text-xs text-destructive" title={importError}>
            {importError}
          </span>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={handleImportFile}
        />

        {!readOnly && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            title="Import a flow from a JSON file"
          >
            <Upload className="mr-1 h-4 w-4" />
            Import
          </Button>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          title="Export this flow to a JSON file"
        >
          <Download className="mr-1 h-4 w-4" />
          Export
        </Button>

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

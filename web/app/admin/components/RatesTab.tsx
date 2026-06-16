"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Star,
  Save,
  Loader2,
  Upload,
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
  type RatePlan,
  type Rate,
  type RatePlanInput,
  type RateInput,
  type RateImportResult,
} from "../../lib/go-api";

// ─── Rates Tab ──────────────────────────────────────────
//
// Two-pane billing manager: rate plans on the left, the selected plan's rate
// table on the right. Plans are named, single-currency collections of rates;
// rates are matched against a dialed number longest-prefix-first at call end.

export function RatesTab() {
  const [plans, setPlans] = useState<RatePlan[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loadErr, setLoadErr] = useState(false);

  // Plan editor dialog (null = closed; {} = create; plan = edit).
  const [planDraft, setPlanDraft] = useState<RatePlan | null>(null);
  const [planCreating, setPlanCreating] = useState(false);
  const [planToDelete, setPlanToDelete] = useState<RatePlan | null>(null);

  const loadPlans = async (selectFirst = false) => {
    try {
      const list = await goApi.getRatePlans();
      setPlans(list);
      if (selectFirst && list.length && selectedId === null) {
        setSelectedId(list[0].id);
      }
    } catch (err) {
      console.error("Failed to load rate plans:", err);
      setLoadErr(true);
    }
  };

  useEffect(() => {
    loadPlans(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    setPlanCreating(true);
    setPlanDraft({
      id: 0,
      name: "",
      currency: "USD",
      default: false,
      created_at: "",
      updated_at: "",
    });
  };

  const openEdit = (plan: RatePlan) => {
    setPlanCreating(false);
    setPlanDraft(plan);
  };

  const handleDeletePlan = async () => {
    if (!planToDelete) return;
    const id = planToDelete.id;
    setPlanToDelete(null);
    try {
      await goApi.deleteRatePlan(id);
      if (selectedId === id) setSelectedId(null);
      await loadPlans();
    } catch (err) {
      console.error("Failed to delete rate plan:", err);
    }
  };

  if (loadErr) {
    return (
      <>
        <h2 className="text-2xl font-bold">Rates &amp; Billing</h2>
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm text-muted-foreground">
            Couldn&apos;t load rate plans. Check the API connection and try again.
          </CardContent>
        </Card>
      </>
    );
  }

  if (!plans) return <RatesSkeleton />;

  const selected = plans.find((p) => p.id === selectedId) ?? null;

  return (
    <>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold">Rates &amp; Billing</h2>
          <p className="text-sm text-muted-foreground">
            Price outbound destinations with prefix-matched rate plans.
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1.5" /> New plan
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* Plans list */}
        <div className="space-y-2">
          {plans.length === 0 && (
            <Card className="border-dashed border-border/60 bg-transparent">
              <CardContent className="p-4 text-sm text-muted-foreground text-center">
                No rate plans yet. Create one to start pricing calls.
              </CardContent>
            </Card>
          )}
          {plans.map((plan) => (
            <button
              key={plan.id}
              onClick={() => setSelectedId(plan.id)}
              className={`w-full text-left rounded-lg border p-3 transition-colors ${
                selectedId === plan.id
                  ? "border-primary/60 bg-accent"
                  : "border-border/50 bg-card/40 hover:bg-accent/50"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium truncate flex items-center gap-1.5">
                  {plan.default && (
                    <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500 shrink-0" />
                  )}
                  {plan.name}
                </span>
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  {plan.currency}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {plan.rate_count ?? 0} {plan.rate_count === 1 ? "rate" : "rates"}
              </p>
            </button>
          ))}
        </div>

        {/* Selected plan detail */}
        <div className="min-w-0">
          {selected ? (
            <PlanDetail
              key={selected.id}
              plan={selected}
              onEditPlan={() => openEdit(selected)}
              onDeletePlan={() => setPlanToDelete(selected)}
              onRatesChanged={() => loadPlans()}
            />
          ) : (
            <Card className="border-border/50 bg-card/40 h-full">
              <CardContent className="p-8 text-sm text-muted-foreground text-center">
                Select a plan to view and edit its rates.
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Plan create/edit dialog */}
      <PlanDialog
        draft={planDraft}
        creating={planCreating}
        onClose={() => setPlanDraft(null)}
        onSaved={async (saved) => {
          setPlanDraft(null);
          await loadPlans();
          setSelectedId(saved.id);
        }}
      />

      {/* Plan delete confirm */}
      <ConfirmDialog
        open={!!planToDelete}
        title={`Delete “${planToDelete?.name}”?`}
        description={`This removes the plan and all ${planToDelete?.rate_count ?? 0} of its rates. This can't be undone.`}
        confirmLabel="Delete plan"
        onCancel={() => setPlanToDelete(null)}
        onConfirm={handleDeletePlan}
      />
    </>
  );
}

// ─── Plan detail (rate table) ───────────────────────────

function PlanDetail({
  plan,
  onEditPlan,
  onDeletePlan,
  onRatesChanged,
}: {
  plan: RatePlan;
  onEditPlan: () => void;
  onDeletePlan: () => void;
  onRatesChanged: () => void;
}) {
  const [rates, setRates] = useState<Rate[] | null>(null);
  const [rateDraft, setRateDraft] = useState<Rate | null>(null);
  const [rateCreating, setRateCreating] = useState(false);
  const [rateToDelete, setRateToDelete] = useState<Rate | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const loadRates = async () => {
    try {
      setRates(await goApi.getRates(plan.id));
    } catch (err) {
      console.error("Failed to load rates:", err);
      setRates([]);
    }
  };

  useEffect(() => {
    loadRates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id]);

  const openCreate = () => {
    setRateCreating(true);
    setRateDraft({
      id: 0,
      rate_plan_id: plan.id,
      prefix: "",
      description: "",
      sell_per_min: 0,
      buy_per_min: 0,
      setup_fee: 0,
      increment_secs: 60,
      min_secs: 0,
      created_at: "",
      updated_at: "",
    });
  };

  const handleDeleteRate = async () => {
    if (!rateToDelete) return;
    const id = rateToDelete.id;
    setRateToDelete(null);
    try {
      await goApi.deleteRate(plan.id, id);
      await loadRates();
      onRatesChanged();
    } catch (err) {
      console.error("Failed to delete rate:", err);
    }
  };

  return (
    <Card className="border-border/50 bg-card/40">
      <div className="flex items-center justify-between gap-2 p-4 border-b border-border/50">
        <div className="min-w-0 flex items-center gap-2">
          {plan.default && <Star className="h-4 w-4 text-amber-500 fill-amber-500 shrink-0" />}
          <h3 className="font-semibold truncate">{plan.name}</h3>
          <Badge variant="outline" className="text-[10px]">{plan.currency}</Badge>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEditPlan} aria-label="Edit plan">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={onDeletePlan} aria-label="Delete plan">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <CardContent className="p-0">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <p className="text-xs text-muted-foreground">
            Longest matching prefix wins. Prices are per minute in {plan.currency}.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="ghost" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4 mr-1.5" /> Import CSV
            </Button>
            <Button size="sm" variant="outline" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1.5" /> Add rate
            </Button>
          </div>
        </div>

        {rates === null ? (
          <div className="p-4 space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : rates.length === 0 ? (
          <div className="px-4 pb-6 pt-2 text-sm text-muted-foreground text-center">
            No rates yet. Add a prefix like <code className="font-mono">1</code> (US) or{" "}
            <code className="font-mono">91</code> (India).
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-border/50 text-xs text-muted-foreground">
                  <th className="text-left font-medium px-4 py-2">Prefix</th>
                  <th className="text-left font-medium px-3 py-2">Description</th>
                  <th className="text-right font-medium px-3 py-2">Sell/min</th>
                  <th className="text-right font-medium px-3 py-2">Buy/min</th>
                  <th className="text-right font-medium px-3 py-2">Setup</th>
                  <th className="text-right font-medium px-3 py-2">Incr/Min</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rates.map((rate) => (
                  <tr key={rate.id} className="border-b border-border/30 hover:bg-accent/30">
                    <td className="px-4 py-2 font-mono">+{rate.prefix}</td>
                    <td className="px-3 py-2 text-muted-foreground truncate max-w-45">
                      {rate.description || "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{rate.sell_per_min.toFixed(4)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{rate.buy_per_min.toFixed(4)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{rate.setup_fee.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {rate.increment_secs}s / {rate.min_secs}s
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => {
                            setRateCreating(false);
                            setRateDraft(rate);
                          }}
                          aria-label="Edit rate"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setRateToDelete(rate)}
                          aria-label="Delete rate"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {/* Rate create/edit dialog */}
      <RateDialog
        planId={plan.id}
        draft={rateDraft}
        creating={rateCreating}
        onClose={() => setRateDraft(null)}
        onSaved={async () => {
          setRateDraft(null);
          await loadRates();
          onRatesChanged();
        }}
      />

      {/* Rate delete confirm */}
      <ConfirmDialog
        open={!!rateToDelete}
        title={`Delete rate +${rateToDelete?.prefix}?`}
        description="Calls to this destination will fall back to a shorter matching prefix (or be unrated). This can't be undone."
        confirmLabel="Delete rate"
        onCancel={() => setRateToDelete(null)}
        onConfirm={handleDeleteRate}
      />

      {/* CSV bulk import */}
      <ImportDialog
        planId={plan.id}
        currency={plan.currency}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={async () => {
          await loadRates();
          onRatesChanged();
        }}
      />
    </Card>
  );
}

// ─── Plan dialog ────────────────────────────────────────

function PlanDialog({
  draft,
  creating,
  onClose,
  onSaved,
}: {
  draft: RatePlan | null;
  creating: boolean;
  onClose: () => void;
  onSaved: (plan: RatePlan) => void;
}) {
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (draft) {
      setName(draft.name);
      setCurrency(draft.currency || "USD");
      setIsDefault(draft.default);
    }
  }, [draft]);

  const handleSave = async () => {
    if (!draft || saving || !name.trim()) return;
    setSaving(true);
    const payload: RatePlanInput = {
      name: name.trim(),
      currency: currency.trim().toUpperCase() || "USD",
      default: isDefault,
    };
    try {
      const saved = creating
        ? await goApi.createRatePlan(payload)
        : await goApi.updateRatePlan(draft.id, payload);
      onSaved(saved);
    } catch (err) {
      console.error("Failed to save rate plan:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!draft} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{creating ? "New rate plan" : "Edit rate plan"}</DialogTitle>
          <DialogDescription>
            A plan groups destination rates under a single billing currency.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <DialogField label="Name">
            <Input
              autoFocus
              value={name}
              maxLength={120}
              placeholder="Standard"
              onChange={(e) => setName(e.target.value)}
            />
          </DialogField>
          <DialogField label="Currency" hint="ISO code, e.g. USD, EUR, INR">
            <Input
              value={currency}
              maxLength={3}
              placeholder="USD"
              className="uppercase"
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
          </DialogField>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 p-3">
            <div>
              <p className="text-sm font-medium">Default plan</p>
              <p className="text-xs text-muted-foreground">Applied to users without an explicit plan.</p>
            </div>
            <Switch checked={isDefault} onCheckedChange={setIsDefault} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
            {creating ? "Create plan" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Rate dialog ────────────────────────────────────────

function RateDialog({
  planId,
  draft,
  creating,
  onClose,
  onSaved,
}: {
  planId: number;
  draft: Rate | null;
  creating: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Rate | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(draft);
  }, [draft]);

  const patch = (updates: Partial<Rate>) => setForm((f) => (f ? { ...f, ...updates } : f));

  const handleSave = async () => {
    if (!form || saving || !form.prefix.trim()) return;
    setSaving(true);
    const payload: RateInput = {
      prefix: form.prefix.trim(),
      description: form.description.trim(),
      sell_per_min: form.sell_per_min,
      buy_per_min: form.buy_per_min,
      setup_fee: form.setup_fee,
      increment_secs: form.increment_secs,
      min_secs: form.min_secs,
    };
    try {
      if (creating) {
        await goApi.createRate(planId, payload);
      } else {
        await goApi.updateRate(planId, form.id, payload);
      }
      onSaved();
    } catch (err) {
      console.error("Failed to save rate:", err);
    } finally {
      setSaving(false);
    }
  };

  const num = (v: string) => Math.max(0, Number(v) || 0);

  return (
    <Dialog open={!!draft} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{creating ? "Add rate" : "Edit rate"}</DialogTitle>
          <DialogDescription>
            Prefixes are leading E.164 digits (no <code className="font-mono">+</code>).
          </DialogDescription>
        </DialogHeader>
        {form && (
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <DialogField label="Prefix" hint="e.g. 1, 44, 91">
              <Input
                autoFocus
                value={form.prefix}
                maxLength={15}
                inputMode="numeric"
                placeholder="91"
                onChange={(e) => patch({ prefix: e.target.value.replace(/[^0-9]/g, "") })}
              />
            </DialogField>
            <DialogField label="Description">
              <Input
                value={form.description}
                maxLength={120}
                placeholder="India mobile"
                onChange={(e) => patch({ description: e.target.value })}
              />
            </DialogField>
            <DialogField label="Sell / min">
              <Input
                type="number" min={0} step="0.0001"
                value={form.sell_per_min}
                onChange={(e) => patch({ sell_per_min: num(e.target.value) })}
              />
            </DialogField>
            <DialogField label="Buy / min" hint="Carrier cost (margin)">
              <Input
                type="number" min={0} step="0.0001"
                value={form.buy_per_min}
                onChange={(e) => patch({ buy_per_min: num(e.target.value) })}
              />
            </DialogField>
            <DialogField label="Setup fee" hint="Per-call connection fee">
              <Input
                type="number" min={0} step="0.01"
                value={form.setup_fee}
                onChange={(e) => patch({ setup_fee: num(e.target.value) })}
              />
            </DialogField>
            <div className="grid grid-cols-2 gap-3">
              <DialogField label="Increment (s)">
                <Input
                  type="number" min={1}
                  value={form.increment_secs}
                  onChange={(e) => patch({ increment_secs: Math.max(1, Number(e.target.value) || 1) })}
                />
              </DialogField>
              <DialogField label="Minimum (s)">
                <Input
                  type="number" min={0}
                  value={form.min_secs}
                  onChange={(e) => patch({ min_secs: num(e.target.value) })}
                />
              </DialogField>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !form?.prefix.trim()}>
            {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
            {creating ? "Add rate" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── CSV import dialog ──────────────────────────────────
//
// Bulk-loads a carrier rate sheet. Accepts a pasted CSV or a picked .csv file;
// columns are prefix, description, sell, buy, setup, increment, min (only prefix
// is required, an optional header row is auto-detected). Existing prefixes are
// overwritten so re-importing an updated sheet is safe.

const CSV_PLACEHOLDER = `prefix,description,sell,buy,setup,increment,min
1,United States,0.0090,0.0070,0,60,0
44,United Kingdom,0.0120,0.0090,0,60,0
91,India,0.0110,0.0085,0,60,0`;

function ImportDialog({
  planId,
  currency,
  open,
  onClose,
  onImported,
}: {
  planId: number;
  currency: string;
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RateImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reset transient state whenever the dialog is (re)opened.
  useEffect(() => {
    if (open) {
      setCsv("");
      setError(null);
      setResult(null);
      setBusy(false);
    }
  }, [open]);

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result ?? ""));
    reader.onerror = () => setError("Could not read that file.");
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!csv.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await goApi.importRates(planId, csv);
      setResult(res);
      onImported();
    } catch (err) {
      console.error("Rate import failed:", err);
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import rates from CSV</DialogTitle>
          <DialogDescription>
            Columns: <code className="font-mono">prefix, description, sell, buy, setup, increment, min</code>.
            Only <code className="font-mono">prefix</code> is required. Prices are per minute in {currency}.
            Existing prefixes are overwritten.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-4 w-4 mr-1.5" /> Choose .csv file
            </Button>
            {csv.trim() && (
              <span className="text-[11px] text-muted-foreground">
                {csv.trim().split(/\r?\n/).length} line(s) loaded
              </span>
            )}
          </div>

          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={CSV_PLACEHOLDER}
            spellCheck={false}
            className="w-full h-44 rounded-md border border-input bg-transparent px-3 py-2 text-xs font-mono resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />

          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}

          {result && (
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs space-y-1">
              <p className="font-medium text-foreground">
                Imported: {result.created} added, {result.updated} updated
                {result.skipped > 0 ? `, ${result.skipped} skipped` : ""}.
              </p>
              {result.errors && result.errors.length > 0 && (
                <ul className="list-disc pl-4 text-muted-foreground max-h-20 overflow-y-auto">
                  {result.errors.slice(0, 8).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                  {result.errors.length > 8 && <li>…and {result.errors.length - 8} more</li>}
                </ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {result ? "Done" : "Cancel"}
          </Button>
          <Button onClick={handleImport} disabled={busy || !csv.trim()}>
            {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Upload className="h-4 w-4 mr-1.5" />}
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Shared bits ────────────────────────────────────────

function DialogField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

// Lightweight destructive confirmation built on Dialog (this project's
// alert-dialog primitive doesn't ship Action/Cancel parts).
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RatesSkeleton() {
  return (
    <>
      <Skeleton className="h-8 w-56" />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="space-y-2">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
        <Skeleton className="h-72 w-full rounded-lg" />
      </div>
    </>
  );
}

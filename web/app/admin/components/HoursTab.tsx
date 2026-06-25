"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  Save,
  Loader2,
  Clock,
  CalendarClock,
  CalendarOff,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  goApi,
  type GoBusinessHoursInput,
} from "../../lib/go-api";
import { type UserResponse } from "../../lib/api";

// ─── Working Hours Tab ──────────────────────────────────
//
// Two schedule editors backed by the Go API (SQL migration 005):
//   • Global business hours  — GET/PUT /business-hours (admin-only write).
//   • Per-user availability   — GET/PUT /availability/:ext.
//
// A window is one open interval on a weekday (0 = Sun … 6 = Sat) expressed in
// minutes from midnight. With no enabled windows the routing engine treats the
// company as always open / the user as always available (backward compatible).

const DAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

/** "HH:MM" → minutes from midnight. Returns NaN on a malformed value. */
function timeToMinutes(value: string): number {
  const [h, m] = value.split(":");
  const hours = Number(h);
  const mins = Number(m);
  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return NaN;
  return hours * 60 + mins;
}

/** minutes from midnight → "HH:MM" (1440 clamps to 23:59 for the time input). */
function minutesToTime(min: number): string {
  const clamped = Math.max(0, Math.min(1439, min));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

interface EditableWindow {
  day_of_week: number;
  start_minute: number;
  end_minute: number;
  enabled: boolean;
}

function windowValid(w: EditableWindow): boolean {
  return (
    w.day_of_week >= 0 &&
    w.day_of_week <= 6 &&
    w.start_minute >= 0 &&
    w.start_minute <= 1439 &&
    w.end_minute >= 1 &&
    w.end_minute <= 1440 &&
    w.start_minute < w.end_minute
  );
}

/** Shared editor for a list of weekly windows. */
function WindowRows({
  windows,
  showEnabled,
  onChange,
}: {
  windows: EditableWindow[];
  showEnabled: boolean;
  onChange: (next: EditableWindow[]) => void;
}) {
  const update = (i: number, patch: Partial<EditableWindow>) =>
    onChange(windows.map((w, idx) => (idx === i ? { ...w, ...patch } : w)));
  const remove = (i: number) => onChange(windows.filter((_, idx) => idx !== i));
  const add = () =>
    onChange([
      ...windows,
      { day_of_week: 1, start_minute: 540, end_minute: 1020, enabled: true },
    ]);

  return (
    <div className="space-y-2">
      {windows.length === 0 && (
        <p className="text-sm text-muted-foreground py-2">
          No windows — treated as always available.
        </p>
      )}
      {windows.map((w, i) => {
        const invalid = !windowValid(w);
        return (
          <div
            key={i}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 p-2"
          >
            <Select
              value={String(w.day_of_week)}
              onValueChange={(v) => update(i, { day_of_week: Number(v) })}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAYS.map((d) => (
                  <SelectItem key={d.value} value={String(d.value)}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-1">
              <Input
                type="time"
                className="w-28"
                value={minutesToTime(w.start_minute)}
                onChange={(e) => {
                  const m = timeToMinutes(e.target.value);
                  if (Number.isFinite(m)) update(i, { start_minute: m });
                }}
              />
              <span className="text-muted-foreground text-sm">to</span>
              <Input
                type="time"
                className="w-28"
                value={minutesToTime(w.end_minute)}
                onChange={(e) => {
                  const m = timeToMinutes(e.target.value);
                  if (Number.isFinite(m)) update(i, { end_minute: m });
                }}
              />
            </div>

            {showEnabled && (
              <div className="flex items-center gap-2">
                <Switch
                  checked={w.enabled}
                  onCheckedChange={(checked) => update(i, { enabled: checked })}
                />
                <span className="text-xs text-muted-foreground">Enabled</span>
              </div>
            )}

            {invalid && (
              <span className="flex items-center gap-1 text-xs text-destructive">
                <AlertCircle className="h-3 w-3" /> Start must be before end
              </span>
            )}

            <Button
              variant="ghost"
              size="icon"
              className="ml-auto h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={() => remove(i)}
              aria-label="Remove window"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        );
      })}
      <Button variant="outline" size="sm" onClick={add} className="gap-1">
        <Plus className="h-4 w-4" /> Add window
      </Button>
    </div>
  );
}

interface EditableException {
  date: string; // 'YYYY-MM-DD'
  closed_all_day: boolean;
  start_minute: number;
  end_minute: number;
  note: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function exceptionValid(e: EditableException): boolean {
  if (!DATE_RE.test(e.date)) return false;
  if (e.closed_all_day) return true;
  return (
    e.start_minute >= 0 &&
    e.start_minute <= 1439 &&
    e.end_minute >= 1 &&
    e.end_minute <= 1440 &&
    e.start_minute < e.end_minute
  );
}

/** Editor for one-off date exceptions (holidays / special days). */
function ExceptionRows({
  exceptions,
  onChange,
}: {
  exceptions: EditableException[];
  onChange: (next: EditableException[]) => void;
}) {
  const update = (i: number, patch: Partial<EditableException>) =>
    onChange(exceptions.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  const remove = (i: number) =>
    onChange(exceptions.filter((_, idx) => idx !== i));
  const add = () =>
    onChange([
      ...exceptions,
      {
        date: "",
        closed_all_day: true,
        start_minute: 540,
        end_minute: 1020,
        note: "",
      },
    ]);

  const dupDates = new Set(
    exceptions
      .map((e) => e.date)
      .filter((d, i, arr) => d && arr.indexOf(d) !== i)
  );

  return (
    <div className="space-y-2">
      {exceptions.length === 0 && (
        <p className="text-sm text-muted-foreground py-2">
          No exceptions — holidays use the normal weekly schedule.
        </p>
      )}
      {exceptions.map((e, i) => {
        const invalid = !exceptionValid(e) || dupDates.has(e.date);
        return (
          <div
            key={i}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 p-2"
          >
            <Input
              type="date"
              className="w-40"
              value={e.date}
              onChange={(ev) => update(i, { date: ev.target.value })}
            />

            <div className="flex items-center gap-2">
              <Switch
                checked={e.closed_all_day}
                onCheckedChange={(checked) => update(i, { closed_all_day: checked })}
              />
              <span className="text-xs text-muted-foreground">Closed all day</span>
            </div>

            {!e.closed_all_day && (
              <div className="flex items-center gap-1">
                <Input
                  type="time"
                  className="w-28"
                  value={minutesToTime(e.start_minute)}
                  onChange={(ev) => {
                    const m = timeToMinutes(ev.target.value);
                    if (Number.isFinite(m)) update(i, { start_minute: m });
                  }}
                />
                <span className="text-muted-foreground text-sm">to</span>
                <Input
                  type="time"
                  className="w-28"
                  value={minutesToTime(e.end_minute)}
                  onChange={(ev) => {
                    const m = timeToMinutes(ev.target.value);
                    if (Number.isFinite(m)) update(i, { end_minute: m });
                  }}
                />
              </div>
            )}

            <Input
              className="w-40 flex-1 min-w-32"
              placeholder="Note (e.g. Christmas)"
              value={e.note}
              maxLength={200}
              onChange={(ev) => update(i, { note: ev.target.value })}
            />

            {invalid && (
              <span className="flex items-center gap-1 text-xs text-destructive">
                <AlertCircle className="h-3 w-3" />
                {dupDates.has(e.date) ? "Duplicate date" : "Pick a date / valid hours"}
              </span>
            )}

            <Button
              variant="ghost"
              size="icon"
              className="ml-auto h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={() => remove(i)}
              aria-label="Remove exception"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        );
      })}
      <Button
        variant="outline"
        size="sm"
        onClick={add}
        className="gap-1"
      >
        <Plus className="h-4 w-4" /> Add exception
      </Button>
    </div>
  );
}

/** Global business-hours editor. */
function BusinessHoursCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [timezone, setTimezone] = useState("UTC");
  const [windows, setWindows] = useState<EditableWindow[]>([]);
  const [exceptions, setExceptions] = useState<EditableException[]>([]);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let active = true;
    goApi.schedule
      .getBusinessHours()
      .then((policy) => {
        if (!active) return;
        setEnabled(policy.enabled);
        setTimezone(policy.timezone || "UTC");
        setWindows(
          policy.windows.map((w) => ({
            day_of_week: w.day_of_week,
            start_minute: w.start_minute,
            end_minute: w.end_minute,
            enabled: true,
          }))
        );
        setExceptions(
          (policy.exceptions ?? []).map((e) => ({
            date: e.date,
            closed_all_day: e.closed_all_day,
            start_minute: e.start_minute ?? 540,
            end_minute: e.end_minute ?? 1020,
            note: e.note ?? "",
          }))
        );
      })
      .catch((err) => {
        console.error("Failed to load business hours:", err);
        setError("Failed to load business hours");
        setStatus("error");
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const allValid = useMemo(() => {
    const dates = exceptions.map((e) => e.date).filter(Boolean);
    const noDupes = new Set(dates).size === dates.length;
    return (
      windows.every(windowValid) &&
      exceptions.every(exceptionValid) &&
      noDupes
    );
  }, [windows, exceptions]);

  const save = async () => {
    setSaving(true);
    setStatus("idle");
    setError("");
    try {
      const payload: GoBusinessHoursInput = {
        timezone: timezone.trim() || "UTC",
        enabled,
        windows: windows.map((w) => ({
          day_of_week: w.day_of_week,
          start_minute: w.start_minute,
          end_minute: w.end_minute,
        })),
        exceptions: exceptions.map((e) => ({
          date: e.date,
          closed_all_day: e.closed_all_day,
          ...(e.closed_all_day
            ? {}
            : { start_minute: e.start_minute, end_minute: e.end_minute }),
          note: e.note.trim() || undefined,
        })),
      };
      const updated = await goApi.schedule.saveBusinessHours(payload);
      setEnabled(updated.enabled);
      setTimezone(updated.timezone || "UTC");
      setWindows(
        updated.windows.map((w) => ({
          day_of_week: w.day_of_week,
          start_minute: w.start_minute,
          end_minute: w.end_minute,
          enabled: true,
        }))
      );
      setExceptions(
        (updated.exceptions ?? []).map((e) => ({
          date: e.date,
          closed_all_day: e.closed_all_day,
          start_minute: e.start_minute ?? 540,
          end_minute: e.end_minute ?? 1020,
          note: e.note ?? "",
        }))
      );
      setStatus("saved");
    } catch (err) {
      console.error("Failed to save business hours:", err);
      setError(err instanceof Error ? err.message : "Failed to save");
      setStatus("error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4 text-primary" /> Business Hours
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          When enabled, calls outside these hours hear the &quot;company closed&quot;
          announcement. When disabled, the platform is always open.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex items-center gap-2">
                <Switch checked={enabled} onCheckedChange={setEnabled} />
                <Label>Enforce business hours</Label>
              </div>
              <div className="space-y-1">
                <Label htmlFor="bh-tz" className="text-xs">
                  Timezone
                </Label>
                <Input
                  id="bh-tz"
                  className="w-44"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="UTC"
                />
              </div>
            </div>

            <WindowRows windows={windows} showEnabled={false} onChange={setWindows} />

            <div className="space-y-2 border-t border-border/50 pt-4">
              <div className="flex items-center gap-2">
                <CalendarOff className="h-4 w-4 text-primary" />
                <Label className="text-sm font-medium">Exceptions &amp; holidays</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                One-off dates that override the weekly schedule — closed all day, or
                with special hours. Upcoming dates only.
              </p>
              <ExceptionRows exceptions={exceptions} onChange={setExceptions} />
            </div>

            <div className="flex items-center gap-3">
              <Button onClick={save} disabled={saving || !allValid} className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save business hours
              </Button>
              {status === "saved" && (
                <span className="flex items-center gap-1 text-sm text-green-600">
                  <CheckCircle2 className="h-4 w-4" /> Saved
                </span>
              )}
              {status === "error" && (
                <span className="flex items-center gap-1 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4" /> {error}
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Per-user availability editor (admin picks a user). */
function AvailabilityCard({ users }: { users: UserResponse[] }) {
  const [ext, setExt] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [timezone, setTimezone] = useState("UTC");
  const [windows, setWindows] = useState<EditableWindow[]>([]);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (!ext) return;
    let active = true;
    setLoading(true);
    setStatus("idle");
    goApi.schedule
      .getAvailability(ext)
      .then((rows) => {
        if (!active) return;
        setTimezone(rows[0]?.timezone || "UTC");
        setWindows(
          rows.map((w) => ({
            day_of_week: w.day_of_week,
            start_minute: w.start_minute,
            end_minute: w.end_minute,
            enabled: w.enabled,
          }))
        );
      })
      .catch((err) => {
        console.error("Failed to load availability:", err);
        setError("Failed to load availability");
        setStatus("error");
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [ext]);

  const allValid = useMemo(() => windows.every(windowValid), [windows]);

  const save = async () => {
    if (!ext) return;
    setSaving(true);
    setStatus("idle");
    setError("");
    try {
      const updated = await goApi.schedule.saveAvailability(ext, {
        timezone: timezone.trim() || "UTC",
        windows: windows.map((w) => ({
          day_of_week: w.day_of_week,
          start_minute: w.start_minute,
          end_minute: w.end_minute,
          enabled: w.enabled,
        })),
      });
      setWindows(
        updated.map((w) => ({
          day_of_week: w.day_of_week,
          start_minute: w.start_minute,
          end_minute: w.end_minute,
          enabled: w.enabled,
        }))
      );
      setStatus("saved");
    } catch (err) {
      console.error("Failed to save availability:", err);
      setError(err instanceof Error ? err.message : "Failed to save");
      setStatus("error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4 text-primary" /> User Availability
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Personal working hours per extension. Calls outside a user&apos;s windows
          hear the &quot;unavailable&quot; announcement. No windows = always available.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label className="text-xs">Extension</Label>
          <Select value={ext} onValueChange={setExt}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select a user…" />
            </SelectTrigger>
            <SelectContent>
              {users.map((u) => (
                <SelectItem key={u.extension} value={u.extension}>
                  {u.extension}
                  {u.name ? ` — ${u.name}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {ext && (
          <>
            <div className="space-y-1">
              <Label htmlFor="av-tz" className="text-xs">
                Timezone
              </Label>
              <Input
                id="av-tz"
                className="w-44"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="UTC"
              />
            </div>

            {loading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <WindowRows windows={windows} showEnabled onChange={setWindows} />
            )}

            <div className="flex items-center gap-3">
              <Button onClick={save} disabled={saving || loading || !allValid} className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save availability
              </Button>
              {status === "saved" && (
                <span className="flex items-center gap-1 text-sm text-green-600">
                  <CheckCircle2 className="h-4 w-4" /> Saved
                </span>
              )}
              {status === "error" && (
                <span className="flex items-center gap-1 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4" /> {error}
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function HoursTab({ users }: { users: UserResponse[] }) {
  return (
    <div className="space-y-6">
      <BusinessHoursCard />
      <AvailabilityCard users={users} />
    </div>
  );
}

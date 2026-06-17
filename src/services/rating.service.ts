import type { CallLog } from '@/core';
import { loadRatePlans, type RatePlanRow, type RateRow } from './postgres/rate.repo';

/** The billing fields a successful rating produces, merged into a CallLog. */
export interface RatingResult {
  cost: number;
  currency: string;
  ratePrefix: string;
  billedSecs: number;
}

/**
 * In-memory call-rating engine. Holds the rate book (rate plans + their rates)
 * loaded from the shared Postgres tables the Go API owns, and prices outbound
 * calls at end-of-call using longest-prefix matching.
 *
 * Prices each call with the **caller's assigned plan** (`UserSettings.rate_plan_id`,
 * threaded in by the SIP layer via `applyToEndedCall`), falling back to the
 * workspace **default** plan when the user has none.
 */
export class RatingService {
  /** All plans by id (each carries its own longest-prefix-first rate list). */
  private plans = new Map<number, RatePlanRow>();
  /** Id of the plan flagged default, applied when a call has no explicit plan. */
  private defaultPlanId: number | null = null;

  /** Whether any plans are loaded (rating is a no-op when false). */
  get hasRates(): boolean {
    return this.plans.size > 0;
  }

  /**
   * (Re)load the entire rate book from Postgres. Safe to call repeatedly — the
   * rate-sync listener calls this on every rate-table change. Failures leave the
   * previous book in place so a transient DB blip doesn't wipe pricing.
   */
  async reload(): Promise<number> {
    let rows: RatePlanRow[];
    try {
      rows = await loadRatePlans();
    } catch (err: any) {
      console.warn(`⚠️  rating: rate book reload failed (${err?.message}); keeping previous`);
      return this.plans.size;
    }

    const next = new Map<number, RatePlanRow>();
    let defaultId: number | null = null;
    for (const plan of rows) {
      next.set(plan.id, plan);
      if (plan.isDefault && defaultId === null) defaultId = plan.id;
    }
    // Fall back to the first plan if none is explicitly flagged default, so a
    // single-plan workspace prices calls without needing the flag set.
    if (defaultId === null && rows.length > 0) defaultId = rows[0].id;

    this.plans = next;
    this.defaultPlanId = defaultId;
    return next.size;
  }

  /**
   * Rate one (billable) call. Returns the billing fields, or `null` when the
   * call can't/shouldn't be rated (no plan, no matching prefix, zero duration).
   * Caller decides what to do with a null (typically: leave cost unset = 0).
   *
   * @param dialed     the dialed destination (E.164-ish, may include `+`)
   * @param durationSecs answered talk time in seconds
   * @param planId     optional explicit plan; falls back to the default plan
   */
  rate(dialed: string, durationSecs: number, planId?: number | null): RatingResult | null {
    if (durationSecs <= 0) return null;

    const plan = this.resolvePlan(planId);
    if (!plan) return null;

    const digits = toDigits(dialed);
    if (!digits) return null;

    const match = longestPrefixMatch(plan.rates, digits);
    if (!match) return null;

    const billedSecs = billableSeconds(durationSecs, match.incrementSecs, match.minSecs);
    const cost = round5(match.setupFee + (match.sellPerMin * billedSecs) / 60);

    return {
      cost,
      currency: plan.currency,
      ratePrefix: match.prefix,
      billedSecs,
    };
  }

  /**
   * The smallest amount a call to `dialed` could possibly cost: the setup fee
   * plus one minimum billable increment of talk time. Used by the prepaid gate
   * to refuse a call the caller can't even afford to start. Returns 0 (don't
   * gate) when there's no plan or no matching prefix — an unrateable call is
   * never balance-blocked, mirroring `rate()` returning null.
   */
  estimateMinCharge(dialed: string, planId?: number | null): { cost: number; currency: string } | null {
    const plan = this.resolvePlan(planId);
    if (!plan) return null;

    const digits = toDigits(dialed);
    if (!digits) return null;

    const match = longestPrefixMatch(plan.rates, digits);
    if (!match) return null;

    // Cheapest possible answered call: one increment (or the minimum), same
    // rounding the real rating uses, so the estimate never under-charges.
    const minBilled = billableSeconds(1, match.incrementSecs, match.minSecs);
    const cost = round5(match.setupFee + (match.sellPerMin * minBilled) / 60);
    return { cost, currency: plan.currency };
  }

  /**
   * Convenience for the SIP layer: given the call's terminal updates, rate the
   * outbound destination and merge the billing fields into those updates. Only
   * rates outbound legs to an external number; inbound / internal calls return
   * the updates unchanged. Never throws.
   *
   * @param planId optional rate plan for the calling user; falls back to default.
   */
  applyToEndedCall(call: CallLog, updates: Partial<CallLog>, planId?: number | null): Partial<CallLog> {
    try {
      // Only external/PSTN destinations are billable; an internal `to` resolves
      // to a local extension (toExt set) and costs nothing.
      if (call.toExt) return updates;

      const durationSecs =
        typeof updates.duration === 'number'
          ? updates.duration
          : derivedDuration(call.startTime, updates.endTime ?? call.endTime);

      const result = this.rate(call.to, durationSecs, planId);
      if (!result) return updates;

      return {
        ...updates,
        cost: result.cost,
        currency: result.currency,
        ratePrefix: result.ratePrefix,
        billedSecs: result.billedSecs,
      };
    } catch {
      return updates;
    }
  }

  private resolvePlan(planId?: number | null): RatePlanRow | null {
    if (planId != null) {
      const explicit = this.plans.get(planId);
      if (explicit) return explicit;
    }
    if (this.defaultPlanId != null) return this.plans.get(this.defaultPlanId) ?? null;
    return null;
  }
}

// ─── pure helpers ───────────────────────────────────────

/** Strip everything but digits (drops `+`, spaces, dashes). */
function toDigits(value: string): string {
  let out = '';
  for (const ch of value) {
    if (ch >= '0' && ch <= '9') out += ch;
  }
  return out;
}

/**
 * Longest-prefix match. `rates` is expected longest-first (the repo orders by
 * `length(prefix) DESC`), so the first prefix the number starts with wins; the
 * length guard makes the result order-independent regardless.
 */
function longestPrefixMatch(rates: RateRow[], digits: string): RateRow | null {
  let best: RateRow | null = null;
  for (const rate of rates) {
    if (!rate.prefix) continue;
    if (digits.startsWith(rate.prefix)) {
      if (!best || rate.prefix.length > best.prefix.length) best = rate;
    }
  }
  return best;
}

/**
 * Round `durationSecs` up to the next billing increment, then enforce the
 * minimum billable duration. e.g. 61s @ 60s increment, 60s min → 120s billed.
 */
function billableSeconds(durationSecs: number, incrementSecs: number, minSecs: number): number {
  const inc = incrementSecs > 0 ? incrementSecs : 60;
  const rounded = Math.ceil(durationSecs / inc) * inc;
  return Math.max(rounded, minSecs > 0 ? minSecs : 0);
}

/** Round to 5 decimal places to match the numeric(12,5) cost column. */
function round5(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

/** Seconds between two ISO timestamps (0 if the end is missing/invalid). */
function derivedDuration(startIso: string, endIso?: string): number {
  if (!endIso) return 0;
  const ms = Date.parse(endIso) - Date.parse(startIso);
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : 0;
}

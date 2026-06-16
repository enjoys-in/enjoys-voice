import { getPool } from './pool';

/** A single destination rate loaded from Postgres (one row of `rates`). */
export interface RateRow {
  id: number;
  ratePlanId: number;
  /** Leading E.164 digits (no `+`), e.g. "91" / "1". */
  prefix: string;
  sellPerMin: number;
  buyPerMin: number;
  setupFee: number;
  incrementSecs: number;
  minSecs: number;
}

/** A rate plan plus its full rate table (one row of `rate_plans`). */
export interface RatePlanRow {
  id: number;
  name: string;
  currency: string;
  isDefault: boolean;
  rates: RateRow[];
}

/**
 * Load every rate plan with its rates, ready for in-memory longest-prefix
 * matching. Rates come back longest-prefix-first so the matcher can take the
 * first hit. The `rate_plans` / `rates` tables are owned by the Go API
 * (AutoMigrate); Node only reads them. Returns an empty array if the tables
 * don't exist yet (billing not provisioned) rather than throwing, so the SIP
 * engine still boots.
 */
export async function loadRatePlans(): Promise<RatePlanRow[]> {
  const pool = getPool();

  // Guard: if billing tables haven't been created by the Go API yet, treat it
  // as "no plans" instead of erroring the whole rating hydrate.
  const present = await pool.query(
    `SELECT to_regclass('public.rate_plans') AS plans, to_regclass('public.rates') AS rates`,
  );
  if (!present.rows[0]?.plans || !present.rows[0]?.rates) return [];

  const { rows: planRows } = await pool.query(
    `SELECT id, name, currency, is_default FROM rate_plans ORDER BY id`,
  );
  if (planRows.length === 0) return [];

  const { rows: rateRows } = await pool.query(
    `SELECT id, rate_plan_id, prefix, sell_per_min, buy_per_min, setup_fee,
            increment_secs, min_secs
       FROM rates
      ORDER BY length(prefix) DESC, prefix ASC`,
  );

  const byPlan = new Map<number, RateRow[]>();
  for (const r of rateRows) {
    const rate: RateRow = {
      id: r.id,
      ratePlanId: r.rate_plan_id,
      prefix: String(r.prefix),
      sellPerMin: Number(r.sell_per_min) || 0,
      buyPerMin: Number(r.buy_per_min) || 0,
      setupFee: Number(r.setup_fee) || 0,
      incrementSecs: Number(r.increment_secs) || 60,
      minSecs: Number(r.min_secs) || 0,
    };
    const list = byPlan.get(rate.ratePlanId);
    if (list) list.push(rate);
    else byPlan.set(rate.ratePlanId, [rate]);
  }

  return planRows.map((p): RatePlanRow => ({
    id: p.id,
    name: p.name,
    currency: p.currency || 'USD',
    isDefault: !!p.is_default,
    rates: byPlan.get(p.id) ?? [],
  }));
}

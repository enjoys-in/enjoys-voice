import { getPool } from './pool';

/**
 * Read-only access to the shared Postgres `routing_rules` table — the single
 * source of truth the Go API (per-user routing UI) writes. The SIP runtime only
 * ever READS rules (it never edits them), keyed by the dialed number, to decide
 * whether an inbound call is overridden to an IVR flow, another extension, a
 * PSTN number, or voicemail.
 */

/** A user's per-user inbound routing rule, as the SIP engine consumes it. */
export interface RoutingRuleRecord {
  id: number;
  ownerExtension: string;
  /** "all" → every inbound call to the owner; "number" → a specific dialed number. */
  matchType: 'all' | 'number';
  /** The dialed number to match when matchType is "number". */
  matchNumber: string;
  destinationType: 'ivr' | 'extension' | 'pstn' | 'voicemail';
  /** IVR entry extension, target extension, or PSTN number. Empty for voicemail. */
  destinationValue: string;
  enabled: boolean;
}

interface RoutingRuleRow {
  id: number | string;
  owner_extension: string;
  match_type: string;
  match_number: string | null;
  destination_type: string;
  destination_value: string | null;
  enabled: boolean;
}

function rowToRule(r: RoutingRuleRow): RoutingRuleRecord {
  return {
    id: Number(r.id),
    ownerExtension: r.owner_extension,
    matchType: r.match_type === 'number' ? 'number' : 'all',
    matchNumber: r.match_number ?? '',
    destinationType: r.destination_type as RoutingRuleRecord['destinationType'],
    destinationValue: r.destination_value ?? '',
    enabled: !!r.enabled,
  };
}

/**
 * The enabled routing rule that matches a dialed number, or undefined when none
 * exists. A "number" rule matches when its match_number equals the dialed
 * number; an "all" rule matches when the dialed number is the owner's own
 * extension. A specific-number match wins over a catch-all "all" match.
 */
export async function loadRoutingRuleByNumber(number: string): Promise<RoutingRuleRecord | undefined> {
  const { rows } = await getPool().query(
    `SELECT id, owner_extension, match_type, match_number, destination_type, destination_value, enabled
       FROM routing_rules
      WHERE enabled = TRUE
        AND ( (match_type = 'number' AND match_number = $1)
           OR (match_type = 'all'    AND owner_extension = $1) )
      ORDER BY (match_type = 'number') DESC, id ASC
      LIMIT 1`,
    [number],
  );
  return rows[0] ? rowToRule(rows[0] as RoutingRuleRow) : undefined;
}

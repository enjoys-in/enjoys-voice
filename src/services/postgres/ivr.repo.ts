import { getPool } from './pool';
import type { IvrFlowGraph } from '@/sip/ivr/flow.types';

/**
 * Read-only access to the shared Postgres `ivr_flows` table — the single source
 * of truth the Go API (flow builder) writes. The SIP runtime only ever READS
 * flows (it never edits them), so this repo exposes just the lookups the IVR
 * needs. The `graph` JSONB column holds `{ nodes, edges }`; node-postgres parses
 * jsonb into a JS object already, but we defensively handle a string too.
 */

interface IvrFlowRow {
  id: string;
  name: string;
  extension: string;
  enabled: boolean;
  graph: unknown;
}

function rowToFlow(r: IvrFlowRow): IvrFlowGraph {
  let graph: any = r.graph;
  if (typeof graph === 'string') {
    try { graph = JSON.parse(graph); } catch { graph = null; }
  }
  return {
    id: r.id,
    name: r.name,
    extension: r.extension,
    enabled: !!r.enabled,
    nodes: Array.isArray(graph?.nodes) ? graph.nodes : [],
    edges: Array.isArray(graph?.edges) ? graph.edges : [],
  };
}

/** The enabled flow whose entry DID/extension matches, or undefined. */
export async function loadIvrFlowByExtension(extension: string): Promise<IvrFlowGraph | undefined> {
  const { rows } = await getPool().query(
    `SELECT id, name, extension, enabled, graph
       FROM ivr_flows
      WHERE extension = $1 AND enabled = TRUE`,
    [extension],
  );
  return rows[0] ? rowToFlow(rows[0] as IvrFlowRow) : undefined;
}

/**
 * Every entry extension that has an ENABLED IVR flow. The SIP runtime keeps
 * these in a sync Set so the dial-plan can route a dialed number into the IVR
 * even though it isn't a provisioned SIP user. Returns [] when the table does
 * not exist yet (fresh DB before the Go API migrates it).
 */
export async function loadEnabledIvrFlowExtensions(): Promise<string[]> {
  try {
    const { rows } = await getPool().query<{ extension: string }>(
      `SELECT extension FROM ivr_flows WHERE enabled = TRUE`,
    );
    return rows.map((r) => r.extension).filter(Boolean);
  } catch (err: any) {
    // 42P01 = undefined_table (Go API hasn't created ivr_flows yet).
    if (err?.code === '42P01') return [];
    throw err;
  }
}

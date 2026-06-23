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

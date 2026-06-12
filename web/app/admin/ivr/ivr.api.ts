/**
 * IVR flow persistence.
 *
 * Async (Promise-based) on purpose: it currently stores flows in localStorage
 * so the builder is fully usable today, but the surface mirrors a REST client
 * so swapping to the Postgres-backed API is a one-file change.
 *
 * Backend mapping (when wired up):
 *   GET    /api/ivr/flows         → listFlows()
 *   GET    /api/ivr/flows/:id     → getFlow(id)
 *   POST   /api/ivr/flows         → saveFlow(new)
 *   PUT    /api/ivr/flows/:id     → saveFlow(existing)
 *   DELETE /api/ivr/flows/:id     → deleteFlow(id)
 *
 * Suggested Postgres schema:
 *   CREATE TABLE ivr_flows (
 *     id          TEXT PRIMARY KEY,
 *     name        TEXT NOT NULL,
 *     extension   TEXT NOT NULL UNIQUE,   -- entry DID
 *     enabled     BOOLEAN NOT NULL DEFAULT true,
 *     graph       JSONB NOT NULL,         -- { nodes, edges }
 *     created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
 *     updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
 *   );
 */
import type { IvrFlow, IvrFlowSummary } from "./ivr.types";

const STORAGE_KEY = "voip.ivrFlows";

function readAll(): IvrFlow[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as IvrFlow[]) : [];
  } catch {
    return [];
  }
}

function writeAll(flows: IvrFlow[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(flows));
}

function toSummary(f: IvrFlow): IvrFlowSummary {
  return {
    id: f.id,
    name: f.name,
    extension: f.extension,
    enabled: f.enabled,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    nodeCount: f.nodes.length,
  };
}

export const ivrApi = {
  async listFlows(): Promise<IvrFlowSummary[]> {
    return readAll()
      .map(toSummary)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async getFlow(id: string): Promise<IvrFlow | null> {
    return readAll().find((f) => f.id === id) ?? null;
  },

  async saveFlow(flow: IvrFlow): Promise<IvrFlow> {
    const flows = readAll();
    const now = new Date().toISOString();
    const next: IvrFlow = { ...flow, updatedAt: now };
    const idx = flows.findIndex((f) => f.id === flow.id);
    if (idx >= 0) flows[idx] = next;
    else flows.push(next);
    writeAll(flows);
    return next;
  },

  async deleteFlow(id: string): Promise<void> {
    writeAll(readAll().filter((f) => f.id !== id));
  },
};

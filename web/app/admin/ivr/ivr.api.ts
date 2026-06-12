/**
 * IVR flow persistence — wired to the Go CRUD API (port 3002).
 *
 * Endpoints (envelope-wrapped { success, message, data }, unwrapped by go-api):
 *   GET    /api/ivr/flows         → listFlows()
 *   GET    /api/ivr/flows/:id     → getFlow(id)
 *   POST   /api/ivr/flows         → saveFlow(flow)   (upsert)
 *   DELETE /api/ivr/flows/:id     → deleteFlow(id)
 *
 * The async surface is intentionally identical to the previous localStorage
 * implementation so the builder store needs no changes.
 */
import type { IvrFlow, IvrFlowSummary } from "./ivr.types";
import { goApi, GoApiError } from "../../lib/go-api";

export const ivrApi = {
  async listFlows(): Promise<IvrFlowSummary[]> {
    return goApi.ivr.listFlows();
  },

  async getFlow(id: string): Promise<IvrFlow | null> {
    try {
      return await goApi.ivr.getFlow(id);
    } catch (err) {
      if (err instanceof GoApiError && err.status === 404) return null;
      throw err;
    }
  },

  async saveFlow(flow: IvrFlow): Promise<IvrFlow> {
    return goApi.ivr.saveFlow(flow);
  },

  async deleteFlow(id: string): Promise<void> {
    await goApi.ivr.deleteFlow(id);
  },
};

/**
 * Client for the Go CRUD API (port 3002).
 *
 * Every Go endpoint replies with a uniform envelope:
 *   { success: boolean, message: string, data: T }
 *
 * `goRequest` unwraps that envelope: it returns `data` on success and throws a
 * `GoApiError` (carrying the server message) otherwise. The Node REST client in
 * `api.ts` is unchanged — these helpers target only the routes ported to Go.
 */
import { getGoApiBase } from "./runtime-config";
import type { IvrFlow, IvrFlowSummary } from "../admin/ivr/ivr.types";

const GO_API_BASE = getGoApiBase();

export interface GoEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
}

export class GoApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown
  ) {
    super(message);
    this.name = "GoApiError";
  }
}

/** Reads the persisted bearer token (zustand persist key "callnet-auth"). */
function authToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("callnet-auth");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { token?: string | null } };
    return parsed?.state?.token ?? null;
  } catch {
    return null;
  }
}

async function goRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = authToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((options.headers as Record<string, string>) ?? {}),
  };

  const res = await fetch(`${GO_API_BASE}/api${endpoint}`, {
    ...options,
    headers,
  });

  let body: GoEnvelope<T> | null = null;
  try {
    body = (await res.json()) as GoEnvelope<T>;
  } catch {
    body = null;
  }

  if (!res.ok || !body || body.success === false) {
    const message = body?.message || res.statusText || "Request failed";
    throw new GoApiError(res.status, message, body);
  }

  return body.data;
}

// ─── Payload types ──────────────────────────────────────

export interface PstnForward {
  enabled: boolean;
  target: string;
}

export interface AuditLog {
  id: number;
  extension: string;
  event: string;
  detail: string;
  createdAt: string;
}

export interface Voicemail {
  id: number;
  extension: string;
  from: string;
  filename: string;
  duration: number;
  path: string;
  read: boolean;
  created_at: string;
}

export interface VoicemailList {
  voicemails: Voicemail[];
  unread: number;
}

export interface GoLookupResponse {
  extension: string;
  name: string;
  mobile: string;
}

// ─── Client ─────────────────────────────────────────────

export const goApi = {
  // Phone → user lookup
  lookupByPhone(phone: string): Promise<GoLookupResponse> {
    return goRequest<GoLookupResponse>(`/lookup/${encodeURIComponent(phone)}`);
  },

  // PSTN call forwarding
  getPstnForward(ext: string): Promise<PstnForward> {
    return goRequest<PstnForward>(`/pstn-forward/${encodeURIComponent(ext)}`);
  },
  setPstnForward(ext: string, payload: PstnForward): Promise<PstnForward> {
    return goRequest<PstnForward>(`/pstn-forward/${encodeURIComponent(ext)}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  // Audit log
  getAudit(params?: {
    user?: string;
    event?: string;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<AuditLog[]> {
    const qs = new URLSearchParams();
    if (params?.user) qs.set("user", params.user);
    if (params?.event) qs.set("event", params.event);
    if (params?.from) qs.set("from", params.from);
    if (params?.to) qs.set("to", params.to);
    if (params?.limit) qs.set("limit", String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return goRequest<AuditLog[]>(`/audit${suffix}`);
  },
  getAuditByExtension(ext: string, limit?: number): Promise<AuditLog[]> {
    const suffix = limit ? `?limit=${limit}` : "";
    return goRequest<AuditLog[]>(
      `/audit/${encodeURIComponent(ext)}${suffix}`
    );
  },

  // Voicemails
  getVoicemails(ext: string): Promise<VoicemailList> {
    return goRequest<VoicemailList>(`/voicemails/${encodeURIComponent(ext)}`);
  },
  markVoicemailRead(ext: string, id: number): Promise<{ unread: number }> {
    return goRequest<{ unread: number }>(
      `/voicemails/${encodeURIComponent(ext)}/${id}/read`,
      { method: "POST" }
    );
  },
  deleteVoicemail(ext: string, id: number): Promise<{ unread: number }> {
    return goRequest<{ unread: number }>(
      `/voicemails/${encodeURIComponent(ext)}/${id}`,
      { method: "DELETE" }
    );
  },
  /** Direct URL for the raw WAV (not enveloped); use in <audio src>. */
  voicemailAudioUrl(ext: string, id: number): string {
    return `${GO_API_BASE}/api/voicemails/${encodeURIComponent(ext)}/${id}/audio`;
  },

  // IVR flows
  ivr: {
    listFlows(): Promise<IvrFlowSummary[]> {
      return goRequest<IvrFlowSummary[]>(`/ivr/flows`);
    },
    getFlow(id: string): Promise<IvrFlow> {
      return goRequest<IvrFlow>(`/ivr/flows/${encodeURIComponent(id)}`);
    },
    saveFlow(flow: IvrFlow): Promise<IvrFlow> {
      return goRequest<IvrFlow>(`/ivr/flows`, {
        method: "POST",
        body: JSON.stringify(flow),
      });
    },
    deleteFlow(id: string): Promise<{ id: string }> {
      return goRequest<{ id: string }>(
        `/ivr/flows/${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
    },
  },
};

export { goRequest };

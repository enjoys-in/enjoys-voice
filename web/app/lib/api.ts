/**
 * Strongly-typed API client for Enjoys Voice backend.
 * All fetch calls are centralized here with full request/response typing.
 */

import { getApiBase } from "./runtime-config";
import { getAccessToken, refreshAccessToken } from "./go-api";

// ─── Request Types ──────────────────────────────────────


export interface IvrTransferRequest {
  callId: string;
  targetExtension: string;
  attended?: boolean;
}

// ─── Response Types ─────────────────────────────────────

export interface HealthResponse {
  status: string;
  sipConnected: boolean;
  ivrActive: boolean;
  trunkEnabled: boolean;
  uptime: number;
}

/**
 * Live call-engine metrics snapshot from the Node SIP server
 * (GET /api/n/metrics, also streamed over the signaling WS `metrics` event).
 */
export interface LiveMetrics {
  activeTotal: number;
  activeInbound: number;
  activeOutbound: number;
  maxConcurrent: number;
  peakInboundConcurrent: number;
  outboundCurrentCps: number;
  outboundPeakCps: number;
  since: string;
  updatedAt: string;
}

export interface UserResponse {
  extension: string;
  name: string;
  username: string;
  registered: boolean;
}

export interface UserDetailResponse {
  extension: string;
  name: string;
  registered: boolean;
}

export interface IvrStatusResponse {
  enabled: boolean;
  connected: boolean;
  activeCalls: unknown[];
  departments: unknown[];
}

export interface TrunkResponse {
  enabled: boolean;
  name?: string;
  host?: string;
  transport?: string;
}

export interface ConfigResponse {
  domain: string;
  sipWsPort: number;
  wsPort: number;
  ivrEnabled: boolean;
  ivrEntry: string;
}

export interface VoicemailRecord {
  id: string;
  mailbox: string;
  from: string;
  fromName: string;
  file: string;
  duration?: number;
  createdAt: string;
  read: boolean;
}

export interface VoicemailListResponse {
  voicemails: VoicemailRecord[];
  unread: number;
}

export interface SuccessResponse {
  success: boolean;
}

// ─── Error Handling ─────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    message?: string
  ) {
    super(message || `${status} ${statusText}`);
    this.name = "ApiError";
  }
}

/** Uniform envelope returned by every Node (/api/n) endpoint. */
interface Envelope<T> {
  success: boolean;
  message: string;
  data: T | null;
}

async function request<T>(
  endpoint: string,
  options?: RequestInit,
  retryOn401 = true
): Promise<T> {
  // Node engine is served under /api/n (see Caddy path routing); dev also uses
  // port 3001 via getApiBase(), so the prefix is consistent in both. The Node
  // voicemail routes are JWT-protected, so attach the shared access token (same
  // token the Go client uses) and refresh-once on a 401, mirroring goRequest.
  const token = getAccessToken();
  const res = await fetch(`${getApiBase()}/api/n${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers as Record<string, string> | undefined),
    },
    // Auth is carried by the httpOnly access-token cookie (the JS token is no
    // longer persisted); the Node API accepts cookie or Bearer.
    credentials: "include",
  });

  if (res.status === 401 && retryOn401) {
    const newToken = await refreshAccessToken();
    if (newToken) return request<T>(endpoint, options, false);
  }

  // Every Node endpoint replies with { success, message, data }; unwrap to the
  // typed `data` payload (mirroring the Go client's goRequest), or throw the
  // server-supplied message on failure.
  let body: Envelope<T> | null = null;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    body = null;
  }

  if (!res.ok || !body || body.success === false) {
    throw new ApiError(res.status, res.statusText, body?.message);
  }

  return body.data as T;
}

// ─── API Methods ────────────────────────────────────────

export const api = {
  // Health
  health: () => request<HealthResponse>("/health"),

  // Live call-engine metrics (active concurrency, peak CPS, etc.)
  metrics: () => request<LiveMetrics>("/metrics"),

  // Users
  getUsers: () => request<UserResponse[]>("/users"),

  getUser: (ext: string) => request<UserDetailResponse>(`/users/${ext}`),

  // IVR
  getIvrStatus: () => request<IvrStatusResponse>("/ivr/status"),

  getIvrRecordings: () => request<unknown[]>("/ivr/recordings"),

  ivrTransfer: (data: IvrTransferRequest) =>
    request<SuccessResponse>("/ivr/transfer", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Trunk
  getTrunk: () => request<TrunkResponse>("/trunk"),

  // Config
  getConfig: () => request<ConfigResponse>("/config"),

  // Voicemail
  getVoicemails: (ext: string) =>
    request<VoicemailListResponse>(`/voicemails/${ext}`),

  markVoicemailRead: (ext: string, id: string) =>
    request<{ success: boolean; unread: number }>(
      `/voicemails/${ext}/${id}/read`,
      { method: "POST" }
    ),

  deleteVoicemail: (ext: string, id: string) =>
    request<SuccessResponse>(`/voicemails/${ext}/${id}`, {
      method: "DELETE",
    }),

  // Direct (non-JSON) URL for streaming a voicemail recording.
  voicemailAudioUrl: (ext: string, id: string) =>
    `${getApiBase()}/api/n/voicemails/${ext}/${id}/audio`,
} as const;

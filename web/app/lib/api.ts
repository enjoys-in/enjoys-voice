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
    public body?: { error?: string }
  ) {
    super(body?.error || `${status} ${statusText}`);
    this.name = "ApiError";
  }
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
  });

  if (res.status === 401 && retryOn401) {
    const newToken = await refreshAccessToken();
    if (newToken) return request<T>(endpoint, options, false);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => undefined);
    throw new ApiError(res.status, res.statusText, body);
  }

  return res.json() as Promise<T>;
}

// ─── API Methods ────────────────────────────────────────

export const api = {
  // Health
  health: () => request<HealthResponse>("/health"),

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

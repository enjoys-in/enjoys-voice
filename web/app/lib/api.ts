/**
 * Strongly-typed API client for Enjoys Voice backend.
 * All fetch calls are centralized here with full request/response typing.
 */

import { getApiBase } from "./runtime-config";
import type { CallDirection, CallRecordStatus } from "../types";

// ─── Base Config ────────────────────────────────────────

// Sourced from RUNTIME config (window.__RUNTIME_CONFIG__.API_BASE) injected at
// container start. Falls back to dev (window host:3001) when unset.
const API_BASE = getApiBase();

// ─── Request Types ──────────────────────────────────────

export interface BlockNumberRequest {
  number: string;
}

export interface SetForwardingRequest {
  type: "busy" | "noAnswer" | "unavailable";
  target: string | null;
}

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

export interface LookupResponse {
  extension: string;
  name: string;
  mobile: string;
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

export interface CallRecordResponse {
  id: string;
  from: string;
  to: string;
  fromName: string;
  status: CallRecordStatus;
  direction: CallDirection;
  startTime: string;
  endTime?: string;
  duration?: number;
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

export interface BlockListResponse {
  blocked: string[];
}

export interface ForwardingResponse {
  busy?: string | null;
  noAnswer?: string | null;
  unavailable?: string | null;
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
  options?: RequestInit
): Promise<T> {
  // Node engine is served under /api/n (see Caddy path routing); dev also uses
  // port 3001 via getApiBase(), so the prefix is consistent in both.
  const res = await fetch(`${API_BASE}/api/n${endpoint}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

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

  // Lookup
  lookupByPhone: (phone: string) =>
    request<LookupResponse>(`/lookup/${encodeURIComponent(phone)}`),

  // Users
  getUsers: () => request<UserResponse[]>("/users"),

  getUser: (ext: string) => request<UserDetailResponse>(`/users/${ext}`),

  // Calls
  getCalls: () => request<CallRecordResponse[]>("/calls"),

  getCallsByUser: (ext: string) =>
    request<CallRecordResponse[]>(`/calls/${ext}`),

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

  // Block List
  getBlockedNumbers: (ext: string) =>
    request<BlockListResponse>(`/block/${ext}`),

  blockNumber: (ext: string, data: BlockNumberRequest) =>
    request<SuccessResponse>(`/block/${ext}`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  unblockNumber: (ext: string, number: string) =>
    request<SuccessResponse>(`/block/${ext}/${number}`, {
      method: "DELETE",
    }),

  // Call Forwarding
  getForwarding: (ext: string) =>
    request<ForwardingResponse>(`/forwarding/${ext}`),

  setForwarding: (ext: string, data: SetForwardingRequest) =>
    request<SuccessResponse>(`/forwarding/${ext}`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // PSTN Forward to Browser
  getPstnForward: (ext: string) =>
    request<{ enabled: boolean; target?: string }>(`/pstn-forward/${ext}`),

  setPstnForward: (ext: string, enabled: boolean, target?: string) =>
    request<SuccessResponse>(`/pstn-forward/${ext}`, {
      method: "POST",
      body: JSON.stringify({ enabled, target: target || undefined }),
    }),

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
    `${API_BASE}/api/n/voicemails/${ext}/${id}/audio`,
} as const;

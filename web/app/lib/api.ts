/**
 * Strongly-typed API client for Enjoys Voice backend.
 * All fetch calls are centralized here with full request/response typing.
 */

// ─── Base Config ────────────────────────────────────────

const API_BASE =
  typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : "";

// ─── Request Types ──────────────────────────────────────

export interface LoginRequest {
  username: string;
  password: string;
}

export interface SignupRequest {
  name: string;
  mobile: string;
  password: string;
}

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

export interface LoginResponse {
  success: boolean;
  user: {
    extension: string;
    name: string;
    username: string;
    mobile?: string;
  };
  sipConfig: {
    wsUrl: string;
    sipWsUrl: string;
    domain: string;
    trunkEnabled: boolean;
  };
}

export type SignupResponse = LoginResponse;

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
  status: "ringing" | "answered" | "ended" | "missed" | "failed";
  direction: "inbound" | "outbound";
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
  const res = await fetch(`${API_BASE}/api${endpoint}`, {
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

  // Auth
  login: (data: LoginRequest) =>
    request<LoginResponse>("/auth", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  signup: (data: SignupRequest) =>
    request<SignupResponse>("/auth/signup", {
      method: "POST",
      body: JSON.stringify(data),
    }),

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
} as const;

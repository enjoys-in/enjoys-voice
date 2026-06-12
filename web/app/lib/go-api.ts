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

/** Reads the persisted access + refresh tokens (zustand persist "callnet-auth"). */
function authTokens(): { token: string | null; refreshToken: string | null } {
  if (typeof window === "undefined") return { token: null, refreshToken: null };
  try {
    const raw = window.localStorage.getItem("callnet-auth");
    if (!raw) return { token: null, refreshToken: null };
    const parsed = JSON.parse(raw) as {
      state?: { token?: string | null; refreshToken?: string | null };
    };
    return {
      token: parsed?.state?.token ?? null,
      refreshToken: parsed?.state?.refreshToken ?? null,
    };
  } catch {
    return { token: null, refreshToken: null };
  }
}

// De-duplicates concurrent refreshes: while one /auth/refresh is in flight, all
// callers await the same promise instead of firing a stampede of refreshes.
let refreshInFlight: Promise<string | null> | null = null;

/** Exchanges the stored refresh token for a new access token; updates the store. */
function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const { refreshToken } = authTokens();
    if (!refreshToken) return null;
    try {
      const res = await fetch(`${GO_API_BASE}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ refreshToken }),
      });
      const body = (await res.json().catch(() => null)) as GoEnvelope<{
        token: string;
        refreshToken: string;
      }> | null;
      if (!res.ok || !body?.success || !body.data?.token) return null;
      const { useAuthStore } = await import("../stores/auth.store");
      useAuthStore.getState().setTokens(body.data.token, body.data.refreshToken);
      return body.data.token;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function goRequest<T>(
  endpoint: string,
  options: RequestInit = {},
  retryOn401 = true
): Promise<T> {
  const { token } = authTokens();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((options.headers as Record<string, string>) ?? {}),
  };

  const res = await fetch(`${GO_API_BASE}/api${endpoint}`, {
    ...options,
    headers,
    credentials: "include",
  });

  // Access token expired → try a one-time refresh, then replay the request.
  if (res.status === 401 && retryOn401) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      return goRequest<T>(endpoint, options, false);
    }
    // Refresh failed → session is dead; clear it.
    if (typeof window !== "undefined") {
      const { useAuthStore } = await import("../stores/auth.store");
      useAuthStore.getState().logout();
    }
  }

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

export interface AuthUser {
  extension: string;
  name: string;
  username: string;
  mobile?: string;
}

export interface AuthSipConfig {
  wsUrl: string;
  sipWsUrl: string;
  domain: string;
  trunkEnabled: boolean;
}

export interface AuthResult {
  token: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser;
  sipConfig: AuthSipConfig;
}

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
  // Auth — issues JWT access + refresh tokens and returns the SIP config.
  // retryOn401 disabled: a 401 here means bad credentials, not an expired token.
  auth: {
    login(username: string, password: string): Promise<AuthResult> {
      return goRequest<AuthResult>(
        "/auth",
        { method: "POST", body: JSON.stringify({ username, password }) },
        false
      );
    },
    signup(name: string, mobile: string, password: string): Promise<AuthResult> {
      return goRequest<AuthResult>(
        "/auth/signup",
        { method: "POST", body: JSON.stringify({ name, mobile, password }) },
        false
      );
    },
    /**
     * Current-session profile. The UI calls this on boot to confirm a persisted
     * login is still valid and to refresh the cached user. A 401 here triggers
     * goRequest's one-shot refresh; if that also fails the session is cleared.
     */
    me(): Promise<AuthUser> {
      return goRequest<AuthUser>("/auth/me");
    },
    /**
     * Updates the current user's account name. The server identifies the user
     * from the access token, so no extension is sent. Returns the refreshed
     * profile, which callers persist via the auth store.
     */
    updateName(name: string): Promise<AuthUser> {
      return goRequest<AuthUser>("/auth/me", {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
    },
  },

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

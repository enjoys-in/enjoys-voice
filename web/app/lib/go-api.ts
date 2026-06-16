/**
 * Client for the Go CRUD API (port 3003 in dev; /api/g/* via Caddy in prod).
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
import type { CallRecord } from "../types";

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

/**
 * Best-effort read of any in-memory tokens mirrored into localStorage. Since
 * the auth store no longer persists tokens (the httpOnly cookies are the source
 * of truth), this normally returns nulls — request helpers then authenticate
 * purely via `credentials:"include"`. Kept for backward compatibility.
 */
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

/** The current access token (or null), for clients that authenticate manually. */
export function getAccessToken(): string | null {
  return authTokens().token;
}

// De-duplicates concurrent refreshes: while one /auth/refresh is in flight, all
// callers await the same promise instead of firing a stampede of refreshes.
let refreshInFlight: Promise<string | null> | null = null;

/** Exchanges the stored refresh token for a new access token; updates the store. */
export function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      // The refresh token rides in the httpOnly refresh_token cookie (sent via
      // credentials:"include"); we no longer read it from localStorage. A body
      // token is sent only if one happens to be in memory, for older clients.
      const { refreshToken } = authTokens();
      const res = await fetch(`${getGoApiBase()}/api/g/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(refreshToken ? { refreshToken } : {}),
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

  const res = await fetch(`${getGoApiBase()}/api/g${endpoint}`, {
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

/**
 * Flat per-user settings persisted by the Go API (GET/PUT /settings/:ext).
 * snake_case keys mirror models.SettingsResponse on the server.
 */
export interface GoSettings {
  extension: string;
  sounds_enabled: boolean;
  dtmf_enabled: boolean;
  caller_tune: string;
  ringtone: string;
  pstn_enabled: boolean;
  pstn_mobile: string;
  pstn_country_code: string;
  recording_enabled: boolean;
  voicemail_enabled: boolean;
  dnd: boolean;
  /** Assigned billing rate plan id, or null to use the workspace default plan. */
  rate_plan_id: number | null;
}

/** Partial settings update — only the provided keys are changed server-side. */
export type GoSettingsInput = Partial<Omit<GoSettings, "extension">>;

/**
 * Workspace-wide customization (branding + default policies) managed from the
 * admin Customization tab. GET is public (login screen branding); PUT is gated.
 */
export interface SystemSettings {
  brand_name: string;
  brand_tagline: string;
  accent_color: string;
  logo_url: string;
  support_email: string;
  default_recording: boolean;
  default_voicemail: boolean;
  allow_user_dnd: boolean;
  recording_retention_days: number;
  max_concurrent_calls: number;
}

/** Partial system-settings update. */
export type SystemSettingsInput = Partial<SystemSettings>;

// ─── Billing: rate plans + rates ────────────────────────

/** A named collection of per-destination rates in a single currency. */
export interface RatePlan {
  id: number;
  name: string;
  currency: string;
  /** Plan applied to users that have no explicit plan assigned. */
  default: boolean;
  /** Number of rates in the plan (omitted on the detail payload). */
  rate_count?: number;
  created_at: string;
  updated_at: string;
}

/** A single destination rate. Prefixes are matched longest-first. */
export interface Rate {
  id: number;
  rate_plan_id: number;
  /** Leading E.164 digits (no `+`), e.g. "91" for India, "1" for NANPA. */
  prefix: string;
  description: string;
  /** Price charged to the user per minute. */
  sell_per_min: number;
  /** Underlying carrier cost per minute (margin reporting). */
  buy_per_min: number;
  /** One-off connection fee added to every billed call. */
  setup_fee: number;
  /** Billing granularity in seconds (e.g. 60 = per-minute, 1 = per-second). */
  increment_secs: number;
  /** Minimum billed duration in seconds. */
  min_secs: number;
  created_at: string;
  updated_at: string;
}

/** A plan together with its full (longest-prefix-first) rate table. */
export interface RatePlanDetail extends RatePlan {
  rates: Rate[];
}

/** Partial rate-plan create/update. `name` is required on create. */
export interface RatePlanInput {
  name?: string;
  currency?: string;
  default?: boolean;
}

/** Partial rate create/update. `prefix` is required on create. */
export interface RateInput {
  prefix?: string;
  description?: string;
  sell_per_min?: number;
  buy_per_min?: number;
  setup_fee?: number;
  increment_secs?: number;
  min_secs?: number;
}

export interface GoForwarding {
  busy?: string | null;
  noAnswer?: string | null;
  unavailable?: string | null;
}

export interface GoLookupResponse {
  extension: string;
  name: string;
  mobile: string;
}

// ─── Dashboard stats ────────────────────────────────────

/** One status slice of the call-status breakdown. */
export interface StatusCount {
  status: string;
  count: number;
}

/** One day of the calls-over-time series (oldest → newest). */
export interface CallStatsBucket {
  date: string; // YYYY-MM-DD
  total: number;
  inbound: number;
  outbound: number;
  answered: number;
  cost: number;
}

/**
 * Aggregate, read-only call metrics computed by the Go API over call_records
 * (GET /api/g/stats?days=N). Rates are 0..1 fractions; durations are seconds.
 */
export interface CallStats {
  rangeDays: number;
  totalCalls: number;
  answered: number;
  missed: number;
  failed: number;
  voicemail: number;
  unreachable: number;
  inbound: number;
  outbound: number;
  connectionRate: number;
  abandonedRate: number;
  avgDuration: number;
  totalDuration: number;
  totalCost: number;
  currency: string;
  statusBreakdown: StatusCount[];
  series: CallStatsBucket[];
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
     * Also returns sipConfig so a cookie-bootstrapped client (no login response
     * in hand) can reconstruct the SIP connection without localStorage.
     */
    me(): Promise<AuthUser & { sipConfig: AuthSipConfig }> {
      return goRequest<AuthUser & { sipConfig: AuthSipConfig }>("/auth/me");
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
    /**
     * Clears the server-side httpOnly auth cookies (token + refresh_token).
     * Uses a bare fetch instead of goRequest so a missing/expired session can't
     * recurse into goRequest's 401→logout handling. Best-effort: a network
     * failure here still lets the client tear its own state down.
     */
    logout(): Promise<void> {
      return fetch(`${getGoApiBase()}/api/g/auth/logout`, {
        method: "POST",
        credentials: "include",
      })
        .then(() => undefined)
        .catch(() => undefined);
    },
  },

  // Phone → user lookup (resolves a mobile/number to a user).
  lookupByPhone(phone: string): Promise<GoLookupResponse> {
    return goRequest<GoLookupResponse>(`/lookup/${encodeURIComponent(phone)}`);
  },

  // PSTN call forwarding (forward inbound PSTN to a browser/extension target).
  getPstnForward(ext: string): Promise<PstnForward> {
    return goRequest<PstnForward>(`/pstn-forward/${encodeURIComponent(ext)}`);
  },
  setPstnForward(ext: string, payload: PstnForward): Promise<PstnForward> {
    return goRequest<PstnForward>(`/pstn-forward/${encodeURIComponent(ext)}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  // Per-user settings (sounds / DTMF / recording / voicemail / DND).
  getSettings(ext: string): Promise<GoSettings> {
    return goRequest<GoSettings>(`/settings/${encodeURIComponent(ext)}`);
  },
  updateSettings(ext: string, payload: GoSettingsInput): Promise<GoSettings> {
    return goRequest<GoSettings>(`/settings/${encodeURIComponent(ext)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },

  // Workspace-wide customization (branding + default policies).
  getSystemSettings(): Promise<SystemSettings> {
    return goRequest<SystemSettings>(`/system-settings`);
  },
  updateSystemSettings(payload: SystemSettingsInput): Promise<SystemSettings> {
    return goRequest<SystemSettings>(`/system-settings`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },

  // Billing: rate plans + nested per-destination rates.
  getRatePlans(): Promise<RatePlan[]> {
    return goRequest<RatePlan[]>(`/rate-plans`);
  },
  getRatePlan(id: number): Promise<RatePlanDetail> {
    return goRequest<RatePlanDetail>(`/rate-plans/${id}`);
  },
  createRatePlan(payload: RatePlanInput): Promise<RatePlan> {
    return goRequest<RatePlan>(`/rate-plans`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  updateRatePlan(id: number, payload: RatePlanInput): Promise<RatePlan> {
    return goRequest<RatePlan>(`/rate-plans/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },
  deleteRatePlan(id: number): Promise<{ id: number }> {
    return goRequest<{ id: number }>(`/rate-plans/${id}`, { method: "DELETE" });
  },
  getRates(planId: number): Promise<Rate[]> {
    return goRequest<Rate[]>(`/rate-plans/${planId}/rates`);
  },
  createRate(planId: number, payload: RateInput): Promise<Rate> {
    return goRequest<Rate>(`/rate-plans/${planId}/rates`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  updateRate(planId: number, rateId: number, payload: RateInput): Promise<Rate> {
    return goRequest<Rate>(`/rate-plans/${planId}/rates/${rateId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },
  deleteRate(planId: number, rateId: number): Promise<{ id: number }> {
    return goRequest<{ id: number }>(`/rate-plans/${planId}/rates/${rateId}`, {
      method: "DELETE",
    });
  },

  // Block list (numbers a user has blocked from calling them).
  getBlockedNumbers(ext: string): Promise<{ blocked: string[] }> {
    return goRequest<{ blocked: string[] }>(`/block/${encodeURIComponent(ext)}`);
  },
  blockNumber(ext: string, data: { number: string }): Promise<void> {
    return goRequest<null>(`/block/${encodeURIComponent(ext)}`, {
      method: "POST",
      body: JSON.stringify(data),
    }).then(() => undefined);
  },
  unblockNumber(ext: string, number: string): Promise<void> {
    return goRequest<null>(
      `/block/${encodeURIComponent(ext)}/${encodeURIComponent(number)}`,
      { method: "DELETE" }
    ).then(() => undefined);
  },

  // Call forwarding (busy / no-answer / unavailable → target extension).
  getForwarding(ext: string): Promise<GoForwarding> {
    return goRequest<GoForwarding>(`/forwarding/${encodeURIComponent(ext)}`);
  },
  setForwarding(
    ext: string,
    data: { type: "busy" | "noAnswer" | "unavailable"; target: string | null }
  ): Promise<void> {
    return goRequest<null>(`/forwarding/${encodeURIComponent(ext)}`, {
      method: "POST",
      body: JSON.stringify({ type: data.type, target: data.target ?? "" }),
    }).then(() => undefined);
  },

  // Call history (read-only). The Node SIP engine writes the shared
  // call_records table; the Go API reads it and returns the CallRecord shape.
  getCalls(): Promise<CallRecord[]> {
    return goRequest<CallRecord[]>(`/calls`);
  },
  getCallsByUser(ext: string): Promise<CallRecord[]> {
    return goRequest<CallRecord[]>(`/calls/${encodeURIComponent(ext)}`);
  },
  // Clear a user's call history (the "clear recents" action). Purges the shared
  // call_records rows owned by this extension on the server.
  clearCallsByUser(ext: string): Promise<void> {
    return goRequest<unknown>(`/calls/${encodeURIComponent(ext)}`, {
      method: "DELETE",
    }).then(() => undefined);
  },

  // Aggregate dashboard metrics over call_records for the last `days` days
  // (default 7). Read-only; computed on demand by the Go API.
  getStats(days = 7): Promise<CallStats> {
    return goRequest<CallStats>(`/stats?days=${encodeURIComponent(days)}`);
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

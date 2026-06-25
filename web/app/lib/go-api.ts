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
  // Multipart uploads must NOT carry a JSON Content-Type — the browser sets the
  // multipart boundary itself when the body is FormData.
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
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
  // True when the caller's extension is in the server's ADMIN_EXTENSIONS
  // allow-list. Only the /auth/me response sets this (login does not), so the
  // app fills it in from the background /me refresh on boot.
  isAdmin?: boolean;
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
  /** Verified outbound caller ID (BYON), or "" when unset. Read-only here — it
   * is managed via the dedicated caller-id verify endpoints, not settings PUT. */
  outbound_caller_id: string;
  caller_id_verified: boolean;
  caller_id_verified_at: string | null;
}

/** Partial settings update — only the provided keys are changed server-side.
 * Caller-ID fields are read-only (owned by the verify flow) so they're excluded. */
export type GoSettingsInput = Partial<
  Omit<GoSettings, "extension" | "outbound_caller_id" | "caller_id_verified" | "caller_id_verified_at">
>;

/** Current outbound caller-ID status for the signed-in user. */
export interface CallerIdStatus {
  number: string;
  verified: boolean;
  verifiedAt: string | null;
}

/** Result of starting verification — Twilio calls the number and the user must
 * enter `validationCode` to complete it. */
export interface CallerIdVerifyStart {
  status: string;
  number: string;
  validationCode: string;
  callSid: string;
}

/** Prepaid wallet snapshot. `enabled` reflects the server's
 * BILLING_PREPAID_ENABLED — the wallet UI is hidden when it is false. */
export interface GoBalance {
  extension: string;
  balance: number;
  currency: string;
  enabled: boolean;
  updated_at: string;
}

/** One prepaid ledger entry. `amount` is signed (negative = call charge). */
export interface GoBalanceTxn {
  id: number;
  amount: number;
  currency: string;
  reason: string;
  call_id: string;
  created_at: string;
}

/** An upstream SIP trunk (PSTN gateway / ITSP). The secret is never returned —
 * `has_password` reports only whether one is stored. */
export interface GoTrunk {
  id: number;
  name: string;
  host: string;
  port: number;
  transport: "udp" | "tcp" | "tls";
  username: string;
  has_password: boolean;
  caller_number: string;
  prefix: string;
  codecs: string;
  enabled: boolean;
  last_status: string;
  last_tested_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Create/update payload for a trunk. Omit `password` to keep the stored one. */
export interface GoTrunkInput {
  name?: string;
  host?: string;
  port?: number;
  transport?: "udp" | "tcp" | "tls";
  username?: string;
  password?: string;
  caller_number?: string;
  prefix?: string;
  codecs?: string;
  enabled?: boolean;
}

/** Result of a SIP OPTIONS reachability probe against a trunk. */
export interface GoTrunkTestResult {
  ok: boolean;
  latency_ms: number;
  response?: string;
  error?: string;
}

/**
 * A developer API key for the embeddable click-to-call widget. The key is
 * locked to a single destination number and gated by allowed Origins + source
 * IPs. The secret (sk_…) is never returned after creation — `has_secret` only
 * reports whether one is stored; `secret` is populated ONLY in the create
 * response and shown to the user exactly once.
 */
export interface GoApiKey {
  id: number;
  label: string;
  public_key: string;
  has_secret: boolean;
  allowed_origins: string[];
  allowed_ips: string[];
  destination_number: string;
  caller_id: string;
  route_type: GoApiKeyRouteType;
  daily_cap: number;
  dev_mode: boolean;
  active: boolean;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  /** Plaintext secret (sk_…) — present ONLY in the create response. */
  secret?: string;
}

/**
 * How a widget call placed with the key is routed:
 *   "trunk"     → bridge to the PSTN trunk (destination is a phone number).
 *   "ivr"       → hand off to an internal IVR menu (destination is its extension).
 *   "extension" → ring an internal SIP extension (browser-to-browser).
 */
export type GoApiKeyRouteType = "trunk" | "ivr" | "extension";

/** Create/update payload for a developer API key. */
export interface GoApiKeyInput {
  label?: string;
  allowed_origins?: string[];
  allowed_ips?: string[];
  destination_number?: string;
  caller_id?: string;
  route_type?: GoApiKeyRouteType;
  daily_cap?: number;
  dev_mode?: boolean;
  active?: boolean;
}

/** A user-uploaded sound record (mirrors models.Sound). Served at `/sounds/<filename>`. */
export interface GoSound {
  id: number;
  extension: string;
  type: "caller_tune" | "ringtone" | "ivr";
  filename: string;
  original_name: string;
  created_at: string;
}

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

/** Summary returned by a CSV bulk rate import. */
export interface RateImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors?: string[];
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

// ─── Connectors (email / webhook integrations) ──────────

export type GoConnectorType = "email" | "webhook";

/** SMTP email connector settings. `password` is write-only — never returned by
 * the API; leave it blank on update to keep the stored one. */
export interface GoEmailConnectorConfig {
  host?: string;
  port?: number;
  secure?: boolean;
  username?: string;
  password?: string;
  fromEmail?: string;
  fromName?: string;
}

/** HTTP webhook connector settings. `secret` is write-only (HMAC signing). */
export interface GoWebhookConnectorConfig {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  secret?: string;
}

export type GoConnectorConfig = GoEmailConnectorConfig & GoWebhookConnectorConfig;

/**
 * A reusable outbound integration the IVR flow builder can trigger. Secret
 * config fields are stripped from reads — `has_secret` reports only whether one
 * is stored.
 */
export interface GoConnector {
  id: number;
  name: string;
  type: GoConnectorType;
  enabled: boolean;
  config: GoConnectorConfig;
  has_secret: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Partial create/update of a connector. `config` is a full replacement of the
 * type-specific settings (blank secret fields keep the stored value). */
export interface GoConnectorInput {
  name?: string;
  type?: GoConnectorType;
  enabled?: boolean;
  config?: GoConnectorConfig;
}

// ─── Personal contacts (per-user address book) ──────────

/** A user's personal address-book entry. Owner-scoped: the API only ever
 * returns the caller's own contacts (not the global SIP directory). */
export interface GoContact {
  id: number;
  ownerExtension: string;
  name: string;
  extension: string;
  username?: string;
  createdAt: string;
  updatedAt: string;
}

/** Partial create/update of a personal contact. */
export interface GoContactInput {
  name?: string;
  extension?: string;
  username?: string;
}

// ─── Per-user inbound routing rules ─────────────────────

/** How a routing rule matches inbound calls. */
export type GoRoutingMatchType = "all" | "number";

/** Where a matched call is routed. */
export type GoRoutingDestinationType =
  | "ivr"
  | "extension"
  | "pstn"
  | "voicemail";

/** A user's per-user inbound call-routing rule. Owner-scoped: the API only
 * ever returns the caller's own rules. A rule sends the user's inbound calls
 * to an IVR flow, another extension, a PSTN number, or voicemail. */
export interface GoRoutingRule {
  id: number;
  ownerExtension: string;
  /** "all" → every inbound call to the owner; "number" → a specific dialed number. */
  matchType: GoRoutingMatchType;
  /** The dialed number to match when matchType is "number". */
  matchNumber?: string;
  destinationType: GoRoutingDestinationType;
  /** IVR entry extension, target extension, or PSTN number. Empty for voicemail. */
  destinationValue?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Partial create/update of a routing rule. */
export interface GoRoutingRuleInput {
  matchType?: GoRoutingMatchType;
  matchNumber?: string;
  destinationType?: GoRoutingDestinationType;
  destinationValue?: string;
  enabled?: boolean;
}

// ─── Routing schedules (business hours + per-user availability) ──────────

/** One open interval on a weekday (0 = Sun … 6 = Sat), minutes from midnight. */
export interface GoScheduleWindow {
  day_of_week: number;
  start_minute: number;
  end_minute: number;
  /** Per-window enable flag (availability windows only). */
  enabled?: boolean;
}

/** A one-off calendar-date override of the weekly business hours. */
export interface GoBusinessHoursException {
  id?: number;
  /** 'YYYY-MM-DD'. */
  date: string;
  /** Closed for the whole day; when false, start/end define the open window. */
  closed_all_day: boolean;
  start_minute?: number | null;
  end_minute?: number | null;
  note?: string;
}

/** Global business-hours policy returned by GET /business-hours. */
export interface GoBusinessHours {
  id: number;
  timezone: string;
  enabled: boolean;
  windows: GoScheduleWindow[];
  exceptions: GoBusinessHoursException[];
}

/** Upsert payload for the global business-hours policy (PUT /business-hours). */
export interface GoBusinessHoursInput {
  timezone: string;
  enabled: boolean;
  windows: GoScheduleWindow[];
  exceptions: GoBusinessHoursException[];
}

/** One stored availability window for a user (GET /availability/:ext). */
export interface GoAvailabilityWindow {
  id: number;
  extension: string;
  day_of_week: number;
  start_minute: number;
  end_minute: number;
  timezone: string;
  enabled: boolean;
}

/** Replace payload for a user's availability windows (PUT /availability/:ext). */
export interface GoAvailabilityInput {
  timezone: string;
  windows: GoScheduleWindow[];
}

/** One admin-overridden routing announcement (GET/PUT /routing-prompts). */
export interface GoRoutingPrompt {
  key: string;
  text: string;
  updated_at?: string;
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

// A single persisted audit-log row, as returned by the Go `/audit` API.
export interface GoAuditLog {
  id: number;
  extension: string;
  event: string;
  detail: string;
  createdAt: string;
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
     * Requests an SMS one-time code. purpose "signup" requires the number to be
     * new; "login" requires it to have an account (but always reports success to
     * avoid revealing which numbers are registered).
     */
    requestOtp(mobile: string, purpose: "signup" | "login"): Promise<void> {
      return goRequest<void>(
        "/auth/otp/request",
        { method: "POST", body: JSON.stringify({ mobile, purpose }) },
        false
      );
    },
    /**
     * Completes mobile-verified signup with the SMS code. Issues tokens + SIP
     * config on success, exactly like {@link signup}.
     */
    signupVerify(name: string, mobile: string, password: string, code: string): Promise<AuthResult> {
      return goRequest<AuthResult>(
        "/auth/signup/verify",
        { method: "POST", body: JSON.stringify({ name, mobile, password, code }) },
        false
      );
    },
    /**
     * Passwordless login: mobile + the SMS code. Issues tokens + SIP config on
     * success, exactly like {@link login}.
     */
    loginOtp(mobile: string, code: string): Promise<AuthResult> {
      return goRequest<AuthResult>(
        "/auth/login/otp",
        { method: "POST", body: JSON.stringify({ mobile, code }) },
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

  // Outbound caller ID (BYON). The server derives the extension from the JWT, so
  // these take no path param — a user only ever manages their own caller ID.
  callerId: {
    get(): Promise<CallerIdStatus> {
      return goRequest<CallerIdStatus>(`/caller-id`);
    },
    /** Start verification. Twilio calls `number`; show the returned
     * `validationCode` for the user to key in on that call. */
    startVerify(number: string, countryCode = ""): Promise<CallerIdVerifyStart> {
      return goRequest<CallerIdVerifyStart>(`/caller-id/verify/start`, {
        method: "POST",
        body: JSON.stringify({ number, countryCode }),
      });
    },
    /** Re-check Twilio and flip to verified once the call has been completed. */
    confirmVerify(): Promise<CallerIdStatus> {
      return goRequest<CallerIdStatus>(`/caller-id/verify/confirm`, {
        method: "POST",
      });
    },
    remove(): Promise<null> {
      return goRequest<null>(`/caller-id`, { method: "DELETE" });
    },
  },

  // Prepaid wallet. Self-reads (no ext) derive the extension from the JWT; the
  // admin variants require an extension in ADMIN_EXTENSIONS server-side.
  balance: {
    /** The caller's own wallet (and whether prepaid billing is enabled). */
    get(): Promise<GoBalance> {
      return goRequest<GoBalance>(`/balance`);
    },
    /** The caller's own recent ledger entries, newest first. */
    txns(limit = 50): Promise<GoBalanceTxn[]> {
      return goRequest<GoBalanceTxn[]>(`/balance/txns?limit=${limit}`);
    },
    /** Admin: read any user's wallet. */
    getByExt(ext: string): Promise<GoBalance> {
      return goRequest<GoBalance>(`/balance/${encodeURIComponent(ext)}`);
    },
    /** Admin: read any user's ledger. */
    txnsByExt(ext: string, limit = 50): Promise<GoBalanceTxn[]> {
      return goRequest<GoBalanceTxn[]>(`/balance/${encodeURIComponent(ext)}/txns?limit=${limit}`);
    },
    /** Admin: credit a user's wallet by a positive amount. */
    topup(ext: string, amount: number, reason = "topup"): Promise<GoBalance> {
      return goRequest<GoBalance>(`/balance/${encodeURIComponent(ext)}/topup`, {
        method: "POST",
        body: JSON.stringify({ amount, reason }),
      });
    },
  },

  // Upstream SIP trunks (PSTN gateways). Admin-only on the server (ADMIN_EXTENSIONS).
  trunks: {
    /** List every configured trunk. */
    list(): Promise<GoTrunk[]> {
      return goRequest<GoTrunk[]>(`/trunks`);
    },
    /** Fetch a single trunk by id. */
    get(id: number): Promise<GoTrunk> {
      return goRequest<GoTrunk>(`/trunks/${id}`);
    },
    /** Create a trunk. */
    create(input: GoTrunkInput): Promise<GoTrunk> {
      return goRequest<GoTrunk>(`/trunks`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    /** Update a trunk (omit `password` to keep the stored secret). */
    update(id: number, input: GoTrunkInput): Promise<GoTrunk> {
      return goRequest<GoTrunk>(`/trunks/${id}`, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    /** Delete a trunk. */
    remove(id: number): Promise<void> {
      return goRequest<void>(`/trunks/${id}`, { method: "DELETE" });
    },
    /** Fire a SIP OPTIONS ping at the trunk and return the reachability result. */
    test(id: number): Promise<GoTrunkTestResult> {
      return goRequest<GoTrunkTestResult>(`/trunks/${id}/test`, { method: "POST" });
    },
  },

  // Developer API keys for the embeddable click-to-call widget. Owner-scoped on
  // the server (the owning extension comes from the JWT, never the body).
  apiKeys: {
    /** List the caller's API keys. */
    list(): Promise<GoApiKey[]> {
      return goRequest<GoApiKey[]>(`/api-keys`);
    },
    /** Create a key. The response includes the plaintext `secret` exactly once. */
    create(input: GoApiKeyInput): Promise<GoApiKey> {
      return goRequest<GoApiKey>(`/api-keys`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    /** Update a key (label / allow-lists / destination / caller-id / cap / active). */
    update(id: number, input: GoApiKeyInput): Promise<GoApiKey> {
      return goRequest<GoApiKey>(`/api-keys/${id}`, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    /** Revoke (delete) a key. */
    remove(id: number): Promise<void> {
      return goRequest<void>(`/api-keys/${id}`, { method: "DELETE" });
    },
  },

  // Custom sounds (caller_tune / ringtone / ivr). The server derives the owning
  // extension from the JWT, so upload only sends the type + file (multipart).
  getSounds(ext: string): Promise<GoSound[]> {
    return goRequest<GoSound[]>(`/sounds/${encodeURIComponent(ext)}`);
  },
  uploadSound(
    type: "caller_tune" | "ringtone" | "ivr",
    file: File,
  ): Promise<{ filename: string; id: number }> {
    const form = new FormData();
    form.append("type", type);
    form.append("file", file);
    return goRequest<{ filename: string; id: number }>(`/sounds/upload`, {
      method: "POST",
      body: form,
    });
  },
  deleteSound(id: number): Promise<{ id: number }> {
    return goRequest<{ id: number }>(`/sounds/${id}`, { method: "DELETE" });
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
  /** Bulk-import rates from CSV text (columns: prefix, description, sell, buy,
   * setup, increment, min). Existing prefixes are overwritten. */
  importRates(planId: number, csv: string): Promise<RateImportResult> {
    return goRequest<RateImportResult>(`/rate-plans/${planId}/rates/import`, {
      method: "POST",
      body: JSON.stringify({ csv }),
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

  // Persisted audit history for one extension (read-only). Self-or-admin on the
  // server, so a regular user can read their own activity.
  getAudit(ext: string, limit = 50): Promise<GoAuditLog[]> {
    return goRequest<GoAuditLog[]>(
      `/audit/${encodeURIComponent(ext)}?limit=${encodeURIComponent(limit)}`
    );
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

  // Outbound integration connectors (email / webhook) the IVR builder triggers.
  connectors: {
    list(): Promise<GoConnector[]> {
      return goRequest<GoConnector[]>(`/connectors`);
    },
    get(id: number): Promise<GoConnector> {
      return goRequest<GoConnector>(`/connectors/${id}`);
    },
    create(input: GoConnectorInput): Promise<GoConnector> {
      return goRequest<GoConnector>(`/connectors`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    update(id: number, input: GoConnectorInput): Promise<GoConnector> {
      return goRequest<GoConnector>(`/connectors/${id}`, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    remove(id: number): Promise<void> {
      return goRequest<unknown>(`/connectors/${id}`, {
        method: "DELETE",
      }).then(() => undefined);
    },
  },

  // Personal address book: each user's own contacts (owner-scoped CRUD).
  contacts: {
    list(): Promise<GoContact[]> {
      return goRequest<GoContact[]>(`/contacts`);
    },
    create(input: GoContactInput): Promise<GoContact> {
      return goRequest<GoContact>(`/contacts`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    update(id: number, input: GoContactInput): Promise<GoContact> {
      return goRequest<GoContact>(`/contacts/${id}`, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    remove(id: number): Promise<void> {
      return goRequest<unknown>(`/contacts/${id}`, {
        method: "DELETE",
      }).then(() => undefined);
    },
  },

  // Per-user inbound routing rules: each user's own rules (owner-scoped CRUD).
  // A rule routes the user's inbound calls to an IVR flow, another extension,
  // a PSTN number, or voicemail.
  routing: {
    list(): Promise<GoRoutingRule[]> {
      return goRequest<GoRoutingRule[]>(`/routing-rules`);
    },
    create(input: GoRoutingRuleInput): Promise<GoRoutingRule> {
      return goRequest<GoRoutingRule>(`/routing-rules`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    update(id: number, input: GoRoutingRuleInput): Promise<GoRoutingRule> {
      return goRequest<GoRoutingRule>(`/routing-rules/${id}`, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    remove(id: number): Promise<void> {
      return goRequest<unknown>(`/routing-rules/${id}`, {
        method: "DELETE",
      }).then(() => undefined);
    },
  },

  // Routing schedules: global business hours + per-user availability windows.
  schedule: {
    getBusinessHours(): Promise<GoBusinessHours> {
      return goRequest<GoBusinessHours>(`/business-hours`);
    },
    saveBusinessHours(input: GoBusinessHoursInput): Promise<GoBusinessHours> {
      return goRequest<GoBusinessHours>(`/business-hours`, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    getAvailability(ext: string): Promise<GoAvailabilityWindow[]> {
      return goRequest<GoAvailabilityWindow[]>(
        `/availability/${encodeURIComponent(ext)}`
      );
    },
    saveAvailability(
      ext: string,
      input: GoAvailabilityInput
    ): Promise<GoAvailabilityWindow[]> {
      return goRequest<GoAvailabilityWindow[]>(
        `/availability/${encodeURIComponent(ext)}`,
        { method: "PUT", body: JSON.stringify(input) }
      );
    },
    getPrompts(): Promise<GoRoutingPrompt[]> {
      return goRequest<GoRoutingPrompt[]>(`/routing-prompts`);
    },
    savePrompts(prompts: GoRoutingPrompt[]): Promise<GoRoutingPrompt[]> {
      return goRequest<GoRoutingPrompt[]>(`/routing-prompts`, {
        method: "PUT",
        body: JSON.stringify({ prompts }),
      });
    },
  },
};

export { goRequest };

import { WidgetConfig, WidgetError, WidgetSession } from "./types";

// Thin client for the widget HTTP endpoints. Every response uses the API's
// { success, message, data } envelope; we surface `message` as the error so the
// widget can show exactly why a key was refused (unknown key, origin/IP not
// allowed, disabled, daily cap reached…). The browser sets the Origin header
// automatically on these cross-origin POSTs, which is what the server validates.
async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "omit",
      mode: "cors",
    });
  } catch {
    throw new WidgetError("Could not reach the voice service", 0);
  }

  let json: { success?: boolean; message?: string; data?: unknown } | null = null;
  try {
    json = (await res.json()) as { success?: boolean; message?: string; data?: unknown };
  } catch {
    /* non-JSON body */
  }

  if (!res.ok || !json || json.success === false) {
    throw new WidgetError(json?.message || `Request failed (${res.status})`, res.status);
  }
  return (json.data ?? json) as T;
}

/** Validate the publishable key (+ Origin/IP) and fetch display/connect config. */
export function fetchWidgetConfig(apiBase: string, publicKey: string): Promise<WidgetConfig> {
  return postJson<WidgetConfig>(`${apiBase}/api/n/widget/config`, { publicKey });
}

/** Mint a short-lived capability session for a single call. */
export function fetchWidgetSession(apiBase: string, publicKey: string): Promise<WidgetSession> {
  return postJson<WidgetSession>(`${apiBase}/api/n/widget/session`, { publicKey });
}

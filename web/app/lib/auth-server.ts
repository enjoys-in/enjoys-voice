import { cookies } from "next/headers";
import { verifyAuthToken, type ServerSession } from "./jwt-verify";

export type { ServerSession };

/**
 * Reads and verifies the httpOnly access-token cookie on the server, returning
 * the session (or null). Server Components call this to decide the initial auth
 * state without a client round-trip, so the very first paint already reflects
 * whether the user is signed in — no login-screen flash, no boot `/me` wait.
 */
export async function getServerSession(): Promise<ServerSession | null> {
  const store = await cookies();
  const token = store.get("token")?.value;
  return verifyAuthToken(token);
}

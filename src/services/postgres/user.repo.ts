import { getPool } from './pool';

/**
 * A user row as stored by the Go API in the shared `users` table. The password
 * column is intentionally NOT selected — Node no longer authenticates with
 * passwords (the signaling WS verifies the Go-issued JWT, and SIP REGISTER only
 * checks that the user exists), so the hash never needs to leave Postgres.
 */
export interface DbUser {
  id: number;
  extension: string;
  username: string;
  name: string;
  mobile: string;
}

/** Load every user's identity from Postgres, ordered by id (stable). */
export async function loadAllUsers(): Promise<DbUser[]> {
  const { rows } = await getPool().query<DbUser>(
    'SELECT id, extension, username, name, mobile FROM users ORDER BY id',
  );
  return rows;
}

/** Load a single user's identity by extension, or null if not found. */
export async function loadUserByExtension(extension: string): Promise<DbUser | null> {
  const { rows } = await getPool().query<DbUser>(
    'SELECT id, extension, username, name, mobile FROM users WHERE extension = $1 LIMIT 1',
    [extension],
  );
  return rows[0] ?? null;
}

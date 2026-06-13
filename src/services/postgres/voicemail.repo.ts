import { getPool } from './pool';
import { config } from '@/core';
import type { Voicemail } from '@/core';

/**
 * Direct CRUD against the shared Postgres `voicemails` table — the single source
 * of truth the Go dashboard also reads. Node keeps NO in-memory copy: the SIP
 * IVR inserts a row when it records a message, and the HTTP API reads / updates
 * / deletes rows on demand. A message is therefore reachable the instant it's
 * saved and survives restarts. The `voicemails` SERIAL id is surfaced as the
 * string `id` the routes address. The Go schema has no `fromName` column, so the
 * caller's display name isn't persisted (the UI formats the number instead).
 */

/** Map a `voicemails` row back onto the Voicemail shape the HTTP API returns. */
function rowToVoicemail(r: {
  id: number; extension: string; from: string; filename: string;
  duration: number | string | null; read: boolean; created_at: Date | string;
}): Voicemail {
  return {
    id: String(r.id),
    mailbox: r.extension,
    from: r.from,
    fromName: '',
    file: r.filename,
    // pg returns BIGINT/NUMERIC as a string; normalise back to a number.
    duration: r.duration != null ? Number(r.duration) : undefined,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    read: !!r.read,
  };
}

/** The container path FreeSWITCH records to, stored so Go can locate the file. */
function absolutePath(file: string): string {
  return `${config.voicemail.fsDir.replace(/\/$/, '')}/${file}`;
}

/** Parse a route `:id` (the SERIAL id as a string) to a positive integer. */
function parseId(id: string): number | undefined {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

const SELECT_COLS = `id, extension, "from", filename, duration, read, created_at`;

export async function insertVoicemail(vm: Voicemail): Promise<void> {
  await getPool().query(
    `INSERT INTO voicemails (extension, "from", filename, duration, path, read, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [vm.mailbox, vm.from, vm.file, vm.duration ?? 0, absolutePath(vm.file), vm.read, vm.createdAt],
  );
}

/**
 * Fetch a mailbox's voicemails (newest first) AND its unread count in ONE
 * round-trip. A window `COUNT(*) FILTER (WHERE read = FALSE) OVER ()` tags every
 * row with the same unread total, so the list endpoint no longer needs a second
 * COUNT query. An empty result simply means zero messages and zero unread.
 */
export async function selectVoicemailsWithUnread(
  extension: string,
): Promise<{ voicemails: Voicemail[]; unread: number }> {
  const { rows } = await getPool().query(
    `SELECT ${SELECT_COLS},
            COUNT(*) FILTER (WHERE read = FALSE) OVER ()::int AS unread_total
       FROM voicemails
      WHERE extension = $1
      ORDER BY created_at DESC NULLS LAST, id DESC`,
    [extension],
  );
  return {
    voicemails: rows.map(rowToVoicemail),
    unread: rows[0]?.unread_total ?? 0,
  };
}

/** A single voicemail owned by the mailbox, or undefined. */
export async function selectVoicemail(extension: string, id: string): Promise<Voicemail | undefined> {
  const pid = parseId(id);
  if (pid === undefined) return undefined;
  const { rows } = await getPool().query(
    `SELECT ${SELECT_COLS} FROM voicemails WHERE extension = $1 AND id = $2`,
    [extension, pid],
  );
  return rows[0] ? rowToVoicemail(rows[0]) : undefined;
}

/** Mark one voicemail read. Returns false if no matching row was found. */
export async function updateVoicemailRead(extension: string, id: string): Promise<boolean> {
  const pid = parseId(id);
  if (pid === undefined) return false;
  const { rowCount } = await getPool().query(
    `UPDATE voicemails SET read = TRUE WHERE extension = $1 AND id = $2`,
    [extension, pid],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Delete one voicemail and return its filename in the SAME query so the caller
 * can clean up the audio file on disk without a preceding SELECT. Returns
 * undefined if no matching row was found (nothing to delete or unlink).
 */
export async function removeVoicemail(extension: string, id: string): Promise<string | undefined> {
  const pid = parseId(id);
  if (pid === undefined) return undefined;
  const { rows } = await getPool().query(
    `DELETE FROM voicemails WHERE extension = $1 AND id = $2 RETURNING filename`,
    [extension, pid],
  );
  return rows[0]?.filename as string | undefined;
}

/** Count unread voicemails for a mailbox. */
export async function countUnreadVoicemails(extension: string): Promise<number> {
  const { rows } = await getPool().query(
    `SELECT COUNT(*)::int AS count FROM voicemails WHERE extension = $1 AND read = FALSE`,
    [extension],
  );
  return rows[0]?.count ?? 0;
}

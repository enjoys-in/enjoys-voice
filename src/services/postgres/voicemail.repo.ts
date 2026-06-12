import { getPool } from './pool';
import { config } from '@/core';
import type { Voicemail } from '@/core';

/**
 * Maps the Node voicemail shape onto the shared Postgres `voicemails` table the
 * Go dashboard reads. Field mapping: mailbox→extension, file→filename, and the
 * absolute on-disk path (recordings dir + relative file) →path. The Go schema
 * has no `fromName` column, so the caller's display name is intentionally not
 * persisted (the dashboard formats the number instead).
 */
function absolutePath(file: string): string {
  return `${config.voicemail.fsDir.replace(/\/$/, '')}/${file}`;
}

export async function insertVoicemail(vm: Voicemail): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO voicemails (extension, "from", filename, duration, path, read, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [vm.mailbox, vm.from, vm.file, vm.duration ?? 0, absolutePath(vm.file), vm.read, vm.createdAt],
  );
}

/**
 * Mark a voicemail read in Postgres. Node's in-memory id (a UUID) has no
 * counterpart in the SERIAL-keyed table, so rows are matched by the naturally
 * unique (extension, filename) pair instead.
 */
export async function markVoicemailReadByFile(extension: string, filename: string): Promise<void> {
  const pool = getPool();
  await pool.query(`UPDATE voicemails SET read = TRUE WHERE extension = $1 AND filename = $2`, [
    extension,
    filename,
  ]);
}

export async function deleteVoicemailByFile(extension: string, filename: string): Promise<void> {
  const pool = getPool();
  await pool.query(`DELETE FROM voicemails WHERE extension = $1 AND filename = $2`, [
    extension,
    filename,
  ]);
}

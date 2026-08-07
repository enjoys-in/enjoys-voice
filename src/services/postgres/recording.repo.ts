import { getPool } from './pool';

/** A call recording row to persist into the Go-owned `recordings` table so it
 * shows up in the owner's playback list. */
export interface NewRecording {
  /** Owning extension (a local party to the call). */
  extension: string;
  callId: string;
  filename: string;
  duration: number;
  /** Host-visible absolute path the Go API streams the WAV from. */
  path: string;
}

/** Insert a call recording. Best-effort: callers should catch so a failed write
 * never affects call teardown. */
export async function insertRecording(rec: NewRecording): Promise<void> {
  await getPool().query(
    `INSERT INTO recordings (extension, call_id, filename, duration, path, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [rec.extension, rec.callId, rec.filename, rec.duration, rec.path],
  );
}

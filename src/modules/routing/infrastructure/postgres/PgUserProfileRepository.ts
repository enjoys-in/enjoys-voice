import { getPool } from '@/services/postgres';
import type { UserProfile, UserProfileRepository } from '../../contracts/UserProfileRepository';

interface UserProfileRow {
  extension: string;
  dnd: boolean;
  pstn_mobile: string | null;
}

export class PgUserProfileRepository implements UserProfileRepository {
  async getByExtension(extension: string): Promise<UserProfile | undefined> {
    if (!extension) return undefined;

    const { rows } = await getPool().query<UserProfileRow>(
      `SELECT extension, COALESCE(dnd, false) AS dnd, pstn_mobile
       FROM user_settings
       WHERE extension = $1
       LIMIT 1`,
      [extension],
    );

    const row = rows[0];
    if (!row) return undefined;

    return {
      extension: row.extension,
      dnd: row.dnd,
      pstnMobile: row.pstn_mobile ?? undefined,
    };
  }
}

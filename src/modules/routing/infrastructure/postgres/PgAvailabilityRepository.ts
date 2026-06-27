import { getPool } from '@/services/postgres';
import type { AvailabilityRepository } from '../../contracts/AvailabilityRepository';
import type { AvailabilityWindow } from '../../domain/entities/AvailabilityWindow';

interface AvailabilityWindowRow {
  extension: string;
  day_of_week: number;
  start_minute: number;
  end_minute: number;
  timezone: string;
  enabled: boolean;
}

export class PgAvailabilityRepository implements AvailabilityRepository {
  async getByExtension(extension: string): Promise<AvailabilityWindow[]> {
    if (!extension) return [];

    try {
      const { rows } = await getPool().query<AvailabilityWindowRow>(
        `SELECT extension, day_of_week, start_minute, end_minute, timezone, enabled
         FROM user_availability_windows
         WHERE extension = $1
         ORDER BY day_of_week, start_minute`,
        [extension],
      );

      return rows.map((r) => ({
        extension: r.extension,
        dayOfWeek: r.day_of_week,
        startMinute: r.start_minute,
        endMinute: r.end_minute,
        timezone: r.timezone,
        enabled: r.enabled,
      }));
    } catch (err: any) {
      // Backward compatibility: before migration, missing table means "always available".
      if (typeof err?.message === 'string' && err.message.includes('does not exist')) return [];
      throw err;
    }
  }
}

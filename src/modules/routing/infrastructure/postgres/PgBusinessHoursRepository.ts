import { getPool } from '@/services/postgres';
import type { BusinessHoursRepository } from '../../contracts/BusinessHoursRepository';
import type { BusinessHoursPolicy } from '../../domain/entities/BusinessHoursPolicy';

interface PolicyRow {
  id: number;
  timezone: string;
  enabled: boolean;
}

interface WindowRow {
  day_of_week: number;
  start_minute: number;
  end_minute: number;
}

interface ExceptionRow {
  date: string;
  closed_all_day: boolean;
  start_minute: number | null;
  end_minute: number | null;
  note: string | null;
}

export class PgBusinessHoursRepository implements BusinessHoursRepository {
  async getPolicy(): Promise<BusinessHoursPolicy | undefined> {
    try {
      const { rows: policyRows } = await getPool().query<PolicyRow>(
        `SELECT id, timezone, enabled
         FROM business_hours_policies
         ORDER BY id ASC
         LIMIT 1`,
      );

      const policy = policyRows[0];
      if (!policy) return undefined;

      const { rows: windows } = await getPool().query<WindowRow>(
        `SELECT day_of_week, start_minute, end_minute
         FROM business_hours_windows
         WHERE policy_id = $1
         ORDER BY day_of_week, start_minute`,
        [policy.id],
      );

      // Only upcoming/today exceptions matter for live routing; bound the read so
      // the holiday list can't grow unboundedly over the years.
      const { rows: exceptions } = await getPool().query<ExceptionRow>(
        `SELECT to_char(exception_date, 'YYYY-MM-DD') AS date,
                closed_all_day, start_minute, end_minute, note
         FROM business_hours_exceptions
         WHERE policy_id = $1 AND exception_date >= CURRENT_DATE
         ORDER BY exception_date ASC`,
        [policy.id],
      );

      return {
        timezone: policy.timezone,
        enabled: policy.enabled,
        windows: windows.map((w) => ({
          dayOfWeek: w.day_of_week,
          startMinute: w.start_minute,
          endMinute: w.end_minute,
        })),
        exceptions: exceptions.map((e) => ({
          date: e.date,
          closedAllDay: e.closed_all_day,
          startMinute: e.start_minute,
          endMinute: e.end_minute,
          note: e.note ?? undefined,
        })),
      };
    } catch (err: any) {
      // Backward compatibility: before migration, missing table means "always open".
      if (typeof err?.message === 'string' && err.message.includes('does not exist')) return undefined;
      throw err;
    }
  }
}

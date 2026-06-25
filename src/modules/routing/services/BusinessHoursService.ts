import type { BusinessHoursRepository } from '../contracts/BusinessHoursRepository';

export class BusinessHoursService {
  constructor(private readonly repo: BusinessHoursRepository) {}

  async isOpen(now: Date): Promise<boolean> {
    const policy = await this.repo.getPolicy();
    if (!policy || !policy.enabled) return true;

    const minute = now.getHours() * 60 + now.getMinutes();

    // A calendar-date exception (holiday / special day) overrides the weekly
    // schedule. Dates are compared in the same local-time basis the weekly
    // windows use below.
    const today = localDateKey(now);
    const exception = policy.exceptions.find((e) => e.date === today);
    if (exception) {
      if (exception.closedAllDay) return false;
      if (exception.startMinute == null || exception.endMinute == null) return false;
      return minute >= exception.startMinute && minute < exception.endMinute;
    }

    const day = now.getDay();
    return policy.windows.some((w) => (
      w.dayOfWeek === day && minute >= w.startMinute && minute < w.endMinute
    ));
  }
}

/** Local-time calendar date as 'YYYY-MM-DD' (matches the weekly-window basis). */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

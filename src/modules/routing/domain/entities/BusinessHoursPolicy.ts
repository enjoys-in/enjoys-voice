export interface BusinessHoursPolicy {
  timezone: string;
  enabled: boolean;
  windows: Array<{
    dayOfWeek: number;
    startMinute: number;
    endMinute: number;
  }>;
  /**
   * One-off calendar-date overrides of the weekly schedule (holidays / special
   * days). A matching exception takes precedence over `windows`: `closedAllDay`
   * shuts the company for the whole date, otherwise `startMinute`/`endMinute`
   * are the only open window that day.
   */
  exceptions: Array<{
    date: string; // 'YYYY-MM-DD'
    closedAllDay: boolean;
    startMinute: number | null;
    endMinute: number | null;
    note?: string;
  }>;
}

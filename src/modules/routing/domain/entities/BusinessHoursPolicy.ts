export interface BusinessHoursPolicy {
  timezone: string;
  enabled: boolean;
  windows: Array<{
    dayOfWeek: number;
    startMinute: number;
    endMinute: number;
  }>;
}

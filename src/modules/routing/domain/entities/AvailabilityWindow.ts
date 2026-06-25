export interface AvailabilityWindow {
  extension: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  timezone: string;
  enabled: boolean;
}

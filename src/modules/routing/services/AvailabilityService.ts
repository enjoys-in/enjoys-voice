import type { AvailabilityRepository } from '../contracts/AvailabilityRepository';

export class AvailabilityService {
  constructor(private readonly repo: AvailabilityRepository) {}

  async isWithinUserHours(extension: string, now: Date): Promise<boolean> {
    const windows = await this.repo.getByExtension(extension);
    if (!windows.length) return true;

    const day = now.getDay();
    const minute = now.getHours() * 60 + now.getMinutes();

    return windows.some((w) => {
      if (!w.enabled || w.dayOfWeek !== day) return false;
      return minute >= w.startMinute && minute < w.endMinute;
    });
  }
}

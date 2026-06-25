import type { BusinessHoursRepository } from '../contracts/BusinessHoursRepository';

export class BusinessHoursService {
  constructor(private readonly repo: BusinessHoursRepository) {}

  async isOpen(now: Date): Promise<boolean> {
    const policy = await this.repo.getPolicy();
    if (!policy || !policy.enabled) return true;

    const day = now.getDay();
    const minute = now.getHours() * 60 + now.getMinutes();

    return policy.windows.some((w) => (
      w.dayOfWeek === day && minute >= w.startMinute && minute < w.endMinute
    ));
  }
}

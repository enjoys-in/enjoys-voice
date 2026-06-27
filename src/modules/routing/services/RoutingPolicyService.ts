import { AvailabilityService } from './AvailabilityService';
import { BusinessHoursService } from './BusinessHoursService';
import { PresenceService } from './PresenceService';

export interface RoutingPolicySnapshot {
  companyOpen: boolean;
  userWithinHours: boolean;
  userOnline: boolean;
  userDnd: boolean;
}

export class RoutingPolicyService {
  constructor(
    private readonly availability: AvailabilityService,
    private readonly businessHours: BusinessHoursService,
    private readonly presence: PresenceService,
  ) {}

  async snapshot(extension: string, now: Date, userDnd = false): Promise<RoutingPolicySnapshot> {
    const [companyOpen, userWithinHours] = await Promise.all([
      this.businessHours.isOpen(now),
      this.availability.isWithinUserHours(extension, now),
    ]);

    return {
      companyOpen,
      userWithinHours,
      userOnline: this.presence.isOnline(extension),
      userDnd,
    };
  }
}

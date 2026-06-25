import type { BusinessHoursPolicy } from '../domain/entities/BusinessHoursPolicy';

export interface BusinessHoursRepository {
  getPolicy(): Promise<BusinessHoursPolicy | undefined>;
}

import type { AvailabilityWindow } from '../domain/entities/AvailabilityWindow';

export interface AvailabilityRepository {
  getByExtension(extension: string): Promise<AvailabilityWindow[]>;
}

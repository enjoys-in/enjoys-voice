import type { PresenceProvider } from '../contracts/PresenceProvider';

export class PresenceService {
  constructor(private readonly presence: PresenceProvider) {}

  isOnline(extension: string): boolean {
    return this.presence.isOnline(extension);
  }
}

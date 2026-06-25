import type { DatabaseService } from '@/services/database.service';
import type { PresenceProvider } from '../../contracts/PresenceProvider';

export class DatabasePresenceProvider implements PresenceProvider {
  constructor(private readonly db: DatabaseService) {}

  isOnline(extension: string): boolean {
    if (!extension) return false;
    return this.db.isRegistered(extension);
  }
}

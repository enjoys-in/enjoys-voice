export interface PresenceProvider {
  isOnline(extension: string): boolean;
}

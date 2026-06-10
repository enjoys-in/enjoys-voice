import { CallLog, SipUser, SipRegistration, config } from '@/core';

export class DatabaseService {
  private users = new Map<string, SipUser>();
  private callLogs: CallLog[] = [];
  private registrations = new Map<string, SipRegistration>();

  constructor() {
    this.seed();
  }

  private seed(): void {
    for (const u of config.sipUsers) {
      const user: SipUser = { ...u, registered: false };
      this.users.set(u.extension, user);
      this.users.set(u.username, user);
    }
  }

  // ─── Users ───────────────────────────────────────────

  getUser(extensionOrUsername: string): SipUser | undefined {
    return this.users.get(extensionOrUsername);
  }

  authenticate(username: string, password: string): SipUser | null {
    for (const [, user] of this.users) {
      if ((user.username === username || user.extension === username) && user.password === password) {
        return user;
      }
    }
    return null;
  }

  addUser(user: SipUser): void {
    this.users.set(user.extension, user);
    this.users.set(user.username, user);
  }

  getUsers(): SipUser[] {
    const seen = new Set<string>();
    const result: SipUser[] = [];
    for (const [, user] of this.users) {
      if (!seen.has(user.extension)) {
        seen.add(user.extension);
        result.push(user);
      }
    }
    return result;
  }

  // ─── Registrations ───────────────────────────────────

  registerUser(extension: string, contact: string, expires: number, ua?: string, source?: { address: string; port: number; protocol: string }): void {
    this.registrations.set(extension, { contact, expires, ua, source });
    const user = this.users.get(extension);
    if (user) {
      user.registered = true;
      user.contact = contact;
      user.userAgent = ua;
    }
  }

  unregisterUser(extension: string): void {
    this.registrations.delete(extension);
    const user = this.users.get(extension);
    if (user) {
      user.registered = false;
      user.contact = undefined;
    }
  }

  getRegistration(extension: string): SipRegistration | undefined {
    return this.registrations.get(extension);
  }

  isRegistered(extension: string): boolean {
    return this.registrations.has(extension);
  }

  // ─── Call Logs ───────────────────────────────────────

  logCall(data: CallLog): void {
    this.callLogs.unshift(data);
    if (this.callLogs.length > 500) this.callLogs.pop();
  }

  updateCall(callId: string, updates: Partial<CallLog>): void {
    const call = this.callLogs.find(c => c.id === callId);
    if (call) Object.assign(call, updates);
  }

  getCalls(): CallLog[] {
    return this.callLogs;
  }

  getCallsByUser(extension: string): CallLog[] {
    return this.callLogs.filter(c => c.from === extension || c.to === extension);
  }
}

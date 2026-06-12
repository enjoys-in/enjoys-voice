import { CallLog, SipUser, SipRegistration, config } from '@/core';

export class DatabaseService {
  private users = new Map<string, SipUser>();
  private callLogs: CallLog[] = [];
  private registrations = new Map<string, SipRegistration>();
  /** phone number → extension lookup */
  private phoneIndex = new Map<string, string>();
  /** Track used extensions for collision avoidance */
  private usedExtensions = new Set<string>();

  constructor() {
    this.seed();
  }

  private seed(): void {
    for (const u of config.sipUsers) {
      const user: SipUser = { ...u, registered: false };
      this.users.set(u.extension, user);
      this.users.set(u.username, user);
      this.usedExtensions.add(u.extension);
    }
  }

  // ─── Signup / Extension Generation ───────────────────

  /**
   * Generate a unique 7-digit extension from a phone number.
   * Takes last 7 digits of the phone, if collision, increments.
   */
  private generateExtension(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    // Use last 7 digits as base
    let base = digits.slice(-7).padStart(7, '1');
    let ext = base;
    let attempts = 0;
    while (this.usedExtensions.has(ext) && attempts < 1000) {
      // Increment numerically
      const num = (parseInt(ext, 10) + 1) % 10000000;
      ext = num.toString().padStart(7, '0');
      attempts++;
    }
    return ext;
  }

  /**
   * Register a new user with phone number → auto-assigned 7-digit extension.
   * Returns the created user or null if phone already registered.
   */
  signup(name: string, mobile: string, password: string): SipUser | null {
    const normalized = mobile.replace(/\D/g, '');
    if (this.phoneIndex.has(normalized)) return null; // already exists

    const extension = this.generateExtension(normalized);
    const username = normalized; // phone number is the username

    const user: SipUser = {
      extension,
      username,
      password,
      name,
      mobile: normalized,
      registered: false,
    };

    this.users.set(extension, user);
    this.users.set(username, user);
    this.usedExtensions.add(extension);
    this.phoneIndex.set(normalized, extension);

    return user;
  }

  /** Lookup extension by phone number */
  getExtensionByPhone(phone: string): string | undefined {
    return this.phoneIndex.get(phone.replace(/\D/g, ''));
  }

  /** Lookup user by phone number */
  getUserByPhone(phone: string): SipUser | undefined {
    const ext = this.getExtensionByPhone(phone);
    return ext ? this.users.get(ext) : undefined;
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

  // ─── Block List ──────────────────────────────────────

  blockNumber(extension: string, numberToBlock: string): boolean {
    const user = this.users.get(extension);
    if (!user) return false;
    if (!user.blockedNumbers) user.blockedNumbers = [];
    if (!user.blockedNumbers.includes(numberToBlock)) {
      user.blockedNumbers.push(numberToBlock);
    }
    return true;
  }

  unblockNumber(extension: string, number: string): boolean {
    const user = this.users.get(extension);
    if (!user || !user.blockedNumbers) return false;
    user.blockedNumbers = user.blockedNumbers.filter(n => n !== number);
    return true;
  }

  isBlocked(calleeExtension: string, callerNumber: string): boolean {
    const user = this.users.get(calleeExtension);
    return user?.blockedNumbers?.includes(callerNumber) ?? false;
  }

  getBlockedNumbers(extension: string): string[] {
    return this.users.get(extension)?.blockedNumbers || [];
  }

  // ─── Call Forwarding ─────────────────────────────────

  setForwarding(extension: string, type: 'busy' | 'noAnswer' | 'unavailable', target: string | null): boolean {
    const user = this.users.get(extension);
    if (!user) return false;
    switch (type) {
      case 'busy': user.forwardOnBusy = target || undefined; break;
      case 'noAnswer': user.forwardOnNoAnswer = target || undefined; break;
      case 'unavailable': user.forwardOnUnavailable = target || undefined; break;
    }
    return true;
  }

  getForwarding(extension: string): { busy?: string; noAnswer?: string; unavailable?: string } {
    const user = this.users.get(extension);
    return {
      busy: user?.forwardOnBusy,
      noAnswer: user?.forwardOnNoAnswer,
      unavailable: user?.forwardOnUnavailable,
    };
  }

  setPstnForward(extension: string, enabled: boolean, target?: string): boolean {
    const user = this.users.get(extension);
    if (!user) return false;
    user.pstnForwardToBrowser = enabled;
    user.pstnForwardTarget = target || undefined;
    return true;
  }

  getPstnForward(extension: string): { enabled: boolean; target?: string } {
    const user = this.users.get(extension);
    return { enabled: user?.pstnForwardToBrowser ?? false, target: user?.pstnForwardTarget };
  }

  /** Find a user who has pstnForwardToBrowser enabled and matches the given phone number */
  findPstnForwardTarget(calledNumber: string): { user: SipUser; target: string } | undefined {
    const normalized = calledNumber.replace(/[^0-9]/g, '').slice(-10);
    for (const [, user] of this.users) {
      if (!user.pstnForwardToBrowser || !user.mobile) continue;
      const userMobile = user.mobile.replace(/[^0-9]/g, '').slice(-10);
      if (userMobile === normalized) {
        // target is either configured target or user's own extension
        const target = user.pstnForwardTarget || user.extension;
        return { user, target };
      }
    }
    return undefined;
  }
}

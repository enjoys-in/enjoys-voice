import { CallLog, SipUser, SipRegistration, Voicemail, DbEvent } from '@/core';
import { EventEmitter } from 'events';
import {
  loadAllUsers,
  loadUserByExtension,
  loadAllBlocked,
  loadAllForwarding,
  loadAllPstn,
  loadBlockedByExtension,
  loadForwardingByExtension,
  loadPstnByExtension,
  loadRecentCalls,
  insertVoicemail,
  selectVoicemailsWithUnread,
  selectVoicemail,
  updateVoicemailRead,
  removeVoicemail,
  countUnreadVoicemails,
  type ForwardingRow,
} from './postgres';

/**
 * Minimal shape of the rating engine the DatabaseService depends on. Declared
 * structurally (rather than importing RatingService) so the rating service can
 * import call types from here without a circular dependency.
 */
export interface CallRater {
  applyToEndedCall(call: CallLog, updates: Partial<CallLog>, planId?: number | null): Partial<CallLog>;
}

export class DatabaseService extends EventEmitter {
  private users = new Map<string, SipUser>();
  private callLogs: CallLog[] = [];
  private registrations = new Map<string, SipRegistration>();
  /** phone number → extension lookup */
  private phoneIndex = new Map<string, string>();
  /**
   * Optional call rater. Injected (not imported) to avoid a module cycle with
   * the rating service. When set, a call transitioning to `ended` is priced here
   * — the single choke point every terminal `ended` flows through — so cost is
   * stamped before the record is mirrored to Postgres, with no per-handler hooks.
   */
  private rater?: CallRater;

  /** Provide the rating engine used to price calls at end-of-call. */
  setRater(rater: CallRater): void {
    this.rater = rater;
  }

  /**
   * Hydrate the in-memory user store from the shared Postgres database so that
   * users created through the Go API (which the SIP/WS layers don't otherwise
   * know about) can register and be called. Identity fields are refreshed while
   * any live state already in memory (registration, routing rules) is preserved,
   * so this is safe to call again later (e.g. on a sync event). Returns the
   * number of users loaded.
   */
  async hydrateFromPostgres(): Promise<number> {
    const rows = await loadAllUsers();
    for (const row of rows) {
      this.upsertUser({
        extension: row.extension,
        username: row.username,
        name: row.name,
        mobile: row.mobile,
      });
    }
    await this.hydrateAllDetail();
    return rows.length;
  }

  /**
   * Hydrate the in-memory call log from the shared Postgres call_records table
   * so "recents" survive a restart. The in-memory log is what the HTTP API
   * serves, but it starts empty on each boot — without this, history would be
   * blank after a reboot even though the rows persist in Postgres. Replace-only:
   * it overwrites whatever is in memory (called once at startup, before any new
   * calls are logged). Returns the number of calls loaded.
   */
  async hydrateCallsFromPostgres(limit = 500): Promise<number> {
    const calls = await loadRecentCalls(limit);
    this.callLogs = calls;
    return calls.length;
  }

  /**
   * Bulk-load every user's blocking / forwarding / PSTN detail from Postgres in
   * three queries and apply it to the in-memory users. Done once at startup so
   * routing works even for users who never register (forward-on-unavailable,
   * inbound PSTN to an offline user). Each call fully replaces the prior detail.
   */
  private async hydrateAllDetail(): Promise<void> {
    const [blocked, forwarding, pstn] = await Promise.all([
      loadAllBlocked(),
      loadAllForwarding(),
      loadAllPstn(),
    ]);

    // Reset routing detail on all users first so removed rows don't linger.
    for (const user of this.getUsers()) {
      user.blockedNumbers = [];
      user.forwardOnBusy = undefined;
      user.forwardOnNoAnswer = undefined;
      user.forwardOnUnavailable = undefined;
      user.pstnForwardToBrowser = false;
      user.pstnForwardTarget = undefined;
      user.dnd = false;
      user.ratePlanId = undefined;
    }

    for (const b of blocked) {
      const user = this.users.get(b.extension);
      if (user) (user.blockedNumbers ??= []).push(b.number);
    }
    for (const f of forwarding) {
      this.applyForwardingRow(this.users.get(f.extension), f);
    }
    for (const p of pstn) {
      this.applyPstn(this.users.get(p.extension), p.pstn_enabled, p.pstn_mobile, p.dnd, p.rate_plan_id);
    }
  }

  /**
   * Refresh a single user's blocking / forwarding / PSTN detail from Postgres.
   * Triggered on SIP REGISTER to pick up dashboard changes made while running.
   * No-op if the user isn't in memory. Fully replaces that user's detail.
   */
  async hydrateUserDetail(extension: string): Promise<void> {
    const user = this.users.get(extension);
    if (!user) return;

    const [blocked, forwarding, pstn] = await Promise.all([
      loadBlockedByExtension(extension),
      loadForwardingByExtension(extension),
      loadPstnByExtension(extension),
    ]);

    user.blockedNumbers = blocked.map((b) => b.number);
    user.forwardOnBusy = undefined;
    user.forwardOnNoAnswer = undefined;
    user.forwardOnUnavailable = undefined;
    for (const f of forwarding) this.applyForwardingRow(user, f);
    this.applyPstn(user, pstn?.pstn_enabled ?? false, pstn?.pstn_mobile ?? null, pstn?.dnd ?? false, pstn?.rate_plan_id ?? null);
  }

  /** Map a forwarding_rules row onto the matching SipUser field. */
  private applyForwardingRow(user: SipUser | undefined, row: ForwardingRow): void {
    if (!user) return;
    const target = row.target || undefined;
    switch (row.type) {
      case 'busy': user.forwardOnBusy = target; break;
      case 'noAnswer': user.forwardOnNoAnswer = target; break;
      case 'unavailable': user.forwardOnUnavailable = target; break;
    }
  }

  /** Map user_settings PSTN + DND + billing fields onto the SipUser. */
  private applyPstn(
    user: SipUser | undefined,
    enabled: boolean,
    mobile: string | null,
    dnd = false,
    ratePlanId: number | null = null,
  ): void {
    if (!user) return;
    user.pstnForwardToBrowser = enabled;
    user.pstnForwardTarget = mobile || undefined;
    user.dnd = dnd;
    user.ratePlanId = ratePlanId ?? undefined;
  }

  /**
   * Insert or update a user's identity in the in-memory maps, preserving any
   * live/routing state on an existing entry. Keeps the extension and username
   * lookups and the phone-number index in sync. Passwords are not stored — Node
   * no longer authenticates with them.
   */
  private upsertUser(identity: { extension: string; username: string; name: string; mobile: string }): void {
    const existing = this.users.get(identity.extension);
    const user: SipUser = existing
      ? { ...existing, ...identity }
      : { ...identity, registered: false };
    this.users.set(user.extension, user);
    this.users.set(user.username, user);
    if (user.mobile) {
      this.phoneIndex.set(user.mobile.replace(/\D/g, ''), user.extension);
    }
  }

  /**
   * Reconcile a single user with Postgres after a change notification. Loads the
   * row by extension: if it exists the identity + routing detail are refreshed;
   * if it's gone (deleted) the user is removed from memory. This one method
   * therefore handles INSERT, UPDATE and DELETE uniformly — the caller only has
   * to know which extension changed.
   */
  async syncUser(extension: string): Promise<void> {
    const row = await loadUserByExtension(extension);
    if (!row) {
      this.removeUser(extension);
      return;
    }
    this.upsertUser({
      extension: row.extension,
      username: row.username,
      name: row.name,
      mobile: row.mobile,
    });
    await this.hydrateUserDetail(row.extension);
  }

  /**
   * Remove a user from the in-memory store and drop any live SIP registration.
   * Clears every index that points at them (extension, username, phone number).
   */
  removeUser(extension: string): void {
    const user = this.users.get(extension);
    if (!user) return;
    this.users.delete(user.extension);
    this.users.delete(user.username);
    if (user.mobile) this.phoneIndex.delete(user.mobile.replace(/\D/g, ''));
    this.registrations.delete(user.extension);
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
    // Resolve each leg to the local extension that owns it (best-effort) so call
    // history can be looked up by user with an exact match — including PSTN legs,
    // where from/to hold an external number, not the extension. Undefined when a
    // leg is external / not a local user.
    data.fromExt = this.resolveExtension(data.from);
    data.toExt = this.resolveExtension(data.to);
    this.callLogs.unshift(data);
    if (this.callLogs.length > 500) this.callLogs.pop();
    // Mirror to the shared Postgres call_records table via the write queue.
    this.emit(DbEvent.CallUpserted, data);
  }

  /**
   * Resolve a call leg (an extension, username, or phone number) to the local
   * user's extension, or undefined if it doesn't belong to a known user. Tries a
   * direct extension/username hit first, then a phone-number match.
   */
  private resolveExtension(leg: string): string | undefined {
    if (!leg) return undefined;
    const direct = this.users.get(leg);
    if (direct) return direct.extension;
    return this.getUserByPhone(leg)?.extension;
  }

  updateCall(callId: string, updates: Partial<CallLog>): void {
    const call = this.callLogs.find(c => c.id === callId);
    if (call) {
      // Price billable calls exactly once, as they reach the terminal `ended`
      // state (the only status that carries final talk time). The rater merges
      // cost/currency/ratePrefix/billedSecs into the updates before they're
      // applied and mirrored to Postgres; non-billable calls pass through.
      let next = updates;
      if (this.rater && updates.status === 'ended' && call.cost === undefined) {
        // Price with the calling user's assigned plan (falls back to the default
        // plan inside the rater when undefined). The caller is the local leg on
        // an outbound call — resolve their extension to read ratePlanId.
        const caller = call.fromExt ? this.users.get(call.fromExt) : this.getUserByPhone(call.from);
        next = this.rater.applyToEndedCall(call, updates, caller?.ratePlanId ?? null);
      }
      Object.assign(call, next);
      this.emit(DbEvent.CallUpserted, call);
    }
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

  // ─── Voicemail ───────────────────────────────────────
  // Voicemails live only in the shared Postgres `voicemails` table (no in-memory
  // copy): the IVR inserts on record, the HTTP API reads/updates/deletes on
  // demand. So messages are durable across restarts and shared with the Go
  // dashboard without any sync. These delegate straight to the repo.

  async addVoicemail(vm: Voicemail): Promise<void> {
    await insertVoicemail(vm);
  }

  /** A mailbox's voicemails (newest first) plus its unread count, in one query. */
  getVoicemailsWithUnread(mailbox: string): Promise<{ voicemails: Voicemail[]; unread: number }> {
    return selectVoicemailsWithUnread(mailbox);
  }

  getVoicemail(mailbox: string, id: string): Promise<Voicemail | undefined> {
    return selectVoicemail(mailbox, id);
  }

  markVoicemailRead(mailbox: string, id: string): Promise<boolean> {
    return updateVoicemailRead(mailbox, id);
  }

  /** Delete a voicemail; resolves to the deleted row's filename (for cleanup) or undefined. */
  deleteVoicemail(mailbox: string, id: string): Promise<string | undefined> {
    return removeVoicemail(mailbox, id);
  }

  unreadVoicemailCount(mailbox: string): Promise<number> {
    return countUnreadVoicemails(mailbox);
  }
}


import { execFile } from 'node:child_process';

export interface SipAbuseGuardOptions {
  /** Offenses within `windowMs` before an IP is banned. */
  threshold: number;
  /** Sliding window (ms) over which offenses are counted. */
  windowMs: number;
  /** How long (ms) a ban lasts. */
  banMs: number;
  /** Optional OS firewall command run on ban. `{ip}` is replaced with the
   *  offending address. Empty string disables the kernel-level ban. */
  firewallCmd?: string;
  /** Sources that must never be penalized (trunk edges, office IPs). */
  isTrusted?: (ip: string) => boolean;
}

interface OffenseRecord {
  count: number;
  windowStart: number;
  lastSeen: number;
  bannedUntil: number;
}

/** Strict IPv4 / IPv6 literal check — defense-in-depth before an IP is ever
 *  handed to a firewall command (we use execFile, so there is no shell to
 *  inject into, but a malformed value should still never be acted on). */
function isValidIp(ip: string): boolean {
  if (/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(ip)) {
    return ip.split('.').every((o) => Number(o) <= 255);
  }
  // Compact IPv6 validity (hex groups + optional `::`), good enough to gate a
  // firewall call without pulling in a dependency.
  return /^[0-9a-fA-F:]+$/.test(ip) && ip.includes(':') && ip.length <= 45;
}

/**
 * In-memory SIP abuse tracker / soft-firewall. Counts misbehavior per source IP
 * (flood, credential scanning, toll-fraud / spoofed INVITEs) and bans repeat
 * offenders. A banned IP is refused at the very top of the REGISTER/INVITE
 * handlers — before any rate accounting, routing, DB lookup, or call-history
 * write — so scanners are cheap to reject and never pollute call logs.
 *
 * When `firewallCmd` is configured the ban is ALSO pushed to the OS firewall
 * (e.g. `ipset add callnet-ban {ip} -exist`) so future packets can be dropped
 * in the kernel and "never hit the app" at all. The command is run via
 * `execFile` (no shell) with the validated IP as a discrete argument, so it is
 * not vulnerable to command injection.
 */
export class SipAbuseGuard {
  private readonly records = new Map<string, OffenseRecord>();
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly banMs: number;
  private readonly firewallCmd: string;
  private readonly isTrusted: (ip: string) => boolean;
  private sweepTimer?: ReturnType<typeof setInterval>;

  constructor(opts: SipAbuseGuardOptions) {
    this.threshold = Math.max(1, opts.threshold);
    this.windowMs = Math.max(1000, opts.windowMs);
    this.banMs = Math.max(1000, opts.banMs);
    this.firewallCmd = (opts.firewallCmd || '').trim();
    this.isTrusted = opts.isTrusted ?? (() => false);

    // Periodically drop expired/idle records so the map can't grow unbounded.
    // Unref'd so it never keeps the process alive on its own.
    this.sweepTimer = setInterval(() => this.sweep(), Math.min(this.windowMs, 60_000));
    this.sweepTimer.unref?.();
  }

  /** True while `ip` is actively banned. */
  isBanned(ip: string): boolean {
    const rec = this.records.get(ip);
    return !!rec && rec.bannedUntil > Date.now();
  }

  /** Record one offense for `ip`; bans it once the threshold is crossed. */
  recordOffense(ip: string, reason: string): void {
    if (!ip || this.isTrusted(ip)) return; // never penalize trusted sources
    const now = Date.now();
    let rec = this.records.get(ip);
    if (!rec || now - rec.windowStart > this.windowMs) {
      rec = { count: 0, windowStart: now, lastSeen: now, bannedUntil: rec?.bannedUntil ?? 0 };
      this.records.set(ip, rec);
    }
    rec.count++;
    rec.lastSeen = now;

    if (rec.count >= this.threshold && rec.bannedUntil <= now) {
      rec.bannedUntil = now + this.banMs;
      console.warn(
        `⛔ SIP abuse: banning ${ip} for ${Math.round(this.banMs / 1000)}s ` +
          `after ${rec.count} offenses (last: ${reason})`,
      );
      this.applyFirewall(ip);
    }
  }

  /** A legitimate, authenticated action (e.g. a successful REGISTER) clears the
   *  offense tally for `ip` — but NOT an active ban — so real users sharing a
   *  NAT with a scanner aren't penalized for its behavior. */
  recordSuccess(ip: string): void {
    const rec = this.records.get(ip);
    if (rec && rec.bannedUntil <= Date.now()) this.records.delete(ip);
  }

  /** Stop the background sweep (best-effort; for graceful shutdown). */
  stop(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [ip, rec] of this.records) {
      const banned = rec.bannedUntil > now;
      const fresh = now - rec.lastSeen < this.windowMs;
      if (!banned && !fresh) this.records.delete(ip);
    }
  }

  private applyFirewall(ip: string): void {
    if (!this.firewallCmd) return;
    if (!isValidIp(ip)) {
      console.warn(`SIP abuse: refusing firewall ban for malformed IP "${ip}"`);
      return;
    }
    // Split on whitespace and substitute the {ip} placeholder. execFile runs the
    // binary directly (no shell), so each token is a literal argv entry.
    const parts = this.firewallCmd.split(/\s+/).map((p) => (p === '{ip}' ? ip : p));
    const [cmd, ...args] = parts;
    if (!cmd) return;
    execFile(cmd, args, (err) => {
      if (err) console.warn(`SIP abuse: firewall command failed for ${ip}: ${err.message}`);
      else console.log(`⛔ SIP abuse: firewall ban applied for ${ip}`);
    });
  }
}

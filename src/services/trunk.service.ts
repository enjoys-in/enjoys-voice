import Srf from 'drachtio-srf';
import { config } from '@/core';

export class TrunkService {
  private readonly trunk = {
    name: config.trunk.name,
    host: config.trunk.host,
    port: config.trunk.port,
    transport: config.trunk.transport,
    username: config.trunk.username,
    password: config.trunk.password,
    callerNumber: config.trunk.callerNumber,
    enabled: config.trunk.enabled,
    prefix: config.trunk.prefix,
    inboundIps: config.trunk.inboundIps,
  };

  get isEnabled(): boolean {
    return this.trunk.enabled;
  }

  /**
   * Match an IPv4 address against an allowlist entry that is either an exact IP
   * ("54.172.60.1") or CIDR ("54.172.60.0/30"). Returns false for malformed
   * input instead of throwing, so a bad env entry can't crash call routing.
   */
  private static ipMatches(ip: string, entry: string): boolean {
    if (!ip || !entry) return false;
    if (!entry.includes('/')) return ip === entry;
    const [range, bitsStr] = entry.split('/');
    const bits = Number(bitsStr);
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    const toInt = (a: string): number | null => {
      const parts = a.split('.');
      if (parts.length !== 4) return null;
      let n = 0;
      for (const p of parts) {
        const o = Number(p);
        if (!Number.isInteger(o) || o < 0 || o > 255) return null;
        n = (n << 8) | o;
      }
      return n >>> 0;
    };
    const ipInt = toInt(ip);
    const rangeInt = toInt(range);
    if (ipInt === null || rangeInt === null) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipInt & mask) === (rangeInt & mask);
  }

  /**
   * True when the SIP source is a trusted inbound PSTN trunk: the legacy single
   * trunk host, OR any entry in the configured inbound allowlist (exact IPs or
   * CIDRs, e.g. a provider's SIP signaling edges). The allowlist is independent
   * of the legacy trunk, so a provider-only inbound (e.g. Twilio Elastic SIP
   * Trunk) works without TRUNK_HOST. Empty allowlist => no extra sources.
   */
  isFromTrunk(sourceIp: string): boolean {
    if (this.trunk.enabled && sourceIp === this.trunk.host) return true;
    return this.trunk.inboundIps.some((entry) =>
      TrunkService.ipMatches(sourceIp, entry),
    );
  }

  getActive() {
    return this.trunk.enabled ? this.trunk : undefined;
  }

  getEnabledProviders() {
    return this.trunk.enabled ? [this.trunk] : [];
  }

  formatOutboundUri(number: string): string {
    let clean = number.replace(/[^+\d]/g, '');
    if (!clean.startsWith('+')) {
      if (clean.length === 10 && /^[6-9]/.test(clean)) clean = '+91' + clean;
      else if (clean.length === 10) clean = '+1' + clean;
      else clean = '+' + clean;
    }
    return `sip:${this.trunk.prefix}${clean}@${this.trunk.host}:${this.trunk.port}`;
  }

  async routeCall(srf: InstanceType<typeof Srf>, req: any, res: any, calledNumber: string): Promise<boolean> {
    if (!this.trunk.enabled) {
      res.send(503);
      return false;
    }

    try {
      console.log(`📞 Trunk [${this.trunk.name}]: Routing ${calledNumber}`);
      const uri = this.formatOutboundUri(calledNumber);

      const uac = await srf.createUAC(uri, {
        localSdp: req.body,
        auth: { username: this.trunk.username, password: this.trunk.password },
        headers: { 'From': `<sip:${this.trunk.callerNumber}@${this.trunk.host}>` },
      });

      const uas = await srf.createUAS(req, res, { localSdp: uac.remote?.sdp || '' });
      uac.on('destroy', () => uas.destroy());
      uas.on('destroy', () => uac.destroy());

      console.log(`✅ Trunk: Call connected via ${this.trunk.name}`);
      return true;
    } catch (err: any) {
      console.error(`❌ Trunk [${this.trunk.name}] failed:`, err?.message);
      res.send(503);
      return false;
    }
  }
}

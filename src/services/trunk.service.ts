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
  };

  get isEnabled(): boolean {
    return this.trunk.enabled;
  }

  /** Check if a source IP matches the trunk host (inbound from PSTN) */
  isFromTrunk(sourceIp: string): boolean {
    return this.trunk.enabled && sourceIp === this.trunk.host;
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

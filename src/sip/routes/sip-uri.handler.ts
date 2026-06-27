import type { CallContext, RouteHandler, RouteServices } from './types';
import type { DialResult } from '@/services';
import { RouteType, findSipPeer } from '@/services';
import { config } from '@/core';
import type { SipPeer } from '@/core';

/**
 * Places an outbound SIP-to-SIP call from a registered internal user to an
 * approved EXTERNAL SIP peer (e.g. `sip:bob@partner.example.com`). The peer's
 * host must be allowlisted in `config.sipPeers` — the dial plan only ever emits
 * a `SipUri` route for an approved host, so this can never become an open relay
 * to an arbitrary domain.
 *
 * Mirrors the PSTN ExternalHandler/TrunkService pattern: a media-transparent
 * B2BUA (createUAC offer = caller SDP → createUAS answers caller with the
 * peer's SDP). Optional per-peer digest auth, outbound proxy, and From overrides
 * come from the matched peer.
 *
 * MEDIA CAVEAT: this relays SDP verbatim. It is correct for a non-WebRTC SIP
 * originator (a SIP phone/UA) talking to a plain-RTP peer. A WebRTC/browser
 * originator (DTLS-SRTP + Opus) calling a plain-RTP peer would connect but have
 * no audio without media anchoring/transcode through FreeSWITCH — that path is
 * intentionally out of scope here.
 */
export class SipUriHandler implements RouteHandler {
  async handle(ctx: CallContext, services: RouteServices, route?: DialResult): Promise<boolean> {
    if (!route || route.type !== RouteType.SipUri) return false;

    // ─── Toll-fraud gate ───────────────────────────────────────────────
    // Same rule as ExternalHandler: an outbound leg may only be originated by
    // one of OUR currently-registered extensions, so a spoofed/unregistered
    // From can't use us to place SIP calls to a peer.
    const caller = ctx.callingNumber;
    if (!caller || !services.db.isRegistered(caller)) {
      console.warn(`🚫 SIP-peer blocked: unregistered caller "${caller}" → ${route.normalizedNumber} (src ${ctx.req.source_address})`);
      services.audit?.log('call_blocked', caller || 'unknown', {
        reason: 'unregistered_sip_peer', to: route.normalizedNumber, callId: ctx.callId,
      }, ctx.req.source_address);
      services.db.updateCall(ctx.callId, { status: 'failed', direction: 'outbound' });
      ctx.res.send(403, 'Forbidden');
      return true;
    }

    // Split `user@host` (the SipUri route target) and re-resolve the peer by its
    // host. The peer is guaranteed to exist (the route was produced from it),
    // but guard anyway so a config change between resolve and dial fails closed.
    const at = route.target.lastIndexOf('@');
    const user = at >= 0 ? route.target.slice(0, at) : '';
    const host = (at >= 0 ? route.target.slice(at + 1) : route.target).toLowerCase();
    const peer = findSipPeer(host);
    if (!peer) {
      console.warn(`🚫 SIP-peer not allowlisted: ${route.target}`);
      services.db.updateCall(ctx.callId, { status: 'failed', direction: 'outbound' });
      ctx.res.send(403, 'Forbidden');
      return true;
    }

    const uri = this.buildOutboundUri(peer, user);
    const fromHeader = this.buildFrom(peer, caller, services);

    // Record the attempt with the full SIP address so it shows in recents/stats.
    services.db.updateCall(ctx.callId, { to: route.target, direction: 'outbound' });
    console.log(`📞 SIP-peer: ${caller} → ${uri}`);

    try {
      const uac = await services.srf.createUAC(uri, {
        localSdp: ctx.req.body,
        headers: { From: fromHeader },
        ...(peer.proxy ? { proxy: peer.proxy.startsWith('sip:') ? peer.proxy : `sip:${peer.proxy}` } : {}),
        ...(peer.username ? { auth: { username: peer.username, password: peer.password || '' } } : {}),
      });
      const uas = await services.srf.createUAS(ctx.req, ctx.res, { localSdp: uac.remote?.sdp || '' });
      uac.on('destroy', () => uas.destroy());
      uas.on('destroy', () => uac.destroy());
      console.log(`✅ SIP-peer: call connected → ${peer.host}`);
      services.db.updateCall(ctx.callId, { status: 'answered' });
      return true;
    } catch (err: any) {
      // Relay the peer's failure status when it gave one, else a generic 503.
      const status = Number(err?.status);
      console.error(`❌ SIP-peer [${peer.host}] failed:`, err?.message);
      services.db.updateCall(ctx.callId, { status: 'failed', direction: 'outbound' });
      if (!ctx.res.finalResponseSent) {
        ctx.res.send(status >= 400 && status <= 699 ? status : 503);
      }
      return true;
    }
  }

  /** Build the outbound Request-URI to the peer. */
  private buildOutboundUri(peer: SipPeer, user: string): string {
    const hostPort = `${peer.host}${peer.port ? `:${peer.port}` : ''}`;
    const transport = peer.transport ? `;transport=${peer.transport}` : '';
    const userPart = user ? `${this.sanitizeUser(user)}@` : '';
    return `sip:${userPart}${hostPort}${transport}`;
  }

  /**
   * Build the From header. Presents the peer's required From user when one is
   * configured (`fromUser`), otherwise the caller's verified caller-ID (BYON) or
   * their extension. The From host defaults to our own SIP domain.
   */
  private buildFrom(peer: SipPeer, caller: string, services: RouteServices): string {
    const callerId = services.db.getUser(caller)?.outboundCallerId;
    const fromUser = this.sanitizeUser(peer.fromUser || callerId || caller) || 'anonymous';
    const fromHost = peer.fromHost || config.server.domain;
    return `<sip:${fromUser}@${fromHost}>`;
  }

  /** Restrict a SIP user-part to safe characters (guards header/URI injection). */
  private sanitizeUser(value: string): string {
    return (value || '').replace(/[^A-Za-z0-9+._-]/g, '');
  }
}

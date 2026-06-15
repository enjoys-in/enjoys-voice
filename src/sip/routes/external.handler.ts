import type { CallContext, RouteHandler, RouteServices } from './types';
import type { DialResult } from '@/services';
import { RouteType } from '@/services';

export class ExternalHandler implements RouteHandler {
  async handle(ctx: CallContext, services: RouteServices, route?: DialResult): Promise<boolean> {
    if (!route || route.type !== RouteType.External) return false;
    if (!services.trunk.isEnabled) return false;

    // ─── Toll-fraud gate ───────────────────────────────────────────────
    // The public SIP port is constantly probed by scanners that fire INVITEs
    // to premium/international numbers, trying to place calls on our PSTN trunk
    // (toll fraud). Outbound (external) routing is reached only AFTER the
    // trunk-inbound handler, so a call here is an OUTBOUND attempt — it must
    // originate from one of OUR currently-registered extensions. A scanner's
    // spoofed From (e.g. "12345") is not registered, so it is refused with 403
    // and never touches the trunk.
    const caller = ctx.callingNumber;
    if (!caller || !services.db.isRegistered(caller)) {
      console.warn(`🚫 Toll-fraud blocked: unregistered caller "${caller}" → external ${route.normalizedNumber} (src ${ctx.req.source_address})`);
      services.audit?.log('call_blocked', caller || 'unknown', {
        reason: 'unregistered_external', to: route.normalizedNumber, callId: ctx.callId,
      }, ctx.req.source_address);
      services.db.updateCall(ctx.callId, { status: 'failed' });
      ctx.res.send(403, 'Forbidden');
      return true;
    }

    console.log(`📞 Trunk: Routing to ${route.normalizedNumber}`);
    const ok = await services.trunk.routeCall(services.srf, ctx.req, ctx.res, route.normalizedNumber);
    services.db.updateCall(ctx.callId, { status: ok ? 'answered' : 'failed' });
    return true;
  }
}

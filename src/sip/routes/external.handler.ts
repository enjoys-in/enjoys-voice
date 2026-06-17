import type { CallContext, RouteHandler, RouteServices } from './types';
import type { DialResult } from '@/services';
import { RouteType } from '@/services';
import { config } from '@/core';

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
      services.db.updateCall(ctx.callId, { status: 'failed', direction: 'outbound' });
      ctx.res.send(403, 'Forbidden');
      return true;
    }

    // ─── Prepaid balance gate ──────────────────────────────────────────
    // With prepaid billing on, refuse a call the caller can't even afford to
    // start: the wallet must cover the cheapest possible charge (setup fee +
    // one billing increment) for this destination. Unrateable destinations (no
    // plan / no matching prefix) are never balance-blocked, mirroring the rater.
    // Reads only the in-memory wallet (kept fresh by the settings_changed
    // NOTIFY) — no DB on the call path.
    if (config.billing.prepaidEnabled) {
      const estimate = services.db.estimateMinCharge(route.normalizedNumber, caller);
      if (estimate && estimate.cost > 0) {
        const balance = services.db.getUser(caller)?.balance ?? 0;
        if (balance < estimate.cost) {
          console.warn(`🚫 Prepaid: insufficient balance for ${caller} → ${route.normalizedNumber} (have ${balance.toFixed(4)}, need ${estimate.cost.toFixed(4)} ${estimate.currency})`);
          services.audit?.log('call_blocked', caller, {
            reason: 'insufficient_balance', to: route.normalizedNumber,
            balance, required: estimate.cost, currency: estimate.currency, callId: ctx.callId,
          }, ctx.req.source_address);
          services.db.updateCall(ctx.callId, { status: 'failed', direction: 'outbound' });
          ctx.res.send(402, 'Payment Required');
          return true;
        }
      }
    }

    console.log(`📞 Trunk: Routing to ${route.normalizedNumber}`);
    // Present the caller's own verified number (BYON) when they have one;
    // otherwise routeCall falls back to the shared trunk caller number. The
    // value is only ever populated from a Go-verified caller ID, so it is safe
    // to trust here without re-checking ownership.
    const callerId = services.db.getUser(caller)?.outboundCallerId;
    const ok = await services.trunk.routeCall(services.srf, ctx.req, ctx.res, route.normalizedNumber, callerId);
    services.db.updateCall(ctx.callId, { status: ok ? 'answered' : 'failed' });
    return true;
  }
}

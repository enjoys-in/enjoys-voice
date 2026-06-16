import type { CallContext, RouteHandler, RouteServices } from './types';
import type { DialResult } from '@/services';
import { RouteType } from '@/services';

export class InternalHandler implements RouteHandler {
  async handle(ctx: CallContext, services: RouteServices, route?: DialResult): Promise<boolean> {
    if (!route || route.type !== RouteType.Internal) return false;

    const reg = services.db.getRegistration(route.target);
    if (reg) {
      // Registered but Do Not Disturb is on → don't ring the device; send the
      // caller straight to voicemail (or a silent 480 when voicemail is off).
      const user = services.db.getUser(route.target);
      if (user?.dnd) {
        await services.routeDoNotDisturb(ctx.req, ctx.res, route.target, ctx.callId, ctx.callingNumber);
        return true;
      }
      await services.routeToExtension(ctx.req, ctx.res, reg.contact, ctx.callId);
      return true;
    }

    // ─── Internal extension is NOT registered (offline) ───────────────
    const targetUser = services.db.getUser(route.target);

    // Unknown extension → let the dial plan fall through to other handlers.
    if (!targetUser) return false;

    // Known user but offline: run the shared unreachable fallback chain
    // (PSTN → forward → voicemail → "unavailable" announcement → missed). This
    // is the exact same path used when a registered device turns out to be
    // stale and returns a 410 "Gone", so both cases behave identically.
    await services.routeUnreachable(ctx.req, ctx.res, route.target, ctx.callId, ctx.callingNumber);
    return true;
  }
}


import type { CallContext, RouteHandler, RouteServices } from './types';
import type { DialResult } from '@/services';
import { RouteType } from '@/services';
import { SipStatus } from '@/core/types';
import { config } from '@/core';

export class InternalHandler implements RouteHandler {
  async handle(ctx: CallContext, services: RouteServices, route?: DialResult): Promise<boolean> {
    if (!route || route.type !== RouteType.Internal) return false;

    const reg = services.db.getRegistration(route.target);
    if (reg) {
      await services.routeToExtension(ctx.req, ctx.res, reg.contact, ctx.callId);
      return true;
    }

    // ─── Internal extension is NOT registered (offline) ───────────────
    const targetUser = services.db.getUser(route.target);

    // Unknown extension → let the dial plan fall through to other handlers.
    if (!targetUser) return false;

    // 1) PSTN fallback: ring the user's mobile if they have one + trunk is up.
    if (targetUser.mobile && services.trunk.isEnabled) {
      console.log(`📱 PSTN fallback: ${route.target} → mobile ${targetUser.mobile}`);
      const ok = await services.trunk.routeCall(services.srf, ctx.req, ctx.res, targetUser.mobile);
      services.db.updateCall(ctx.callId, { status: ok ? 'answered' : 'failed' });
      return true;
    }

    // 2) Forward-on-unavailable if configured for this extension.
    const forwarding = services.db.getForwarding(route.target);
    if (forwarding.unavailable) {
      console.log(`↪️ ${route.target} offline → forwarding to ${forwarding.unavailable}`);
      await services.forwardCall(ctx.req, ctx.res, forwarding.unavailable, ctx.callId, ctx.callingNumber);
      return true;
    }

    // 3) Voicemail: if the media server is available, let the caller leave a
    //    message for the offline user instead of just dropping the call.
    if (config.voicemail.enabled && services.ivr) {
      console.log(`📭 ${route.target} offline → routing to voicemail`);
      const fromName = ctx.req.callingName || ctx.callingNumber;
      const saved = await services.ivr.recordVoicemail(
        ctx.req, ctx.res, route.target, ctx.callingNumber, fromName,
      );
      services.db.updateCall(ctx.callId, { status: saved ? 'answered' : 'missed' });
      services.notifyFn?.(ctx.callingNumber, 'unavailable', {
        target: route.target,
        reason: 'voicemail',
        callId: ctx.callId,
      });
      return true;
    }

    // 4) Nothing configured → respond gracefully with a clear "offline" reason
    //    and tell the caller's UI exactly why, instead of a bare 480.
    console.log(`📴 ${route.target} is offline and has no fallback configured`);
    services.notifyFn?.(ctx.callingNumber, 'unavailable', {
      target: route.target,
      reason: 'offline',
      callId: ctx.callId,
    });
    services.db.updateCall(ctx.callId, { status: 'missed' });
    if (!ctx.res.finalResponseSent) {
      ctx.res.send(SipStatus.TemporarilyUnavailable, 'User Offline', {
        headers: { 'Reason': 'SIP;cause=480;text="User is offline"' },
      });
    }
    return true;
  }
}


import type { CallContext, RouteHandler, RouteServices } from './types';
import type { DialResult } from '@/services';
import { RouteType } from '@/services';
import { SipStatus } from '@/core/types';

export class TrunkInboundHandler implements RouteHandler {
  async handle(ctx: CallContext, services: RouteServices): Promise<boolean> {
    if (!services.trunk.isFromTrunk(ctx.req.source_address)) return false;

    const match = services.db.findPstnForwardTarget(ctx.calledNumber);
    if (!match) {
      // Inbound trunk call but no matching DID configured
      ctx.res.send(SipStatus.TemporarilyUnavailable);
      services.db.updateCall(ctx.callId, { status: 'missed' });
      return true;
    }

    const { user, target } = match;
    console.log(`📲 PSTN→Internal: ${ctx.calledNumber} → ${target} (configured by ${user.extension})`);
    services.audit.log('call_start', ctx.callingNumber, { to: target, callId: ctx.callId, type: 'pstn_inbound' }, ctx.req.source_address);

    // Check if target is an internal extension
    const reg = services.db.getRegistration(target);
    if (reg) {
      await services.routeToExtension(ctx.req, ctx.res, reg.contact, ctx.callId);
      return true;
    }

    // Target not registered — could be IVR or offline extension
    // Try IVR routing if target matches IVR pattern
    if (services.ivr?.isConnected()) {
      const { DialPlanService } = await import('@/services');
      const dialPlan = new DialPlanService();
      const route = dialPlan.resolve(target);
      if (route.type === RouteType.IVR) {
        console.log(`📲 PSTN→IVR: ${ctx.calledNumber} → IVR ${target}`);
        try {
          await services.ivr.handleIncomingCall(ctx.req, ctx.res);
        } catch (err: any) {
          console.error('❌ PSTN→IVR failed:', err.message);
          if (!ctx.res.finalResponseSent) ctx.res.send(SipStatus.ServiceUnavailable);
          services.db.updateCall(ctx.callId, { status: 'failed' });
        }
        return true;
      }
    }

    // Target not registered and not IVR
    console.log(`📲 PSTN→Browser: ${target} not registered/available`);
    ctx.res.send(SipStatus.TemporarilyUnavailable);
    services.db.updateCall(ctx.callId, { status: 'missed' });
    return true;
  }
}

import type { CallContext, RouteHandler, RouteServices } from './types';
import { SipStatus } from '@/core/types';

export class TrunkInboundHandler implements RouteHandler {
  async handle(ctx: CallContext, services: RouteServices): Promise<boolean> {
    if (!services.trunk.isFromTrunk(ctx.req.source_address)) return false;

    const fwdTarget = services.db.findPstnForwardTarget(ctx.calledNumber);
    if (fwdTarget) {
      const reg = services.db.getRegistration(fwdTarget.extension);
      if (reg) {
        console.log(`📲 PSTN→Browser: ${ctx.calledNumber} → ext ${fwdTarget.extension}`);
        services.audit.log('call_start', ctx.callingNumber, { to: fwdTarget.extension, callId: ctx.callId, type: 'pstn_inbound' }, ctx.req.source_address);
        await services.routeToExtension(ctx.req, ctx.res, reg.contact, ctx.callId);
        return true;
      }
      console.log(`📲 PSTN→Browser: ${fwdTarget.extension} not registered, rejecting`);
    }

    // Inbound trunk call but no matching DID or user offline
    ctx.res.send(SipStatus.TemporarilyUnavailable);
    services.db.updateCall(ctx.callId, { status: 'missed' });
    return true;
  }
}

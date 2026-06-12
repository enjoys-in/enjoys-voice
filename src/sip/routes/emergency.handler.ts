import type { CallContext, RouteHandler, RouteServices } from './types';
import type { DialResult } from '@/services';
import { RouteType } from '@/services';
import { SipStatus } from '@/core/types';

export class EmergencyHandler implements RouteHandler {
  async handle(ctx: CallContext, services: RouteServices, route?: DialResult): Promise<boolean> {
    if (!route || route.type !== RouteType.Emergency) return false;

    console.log(`🚨 Emergency: Routing ${route.target} to trunk`);
    services.audit.log('call_start', ctx.callingNumber, { to: route.target, callId: ctx.callId, type: 'emergency' }, ctx.req.source_address);

    if (services.trunk.isEnabled) {
      const ok = await services.trunk.routeCall(services.srf, ctx.req, ctx.res, route.target);
      services.db.updateCall(ctx.callId, { status: ok ? 'answered' : 'failed' });
    } else {
      ctx.res.send(SipStatus.ServiceUnavailable);
      services.db.updateCall(ctx.callId, { status: 'failed' });
    }
    return true;
  }
}

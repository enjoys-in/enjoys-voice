import type { CallContext, RouteHandler, RouteServices } from './types';
import type { DialResult } from '@/services';
import { RouteType } from '@/services';

export class InternalHandler implements RouteHandler {
  async handle(ctx: CallContext, services: RouteServices, route?: DialResult): Promise<boolean> {
    if (!route || route.type !== RouteType.Internal) return false;

    const reg = services.db.getRegistration(route.target);
    if (reg) {
      await services.routeToExtension(ctx.req, ctx.res, reg.contact, ctx.callId);
      return true;
    }

    // Internal ext not registered → try PSTN fallback via mobile number
    const targetUser = services.db.getUser(route.target);
    if (targetUser?.mobile && services.trunk.isEnabled) {
      console.log(`📱 PSTN fallback: ${route.target} → mobile ${targetUser.mobile}`);
      const ok = await services.trunk.routeCall(services.srf, ctx.req, ctx.res, targetUser.mobile);
      services.db.updateCall(ctx.callId, { status: ok ? 'answered' : 'failed' });
      return true;
    }

    return false;
  }
}

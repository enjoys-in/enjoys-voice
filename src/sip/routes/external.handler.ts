import type { CallContext, RouteHandler, RouteServices } from './types';
import type { DialResult } from '@/services';
import { RouteType } from '@/services';

export class ExternalHandler implements RouteHandler {
  async handle(ctx: CallContext, services: RouteServices, route?: DialResult): Promise<boolean> {
    if (!route || route.type !== RouteType.External) return false;
    if (!services.trunk.isEnabled) return false;

    console.log(`📞 Trunk: Routing to ${route.normalizedNumber}`);
    const ok = await services.trunk.routeCall(services.srf, ctx.req, ctx.res, route.normalizedNumber);
    services.db.updateCall(ctx.callId, { status: ok ? 'answered' : 'failed' });
    return true;
  }
}

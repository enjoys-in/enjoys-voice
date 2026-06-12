import { config } from '@/core';
import type { CallContext, RouteHandler, RouteServices } from './types';
import type { DialResult } from '@/services';
import { RouteType } from '@/services';
import { SipStatus } from '@/core/types';

export class IvrHandler implements RouteHandler {
  async handle(ctx: CallContext, services: RouteServices, route?: DialResult): Promise<boolean> {
    if (!route || route.type !== RouteType.IVR) return false;
    if (!services.ivr?.isConnected() || !config.ivr.enabled) return false;

    console.log(`🎙️ IVR: Routing call`);
    services.audit.log('call_start', ctx.callingNumber, { to: route.target, callId: ctx.callId, type: 'ivr' }, ctx.req.source_address);

    try {
      await services.ivr.handleIncomingCall(ctx.req, ctx.res, ctx.callId);
    } catch (ivrErr: any) {
      console.error('❌ IVR routing failed:', ivrErr.message);
      if (!ctx.res.finalResponseSent) ctx.res.send(SipStatus.ServiceUnavailable);
      services.db.updateCall(ctx.callId, { status: 'failed' });
    }
    return true;
  }
}

import { config } from '@/core';
import type { CallContext, RouteHandler, RouteServices } from './types';
import type { DialResult } from '@/services';
import { RouteType } from '@/services';
import { SipStatus } from '@/core/types';

/**
 * Joins a caller into a multi-party conference room.
 *
 * The browser dials `conf-<roomId>`, which the dial plan classifies as
 * `RouteType.Conference` with `route.target` = the room id. The room is normally
 * pre-created by the signaling server when the host starts the conference, but a
 * direct dial into an unknown id creates it ad-hoc (the first caller is host).
 *
 * Media mixing is done by FreeSWITCH `mod_conference`; this handler only anchors
 * the leg on the media server, joins it to the room, and keeps the shared roster
 * in step via ConferenceService.
 */
export class ConferenceHandler implements RouteHandler {
  async handle(ctx: CallContext, services: RouteServices, route?: DialResult): Promise<boolean> {
    if (!route || route.type !== RouteType.Conference) return false;

    // Media server is required to anchor/mix the leg.
    if (!services.ivr) {
      console.warn('🚫 Conference: media server unavailable');
      ctx.res.send(SipStatus.ServiceUnavailable);
      return true;
    }

    // Toll-fraud gate: only a currently-registered user may join a room. The
    // From must be one of our extensions (mirrors Teams/External handlers).
    const caller = ctx.callingNumber;
    if (!caller || !services.db.isRegistered(caller)) {
      console.warn(`🚫 Conference blocked: unregistered caller "${caller}" → conf ${route.target}`);
      services.audit?.log('call_blocked', caller || 'unknown', {
        reason: 'unregistered_conference', roomId: route.target, callId: ctx.callId,
      }, ctx.req.source_address);
      services.db.updateCall(ctx.callId, { status: 'failed', direction: 'outbound' });
      ctx.res.send(SipStatus.Forbidden);
      return true;
    }

    const roomId = route.target;
    const callerName = ctx.req.get('X-Display-Name') || caller;

    // Ensure the room exists; a direct dial into an unknown id creates it.
    const room = services.conference.getRoom(roomId)
      ?? services.conference.ensureRoom(roomId, caller, callerName);

    // Enforce the per-room member cap (-1 = unlimited).
    if (config.conference.maxMembers >= 0) {
      const joined = Array.from(room.participants.values()).filter((p) => p.state === 'joined').length;
      if (joined >= config.conference.maxMembers && !room.participants.get(caller)) {
        console.warn(`🚫 Conference full: ${roomId} (${joined}/${config.conference.maxMembers})`);
        ctx.res.send(SipStatus.BusyHere, 'Conference Full');
        return true;
      }
    }

    services.conference.markRinging(roomId, caller);
    services.db.updateCall(ctx.callId, { to: `conf:${roomId}`, direction: 'outbound' });
    console.log(`📞 Conference: ${caller} (${callerName}) joining room ${roomId}`);

    const roomName = `conf-${roomId}`;
    const ok = await services.ivr.joinConference(ctx.req, ctx.res, roomName, {
      onJoined: () => services.conference.markJoined(roomId, caller, callerName),
      onLeft: () => services.conference.markLeft(roomId, caller),
    });

    services.db.updateCall(ctx.callId, { status: ok ? 'answered' : 'failed' });
    return true;
  }
}

import { config } from '@/core';
import type { CallContext, RouteHandler, RouteServices } from './types';
import type { DialResult } from '@/services';
import { RouteType } from '@/services';
import { SipStatus } from '@/core/types';

/**
 * Distributes a caller into a call queue (ACD).
 *
 * The caller dials `queue-<id>`, which the dial plan classifies as
 * `RouteType.Queue` with `route.target` = the queue id. Queues are declared up
 * front in config (id, display name, agent roster, strategy); a dial into an
 * unknown id is rejected with 404.
 *
 * Unlike the conference handler, queues are also a normal inbound destination
 * for PSTN customers, so trunk-originated callers are allowed alongside our own
 * registered users (internal callers must still be registered, mirroring the
 * other handlers' toll-fraud gate). The handler enqueues the caller in
 * QueueService for the live supervisor view, then hands off to
 * IVRSystem.enqueueCaller which anchors the leg, plays hold music, rings the
 * available agents one at a time, and bridges to whoever answers. The Queue
 * service's strategy decides which agent is rung next.
 */
export class QueueHandler implements RouteHandler {
  async handle(ctx: CallContext, services: RouteServices, route?: DialResult): Promise<boolean> {
    if (!route || route.type !== RouteType.Queue) return false;

    // Media server is required to anchor the caller and bridge to an agent.
    if (!services.ivr) {
      console.warn('🚫 Queue: media server unavailable');
      ctx.res.send(SipStatus.ServiceUnavailable);
      return true;
    }

    const queueId = route.target;
    const queue = services.queue.getQueue(queueId);
    if (!queue) {
      console.warn(`🚫 Queue not found: "${queueId}"`);
      ctx.res.send(SipStatus.NotFound, 'Queue Not Found');
      return true;
    }

    // Toll-fraud gate: internal callers must be registered; PSTN callers
    // arriving over the trunk are allowed (queues are a public inbound target).
    const caller = ctx.callingNumber || 'unknown';
    const fromTrunk = services.trunk.isFromTrunk(ctx.req.source_address);
    if (!fromTrunk && !services.db.isRegistered(caller)) {
      console.warn(`🚫 Queue blocked: unregistered caller "${caller}" → queue ${queueId}`);
      services.audit?.log('call_blocked', caller, {
        reason: 'unregistered_queue', queueId, callId: ctx.callId,
      }, ctx.req.source_address);
      services.db.updateCall(ctx.callId, { status: 'failed' });
      ctx.res.send(SipStatus.Forbidden);
      return true;
    }

    const callerName = ctx.req.get('X-Display-Name') || ctx.req.callingName || caller;
    services.queue.enqueue(queueId, ctx.callId, caller, callerName);
    services.db.updateCall(ctx.callId, { to: `queue:${queueId}`, status: 'answered' });
    console.log(`📞 Queue [${queue.name}]: ${caller} (${callerName}) entered queue ${queueId}`);

    const result = await services.ivr.enqueueCaller(ctx.req, ctx.res, {
      queueName: queue.name,
      moh: config.queue.moh,
      ringTimeoutMs: config.queue.ringTimeoutSecs * 1000,
      maxWaitMs: config.queue.maxWaitSecs * 1000,
      callerNumber: caller,
      callerName,
      // Pick the next agent via the queue's strategy, resolving their current
      // SIP contact so we can ring them. Skips agents with no live contact.
      nextAgent: () => {
        const exclude = new Set<string>();
        // Try in strategy order, skipping anyone whose registration vanished.
        for (let i = 0; i < queue.agents.size; i++) {
          const agent = services.queue.nextAvailableAgent(queueId, exclude);
          if (!agent) return null;
          const reg = services.db.getRegistration(agent.extension);
          const contactUri = reg?.contact.match(/<([^>]+)>/)?.[1] || reg?.contact;
          if (contactUri) {
            return { extension: agent.extension, contactUri, name: agent.name };
          }
          exclude.add(agent.extension);
        }
        return null;
      },
      hooks: {
        onRingAgent: (ext) => services.queue.markCallerRinging(queueId, ctx.callId, ext),
        onAgentNoAnswer: (ext) => services.queue.releaseRing(queueId, ctx.callId, ext),
        onConnected: (ext) => services.queue.markCallerConnected(queueId, ctx.callId, ext),
        onAbandoned: () => services.queue.dequeue(queueId, ctx.callId),
        onTimeout: () => services.queue.dequeue(queueId, ctx.callId),
        onEnded: () => services.queue.dequeue(queueId, ctx.callId),
      },
    });

    switch (result.outcome) {
      case 'connected':
        services.db.updateCall(ctx.callId, { status: 'answered', to: `agent:${result.connectedAgent}` });
        break;
      case 'abandoned':
        services.db.updateCall(ctx.callId, { status: 'missed' });
        break;
      case 'timeout':
        services.db.updateCall(ctx.callId, { status: 'missed' });
        break;
      default:
        services.queue.dequeue(queueId, ctx.callId);
        services.db.updateCall(ctx.callId, { status: 'failed' });
    }
    return true;
  }
}

import type { CallContext, RouteHandler, RouteServices } from './types';
import { config } from '@/core';

/**
 * Joins the calling user into a Microsoft Teams meeting via Audio-Conferencing
 * dial-in. The browser triggers this by placing a normal call that carries two
 * custom SIP headers instead of encoding data into the dialed string:
 *   X-Teams-Conf-Id: <conference id digits>
 *   X-Teams-Number:  <PSTN dial-in number, optional if TEAMS_DEFAULT_DIALIN set>
 *
 * Because the trigger is header-based, this handler runs early in the chain and
 * simply returns false (lets the call fall through to normal routing) when the
 * Conference-ID header is absent — so it never interferes with ordinary calls.
 */
export class TeamsMeetingHandler implements RouteHandler {
  // In-memory per-caller rate limit: each join places a real PSTN call, so cap
  // how often a single extension can trigger one.
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();
  private readonly LIMIT = 5;
  private readonly WINDOW_MS = 60_000;

  async handle(ctx: CallContext, services: RouteServices): Promise<boolean> {
    const confId = (ctx.req.get('X-Teams-Conf-Id') || '').replace(/\D/g, '');
    if (!confId) return false; // not a Teams join → continue normal routing

    const dialIn = (ctx.req.get('X-Teams-Number') || config.teams.defaultDialIn || '').trim();

    // Media + trunk are both required for the dial-in bridge.
    if (!services.trunk.isEnabled || !services.ivr) {
      ctx.res.send(503);
      return true;
    }
    if (!dialIn) {
      console.warn('🚫 Teams: no dial-in number supplied and no default configured');
      ctx.res.send(400, 'Missing dial-in number');
      return true;
    }

    // Toll-fraud gate: only a currently-registered user may originate a join,
    // so this path can't be abused to dial arbitrary/premium numbers (mirrors
    // ExternalHandler). The caller's From must be one of our extensions.
    const caller = ctx.callingNumber;
    if (!caller || !services.db.isRegistered(caller)) {
      console.warn(`🚫 Teams blocked: unregistered caller "${caller}" → meeting (src ${ctx.req.source_address})`);
      services.audit?.log('call_blocked', caller || 'unknown', {
        reason: 'unregistered_teams', confId, callId: ctx.callId,
      }, ctx.req.source_address);
      services.db.updateCall(ctx.callId, { status: 'failed', direction: 'outbound' });
      ctx.res.send(403, 'Forbidden');
      return true;
    }

    if (!this.allow(caller)) {
      console.warn(`🚫 Teams rate-limited: ${caller}`);
      ctx.res.send(429, 'Too Many Requests');
      return true;
    }

    // Record the attempt with a recognizable target so it shows in recents/stats.
    services.db.updateCall(ctx.callId, { to: `teams:${confId}`, direction: 'outbound' });
    console.log(`📞 Teams: ${caller} joining meeting ${confId} via ${dialIn}`);

    const ok = await services.ivr!.joinTeamsMeeting(
      ctx.req, ctx.res, services.srf, services.trunk, dialIn, confId,
    );
    services.db.updateCall(ctx.callId, { status: ok ? 'answered' : 'failed' });
    return true;
  }

  /** Sliding-window per-caller limiter. Returns true when the call is allowed. */
  private allow(caller: string): boolean {
    const now = Date.now();
    const entry = this.attempts.get(caller);
    if (!entry || now > entry.resetAt) {
      this.attempts.set(caller, { count: 1, resetAt: now + this.WINDOW_MS });
      return true;
    }
    if (entry.count >= this.LIMIT) return false;
    entry.count++;
    return true;
  }
}

import type { CallContext, RouteHandler, RouteServices } from './types';
import type { DialResult } from '@/services';
import { RouteType } from '@/services';

/**
 * WidgetHandler routes calls placed by the embeddable click-to-call widget.
 *
 * A widget INVITE is authorized by a short-lived capability token (verified in
 * sip.server.ts and attached as `ctx.widget`), NOT by a SIP registration — so
 * it deliberately bypasses the registered-caller toll-fraud gate that the
 * ExternalHandler enforces. To keep that safe, the token pins exactly one
 * destination and one caller-ID: this handler refuses the call unless the
 * dialed number matches the destination the token was minted for.
 *
 * How the call is then routed depends on the key's `routeType`:
 *   - 'trunk'     → bridge to the PSTN trunk, presenting the token's caller-ID.
 *   - 'ivr'       → hand off to the internal IVR menu (delegate to the dial plan).
 *   - 'extension' → ring an internal SIP extension, i.e. browser-to-browser
 *                   (delegate to the dial plan).
 *
 * It is placed AHEAD of the normal dial-plan handlers, and only ever acts when
 * `ctx.widget` is present, so non-widget calls fall straight through.
 */
export class WidgetHandler implements RouteHandler {
  async handle(ctx: CallContext, services: RouteServices, route?: DialResult): Promise<boolean> {
    const claims = ctx.widget;
    if (!claims) return false; // not a widget call — let the dial plan handle it

    // The token pins the destination. Compare digit-only forms of what was
    // dialed (and its dial-plan-normalized variant) against the token's
    // destination so prefix normalization can't be used to dial elsewhere.
    const want = onlyDigits(claims.destination);
    const dialedDigits = onlyDigits(ctx.calledNumber);
    const normalizedDigits = route ? onlyDigits(route.normalizedNumber) : '';
    const matches = want.length > 0 && (digitsEqual(want, dialedDigits) || digitsEqual(want, normalizedDigits));
    if (!matches) {
      console.warn(
        `🚫 Widget token destination mismatch: dialed ${ctx.calledNumber} but token allows ${claims.destination} (key ${claims.keyId}, src ${ctx.req.source_address})`,
      );
      services.audit?.log('call_blocked', `widget:${claims.keyId}`, {
        reason: 'widget_destination_mismatch', to: ctx.calledNumber,
        allowed: claims.destination, owner: claims.owner, callId: ctx.callId,
      }, ctx.req.source_address);
      services.db.updateCall(ctx.callId, { status: 'failed', direction: 'outbound' });
      ctx.res.send(403, 'Forbidden');
      return true;
    }

    const routeType = claims.routeType || 'trunk';

    // ─── Internal route types (ivr / extension) ──────────────────────────
    // Hand the call to the normal dial-plan handlers (IVR / Internal / etc.).
    // The destination pin above already restricts it to the key's configured
    // target. As a safety net, never let a key marked internal reach the PSTN
    // trunk (which would side-step the per-key trunk gating / billing).
    if (routeType !== 'trunk') {
      if (route && route.type === RouteType.External) {
        console.warn(
          `🚫 Widget key ${claims.keyId} is '${routeType}' but ${ctx.calledNumber} resolves to the PSTN trunk — refusing`,
        );
        services.audit?.log('call_blocked', `widget:${claims.keyId}`, {
          reason: 'widget_route_type_mismatch', to: ctx.calledNumber, routeType,
          owner: claims.owner, callId: ctx.callId,
        }, ctx.req.source_address);
        services.db.updateCall(ctx.callId, { status: 'failed', direction: 'inbound' });
        ctx.res.send(403, 'Forbidden');
        return true;
      }
      // Delegate: the subsequent handlers route by the resolved DialResult.
      return false;
    }

    // ─── Trunk route type: bridge to the PSTN ────────────────────────────
    if (!services.trunk.isEnabled) {
      ctx.res.send(503, 'Trunk Unavailable');
      services.db.updateCall(ctx.callId, { status: 'failed', direction: 'outbound' });
      return true;
    }

    // Prefer the dial-plan-normalized number when it was the thing that matched;
    // otherwise dial the token's destination verbatim.
    const destination = normalizedDigits && digitsEqual(want, normalizedDigits) && route
      ? route.normalizedNumber
      : claims.destination;
    const callerId = claims.callerId || undefined;

    console.log(`📞 Widget: key ${claims.keyId} → ${destination} (caller-ID ${callerId ?? 'trunk default'})`);
    services.audit?.log('call_start', `widget:${claims.keyId}`, {
      to: destination, owner: claims.owner, callerId, callId: ctx.callId, via: 'widget',
    }, ctx.req.source_address);

    const ok = await services.trunk.routeCall(services.srf, ctx.req, ctx.res, destination, callerId);
    services.db.updateCall(ctx.callId, { status: ok ? 'answered' : 'failed', direction: 'outbound' });
    return true;
  }
}

/** Reduce a dialed string to its significant digits (drops +, spaces, dashes). */
function onlyDigits(value: string): string {
  return (value || '').replace(/\D+/g, '');
}

/**
 * Compare two digit strings allowing for a country-code / trunk-prefix offset:
 * equal if identical, or if one is a suffix of the other by at least 7 digits
 * (so +14155550123 == 4155550123 == 14155550123, but not unrelated numbers).
 */
function digitsEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.length >= 7 && longer.endsWith(shorter);
}

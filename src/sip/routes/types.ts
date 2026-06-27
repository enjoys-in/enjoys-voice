import type { DatabaseService, TrunkService, AuditService, DialResult } from '@/services';
import type { ConferenceService, QueueService } from '@/services';
import type { WidgetTokenClaims } from '@/core';
import type { UnreachableReason } from '@/core';
import type { RoutingOrchestrator } from '@/modules/routing';
import type { IVRSystem } from '../ivr.system';

export interface CallContext {
  req: any;
  res: any;
  calledNumber: string;
  callingNumber: string;
  callId: string;
  /**
   * When set, this INVITE carried a valid capability token from the embeddable
   * click-to-call widget (X-Widget-Token). The token — not a SIP registration —
   * authorizes the call, and pins the destination + caller-ID it may use.
   */
  widget?: WidgetTokenClaims;
}

export interface RouteServices {
  srf: any;
  db: DatabaseService;
  trunk: TrunkService;
  audit: AuditService;
  ivr: IVRSystem | null;
  conference: ConferenceService;
  queue: QueueService;
  notifyFn?: (extension: string, event: string, data?: any) => void;
  /**
   * Reusable routing module (business-hours + per-user schedule + presence).
   * Optional so handlers stay backward-compatible: when absent (or when no
   * schedule is configured) the existing registration/DND/offline logic runs
   * unchanged. Wired in phase 3 for the internal extension path only.
   */
  routing?: RoutingOrchestrator;
  routeToExtension: (req: any, res: any, contact: string, callId: string) => Promise<void>;
  forwardCall: (req: any, res: any, target: string, callId: string, callingNumber: string) => Promise<void>;
  /**
   * Run the offline/unreachable fallback chain (PSTN → forward → voicemail →
   * spoken status tone) for a known extension. `reason` controls voicemail
   * gating + wording: 'offline' (default) runs the full chain incl. voicemail
   * and records `unreachable`; 'busy'/'no_answer' skip voicemail, play a
   * "currently busy"/"not answering" tone and record `missed`. Used for
   * never-registered users, stale-registration (410), and busy/no-answer.
   */
  routeUnreachable: (req: any, res: any, calledExt: string, callId: string, callingNumber: string, reason?: UnreachableReason) => Promise<void>;
  /**
   * Handle a call to a registered user who has Do Not Disturb enabled: skip
   * ringing and send the caller straight to voicemail (or a silent SIP 480 when
   * voicemail is off). Records the call as `voicemail` or `missed`.
   */
  routeDoNotDisturb: (req: any, res: any, calledExt: string, callId: string, callingNumber: string) => Promise<void>;
}

export interface RouteHandler {
  handle(ctx: CallContext, services: RouteServices, route?: DialResult): Promise<boolean>;
}

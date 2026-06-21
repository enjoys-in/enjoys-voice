import type { DatabaseService, TrunkService, AuditService, DialResult } from '@/services';
import type { ConferenceService } from '@/services';
import type { IVRSystem } from '../ivr.system';

export interface CallContext {
  req: any;
  res: any;
  calledNumber: string;
  callingNumber: string;
  callId: string;
}

export interface RouteServices {
  srf: any;
  db: DatabaseService;
  trunk: TrunkService;
  audit: AuditService;
  ivr: IVRSystem | null;
  conference: ConferenceService;
  notifyFn?: (extension: string, event: string, data?: any) => void;
  routeToExtension: (req: any, res: any, contact: string, callId: string) => Promise<void>;
  forwardCall: (req: any, res: any, target: string, callId: string, callingNumber: string) => Promise<void>;
  /**
   * Run the offline/unreachable fallback chain (forward → PSTN → voicemail →
   * "unavailable" announcement) for a known extension and record the call as
   * missed. Used for both never-registered users and stale-registration (410)
   * failures so both paths behave identically.
   */
  routeUnreachable: (req: any, res: any, calledExt: string, callId: string, callingNumber: string) => Promise<void>;
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

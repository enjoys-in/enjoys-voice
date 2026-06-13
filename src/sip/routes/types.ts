import type { DatabaseService, TrunkService, AuditService, DialResult } from '@/services';
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
}

export interface RouteHandler {
  handle(ctx: CallContext, services: RouteServices, route?: DialResult): Promise<boolean>;
}

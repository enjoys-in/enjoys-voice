export interface RoutingContext {
  callId: string;
  callerNumber: string;
  calledNumber: string;
  targetExtension?: string;
  targetQueueId?: string;
  preferQueue?: boolean;
}

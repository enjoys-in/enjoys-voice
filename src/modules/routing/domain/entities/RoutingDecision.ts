import { DecisionType } from '../enums/DecisionType';
import { UnavailableReason } from '../enums/UnavailableReason';

export interface RoutingDecision {
  type: DecisionType;
  reason?: UnavailableReason;
  extension?: string;
  queueId?: string;
  pstnNumber?: string;
  announcementKey?: string;
}

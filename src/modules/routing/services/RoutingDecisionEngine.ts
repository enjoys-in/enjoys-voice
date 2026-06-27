import type { RoutingContext } from '../domain/entities/RoutingContext';
import type { RoutingDecision } from '../domain/entities/RoutingDecision';
import { DecisionType } from '../domain/enums/DecisionType';
import { UnavailableReason } from '../domain/enums/UnavailableReason';
import type { RoutingPolicySnapshot } from './RoutingPolicyService';

export class RoutingDecisionEngine {
  decide(ctx: RoutingContext, policy: RoutingPolicySnapshot): RoutingDecision {
    if (!policy.companyOpen) {
      return {
        type: DecisionType.PlayAnnouncement,
        reason: UnavailableReason.OutsideCompanyHours,
        announcementKey: 'company_closed',
      };
    }

    if (!policy.userWithinHours) {
      return {
        type: DecisionType.PlayAnnouncement,
        reason: UnavailableReason.OutsideUserHours,
        announcementKey: 'user_unavailable_by_schedule',
      };
    }

    if (policy.userDnd) {
      return {
        type: DecisionType.RouteToVoicemail,
        reason: UnavailableReason.UserDnd,
      };
    }

    if (policy.userOnline) {
      return {
        type: DecisionType.RouteToExtension,
        extension: ctx.targetExtension,
      };
    }

    if (ctx.preferQueue && ctx.targetQueueId) {
      return {
        type: DecisionType.RouteToQueue,
        queueId: ctx.targetQueueId,
        reason: UnavailableReason.UserOffline,
      };
    }

    return {
      type: DecisionType.RouteToVoicemail,
      reason: UnavailableReason.UserOffline,
    };
  }
}

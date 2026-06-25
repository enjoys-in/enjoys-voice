import type { UserProfileRepository } from '../contracts/UserProfileRepository';
import type { RoutingContext } from '../domain/entities/RoutingContext';
import type { RoutingDecision } from '../domain/entities/RoutingDecision';
import { RoutingDecisionEngine } from '../services/RoutingDecisionEngine';
import { RoutingPolicyService } from '../services/RoutingPolicyService';

export class RoutingOrchestrator {
  constructor(
    private readonly policyService: RoutingPolicyService,
    private readonly decisionEngine: RoutingDecisionEngine,
    private readonly users: UserProfileRepository,
  ) {}

  async evaluate(ctx: RoutingContext, now = new Date()): Promise<RoutingDecision> {
    const extension = ctx.targetExtension || '';
    const user = extension ? await this.users.getByExtension(extension) : undefined;

    const policy = await this.policyService.snapshot(extension, now, !!user?.dnd);
    return this.decisionEngine.decide(ctx, policy);
  }
}

import type { UserProfileRepository } from '../contracts/UserProfileRepository';
import type { PromptRepository } from '../contracts/PromptRepository';
import type { RoutingContext } from '../domain/entities/RoutingContext';
import type { RoutingDecision } from '../domain/entities/RoutingDecision';
import { RoutingDecisionEngine } from '../services/RoutingDecisionEngine';
import { RoutingPolicyService } from '../services/RoutingPolicyService';
import { announcementText } from '../constants/TtsPrompts';

export class RoutingOrchestrator {
  constructor(
    private readonly policyService: RoutingPolicyService,
    private readonly decisionEngine: RoutingDecisionEngine,
    private readonly users: UserProfileRepository,
    private readonly prompts?: PromptRepository,
  ) {}

  async evaluate(ctx: RoutingContext, now = new Date()): Promise<RoutingDecision> {
    const extension = ctx.targetExtension || '';
    const user = extension ? await this.users.getByExtension(extension) : undefined;

    const policy = await this.policyService.snapshot(extension, now, !!user?.dnd);
    return this.decisionEngine.decide(ctx, policy);
  }

  /**
   * Resolve a routing announcement's spoken text (raw, no `say:` prefix): an
   * admin override from `routing_prompts` when present, else the engine default.
   * Override-lookup failures fall back to the default so a DB hiccup can never
   * break a gated call.
   */
  async announcement(key?: string): Promise<string | undefined> {
    if (!key) return undefined;
    if (this.prompts) {
      try {
        const overrides = await this.prompts.getOverrides();
        const override = overrides[key];
        if (override && override.trim()) return override.trim();
      } catch (err: any) {
        console.warn('⚠️ routing prompt override lookup failed:', err?.message || err);
      }
    }
    return announcementText(key);
  }
}

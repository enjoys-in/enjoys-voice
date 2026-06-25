export { RoutingOrchestrator } from './application/RoutingOrchestrator';

export { RoutingDecisionEngine } from './services/RoutingDecisionEngine';
export { RoutingPolicyService } from './services/RoutingPolicyService';
export { AvailabilityService } from './services/AvailabilityService';
export { BusinessHoursService } from './services/BusinessHoursService';
export { PresenceService } from './services/PresenceService';

export { DecisionType } from './domain/enums/DecisionType';
export { UnavailableReason } from './domain/enums/UnavailableReason';

export type { RoutingContext } from './domain/entities/RoutingContext';
export type { RoutingDecision } from './domain/entities/RoutingDecision';
export type { AvailabilityWindow } from './domain/entities/AvailabilityWindow';
export type { BusinessHoursPolicy } from './domain/entities/BusinessHoursPolicy';

export type { AvailabilityRepository } from './contracts/AvailabilityRepository';
export type { BusinessHoursRepository } from './contracts/BusinessHoursRepository';
export type { PresenceProvider } from './contracts/PresenceProvider';
export type { UserProfileRepository, UserProfile } from './contracts/UserProfileRepository';

export { TTS_PROMPTS } from './constants/TtsPrompts';
export type { TtsPromptKey } from './constants/TtsPrompts';

export { PgAvailabilityRepository } from './infrastructure/postgres/PgAvailabilityRepository';
export { PgBusinessHoursRepository } from './infrastructure/postgres/PgBusinessHoursRepository';
export { PgUserProfileRepository } from './infrastructure/postgres/PgUserProfileRepository';
export { DatabasePresenceProvider } from './infrastructure/adapters/DatabasePresenceProvider';

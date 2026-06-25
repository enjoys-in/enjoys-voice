# Reusable Routing + Availability Module Plan

## Goal
Build a reusable module (class + service layer) for call-routing decisions so the same logic can be reused by:
- IVR flow transfer nodes
- queue entry and agent selection
- internal extension routing
- PSTN inbound routing

The module will centralize:
- user availability (working hours)
- company global business hours
- online/offline presence checks
- DND and policy checks
- route decision outputs (route to extension, queue, voicemail, announcement, reject)

---

## Design Principles
- Single responsibility per class.
- Domain-first services; transport/framework adapters stay thin.
- Pure decision engine where possible (easy tests, reusable).
- Interfaces for repositories/providers to support future reuse.
- Keep existing SIP handlers, but make them call the new services.

---

## Proposed Directory Structure

```text
src/
	modules/
		routing/
			domain/
				entities/
					AvailabilityWindow.ts
					BusinessHoursPolicy.ts
					RoutingContext.ts
					RoutingDecision.ts
				value-objects/
					TimeRange.ts
					Weekday.ts
					RouteTarget.ts
				enums/
					DecisionType.ts
					UnavailableReason.ts
			contracts/
				AvailabilityRepository.ts
				BusinessHoursRepository.ts
				PresenceProvider.ts
				UserProfileRepository.ts
			services/
				AvailabilityService.ts
				BusinessHoursService.ts
				PresenceService.ts
				RoutingPolicyService.ts
				RoutingDecisionEngine.ts
			application/
				RoutingOrchestrator.ts
			infrastructure/
				postgres/
					PgAvailabilityRepository.ts
					PgBusinessHoursRepository.ts
				adapters/
					DatabasePresenceProvider.ts
			dto/
				EvaluateRouteInput.ts
				EvaluateRouteOutput.ts
			index.ts
```

Optional shared path if needed later:

```text
src/shared/time/
	TimezoneClock.ts
	BusinessCalendar.ts
```

---

## Class and Service Responsibilities

### 1) AvailabilityService
- Evaluate if a specific user is inside their configured working window.
- Inputs: userId/extension, timezone-aware current time.
- Output: available or unavailable with reason (`outside_user_hours`, `holiday`, etc.).

### 2) BusinessHoursService
- Evaluate global company open/closed state.
- Supports default weekly windows and optional exceptions.
- Output: open or closed with reason (`outside_company_hours`).

### 3) PresenceService
- Wrap registration checks (`isRegistered`) and map to online/offline.
- No business rule logic; only presence status.

### 4) RoutingPolicyService
- Combine policy rules: business hours, user hours, DND, queue settings.
- Decide allowed actions for current route context.

### 5) RoutingDecisionEngine (pure core)
- Deterministic decision tree.
- Input: normalized context + policy flags.
- Output: typed decision:
	- route_to_extension
	- route_to_queue
	- route_to_pstn
	- route_to_voicemail
	- play_announcement
	- reject

### 6) RoutingOrchestrator
- Application-layer facade used by SIP handlers and IVR runtime.
- Calls services/engine, returns final decision + metadata (prompt key, reason, target).

---

## Data Model Additions (High-Level)

### user_availability_windows
- id
- extension
- day_of_week (0-6 or enum)
- start_time
- end_time
- timezone
- enabled

### business_hours_policies
- id (singleton or tenant/workspace scoped)
- timezone
- enabled

### business_hours_windows
- policy_id
- day_of_week
- start_time
- end_time

### business_hours_exceptions (optional, phase 2)
- date
- closed_all_day
- start_time
- end_time
- note

---

## Integration Plan (Phased)

### Phase 1: Foundation
1. Create module folders and contracts.
2. Implement domain models and enums.
3. Implement `RoutingDecisionEngine` with unit tests.

### Phase 2: Infrastructure
1. Add repositories (Postgres) for user availability + business hours.
2. Add presence adapter on top of existing registration store.
3. Wire module in `src/index.ts` with dependency injection.

### Phase 3: SIP/IVR Integration
1. In internal route handler, call orchestrator before `routeToExtension`.
2. In queue handler, call orchestrator for pre-queue gating.
3. In IVR transfer path, replace inline decisions with orchestrator output.
4. Keep fallback behavior compatible with current call flow.

### Phase 4: Admin/API Surface
1. Add CRUD endpoints for user availability windows.
2. Add CRUD endpoints for global business hours.
3. Add UI sections for both schedules.

### Phase 5: Prompt and UX Mapping
1. Map unavailable reasons to prompt keys/messages:
	 - company closed
	 - user unavailable by schedule
	 - all agents busy
	 - no agents online
2. Add configurable prompt overrides.

---

## Rule Order (Default)
1. Company business hours check.
2. User-specific availability check.
3. DND check.
4. Presence check (online/offline).
5. Queue/extension/pstn route action.
6. Fallback (voicemail or announcement or reject).

This order should live in one place (`RoutingPolicyService` + `RoutingDecisionEngine`) and not be duplicated in handlers.

---

## Testing Strategy

### Unit Tests
- `RoutingDecisionEngine` decision matrix.
- `AvailabilityService` time boundary tests.
- `BusinessHoursService` weekday + timezone tests.

### Integration Tests
- SIP route handlers call orchestrator and apply decision correctly.
- Queue path differences:
	- no agents online
	- agents online but busy
	- outside company hours

### Regression Tests
- Existing call flow behavior remains unchanged when schedules are not configured.

---

## Backward Compatibility
- If no business-hours policy exists, treat as always open.
- If no user availability exists, treat user as always available.
- Preserve existing DND and voicemail fallback behavior.

---

## Deliverables Checklist
- [x] Module skeleton in `src/modules/routing/`
- [x] Domain models + contracts
- [x] Decision engine (phase 1) — tests pending
- [x] Postgres repositories + migrations
- [~] SIP/IVR integration points switched to orchestrator (phase 3: internal extension; phase 4: queue business-hours + no-agents-online prompts)
- [x] Admin/API endpoints for schedules (phase 5a Go CRUD; phase 5b admin UI)
- [x] Prompt mapping for unavailable reasons (`constants/TtsPrompts.ts`)
- [ ] Documentation update (architecture + env/config)

---

## Implementation Notes
- Keep `RoutingDecisionEngine` side-effect free.
- Keep logging in orchestrator/handlers, not in pure engine.
- Use typed decision objects to avoid stringly-typed branching in handlers.
- Avoid direct DB access inside route handlers after migration to this module.

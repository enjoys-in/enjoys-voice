export const TTS_PROMPTS = {
  COMPANY_CLOSED: 'say:Our company is currently closed. Please call us during business hours.',
  USER_UNAVAILABLE_BY_SCHEDULE: 'say:The person you are trying to reach is currently unavailable. Please try again later.',
  USER_UNREACHABLE: 'say:The person you are trying to reach is unavailable. Please leave a message after the beep.',
  ALL_AGENTS_BUSY: 'say:All of our agents are currently busy. Please hold, or try again later.',
  NO_AGENTS_ONLINE: 'say:No agents are currently online. Please call back during working hours.',
} as const;

export type TtsPromptKey = keyof typeof TTS_PROMPTS;

/**
 * Maps a `RoutingDecision.announcementKey` (produced by the decision engine) to
 * its spoken prompt. Values keep the FreeSWITCH `say:` engine prefix so they can
 * be handed straight to the IVR's `playSafe`.
 */
export const ANNOUNCEMENT_PROMPTS: Record<string, string> = {
  company_closed: TTS_PROMPTS.COMPANY_CLOSED,
  user_unavailable_by_schedule: TTS_PROMPTS.USER_UNAVAILABLE_BY_SCHEDULE,
  user_unreachable: TTS_PROMPTS.USER_UNREACHABLE,
  all_agents_busy: TTS_PROMPTS.ALL_AGENTS_BUSY,
  no_agents_online: TTS_PROMPTS.NO_AGENTS_ONLINE,
};

/**
 * Returns the raw spoken text (without the `say:` prefix) for a decision's
 * `announcementKey`, suitable for `IVRSystem.playUnavailable`, which re-adds the
 * engine prefix itself. Returns `undefined` for an unknown/empty key so callers
 * fall back to their own default wording.
 */
export function announcementText(key?: string): string | undefined {
  if (!key) return undefined;
  const prompt = ANNOUNCEMENT_PROMPTS[key];
  return prompt ? prompt.replace(/^say:/, '') : undefined;
}

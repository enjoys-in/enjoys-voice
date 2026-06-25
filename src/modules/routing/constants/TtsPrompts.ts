export const TTS_PROMPTS = {
  COMPANY_CLOSED: 'say:Our company is currently closed. Please call us during business hours.',
  USER_UNAVAILABLE_BY_SCHEDULE: 'say:The person you are trying to reach is currently unavailable. Please try again later.',
  USER_UNREACHABLE: 'say:The person you are trying to reach is unavailable. Please leave a message after the beep.',
  ALL_AGENTS_BUSY: 'say:All of our agents are currently busy. Please hold, or try again later.',
  NO_AGENTS_ONLINE: 'say:No agents are currently online. Please call back during working hours.',
} as const;

export type TtsPromptKey = keyof typeof TTS_PROMPTS;

-- Routing announcement prompt overrides (phase 7)
--
-- Admin-editable spoken wording for the routing announcements (company closed,
-- user unavailable, no agents online, …). Each row overrides one prompt key; a
-- missing key falls back to the hardcoded default in the Node engine
-- (src/modules/routing/constants/TtsPrompts.ts), so an empty table preserves the
-- shipped wording (backward compatible). Text is the raw spoken phrase, without
-- the FreeSWITCH `say:` engine prefix (the engine adds it).

CREATE TABLE IF NOT EXISTS routing_prompts (
    prompt_key VARCHAR(64) PRIMARY KEY,
    text       TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

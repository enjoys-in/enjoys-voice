import { getPool } from './pool';

/**
 * An AI agent row as the media runtime needs it to build a live pipeline. Mirrors
 * the Go API's `ai_agents` table 1:1 — there are no secrets here (provider API
 * keys live in the runtime environment), so the full row is safe to read.
 */
export interface AiAgentRecord {
  id: number;
  ownerExtension: string;
  name: string;
  greeting: string;
  language: string;
  sttProvider: string;
  llmProvider: string;
  llmModel: string;
  systemPrompt: string;
  temperature: number;
  ttsProvider: string;
  ttsVoice: string;
  enabled: boolean;
}

interface AiAgentRow {
  id: number | string;
  owner_extension: string;
  name: string;
  greeting: string | null;
  language: string | null;
  stt_provider: string | null;
  llm_provider: string | null;
  llm_model: string | null;
  system_prompt: string | null;
  temperature: number | string | null;
  tts_provider: string | null;
  tts_voice: string | null;
  enabled: boolean;
}

function rowToAgent(r: AiAgentRow): AiAgentRecord {
  return {
    id: Number(r.id),
    ownerExtension: r.owner_extension,
    name: r.name,
    greeting: r.greeting ?? '',
    language: r.language ?? 'en',
    sttProvider: r.stt_provider ?? 'speechmatics',
    llmProvider: r.llm_provider ?? 'openai',
    llmModel: r.llm_model ?? 'gpt-4o-mini',
    systemPrompt: r.system_prompt ?? '',
    temperature: r.temperature != null ? Number(r.temperature) : 0.7,
    ttsProvider: r.tts_provider ?? 'deepgram',
    ttsVoice: r.tts_voice ?? '',
    enabled: !!r.enabled,
  };
}

const SELECT =
  `SELECT id, owner_extension, name, greeting, language, stt_provider,
          llm_provider, llm_model, system_prompt, temperature, tts_provider,
          tts_voice, enabled
     FROM ai_agents`;

/**
 * Load one enabled AI agent by id, or undefined when it doesn't exist / is
 * disabled. Returns undefined when the table doesn't exist yet (the Go API
 * creates it on first migrate).
 */
export async function loadAiAgentById(id: number): Promise<AiAgentRecord | undefined> {
  try {
    const { rows } = await getPool().query(`${SELECT} WHERE id = $1 AND enabled = TRUE`, [id]);
    const row = (rows as AiAgentRow[])[0];
    return row ? rowToAgent(row) : undefined;
  } catch (err: any) {
    if (err?.code === '42P01') return undefined; // undefined_table
    throw err;
  }
}

/**
 * Load every ENABLED AI agent. The set is small (a few agents per user), so the
 * runtime caches the whole thing and refreshes on NOTIFY. Returns [] when the
 * table doesn't exist yet.
 */
export async function loadEnabledAiAgents(): Promise<AiAgentRecord[]> {
  try {
    const { rows } = await getPool().query(`${SELECT} WHERE enabled = TRUE`);
    return (rows as AiAgentRow[]).map(rowToAgent);
  } catch (err: any) {
    if (err?.code === '42P01') return [];
    throw err;
  }
}

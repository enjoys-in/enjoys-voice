import { getPool } from '@/services/postgres';
import type { PromptRepository } from '../../contracts/PromptRepository';

interface PromptRow {
  prompt_key: string;
  text: string;
}

/**
 * Postgres-backed routing announcement overrides (`routing_prompts`, written by
 * the Go API). Read at announcement time only (gated calls), so no caching is
 * needed. Backward compatible: a missing table means "no overrides" → defaults.
 */
export class PgPromptRepository implements PromptRepository {
  async getOverrides(): Promise<Record<string, string>> {
    try {
      const { rows } = await getPool().query<PromptRow>(
        `SELECT prompt_key, text FROM routing_prompts`,
      );
      const map: Record<string, string> = {};
      for (const r of rows) {
        if (r.text && r.text.trim()) map[r.prompt_key] = r.text.trim();
      }
      return map;
    } catch (err: any) {
      // Before migration 007 the table is absent → treat as no overrides.
      if (typeof err?.message === 'string' && err.message.includes('does not exist')) return {};
      throw err;
    }
  }
}

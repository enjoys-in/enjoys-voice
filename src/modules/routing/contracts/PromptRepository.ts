/**
 * Read access to admin-defined overrides for routing announcement wording.
 * Returns a map of prompt key → raw spoken text (no `say:` engine prefix). A
 * key that is absent simply falls back to the engine default, so an empty map
 * preserves the shipped wording.
 */
export interface PromptRepository {
  getOverrides(): Promise<Record<string, string>>;
}

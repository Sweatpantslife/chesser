import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * BYOK (bring your own key) — the user's own LLM API key for the AI coach.
 *
 * PRIVACY CONTRACT (do not weaken):
 *  • The key is persisted ONLY in this browser's localStorage
 *    (`chesser-byok`). It is deliberately NOT wired into lib/sync.ts, so it
 *    never rides the account progress blob to the server.
 *  • The key is sent ONLY to the provider the user chose — directly from the
 *    browser when the provider allows it, or forwarded once per request
 *    through the stateless /api/coach/explain pass-through when CORS blocks
 *    the direct call (the server never stores or logs it; see
 *    apps/server/src/coach/routes.ts).
 *  • Never log the key, never include it in error messages or analytics.
 */

export type ByokProviderId = 'anthropic' | 'openai';

// i18n note: `hint` strings below are the CANONICAL ENGLISH; ByokSettings
// resolves display text via `settings:byok.modelHints.<id>` with these as
// defaultValue. Model ids themselves are never translated.

/** Suggested Anthropic models (the input also accepts any custom id). */
export const ANTHROPIC_MODEL_SUGGESTIONS = [
  { id: 'claude-haiku-4-5', hint: 'fastest & cheapest — the default' },
  { id: 'claude-sonnet-4-6', hint: 'stronger prose, mid price' },
  { id: 'claude-opus-4-8', hint: 'most capable, highest price' },
] as const;

/** Suggested OpenAI-compatible models (any custom id works too). */
export const OPENAI_MODEL_SUGGESTIONS = [
  { id: 'gpt-4o-mini', hint: 'cheap default' },
  { id: 'gpt-4o', hint: 'stronger, pricier' },
] as const;

export const DEFAULT_BYOK_MODEL: Record<ByokProviderId, string> = {
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-4o-mini',
};

/** Everything a call path needs, snapshot-style (no store reference). */
export interface ByokConfig {
  provider: ByokProviderId;
  apiKey: string;
  /** Empty string → provider default model. */
  model: string;
  /** OpenAI-compatible base URL; empty string → https://api.openai.com/v1. */
  baseUrl: string;
}

interface ByokState {
  provider: ByokProviderId;
  apiKey: string;
  model: string;
  baseUrl: string;
  setProvider(p: ByokProviderId): void;
  setApiKey(k: string): void;
  setModel(m: string): void;
  setBaseUrl(u: string): void;
  /** Forget the key (provider/model/baseUrl prefs are kept). */
  clearKey(): void;
}

export const useByok = create<ByokState>()(
  persist(
    (set) => ({
      provider: 'anthropic',
      apiKey: '',
      model: '',
      baseUrl: '',
      setProvider: (provider) => set({ provider, model: '' }),
      setApiKey: (apiKey) => set({ apiKey: apiKey.trim() }),
      setModel: (model) => set({ model: model.trim() }),
      setBaseUrl: (baseUrl) => set({ baseUrl: baseUrl.trim() }),
      clearKey: () => set({ apiKey: '' }),
    }),
    { name: 'chesser-byok' },
  ),
);

/** The active BYOK config, or null when no key is set. */
export function byokConfig(): ByokConfig | null {
  const s = useByok.getState();
  if (!s.apiKey) return null;
  return { provider: s.provider, apiKey: s.apiKey, model: s.model, baseUrl: s.baseUrl };
}

/**
 * Settings → "AI Coach — your own key" (BYOK).
 *
 * Lets the user plug in their own LLM API key so AI coaching works without
 * the operator paying for anything. The key is stored ONLY in this browser
 * (store/byok, localStorage) and is sent only to the chosen provider —
 * directly from the browser when possible, or forwarded once per request
 * through the server's stateless pass-through when CORS blocks the direct
 * call. Calls are billed to the user's key at their provider's rates.
 */
import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  ANTHROPIC_MODEL_SUGGESTIONS,
  DEFAULT_BYOK_MODEL,
  OPENAI_MODEL_SUGGESTIONS,
  useByok,
  type ByokProviderId,
} from '../store/byok';
import { testUserKey, type KeyTestResult } from '../lib/byokCoach';
import { playSound } from '../lib/sound';

// Labels live in the `settings` namespace under `byok.providers.<id>`.
const PROVIDERS: ByokProviderId[] = ['anthropic', 'openai'];

type TestState = { phase: 'idle' } | { phase: 'testing' } | { phase: 'done'; result: KeyTestResult };

export function ByokSettings(): JSX.Element {
  const { t } = useTranslation('settings');
  const { provider, apiKey, model, baseUrl, setProvider, setApiKey, setModel, setBaseUrl, clearKey } = useByok();
  const [test, setTest] = useState<TestState>({ phase: 'idle' });

  const suggestions = provider === 'anthropic' ? ANTHROPIC_MODEL_SUGGESTIONS : OPENAI_MODEL_SUGGESTIONS;
  const modelListId = 'byok-model-suggestions';

  const runTest = () => {
    if (!apiKey || test.phase === 'testing') return;
    setTest({ phase: 'testing' });
    void testUserKey({ provider, apiKey, model, baseUrl }).then((result) => setTest({ phase: 'done', result }));
  };

  return (
    <div className="mt-3" data-testid="byok-settings">
      <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">{t('byok.title')}</div>
      <p className="mb-2 text-xs text-neutral-400">
        <Trans t={t} i18nKey="byok.intro" components={{ rates: <span className="text-neutral-300" /> }} />
      </p>

      <div className="mb-2 flex gap-1" role="group" aria-label={t('byok.providerAria')}>
        {PROVIDERS.map((id) => (
          <button
            key={id}
            onClick={() => {
              playSound('uiClick');
              setProvider(id);
              setTest({ phase: 'idle' });
            }}
            aria-pressed={provider === id}
            className={`btn-press flex-1 rounded-full px-2 py-1 text-xs font-semibold ${
              provider === id ? 'bg-brand-600 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
            }`}
          >
            {t(`byok.providers.${id}`)}
          </button>
        ))}
      </div>

      <label className="mb-2 block">
        <span className="mb-0.5 block text-xs text-neutral-400">{t('byok.apiKey')}</span>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
            setTest({ phase: 'idle' });
          }}
          placeholder={provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
          autoComplete="off"
          data-testid="byok-key-input"
          className="w-full rounded-lg bg-neutral-800 px-2 py-1.5 text-sm text-ink placeholder:text-neutral-400"
        />
      </label>

      <label className="mb-2 block">
        <span className="mb-0.5 block text-xs text-neutral-400">
          {t('byok.model', { model: DEFAULT_BYOK_MODEL[provider] })}
        </span>
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={DEFAULT_BYOK_MODEL[provider]}
          list={modelListId}
          autoComplete="off"
          className="w-full rounded-lg bg-neutral-800 px-2 py-1.5 text-sm text-ink placeholder:text-neutral-400"
        />
        <datalist id={modelListId}>
          {suggestions.map((m) => (
            <option key={m.id} value={m.id}>
              {t(`byok.modelHints.${m.id}`, { defaultValue: m.hint })}
            </option>
          ))}
        </datalist>
      </label>

      {provider === 'openai' && (
        <label className="mb-2 block">
          <span className="mb-0.5 block text-xs text-neutral-400">{t('byok.baseUrl')}</span>
          <input
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
            autoComplete="off"
            className="w-full rounded-lg bg-neutral-800 px-2 py-1.5 text-sm text-ink placeholder:text-neutral-400"
          />
        </label>
      )}

      <div className="flex gap-1.5">
        <button
          onClick={runTest}
          disabled={!apiKey || test.phase === 'testing'}
          data-testid="byok-test-key"
          className="btn-press flex-1 rounded-full bg-brand-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {test.phase === 'testing' ? t('byok.testing') : t('byok.testKey')}
        </button>
        <button
          onClick={() => {
            playSound('uiClick');
            clearKey();
            setTest({ phase: 'idle' });
          }}
          disabled={!apiKey}
          data-testid="byok-clear-key"
          className="btn-press flex-1 rounded-full bg-neutral-700 px-2 py-1.5 text-xs font-semibold text-neutral-200 hover:bg-neutral-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('byok.clearKey')}
        </button>
      </div>

      {test.phase === 'done' && (
        <p
          data-testid="byok-test-result"
          className={`mt-1.5 text-xs ${test.result.ok ? 'text-emerald-400' : 'text-rose-400'}`}
          role="status"
        >
          {test.result.ok
            ? test.result.via === 'server'
              ? t('byok.keyWorksRelay', { model: test.result.model })
              : t('byok.keyWorksDirect', { model: test.result.model })
            : test.result.error}
        </p>
      )}

      {apiKey && test.phase !== 'done' && (
        <p className="mt-1.5 text-xs text-neutral-400">{t('byok.activeNote')}</p>
      )}
    </div>
  );
}

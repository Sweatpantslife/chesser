import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoachMoveFacts } from '@chesser/shared';
import { explainWithUserKey, testUserKey } from './byokCoach';
import { explainWithCoach, _resetCoachApiForTests } from './coachApi';
import { useByok, type ByokConfig } from '../store/byok';

const KEY = 'sk-test-byok-key-1234567890';

function moveFacts(san = 'Qxb7'): CoachMoveFacts {
  return {
    kind: 'move',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    side: 'white',
    moveLabel: '14.',
    san,
    classification: 'blunder',
    evalBefore: '+1.20',
    evalAfter: '-2.35',
    winBefore: 62.1,
    winAfter: 21.4,
    bestMoveSan: 'Nf3',
    pv: ['Nf3'],
    bestReplySan: 'Rb8',
    phase: 'middlegame',
    isCheck: false,
    isMate: false,
    ruleBasedText: 'Blunder.',
    weaknessThemes: [],
  };
}

const anthropicOk = (text = 'Direct prose.') =>
  ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text }] }) }) as Response;
const openAiOk = (text = 'OpenAI prose.') =>
  ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: text } }] }) }) as Response;
const passThroughOk = (text = 'Relayed prose.') =>
  ({ ok: true, status: 200, json: async () => ({ configured: true, explanation: text, model: 'm', cached: false }) }) as Response;

const anthropicCfg: ByokConfig = { provider: 'anthropic', apiKey: KEY, model: '', baseUrl: '' };
const openAiCfg: ByokConfig = { provider: 'openai', apiKey: KEY, model: 'local-model', baseUrl: 'https://llm.example.com/v1' };

afterEach(() => vi.unstubAllGlobals());

describe('explainWithUserKey — direct browser calls', () => {
  it('calls Anthropic directly with the user key and the browser-access opt-in header', async () => {
    const fetchMock = vi.fn(async () => anthropicOk());
    vi.stubGlobal('fetch', fetchMock);

    expect(await explainWithUserKey(anthropicCfg, moveFacts(), 'beginner')).toBe('Direct prose.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(KEY);
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    const body = JSON.parse(String(init.body)) as { model: string; system: string };
    expect(body.model).toBe('claude-haiku-4-5'); // provider default
    expect(body.system).toContain('ONLY the provided facts'); // shared prompt
  });

  it('calls an OpenAI-compatible base URL directly with a bearer key', async () => {
    const fetchMock = vi.fn(async () => openAiOk());
    vi.stubGlobal('fetch', fetchMock);

    expect(await explainWithUserKey(openAiCfg, moveFacts())).toBe('OpenAI prose.');
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('https://llm.example.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(init.body)).model).toBe('local-model');
  });

  it('falls back to the stateless pass-through when the direct call dies at the network/CORS layer', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch')) // CORS/offline
      .mockResolvedValueOnce(passThroughOk());
    vi.stubGlobal('fetch', fetchMock);

    expect(await explainWithUserKey(openAiCfg, moveFacts())).toBe('Relayed prose.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1]! as unknown as [string, RequestInit];
    expect(url).toBe('/api/coach/explain');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-coach-key']).toBe(KEY);
    expect(headers['x-coach-provider']).toBe('openai');
    expect(headers['x-coach-model']).toBe('local-model');
    expect(headers['x-coach-base-url']).toBe('https://llm.example.com/v1');
  });

  it('resolves null on a provider HTTP error WITHOUT retrying through the server (no double-billing)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }) as Response);
    vi.stubGlobal('fetch', fetchMock);

    expect(await explainWithUserKey(anthropicCfg, moveFacts())).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('testUserKey', () => {
  it('reports a working key via the direct path', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => anthropicOk('ok')));
    expect(await testUserKey(anthropicCfg)).toEqual({ ok: true, via: 'direct', model: 'claude-haiku-4-5' });
  });

  it('reports friendly errors that never include the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }) as Response));
    const res = await testUserKey(anthropicCfg);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/rejected the key/i);
      expect(res.error).not.toContain(KEY);
    }
  });

  it('reports success via the server when only the pass-through works', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('cors'))
      .mockResolvedValueOnce(passThroughOk());
    vi.stubGlobal('fetch', fetchMock);
    expect(await testUserKey(openAiCfg)).toEqual({ ok: true, via: 'server', model: 'local-model' });
  });
});

describe('explainWithCoach routing (BYOK vs server)', () => {
  beforeEach(() => {
    _resetCoachApiForTests();
    useByok.setState({ provider: 'anthropic', apiKey: '', model: '', baseUrl: '' });
  });
  afterEach(() => {
    useByok.setState({ provider: 'anthropic', apiKey: '', model: '', baseUrl: '' });
  });

  it('routes through the user key when one is configured — the server explain endpoint is never called', async () => {
    useByok.setState({ apiKey: KEY });
    const fetchMock = vi.fn(async () => anthropicOk('BYOK routed.'));
    vi.stubGlobal('fetch', fetchMock);

    expect(await explainWithCoach(moveFacts())).toBe('BYOK routed.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [routedUrl] = fetchMock.mock.calls[0]! as unknown as [string];
    expect(routedUrl).toBe('https://api.anthropic.com/v1/messages');

    // Memoized per payload — a second ask never re-bills the user's key.
    expect(await explainWithCoach(moveFacts())).toBe('BYOK routed.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ignores the "server has no key" latch while a user key is set, and re-asks after key changes', async () => {
    // Latch the server path first.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ configured: false, reason: 'no-key' }) }) as Response));
    expect(await explainWithCoach(moveFacts())).toBeNull();

    // Now the user adds a key: BYOK must still fire despite the latch.
    useByok.setState({ apiKey: KEY });
    const fetchMock = vi.fn(async () => anthropicOk('With key.'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await explainWithCoach(moveFacts())).toBe('With key.');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Clearing the key drops back to the latched server path — no network.
    useByok.setState({ apiKey: '' });
    const idleMock = vi.fn();
    vi.stubGlobal('fetch', idleMock);
    expect(await explainWithCoach(moveFacts())).toBeNull();
    expect(idleMock).not.toHaveBeenCalled();
  });
});

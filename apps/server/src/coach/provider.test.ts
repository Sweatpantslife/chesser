import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerFromEnv } from './provider.js';

// fetch stub in the style of import.test.ts — capture calls, restore after.
interface Call {
  url: string;
  init: RequestInit;
}
type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function mockFetch(handler: Handler): { calls: Call[]; restore: () => void } {
  const calls: Call[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = orig) };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('providerFromEnv: no keys → null; ANTHROPIC_API_KEY wins over OPENAI_API_KEY', () => {
  assert.equal(providerFromEnv({} as NodeJS.ProcessEnv), null);
  assert.equal(providerFromEnv({ ANTHROPIC_API_KEY: '  ' } as NodeJS.ProcessEnv), null);

  const both = providerFromEnv({ ANTHROPIC_API_KEY: 'a-key', OPENAI_API_KEY: 'o-key' } as NodeJS.ProcessEnv);
  assert.equal(both?.id, 'anthropic');
  assert.equal(both?.model, 'claude-haiku-4-5-20251001'); // documented default

  const overridden = providerFromEnv({ ANTHROPIC_API_KEY: 'a-key', COACH_LLM_MODEL: 'my-model' } as NodeJS.ProcessEnv);
  assert.equal(overridden?.model, 'my-model');
});

test('anthropic provider: correct endpoint, headers, body shape; joins text blocks', async () => {
  const m = mockFetch(() =>
    json({ content: [{ type: 'text', text: 'Good ' }, { type: 'text', text: 'move!' }], stop_reason: 'end_turn' }),
  );
  try {
    const p = providerFromEnv({ ANTHROPIC_API_KEY: 'test-key' } as NodeJS.ProcessEnv)!;
    const out = await p.complete({ system: 'sys', user: 'usr', maxTokens: 300 });
    assert.equal(out, 'Good move!');

    assert.equal(m.calls.length, 1);
    const call = m.calls[0]!;
    assert.equal(call.url, 'https://api.anthropic.com/v1/messages');
    const headers = call.init.headers as Record<string, string>;
    assert.equal(headers['x-api-key'], 'test-key');
    assert.equal(headers['anthropic-version'], '2023-06-01');
    const body = JSON.parse(String(call.init.body));
    assert.equal(body.model, 'claude-haiku-4-5-20251001');
    assert.equal(body.max_tokens, 300);
    assert.equal(body.system, 'sys');
    assert.deepEqual(body.messages, [{ role: 'user', content: 'usr' }]);
  } finally {
    m.restore();
  }
});

test('anthropic provider: HTTP errors and empty content throw (route maps to 502)', async () => {
  const m = mockFetch(() => json({ error: 'nope' }, 401));
  try {
    const p = providerFromEnv({ ANTHROPIC_API_KEY: 'bad' } as NodeJS.ProcessEnv)!;
    await assert.rejects(() => p.complete({ system: 's', user: 'u', maxTokens: 10 }), /HTTP 401/);
  } finally {
    m.restore();
  }
  const empty = mockFetch(() => json({ content: [], stop_reason: 'refusal' }));
  try {
    const p = providerFromEnv({ ANTHROPIC_API_KEY: 'k' } as NodeJS.ProcessEnv)!;
    await assert.rejects(() => p.complete({ system: 's', user: 'u', maxTokens: 10 }), /empty response/);
  } finally {
    empty.restore();
  }
});

test('openai-compatible provider: chat/completions shape, base URL + model overrides', async () => {
  const m = mockFetch(() => json({ choices: [{ message: { content: ' A solid plan. ' } }] }));
  try {
    const p = providerFromEnv({
      OPENAI_API_KEY: 'sk-test',
      COACH_LLM_BASE_URL: 'http://localhost:11434/v1/', // trailing slash tolerated
      COACH_LLM_MODEL: 'llama3',
    } as NodeJS.ProcessEnv)!;
    assert.equal(p.id, 'openai');
    const out = await p.complete({ system: 'sys', user: 'usr', maxTokens: 120 });
    assert.equal(out, 'A solid plan.');

    const call = m.calls[0]!;
    assert.equal(call.url, 'http://localhost:11434/v1/chat/completions');
    const headers = call.init.headers as Record<string, string>;
    assert.equal(headers['Authorization'], 'Bearer sk-test');
    const body = JSON.parse(String(call.init.body));
    assert.equal(body.model, 'llama3');
    assert.equal(body.max_tokens, 120);
    assert.deepEqual(body.messages, [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'usr' },
    ]);
  } finally {
    m.restore();
  }
});

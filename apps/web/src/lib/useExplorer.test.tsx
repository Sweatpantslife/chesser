// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useExplorer } from './useExplorer';
import { DEFAULT_FILTERS } from './explorerApi';

/**
 * The `active` gate (explorer embed contract): while active=false the hook
 * must generate ZERO network activity even though it stays mounted, and a
 * false→true flip must feed the current fen immediately.
 *
 * Failed responses (!res.ok) are never cached by explorerApi, so each test
 * can reuse the stub without polluting the module-level LRU cache — but we
 * still use distinct FENs per test to keep them order-independent.
 */

const DEBOUNCE_MS = 250;

// Distinct legal positions (cache keys are position-keyed EPDs).
const FEN_A = '7k/8/8/8/8/8/8/K7 w - - 0 1';
const FEN_B = '6k1/8/8/8/8/8/8/K7 w - - 0 1';
const FEN_C = '5k2/8/8/8/8/8/8/K7 w - - 0 1';
const FEN_D = '4k3/8/8/8/8/8/8/K7 w - - 0 1';
const FEN_E = '3k4/8/8/8/8/8/8/K7 w - - 0 1';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn(async () => ({ ok: false, status: 503 }) as Response);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const flush = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
};

describe('useExplorer active gating', () => {
  it('fetches by default (active omitted)', async () => {
    renderHook(() => useExplorer(FEN_A, 'masters', DEFAULT_FILTERS));
    await flush(DEBOUNCE_MS + 50);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // URLSearchParams encodes spaces as '+', so assert on the board field only.
    expect(String(fetchMock.mock.calls[0]![0])).toContain(encodeURIComponent(FEN_A.split(' ')[0]!));
  });

  it('performs no network activity while active=false, even across fen changes', async () => {
    const { rerender } = renderHook(({ fen }) => useExplorer(fen, 'masters', DEFAULT_FILTERS, false), {
      initialProps: { fen: FEN_B },
    });
    await flush(DEBOUNCE_MS * 4);
    rerender({ fen: FEN_C });
    await flush(DEBOUNCE_MS * 4);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('feeds the current fen immediately on false→true', async () => {
    const { rerender } = renderHook(({ active }) => useExplorer(FEN_D, 'masters', DEFAULT_FILTERS, active), {
      initialProps: { active: false },
    });
    await flush(DEBOUNCE_MS * 4);
    expect(fetchMock).not.toHaveBeenCalled();

    rerender({ active: true });
    await flush(DEBOUNCE_MS + 50);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain(encodeURIComponent(FEN_D.split(' ')[0]!));
  });

  it('cancels a pending debounced fetch when deactivated mid-debounce', async () => {
    const { rerender } = renderHook(({ active }) => useExplorer(FEN_E, 'masters', DEFAULT_FILTERS, active), {
      initialProps: { active: true },
    });
    // Deactivate before the debounce elapses — the queued fetch must die.
    await flush(DEBOUNCE_MS / 2);
    rerender({ active: false });
    await flush(DEBOUNCE_MS * 4);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearLocalData } from './trustApi';

/** Minimal Storage stand-in backed by a Map. */
function fakeStorage(initial: Record<string, string>) {
  const m = new Map(Object.entries(initial));
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    has: (k: string) => m.has(k),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('clearLocalData', () => {
  it('removes every chesser-* key and nothing else', () => {
    const storage = fakeStorage({
      'chesser-auth': 'x',
      'chesser-progress': 'y',
      'unrelated-app': 'z',
    });
    vi.stubGlobal('localStorage', storage);
    clearLocalData();
    expect(storage.has('chesser-auth')).toBe(false);
    expect(storage.has('chesser-progress')).toBe(false);
    expect(storage.has('unrelated-app')).toBe(true);
  });

  it('does not throw when storage access is blocked', () => {
    // Some private/strict modes throw on ANY localStorage access — the
    // deletion flow must still reach its local cleanup + reload.
    vi.stubGlobal('localStorage', {
      get length(): number {
        throw new DOMException('storage disabled', 'SecurityError');
      },
      key: () => null,
      removeItem: () => {},
    });
    expect(() => clearLocalData()).not.toThrow();
  });
});

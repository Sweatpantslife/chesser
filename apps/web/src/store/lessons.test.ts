import { beforeEach, describe, expect, it } from 'vitest';
import { useLessons } from './lessons';

describe('lessons store', () => {
  beforeEach(() => useLessons.getState().reset());

  it('records completions, keeps earliest ts and best stars', () => {
    const first = useLessons.getState().complete('rules-pawn', 2);
    expect(first.firstTime).toBe(true);
    const ts = useLessons.getState().completed['rules-pawn']!.ts;

    const again = useLessons.getState().complete('rules-pawn', 3);
    expect(again.firstTime).toBe(false);
    expect(useLessons.getState().completed['rules-pawn']).toEqual({ ts, stars: 3 });

    // a worse replay never downgrades stars
    useLessons.getState().complete('rules-pawn', 1);
    expect(useLessons.getState().starsFor('rules-pawn')).toBe(3);
    expect(useLessons.getState().countComplete(['rules-pawn', 'rules-knight'])).toBe(1);
  });

  it('importMerge unions remote and local (earliest ts, best stars)', () => {
    useLessons.getState().complete('a', 2);
    const localTs = useLessons.getState().completed['a']!.ts;
    useLessons.getState().importMerge({
      completed: {
        a: { ts: localTs - 1000, stars: 1 },
        b: { ts: 42, stars: 3 },
      },
    });
    expect(useLessons.getState().completed['a']).toEqual({ ts: localTs - 1000, stars: 2 });
    expect(useLessons.getState().completed['b']).toEqual({ ts: 42, stars: 3 });
  });

  it('importMerge ignores malformed payloads without throwing', () => {
    useLessons.getState().complete('a', 3);
    const before = useLessons.getState().completed;
    for (const bad of [null, undefined, 42, 'nope', [], { completed: null }, { completed: 'nope' }, { completed: [1, 2] }]) {
      expect(() => useLessons.getState().importMerge(bad)).not.toThrow();
    }
    expect(useLessons.getState().completed).toEqual(before);
  });

  it('importMerge skips malformed records and non-numeric fields inside a valid payload', () => {
    useLessons.getState().importMerge({
      completed: {
        good: { ts: 7, stars: 2 },
        junk: 'not-a-record',
        alsoJunk: null,
        weird: { ts: 'soon', stars: 'many' }, // non-numeric fields fall back to defaults
      },
    });
    const c = useLessons.getState().completed;
    expect(c['good']).toEqual({ ts: 7, stars: 2 });
    expect(c['junk']).toBeUndefined();
    expect(c['alsoJunk']).toBeUndefined();
    expect(c['weird']!.stars).toBe(1);
    expect(typeof c['weird']!.ts).toBe('number');
  });

  it('exportState round-trips through importMerge', () => {
    useLessons.getState().complete('x', 3);
    const snapshot = useLessons.getState().exportState();
    useLessons.getState().reset();
    useLessons.getState().importMerge(snapshot);
    expect(useLessons.getState().isComplete('x')).toBe(true);
    expect(useLessons.getState().starsFor('x')).toBe(3);
  });
});

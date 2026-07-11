import { beforeEach, describe, expect, it } from 'vitest';
import { useRepertoire } from './repertoire';

describe('repertoire catalog picks', () => {
  beforeEach(() => {
    useRepertoire.setState({ picked: [], pickedAt: 0 });
  });

  it('togglePicked adds then removes a line and bumps pickedAt', () => {
    const s = useRepertoire.getState();
    s.togglePicked('it-pianissimo');
    expect(useRepertoire.getState().picked).toEqual(['it-pianissimo']);
    expect(useRepertoire.getState().pickedAt).toBeGreaterThan(0);
    useRepertoire.getState().togglePicked('it-pianissimo');
    expect(useRepertoire.getState().picked).toEqual([]);
  });

  it('setPicked dedupes', () => {
    useRepertoire.getState().setPicked(['a', 'b', 'a']);
    expect(useRepertoire.getState().picked).toEqual(['a', 'b']);
  });

  it('importPicks: newer remote wins, older/garbage is ignored', () => {
    useRepertoire.setState({ picked: ['local'], pickedAt: 100 });
    useRepertoire.getState().importPicks({ ids: ['remote'], updatedAt: 50 });
    expect(useRepertoire.getState().picked).toEqual(['local']);
    useRepertoire.getState().importPicks({ ids: ['remote', 42, 'x'], updatedAt: 200 });
    expect(useRepertoire.getState().picked).toEqual(['remote', 'x']);
    expect(useRepertoire.getState().pickedAt).toBe(200);
    useRepertoire.getState().importPicks('nonsense');
    useRepertoire.getState().importPicks({ ids: 'nope', updatedAt: 999 });
    expect(useRepertoire.getState().picked).toEqual(['remote', 'x']);
  });

  it('exportPicks round-trips through importPicks on a fresh store', () => {
    useRepertoire.setState({ picked: ['si-najdorf', 'lo-main'], pickedAt: 500 });
    const blob = useRepertoire.getState().exportPicks();
    useRepertoire.setState({ picked: [], pickedAt: 0 });
    useRepertoire.getState().importPicks(blob);
    expect(useRepertoire.getState().picked).toEqual(['si-najdorf', 'lo-main']);
  });
});

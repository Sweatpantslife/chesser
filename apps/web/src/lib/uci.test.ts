import { describe, expect, it } from 'vitest';
import { sanLineToUci } from './uci';

describe('sanLineToUci', () => {
  it('converts a plain opening line from the standard start', () => {
    expect(sanLineToUci(['e4', 'c5', 'Nf3', 'd6'])).toEqual(['e2e4', 'c7c5', 'g1f3', 'd7d6']);
  });

  it('returns an empty list for an empty line', () => {
    expect(sanLineToUci([])).toEqual([]);
  });

  it('emits castling as the king move (UCI form)', () => {
    expect(sanLineToUci(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O'])).toEqual([
      'e2e4',
      'e7e5',
      'g1f3',
      'b8c6',
      'f1c4',
      'f8c5',
      'e1g1',
    ]);
  });

  it('appends the promotion piece as a lowercase suffix', () => {
    const line = ['e4', 'd5', 'exd5', 'c6', 'dxc6', 'Nf6', 'cxb7', 'Nbd7', 'bxa8=Q'];
    expect(sanLineToUci(line)?.at(-1)).toBe('b7a8q');
  });

  it('rejects a line containing an illegal move', () => {
    expect(sanLineToUci(['e4', 'e4'])).toBeNull();
    expect(sanLineToUci(['Qh5'])).toBeNull();
    expect(sanLineToUci(['nonsense'])).toBeNull();
  });

  it('round-trips through the ?moves= wire format via URLSearchParams', () => {
    const ucis = sanLineToUci(['e4', 'c5'])!;
    const search = new URLSearchParams({ moves: ucis.join(',') }).toString();
    expect(new URLSearchParams(search).get('moves')).toBe('e2e4,c7c5');
  });
});

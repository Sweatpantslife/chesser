import { describe, expect, it } from 'vitest';
import { parseHashRoute, profileHashUser } from './hashRoute';

describe('parseHashRoute', () => {
  it('routes friend and profile hashes', () => {
    expect(parseHashRoute('#/friend/AB2C9D')).toEqual({ kind: 'friend' });
    expect(parseHashRoute('#/profile/bob')).toEqual({ kind: 'profile', user: 'bob' });
    expect(parseHashRoute('#/profile/a%20b')).toEqual({ kind: 'profile', user: 'a b' });
  });

  it('routes the legal pages', () => {
    expect(parseHashRoute('#/privacy')).toEqual({ kind: 'legal', page: 'privacy' });
    expect(parseHashRoute('#/terms')).toEqual({ kind: 'legal', page: 'terms' });
    expect(parseHashRoute('#/privacy/extra')).toEqual({ kind: 'ignore' });
  });

  it('treats a cleared hash as leaving a hash-driven view', () => {
    expect(parseHashRoute('')).toEqual({ kind: 'exit-overlay' });
    expect(parseHashRoute('#')).toEqual({ kind: 'exit-overlay' });
  });

  it("REGRESSION: the skip link's #main is an in-page anchor, not navigation", () => {
    // Activating "Skip to content" on a shared profile must move focus, not
    // bounce the view back home (see App.tsx's <a href="#main">).
    expect(parseHashRoute('#main')).toEqual({ kind: 'ignore' });
  });

  it('ignores foreign and malformed hashes', () => {
    expect(parseHashRoute('#some-anchor')).toEqual({ kind: 'ignore' });
    expect(parseHashRoute('#/profile/')).toEqual({ kind: 'ignore' }); // no name
    expect(parseHashRoute('#/profile/%E0%A4%A')).toEqual({ kind: 'ignore' }); // bad encoding
    expect(parseHashRoute('#/unknown/route')).toEqual({ kind: 'ignore' });
  });
});

describe('profileHashUser', () => {
  it('extracts the username only from a valid profile hash', () => {
    expect(profileHashUser('#/profile/carla')).toBe('carla');
    expect(profileHashUser('#main')).toBeNull();
    expect(profileHashUser('')).toBeNull();
  });
});

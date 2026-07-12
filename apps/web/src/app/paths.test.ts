import { describe, expect, it } from 'vitest';
import { deckPath, legacyRedirect, profileAliasRedirect, viewPath } from './paths';

describe('legacyRedirect (old hash URLs keep working forever)', () => {
  it('redirects shared friend-game invite links, keeping the code', () => {
    expect(legacyRedirect('/friend/AB12CD')).toBe('/play/friends/AB12CD');
    expect(legacyRedirect('/friend/xyz9')).toBe('/play/friends/xyz9');
  });

  it('rejects malformed friend codes', () => {
    expect(legacyRedirect('/friend/')).toBeNull();
    expect(legacyRedirect('/friend/has spaces')).toBeNull();
    expect(legacyRedirect('/friend/waaaaaaaaaytoolong')).toBeNull();
  });

  it('redirects the legal pages (footer/settings/consent/email links)', () => {
    expect(legacyRedirect('/privacy')).toBe('/profile/about/privacy');
    expect(legacyRedirect('/terms')).toBe('/profile/about/terms');
  });

  it('redirects every old flat tab id to its hub home', () => {
    expect(legacyRedirect('/home')).toBe('/');
    expect(legacyRedirect('/friends')).toBe('/play/friends');
    expect(legacyRedirect('/archive')).toBe('/profile/archive'); // owner decision: Profile, not Play
    expect(legacyRedirect('/tactics')).toBe('/train/tactics');
    expect(legacyRedirect('/endgame')).toBe('/train/endgames');
    expect(legacyRedirect('/endgame-drills')).toBe('/train/endgames/drill');
    expect(legacyRedirect('/coords')).toBe('/train/coordinates');
    // Old umbrella-Train sub-tabs (`trainTab` state) as guessed/bookmarked hashes.
    expect(legacyRedirect('/vision')).toBe('/train/vision');
    expect(legacyRedirect('/mates')).toBe('/train/checkmates');
    expect(legacyRedirect('/checkmates')).toBe('/train/checkmates');
    expect(legacyRedirect('/blunders')).toBe('/train/anti-blunder');
    expect(legacyRedirect('/anti-blunder')).toBe('/train/anti-blunder');
    expect(legacyRedirect('/coach')).toBe('/train');
    expect(legacyRedirect('/plan')).toBe('/train/plan');
    expect(legacyRedirect('/openings')).toBe('/learn/openings');
    expect(legacyRedirect('/explorer')).toBe('/learn/openings/explore');
    expect(legacyRedirect('/masters')).toBe('/learn/masters');
    expect(legacyRedirect('/stats')).toBe('/profile/progress');
    expect(legacyRedirect('/leaders')).toBe('/profile/leaderboards');
  });

  it('leaves unknown paths alone (router falls back to Home)', () => {
    expect(legacyRedirect('/definitely-not-a-view')).toBeNull();
    expect(legacyRedirect('/main')).toBeNull(); // skip-link anchor must never route
    expect(legacyRedirect('/')).toBeNull();
  });
});

describe('viewPath (legacy view ids used by page callbacks)', () => {
  it('maps every old View id to a real route', () => {
    expect(viewPath('home')).toBe('/');
    expect(viewPath('play')).toBe('/play');
    expect(viewPath('learn')).toBe('/learn');
    expect(viewPath('openings')).toBe('/learn/openings');
    expect(viewPath('tactics')).toBe('/train/tactics');
    expect(viewPath('profile')).toBe('/profile');
    expect(viewPath('plan')).toBe('/train/plan');
    expect(viewPath('coach')).toBe('/train');
    expect(viewPath('masters')).toBe('/learn/masters');
  });

  it('falls back to Home for unknown ids', () => {
    expect(viewPath('nope')).toBe('/');
  });
});

describe('deckPath (spaced-repetition review targets)', () => {
  it('maps each deck target to its trainer URL', () => {
    expect(deckPath({ view: 'openings' })).toBe('/learn/openings');
    expect(deckPath({ view: 'tactics' })).toBe('/train/tactics');
    expect(deckPath({ view: 'train', trainTab: 'mates' })).toBe('/train/checkmates');
    expect(deckPath({ view: 'train', trainTab: 'blunders' })).toBe('/train/anti-blunder');
    expect(deckPath({ view: 'endgame-drills' })).toBe('/train/endgames/drill');
  });
});

describe('profileAliasRedirect (reserved hub segments are never usernames)', () => {
  it('reserves EVERY Profile tab slug — a user literally named "archive" can never shadow the tab', () => {
    expect(profileAliasRedirect('overview')).toBe('/profile');
    expect(profileAliasRedirect('progress')).toBe('/profile/progress');
    expect(profileAliasRedirect('archive')).toBe('/profile/archive');
    expect(profileAliasRedirect('leaderboards')).toBe('/profile/leaderboards');
    expect(profileAliasRedirect('about')).toBe('/profile/about');
  });

  it('sends hub tabs and old names to their hub pages, any case', () => {
    expect(profileAliasRedirect('Progress')).toBe('/profile/progress');
    expect(profileAliasRedirect('stats')).toBe('/profile/progress');
    expect(profileAliasRedirect('leaders')).toBe('/profile/leaderboards');
    expect(profileAliasRedirect('ranks')).toBe('/profile/leaderboards');
    expect(profileAliasRedirect('ABOUT')).toBe('/profile/about');
    expect(profileAliasRedirect('settings')).toBe('/profile/about');
    expect(profileAliasRedirect('privacy')).toBe('/profile/about/privacy');
    expect(profileAliasRedirect('terms')).toBe('/profile/about/terms');
  });

  it('treats ordinary names as usernames', () => {
    expect(profileAliasRedirect('magnus')).toBeNull();
    expect(profileAliasRedirect('Ann-Marie_2')).toBeNull();
  });
});

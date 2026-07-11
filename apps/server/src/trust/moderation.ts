/**
 * Server-side moderation of user-chosen display text (PR #27/#31 doctrine:
 * the server never trusts client input — every name is validated, bounded and
 * filtered here before it is stored or shown to anyone else).
 *
 * Two call sites:
 *  - account registration (accounts/routes.ts): a rejected name fails the
 *    request with a human-readable error the client surfaces verbatim;
 *  - friend-room display names (friends/rooms.ts): free-form text shown to an
 *    opponent — a flagged name silently falls back to the seat default
 *    ("White"/"Black") rather than erroring mid-join.
 *
 * The filter is deliberately conservative and normalization-based: names are
 * lowercased and common leetspeak substitutions are folded (4dm1n → admin)
 * before matching, so trivial spelling tricks don't bypass it. Two match
 * modes keep false positives down (the Scunthorpe problem):
 *  - ANYWHERE terms are high-signal strings that almost never occur inside an
 *    innocent name — matched as substrings of the collapsed name;
 *  - EXACT terms are words that DO occur inside innocent names ("class",
 *    "cocktail", "cucumber"), so they only match as a whole separator-bounded
 *    token ("mod-club" is flagged, "modern" is not).
 */

/** Same charset/length contract as account usernames (accounts/auth.ts). */
export const NAME_RE = /^[a-zA-Z0-9_-]{3,20}$/;

/** Leetspeak folding applied before any matching. */
const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  $: 's',
  '!': 'i',
};

/** Lowercase + fold leetspeak. Keeps separators so tokenization still works. */
function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .split('')
    .map((c) => LEET[c] ?? c)
    .join('');
}

/** Separator-bounded tokens ("mod-club_99" → ["mod", "club", "99"]). */
function tokens(normalized: string): string[] {
  return normalized.split(/[-_.\s]+/).filter(Boolean);
}

/** The normalized name with separators stripped ("a_d-min" → "admin"). */
function collapse(normalized: string): string {
  return normalized.replace(/[-_.\s]+/g, '');
}

// --- impersonation: staff/official-style names -------------------------------

/** High-signal: anywhere in the collapsed name reads as staff/official. */
const RESERVED_ANYWHERE = ['admin', 'moderator', 'official', 'chesser'];

/** Ambiguous as substrings ("modern", "systematic") — whole tokens only. */
const RESERVED_EXACT = new Set([
  'mod',
  'mods',
  'staff',
  'support',
  'system',
  'sysop',
  'owner',
  'root',
  'helpdesk',
  'security',
  'team',
]);

// --- profanity / slurs --------------------------------------------------------

/** High-signal: rarely inside innocent names — matched anywhere. */
const PROFANE_ANYWHERE = [
  'fuck',
  'shit',
  'cunt',
  'nigg',
  'faggot',
  'bitch',
  'whore',
  'slut',
  'wank',
  'nazi',
  'hitler',
  'retard',
  'penis',
  'jizz',
];

/** Common inside innocent words ("cucumber", "cocktail") — whole tokens only. */
const PROFANE_EXACT = new Set([
  'ass',
  'arse',
  'cock',
  'dick',
  'tit',
  'tits',
  'cum',
  'hoe',
  'twat',
  'fag',
  'rape',
  'rapist',
  'kike',
  'spic',
]);

function matches(normalized: string, anywhere: string[], exact: Set<string>): boolean {
  const flat = collapse(normalized);
  if (anywhere.some((t) => flat.includes(t))) return true;
  return tokens(normalized).some((t) => exact.has(t));
}

/** True when the name reads as staff/official/the app itself. */
export function isImpersonating(name: string): boolean {
  return matches(normalize(name), RESERVED_ANYWHERE, RESERVED_EXACT);
}

/** True when the name contains profanity or a slur. */
export function isProfane(name: string): boolean {
  return matches(normalize(name), PROFANE_ANYWHERE, PROFANE_EXACT);
}

/**
 * Full username moderation: charset/length, impersonation, profanity.
 * Returns a user-facing error message, or null when the name is acceptable.
 */
export function moderateUsername(name: unknown): string | null {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    return 'Username must be 3–20 characters (letters, numbers, _ or -).';
  }
  if (isImpersonating(name)) {
    return 'That name is reserved — names that read as staff, moderators or Chesser itself are not allowed.';
  }
  if (isProfane(name)) {
    return 'That name is not allowed — please pick something family-friendly.';
  }
  return null;
}

/**
 * Free-form display text (friend-room names): strip control characters,
 * bound the length, and fall back when the result is empty or flagged.
 * Never throws — a bad name degrades to the fallback, not an error.
 */
export function cleanDisplayName(raw: string | undefined, maxLen: number, fallback: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = (raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  // Bound by code points, not UTF-16 units — a plain .slice() can cut an
  // astral character (emoji) in half and leave a malformed lone surrogate.
  const n = [...cleaned].slice(0, maxLen).join('');
  if (!n || isImpersonating(n) || isProfane(n)) return fallback;
  return n;
}

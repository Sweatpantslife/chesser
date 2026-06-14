import crypto from 'node:crypto';

/** scrypt password hashing (no external deps). */
export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password: string, salt: string, hash: string): boolean {
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

export function newToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function newUserId(): string {
  return crypto.randomBytes(8).toString('hex');
}

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,20}$/;

export function validateCredentials(username: unknown, password: unknown): string | null {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return 'Username must be 3–20 characters (letters, numbers, _ or -).';
  }
  if (typeof password !== 'string' || password.length < 6) {
    return 'Password must be at least 6 characters.';
  }
  return null;
}

import crypto from 'node:crypto';

/**
 * Passwords are capped BEFORE hashing: scrypt cost scales with input length,
 * so an uncapped password (the body limit allows ~1 MiB) turns the hash into
 * a CPU-DoS amplifier. 512 bytes is far beyond any real passphrase.
 */
export const MAX_PASSWORD_BYTES = 512;
export const MIN_PASSWORD_LENGTH = 8;

const SCRYPT_KEYLEN = 64;

function scrypt(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/**
 * scrypt password hashing (no external deps). Async so hashing runs in
 * libuv's threadpool instead of blocking the event loop per login/register.
 */
export async function hashPassword(password: string): Promise<{ salt: string; hash: string }> {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt)).toString('hex');
  return { salt, hash };
}

export async function verifyPassword(password: string, salt: string, hash: string): Promise<boolean> {
  const candidate = await scrypt(password, salt);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

let dummyCreds: { salt: string; hash: string } | null = null;

/**
 * Burn the same scrypt cost as a real verification. Called when a login names
 * a nonexistent user, so response timing doesn't separate "no such user" from
 * "wrong password". (Concurrent first calls may both hash the dummy — harmless.)
 */
export async function fakeVerifyPassword(password: string): Promise<void> {
  dummyCreds ??= await hashPassword('chesser.timing.dummy');
  await verifyPassword(password, dummyCreds.salt, dummyCreds.hash);
}

export function newToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function newUserId(): string {
  return crypto.randomBytes(8).toString('hex');
}

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,20}$/;

/** True when `password` exceeds the pre-hash byte cap. Checked before any scrypt call. */
export function passwordTooLong(password: string): boolean {
  return Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES;
}

/**
 * Registration-time credential rules. The minimum length applies to NEW
 * passwords only — login never re-validates length, so accounts created under
 * the old 6-char minimum keep working.
 */
export function validateCredentials(username: unknown, password: unknown): string | null {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return 'Username must be 3–20 characters (letters, numbers, _ or -).';
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (passwordTooLong(password)) {
    return 'Password is too long.';
  }
  return null;
}

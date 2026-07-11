import type { ExplorerDb, ExplorerResult } from '@chesser/shared';

async function jsonOrThrow(res: Response): Promise<any> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

export interface AuthResponse {
  token: string;
  username: string;
}

export function apiRegister(username: string, password: string): Promise<AuthResponse> {
  return fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  }).then(jsonOrThrow);
}

export function apiLogin(username: string, password: string): Promise<AuthResponse> {
  return fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  }).then(jsonOrThrow);
}

export function apiLogout(token: string): Promise<void> {
  return fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).then(() => undefined);
}

export function apiGetMe(token: string): Promise<{ username: string }> {
  return fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } }).then(jsonOrThrow);
}

export function apiGetProgress(token: string): Promise<{ data: unknown; updatedAt: number }> {
  return fetch('/api/progress', { headers: { Authorization: `Bearer ${token}` } }).then(jsonOrThrow);
}

export function apiPutProgress(token: string, data: unknown): Promise<{ updatedAt: number }> {
  return fetch('/api/progress', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data }),
  }).then(jsonOrThrow);
}

export interface SavedGame {
  id: string;
  pgn: string;
  white: string;
  black: string;
  result: string;
  savedAt: number;
  source?: string;
}

export function apiListGames(token: string): Promise<{ games: SavedGame[] }> {
  return fetch('/api/games', { headers: { Authorization: `Bearer ${token}` } }).then(jsonOrThrow);
}

export function apiSaveGame(token: string, g: Partial<SavedGame>): Promise<{ game: SavedGame }> {
  return fetch('/api/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(g),
  }).then(jsonOrThrow);
}

export function apiDeleteGame(token: string, id: string): Promise<void> {
  return fetch(`/api/games/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).then(() => undefined);
}

export interface ImportedGame {
  pgn: string;
  white: string;
  black: string;
  result: string;
  url?: string;
  date?: string;
}

export function apiImport(
  site: 'lichess' | 'chesscom',
  user: string,
  max = 15,
): Promise<{ available: boolean; reason?: string; games?: ImportedGame[] }> {
  return fetch(`/api/import?site=${site}&user=${encodeURIComponent(user)}&max=${max}`).then((r) => r.json());
}

const explorerCache = new Map<string, ExplorerResult>();
export async function apiExplorer(fen: string, db: ExplorerDb): Promise<ExplorerResult> {
  const key = `${db}:${fen}`;
  const hit = explorerCache.get(key);
  if (hit) return hit;
  try {
    const res = await fetch(`/api/explorer?fen=${encodeURIComponent(fen)}&db=${db}`);
    const data = (await res.json()) as ExplorerResult;
    explorerCache.set(key, data);
    return data;
  } catch {
    return { available: false, reason: 'fetch-failed' };
  }
}

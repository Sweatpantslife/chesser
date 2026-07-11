export interface ImportedGame {
  pgn: string;
  white: string;
  black: string;
  result: string;
  url?: string;
  date?: string;
}
export interface ImportResult {
  available: boolean;
  reason?: string;
  games?: ImportedGame[];
}

const TIMEOUT_MS = 9000;

async function getJson(url: string, accept = 'application/json'): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal, headers: { Accept: accept, 'User-Agent': 'chesser-trainer' } });
  } finally {
    clearTimeout(timer);
  }
}

async function importLichess(user: string, max: number): Promise<ImportResult> {
  const url = `https://lichess.org/api/games/user/${encodeURIComponent(user)}?max=${max}&pgnInJson=true&clocks=false&evals=false&opening=false`;
  const res = await getJson(url, 'application/x-ndjson');
  if (!res.ok) return { available: false, reason: `http-${res.status}` };
  const text = await res.text();
  const games: ImportedGame[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const g = JSON.parse(line);
      games.push({
        pgn: g.pgn ?? '',
        white: g.players?.white?.user?.name ?? (g.players?.white?.aiLevel ? `AI L${g.players.white.aiLevel}` : 'White'),
        black: g.players?.black?.user?.name ?? (g.players?.black?.aiLevel ? `AI L${g.players.black.aiLevel}` : 'Black'),
        result: g.winner === 'white' ? '1-0' : g.winner === 'black' ? '0-1' : '1/2-1/2',
        url: g.id ? `https://lichess.org/${g.id}` : undefined,
        date: g.createdAt ? new Date(g.createdAt).toISOString().slice(0, 10) : undefined,
      });
    } catch {
      /* skip malformed line */
    }
  }
  return { available: true, games: games.filter((g) => g.pgn) };
}

async function importChesscom(user: string, max: number): Promise<ImportResult> {
  const archRes = await getJson(`https://api.chess.com/pub/player/${encodeURIComponent(user.toLowerCase())}/games/archives`);
  if (!archRes.ok) return { available: false, reason: `http-${archRes.status}` };
  const { archives } = (await archRes.json()) as { archives?: string[] };
  const latest = archives?.[archives.length - 1];
  if (!latest) return { available: true, games: [] };
  const monthRes = await getJson(latest);
  if (!monthRes.ok) return { available: false, reason: `http-${monthRes.status}` };
  const { games } = (await monthRes.json()) as { games?: any[] };
  const mapped: ImportedGame[] = (games ?? [])
    .filter((g) => g.pgn)
    .slice(-max)
    .reverse()
    .map((g) => ({
      pgn: g.pgn as string,
      white: g.white?.username ?? 'White',
      black: g.black?.username ?? 'Black',
      result: g.white?.result === 'win' ? '1-0' : g.black?.result === 'win' ? '0-1' : '1/2-1/2',
      url: g.url,
      date: g.end_time ? new Date(g.end_time * 1000).toISOString().slice(0, 10) : undefined,
    }));
  return { available: true, games: mapped };
}

/** Fetch recent games for a username from Lichess or Chess.com. */
export async function importGames(site: 'lichess' | 'chesscom', user: string, max = 15): Promise<ImportResult> {
  const u = user.trim();
  if (!u) return { available: false, reason: 'no-user' };
  try {
    return site === 'lichess' ? await importLichess(u, max) : await importChesscom(u, max);
  } catch {
    return { available: false, reason: 'unreachable' };
  }
}

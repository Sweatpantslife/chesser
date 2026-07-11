import { test, expect, type Page } from '@playwright/test';
import { playMove } from './helpers';

/**
 * Opening explorer, exercised against a mocked /api/explorer (no live Lichess
 * calls in CI): the standalone Explorer page, drilling into a line, database
 * toggling with filters, the offline fallback, and the analysis-board panel.
 */

const START_BOARD = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
const E4_BOARD = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR';

const move = (uci: string, san: string, white: number, draws: number, black: number) => ({
  uci,
  san,
  white,
  draws,
  black,
  total: white + draws + black,
});

/** Mock the explorer proxy with a tiny two-position book. */
async function mockExplorer(page: Page): Promise<{ requests: string[] }> {
  const requests: string[] = [];
  await page.route('**/api/explorer*', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.search);
    const fen = url.searchParams.get('fen') ?? '';
    const board = fen.split(' ')[0];
    let body;
    if (board === START_BOARD) {
      body = {
        available: true,
        white: 1200,
        draws: 800,
        black: 600,
        total: 2600,
        moves: [move('e2e4', 'e4', 700, 400, 300), move('d2d4', 'd4', 500, 400, 300)],
        opening: null,
        topGames: [
          {
            id: 'testgame1',
            winner: 'white',
            white: { name: 'Carlsen, M.', rating: 2870 },
            black: { name: 'Caruana, F.', rating: 2820 },
            year: 2019,
            month: null,
            speed: null,
            uci: 'e2e4',
            san: null,
          },
        ],
        recentGames: [],
      };
    } else if (board === E4_BOARD) {
      body = {
        available: true,
        white: 500,
        draws: 300,
        black: 200,
        total: 1000,
        moves: [move('c7c5', 'c5', 250, 150, 100), move('e7e5', 'e5', 250, 150, 100)],
        opening: { eco: 'B00', name: "King's Pawn Game" },
        topGames: [],
        recentGames: [],
      };
    } else {
      body = { available: true, white: 0, draws: 0, black: 0, total: 0, moves: [], opening: null, topGames: [], recentGames: [] };
    }
    await route.fulfill({ json: body });
  });
  return { requests };
}

test.describe('opening explorer', () => {
  test('standalone page: continuations load, clicking a move drills deeper', async ({ page }) => {
    const { requests } = await mockExplorer(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Explorer' }).click();

    const panel = page.getByRole('region', { name: 'Opening explorer' });
    await expect(panel).toBeVisible();

    // Start position: both continuations with game counts, and a top game.
    const e4row = panel.getByRole('button', { name: /Play e4 — 1,400 games/ });
    await expect(e4row).toBeVisible();
    await expect(panel.getByRole('button', { name: /Play d4 — 1,200 games/ })).toBeVisible();
    await expect(panel.getByRole('link', { name: /Carlsen.*Caruana/ })).toBeVisible();

    // Drill into 1. e4 — the board advances, the line and opening name update.
    await e4row.click();
    await expect(page.getByRole('list', { name: 'Moves played' })).toContainText('e4');
    await expect(panel).toContainText("King's Pawn Game");
    await expect(panel).toContainText('B00');
    const c5row = panel.getByRole('button', { name: /Play c5 — 500 games/ });
    await expect(c5row).toBeVisible();

    // And one more ply (the deeper position has no games in the mock book).
    await c5row.click();
    await expect(page.getByRole('list', { name: 'Moves played' })).toContainText('c5');
    await expect(panel).toContainText('No games in this database from here.');

    // Stepping back replays from the (client-side) cache: still exactly one
    // fetch per unique position+db.
    await page.keyboard.press('ArrowLeft');
    await expect(panel.getByRole('button', { name: /Play c5 — 500 games/ })).toBeVisible();
    const starts = requests.filter((q) => q.includes(encodeURIComponent(START_BOARD))).length;
    expect(starts).toBe(1);
  });

  test('standalone page: moving a piece on the board also drills', async ({ page }) => {
    await mockExplorer(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Explorer' }).click();
    const panel = page.getByRole('region', { name: 'Opening explorer' });
    await expect(panel.getByRole('button', { name: /Play e4/ })).toBeVisible();

    await playMove(page, 'e2', 'e4');
    await expect(panel).toContainText("King's Pawn Game");
    await expect(panel.getByRole('button', { name: /Play c5/ })).toBeVisible();
  });

  test('lichess database exposes speed and rating filters that reach the API', async ({ page }) => {
    const { requests } = await mockExplorer(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Explorer' }).click();

    const panel = page.getByRole('region', { name: 'Opening explorer' });
    await panel.getByRole('button', { name: 'Lichess' }).click();
    await expect(panel.getByRole('group', { name: 'Time controls' })).toBeVisible();

    // Turn bullet on and restrict the rating pool; both must hit the query.
    await panel.getByRole('button', { name: 'Bullet' }).click();
    await panel.getByLabel('Minimum player rating').selectOption('2000');
    await expect
      .poll(() => requests.some((q) => q.includes('db=lichess') && q.includes('bullet') && q.includes('ratings=2000')))
      .toBe(true);

    // Masters never sends filters.
    await panel.getByRole('button', { name: 'Masters' }).click();
    expect(requests.filter((q) => q.includes('db=masters')).every((q) => !q.includes('speeds='))).toBe(true);
  });

  test('degrades gracefully offline: bundled opening name, no crash', async ({ page }) => {
    await page.route('**/api/explorer*', (route) => route.fulfill({ json: { available: false, reason: 'unreachable' } }));
    await page.goto('/');
    await page.getByRole('button', { name: 'Explorer' }).click();

    const panel = page.getByRole('region', { name: 'Opening explorer' });
    await expect(panel).toContainText('Live stats unavailable');

    // The opening is still named from the bundled ECO data after a move.
    await playMove(page, 'e2', 'e4');
    await expect(panel).toContainText("King's Pawn Game");
    await expect(panel).toContainText('B00');
  });

  test('analysis board: explorer panel drives the game store', async ({ page }) => {
    await mockExplorer(page);
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Play' }).click();

    const panel = page.getByRole('region', { name: 'Opening explorer' });
    await expect(panel).toBeVisible();
    const e4row = panel.getByRole('button', { name: /Play e4 — 1,400 games/ });
    await expect(e4row).toBeVisible();

    // Clicking a continuation plays it on the analysis board.
    await e4row.click();
    await expect(panel).toContainText("King's Pawn Game");
    await expect(panel.getByRole('button', { name: /Play c5 — 500 games/ })).toBeVisible();
  });
});

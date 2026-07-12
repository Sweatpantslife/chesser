import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

/**
 * Leaderboards + shareable profile, end to end against the built app:
 * a synced account joins the boards, sees itself ranked (rating from the
 * validated progress blob, rush best via the sprints adapter), flips on
 * profile sharing, copies the link — and a signed-out visitor opens it.
 */

const PASSWORD = 'hunter22';
const uniq = Math.random().toString(36).slice(2, 8);
const USER = `elo-hero-${uniq}`;

/**
 * POST /api/auth/register, waiting out the per-IP registration token bucket
 * (capacity 10, +5/min — accounts/guard.ts): a full-suite run registers more
 * accounts than one bucket holds, so a raw post can 429 late in the run.
 */
async function apiRegister(request: APIRequestContext, username: string) {
  for (let attempt = 0; ; attempt++) {
    const res = await request.post('/api/auth/register', { data: { username, password: PASSWORD } });
    if (res.status() !== 429 || attempt >= 6) return res;
    await new Promise((r) => setTimeout(r, 13_000));
  }
}


const today = new Date().toISOString().slice(0, 10);

/** A progress blob the server-side anti-cheat accepts (puzzles 1300, bots 1480). */
const progressBlob = {
  ratings: {
    legacyMigrated: true,
    categories: {
      bots: {
        elo: 1480,
        eloPeak: 1520,
        glicko: { rating: 1490, rd: 180, vol: 0.06 },
        glickoPeak: 1500,
        played: 8,
        won: 5,
        lost: 3,
        drawn: 0,
        winStreak: 2,
        bestWinStreak: 3,
        history: { [today]: { elo: 1480, glicko: 1490 } },
      },
      blitz: {
        elo: 1500,
        eloPeak: 1500,
        glicko: { rating: 1500, rd: 350, vol: 0.06 },
        glickoPeak: 1500,
        played: 0,
        won: 0,
        lost: 0,
        drawn: 0,
        winStreak: 0,
        bestWinStreak: 0,
        history: {},
      },
      puzzles: {
        elo: 1300,
        eloPeak: 1300,
        glicko: { rating: 1320, rd: 200, vol: 0.06 },
        glickoPeak: 1300,
        played: 15,
        won: 10,
        lost: 5,
        drawn: 0,
        winStreak: 2,
        bestWinStreak: 3,
        history: { [today]: { elo: 1300, glicko: 1320 } },
      },
    },
  },
  gamify: { xp: 100, days: { [today]: { xp: 100, activities: 10 } }, goalXp: 40, streak: 1, bestStreak: 1, lastGoalDay: today, goalsMet: 1 },
  streak: { count: 1, best: 1, lastDay: today, freezes: 0, milestonesAwarded: [] },
};

/** Sign the page's app session in by seeding the persisted auth store. */
async function seedLocalStorage(page: Page, token: string): Promise<void> {
  await page.addInitScript(
    ({ token, user, now }: { token: string; user: string; now: number }) => {
      localStorage.setItem('chesser-auth', JSON.stringify({ state: { token, username: user }, version: 0 }));
      // Seeded storage marks this browser as an "existing user", which would
      // pop the one-time "what moved" IA note over the UI — pre-dismiss it.
      localStorage.setItem('chesser-ia-tour', 'dismissed');
      // Puzzle Rush bests in the sprints store's persisted shape (PR #30 seam):
      // the leaderboard adapter must pick the best rush mode (19), not storm.
      localStorage.setItem(
        'chesser-sprints',
        JSON.stringify({
          state: {
            puzzleRushBest: {
              timed3: { score: 14, bestStreak: 6, at: now },
              survival: { score: 19, bestStreak: 7, at: now },
            },
            puzzleStormBest: { score: 33, bestStreak: 11, at: now },
          },
          version: 0,
        }),
      );
    },
    { token, user: USER, now: Date.now() },
  );
}

test.describe('leaderboards + shareable profile', () => {
  test('join, get ranked, share the profile, open it signed-out', async ({ page, context, request, browser }) => {
    // -- setup: a registered account with server-validated progress ---------
    const reg = await apiRegister(request, USER);
    expect(reg.ok()).toBeTruthy();
    const { token } = (await reg.json()) as { token: string };
    const put = await request.put('/api/progress', {
      headers: { Authorization: `Bearer ${token}` },
      data: { data: progressBlob },
    });
    expect(put.ok()).toBeTruthy();

    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await seedLocalStorage(page, token);

    // Wait for the boot sync (pull + push) so the client stores are populated.
    const firstPush = page.waitForResponse((r) => r.url().includes('/api/progress') && r.request().method() === 'PUT' && r.ok());
    await page.goto('/');
    await firstPush;

    // -- leaderboards: opt in, submit, see the ranking -----------------------
    await page.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: 'Profile' }).click();
    await page.getByRole('link', { name: 'Leaderboards' }).click();
    await expect(page.getByRole('heading', { name: 'Leaderboards', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Join & share my scores' }).click();

    // Puzzle-rating board: our synced 1300 is ranked, marked as "You".
    const myRow = page.getByRole('row').filter({ hasText: USER });
    await expect(myRow).toContainText('1300');
    await expect(myRow).toContainText('You');

    // Rush board: the sprints-store best (19, survival mode) is ranked.
    await page.getByRole('navigation', { name: 'Leaderboard' }).getByRole('button', { name: 'Rush' }).click();
    await expect(page.getByRole('row').filter({ hasText: USER })).toContainText('19');

    // Weekly scope stays populated (same deterministic ISO week).
    await page.getByRole('button', { name: 'This week' }).click();
    await expect(page.getByRole('row').filter({ hasText: USER })).toContainText('19');
    await expect(page.getByText(/· Week \d+, \d{4}/)).toBeVisible();

    await page.screenshot({ path: process.env.E2E_SHOT_DIR ? `${process.env.E2E_SHOT_DIR}/leaderboard.png` : 'test-results/leaderboard.png', fullPage: true });

    // Bots board too (rating from the validated blob).
    await page.getByRole('button', { name: 'All-time' }).click();
    await page.getByRole('navigation', { name: 'Leaderboard' }).getByRole('button', { name: 'Bots' }).click();
    await expect(page.getByRole('row').filter({ hasText: USER })).toContainText('1480');

    // -- share affordance on the own profile ---------------------------------
    await page.getByRole('link', { name: 'Overview' }).click();
    await expect(page.getByRole('heading', { name: 'Share your profile' })).toBeVisible();

    await page.getByRole('checkbox', { name: /Public profile page/ }).check();
    await page.getByRole('checkbox', { name: /^Ratings/ }).check();
    await page.getByRole('checkbox', { name: /Your top run/ }).check(); // Puzzle Rush best
    await page.getByRole('checkbox', { name: /Current \+ best day streak/ }).check(); // Streak
    await page.getByRole('checkbox', { name: /Wins, draws, losses/ }).check(); // W/D/L record

    // Copy the share link and verify the clipboard got the canonical URL.
    await page.getByRole('button', { name: 'Copy link' }).click();
    await expect(page.getByRole('button', { name: 'Copied!' })).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain(`#/profile/${USER}`);

    // Preview renders the public view in-app.
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByRole('heading', { name: USER })).toBeVisible();
    await expect(page.getByText('peak 1300 · 15 played')).toBeVisible();

    // -- a signed-out visitor opens the shared link --------------------------
    const visitorCtx = await browser.newContext();
    const visitor = await visitorCtx.newPage();
    await visitor.goto(copied);
    await expect(visitor.getByRole('heading', { name: USER })).toBeVisible();
    await expect(visitor.getByText('Chesser player since')).toBeVisible();
    await expect(visitor.getByText('1300', { exact: true })).toBeVisible(); // shared puzzle rating
    await expect(visitor.getByText('19', { exact: true })).toBeVisible(); // shared rush best
    await expect(visitor.getByText(/only opted-in stats are shown/i)).toBeVisible();
    await visitor.screenshot({
      path: process.env.E2E_SHOT_DIR ? `${process.env.E2E_SHOT_DIR}/public-profile.png` : 'test-results/public-profile.png',
      fullPage: true,
    });

    // REGRESSION: activating the accessibility skip link (the first tab
    // stop) on a shared profile must move focus to the content — it must
    // never route away from the profile (hash routing owns location.hash).
    await visitor.keyboard.press('Tab');
    await visitor.keyboard.press('Enter');
    await expect(visitor.getByRole('heading', { name: USER })).toBeVisible();
    await visitorCtx.close();
  });

  test('a profile that was never shared stays private', async ({ page, request }) => {
    const name = `private-${uniq}`;
    const reg = await apiRegister(request, name);
    expect(reg.ok()).toBeTruthy();
    await page.goto(`/#/profile/${name}`);
    await expect(page.getByRole('heading', { name: /private or doesn't exist/ })).toBeVisible();
  });
});

import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { playMove } from './helpers';

/**
 * Friends & challenges, end to end with two real browser contexts:
 * Ann and Ben register, become friends via Ann's friend code, Ann challenges
 * Ben (5+0 as White), Ben accepts — and both land in a live friend-link game
 * relayed over the WebSocket.
 *
 * The friends panel polls every 8s, so cross-user assertions use a 20s window.
 */

const PASSWORD = 'hunter22';
const uniq = Math.random().toString(36).slice(2, 8);
const ANN = `ann-${uniq}`;
const BEN = `ben-${uniq}`;
const SYNC = { timeout: 20_000 };

async function registerUser(request: APIRequestContext, username: string): Promise<string> {
  // Waits out the per-IP registration token bucket (accounts/guard.ts):
  // a full-suite run registers more accounts than one bucket holds.
  let res = await request.post('/api/auth/register', { data: { username, password: PASSWORD } });
  for (let attempt = 0; res.status() === 429 && attempt < 6; attempt++) {
    await new Promise((r) => setTimeout(r, 13_000));
    res = await request.post('/api/auth/register', { data: { username, password: PASSWORD } });
  }
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { token: string }).token;
}

/** Sign the page's app session in by seeding the persisted auth store. */
async function seedAuth(page: Page, token: string, user: string): Promise<void> {
  await page.addInitScript(
    ({ token, user }: { token: string; user: string }) => {
      localStorage.setItem('chesser-auth', JSON.stringify({ state: { token, username: user }, version: 0 }));
      // Seeded storage marks this browser as an "existing user", which would
      // pop the one-time "what moved" tour over the UI — pre-dismiss it.
      localStorage.setItem('chesser-ia-tour-v2', 'dismissed');
    },
    { token, user },
  );
}

test.describe('friends & challenges', () => {
  test('add a friend by code, challenge, accept — a live game starts', async ({ browser, request }) => {
    const annToken = await registerUser(request, ANN);
    const benToken = await registerUser(request, BEN);

    const annCtx = await browser.newContext();
    const benCtx = await browser.newContext();
    const ann = await annCtx.newPage();
    const ben = await benCtx.newPage();
    await seedAuth(ann, annToken, ANN);
    await seedAuth(ben, benToken, BEN);

    // --- both open the Friends tab -----------------------------------------
    await ann.goto('/#/play/friends');
    await expect(ann.getByTestId('friends-empty')).toBeVisible();
    const code = (await ann.getByTestId('friend-code').textContent())!.trim();
    expect(code).toMatch(/^[A-Z2-9]{8}$/);

    await ben.goto('/#/play/friends');

    // --- Ben adds Ann via her friend code (no public profile needed) --------
    await ben.getByTestId('add-friend-input').fill(code);
    await ben.getByTestId('add-friend-submit').click();
    await expect(ben.getByTestId('add-friend-notice')).toHaveText(`Request sent to ${ANN}.`);
    await expect(ben.getByTestId('outgoing-requests')).toContainText(ANN);

    // --- Ann sees the request on her next poll and accepts ------------------
    await expect(ann.getByTestId('incoming-requests')).toContainText(BEN, SYNC);
    await ann.getByRole('button', { name: `Accept friend request from ${BEN}` }).click();
    await expect(ann.getByTestId('friends-list')).toContainText(BEN);
    await expect(ben.getByTestId('friends-list')).toContainText(ANN, SYNC);

    // --- Ann challenges Ben: 5+0, Ann plays White ----------------------------
    await ann.getByRole('button', { name: `Challenge ${BEN} to a game` }).click();
    // Scoped to the challenge form — the pass&play/friend-link cards have
    // their own 5+0 buttons.
    await ann.getByTestId('challenge-form').getByRole('button', { name: '5+0' }).click();
    await ann.getByTestId('challenge-color-white').click();
    await ann.getByTestId('send-challenge').click();
    await expect(ann.getByTestId('outgoing-challenges')).toContainText(`waiting for ${BEN}`);

    // --- Ben sees the pending challenge and accepts --------------------------
    await expect(ben.getByTestId('incoming-challenges')).toContainText(`${ANN} challenges you — 5+0, you play Black`, SYNC);
    await ben.getByRole('button', { name: `Accept challenge from ${ANN}` }).click();

    // Ben lands in a live friend-link game, seated as Black, waiting for Ann…
    await expect(ben.getByTestId('online-status')).toHaveText(/Waiting for your friend|White to move/, SYNC);
    // …and Ann's next poll auto-joins her into the same game as White.
    await expect(ann.getByTestId('online-status')).toHaveText(/White to move/, SYNC);
    await expect(ben.getByTestId('online-status')).toHaveText(/White to move/, SYNC);
    await expect(ann.getByTestId('player-white')).toContainText(`${ANN} (you)`);
    await expect(ann.getByTestId('player-black')).toContainText(BEN);
    await expect(ben.getByTestId('player-black')).toContainText(`${BEN} (you)`);

    // The chosen time control is live (5:00 clocks on both sides).
    await expect(ann.getByText('5:00').first()).toBeVisible();

    // --- live relay across the two browsers ---------------------------------
    await playMove(ann, 'e2', 'e4', 'white');
    await expect(ben.getByTestId('human-movelist')).toContainText('e4');
    await expect(ben.getByTestId('online-status')).toHaveText(/Black to move/);
    await playMove(ben, 'e7', 'e5', 'black');
    await expect(ann.getByTestId('human-movelist')).toContainText('e5');
    await expect(ann.getByTestId('online-status')).toHaveText(/White to move/);

    await ann.screenshot({
      path: process.env.E2E_SHOT_DIR ? `${process.env.E2E_SHOT_DIR}/friends-challenge-game.png` : 'test-results/friends-challenge-game.png',
      fullPage: true,
    });

    await annCtx.close();
    await benCtx.close();
  });

  test('declining a challenge tells the challenger; friends panel works signed out too', async ({ browser, request }) => {
    const carl = `carl-${uniq}`;
    const dana = `dana-${uniq}`;
    const carlToken = await registerUser(request, carl);
    const danaToken = await registerUser(request, dana);

    const carlCtx = await browser.newContext();
    const danaCtx = await browser.newContext();
    const carlPage = await carlCtx.newPage();
    const danaPage = await danaCtx.newPage();
    await seedAuth(carlPage, carlToken, carl);
    await seedAuth(danaPage, danaToken, dana);

    // Friend up via code.
    await carlPage.goto('/#/play/friends');
    const code = (await carlPage.getByTestId('friend-code').textContent())!.trim();
    await danaPage.goto('/#/play/friends');
    await danaPage.getByTestId('add-friend-input').fill(code);
    await danaPage.getByTestId('add-friend-submit').click();
    await expect(carlPage.getByTestId('incoming-requests')).toContainText(dana, SYNC);
    await carlPage.getByRole('button', { name: `Accept friend request from ${dana}` }).click();

    // Carl challenges (unlimited time, random colors) — Dana declines.
    await carlPage.getByRole('button', { name: `Challenge ${dana} to a game` }).click();
    await carlPage.getByTestId('send-challenge').click();
    await expect(danaPage.getByTestId('incoming-challenges')).toContainText(`${carl} challenges you`, SYNC);
    await danaPage.getByRole('button', { name: `Decline challenge from ${carl}` }).click();
    await expect(danaPage.getByTestId('incoming-challenges')).toHaveCount(0);
    await expect(carlPage.getByTestId('outgoing-challenges')).toContainText(`${dana} declined your challenge`, SYNC);
    // Carl dismisses the record.
    await carlPage.getByRole('button', { name: `Dismiss challenge to ${dana}` }).click();
    await expect(carlPage.getByTestId('challenges-empty')).toBeVisible();

    // A signed-out visitor sees the sign-in nudge, not a broken panel.
    const anonCtx = await browser.newContext();
    const anon = await anonCtx.newPage();
    await anon.goto('/#/play/friends');
    await expect(anon.getByTestId('friends-signin-cta')).toBeVisible();

    await anonCtx.close();
    await carlCtx.close();
    await danaCtx.close();
  });
});

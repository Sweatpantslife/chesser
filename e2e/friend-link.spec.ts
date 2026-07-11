import { test, expect } from '@playwright/test';
import { playMove } from './helpers';

test.describe('friend-link online game', () => {
  test('create → share link → play live, survive a mid-game refresh, finish', async ({ browser }) => {
    // Two completely separate browser contexts: the host (Ann) and the guest (Ben).
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();

    // Ann creates a game as White.
    await host.goto('/');
    await host.getByRole('button', { name: 'Friends' }).click();
    await host.getByTestId('online-name').fill('Ann');
    await host.getByTestId('color-white').click();
    await host.getByTestId('create-online').click();

    await expect(host.getByTestId('online-status')).toHaveText(/Waiting for your friend/);
    const link = (await host.getByTestId('invite-link').textContent())!.trim();
    expect(link).toMatch(/#\/friend\/[A-Z2-9]{6}$/);

    // Ben opens the shared link and lands straight in the game as Black.
    await guest.goto(link);
    await expect(guest.getByTestId('online-status')).toHaveText(/White to move/);
    await expect(host.getByTestId('online-status')).toHaveText(/White to move/);
    await expect(host.getByTestId('player-black')).toContainText('Black'); // guest joined without a name

    // Live relay: moves made in one browser appear in the other.
    await playMove(host, 'f2', 'f3', 'white');
    await expect(guest.getByTestId('human-movelist')).toContainText('f3');
    await expect(guest.getByTestId('online-status')).toHaveText(/Black to move/);

    await playMove(guest, 'e7', 'e5', 'black');
    await expect(host.getByTestId('human-movelist')).toContainText('e5');
    await expect(host.getByTestId('online-status')).toHaveText(/White to move/);

    await playMove(host, 'g2', 'g4', 'white');
    await expect(guest.getByTestId('human-movelist')).toContainText('g4');

    // Disconnection mid-game: Ben's page reloads; the seat token in
    // localStorage rejoins the same seat and the game resumes.
    await guest.reload();
    await expect(guest.getByTestId('online-status')).toHaveText(/Black to move/);
    await expect(guest.getByTestId('human-movelist')).toContainText('g4');

    // …and Ben finishes the game after rejoining.
    await playMove(guest, 'd8', 'h4', 'black');
    await expect(guest.getByTestId('online-status')).toHaveText(/Black wins — checkmate/);
    await expect(host.getByTestId('online-status')).toHaveText(/Black wins — checkmate/);
    await expect(host.getByTestId('online-outcome')).toHaveText(/You lost/);
    await expect(guest.getByTestId('online-outcome')).toHaveText(/You won/);

    await hostCtx.close();
    await guestCtx.close();
  });

  test('server rejects playing out of turn (the board simply refuses)', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();

    await host.goto('/');
    await host.getByRole('button', { name: 'Friends' }).click();
    await host.getByTestId('color-white').click();
    await host.getByTestId('create-online').click();
    const link = (await host.getByTestId('invite-link').textContent())!.trim();
    await guest.goto(link);
    await expect(guest.getByTestId('online-status')).toHaveText(/White to move/);
    await expect(host.getByTestId('invite-box')).toHaveCount(0);

    // It's White's turn — Black's pieces are not movable for the guest.
    await playMove(guest, 'e7', 'e5', 'black');
    await expect(guest.getByTestId('human-movelist')).toContainText('No moves yet');

    // White moves; now the guest can reply.
    await playMove(host, 'e2', 'e4', 'white');
    await expect(guest.getByTestId('online-status')).toHaveText(/Black to move/);
    await playMove(guest, 'e7', 'e5', 'black');
    await expect(host.getByTestId('human-movelist')).toContainText('e5');

    await hostCtx.close();
    await guestCtx.close();
  });

  test('draw offer and resignation flow between two browsers', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();

    await host.goto('/');
    await host.getByRole('button', { name: 'Friends' }).click();
    await host.getByTestId('color-white').click();
    await host.getByTestId('create-online').click();
    const link = (await host.getByTestId('invite-link').textContent())!.trim();
    await guest.goto(link);
    // Wait for the host's board to settle in the active-game layout.
    await expect(host.getByTestId('online-status')).toHaveText(/White to move/);
    await expect(host.getByTestId('invite-box')).toHaveCount(0);

    await playMove(host, 'e2', 'e4', 'white');
    await expect(guest.getByTestId('online-status')).toHaveText(/Black to move/);
    await playMove(guest, 'e7', 'e5', 'black');
    await expect(host.getByTestId('online-status')).toHaveText(/White to move/);

    // Host offers a draw; the guest declines; the game continues.
    await host.getByTestId('offer-draw').click();
    await expect(guest.getByTestId('draw-prompt')).toBeVisible();
    await guest.getByRole('button', { name: 'Decline' }).click();
    await expect(guest.getByTestId('draw-prompt')).toHaveCount(0);
    await expect(host.getByTestId('online-status')).toHaveText(/White to move/);

    // Host resigns; both sides see Black win by resignation.
    await host.getByTestId('resign').click();
    await host.getByTestId('confirm-resign').click();
    await expect(host.getByTestId('online-status')).toHaveText(/Black wins — resignation/);
    await expect(guest.getByTestId('online-status')).toHaveText(/Black wins — resignation/);

    await hostCtx.close();
    await guestCtx.close();
  });
});

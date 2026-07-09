import { test, expect } from '@playwright/test';
import { playMove } from './helpers';

test.describe('pass and play', () => {
  test('two players share one board through to checkmate, then rematch', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Friends' }).click();

    // Configure and start a local game (untimed, no auto-flip).
    await expect(page.getByTestId('card-local')).toBeVisible();
    await page.getByTestId('start-local').click();

    const status = page.getByTestId('human-status');
    await expect(status).toHaveText(/White to move/);

    // Fool's mate — both sides played on the same device.
    await playMove(page, 'f2', 'f3');
    await expect(status).toHaveText(/Black to move/);
    await playMove(page, 'e7', 'e5');
    await expect(status).toHaveText(/White to move/);
    await playMove(page, 'g2', 'g4');
    await expect(status).toHaveText(/Black to move/);
    await playMove(page, 'd8', 'h4');

    await expect(status).toHaveText(/Black wins — checkmate/);
    await expect(page.getByTestId('result-banner')).toContainText('Black wins');
    await expect(page.getByTestId('human-movelist')).toContainText('Qh4#');

    // Rematch resets the board and the game state.
    await page.getByTestId('rematch').click();
    await expect(status).toHaveText(/White to move/);
    await expect(page.getByTestId('result-banner')).toHaveCount(0);
  });

  test('auto-flip turns the board toward the player to move', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Friends' }).click();
    await page.getByLabel(/Auto-flip/).check();
    await page.getByTestId('start-local').click();

    const wrap = page.locator('.cg-wrap');
    await expect(wrap).toHaveClass(/orientation-white/);
    await playMove(page, 'e2', 'e4', 'white');
    await expect(wrap).toHaveClass(/orientation-black/); // black now faces the device
    await playMove(page, 'e7', 'e5', 'black');
    await expect(wrap).toHaveClass(/orientation-white/);
  });

  test('resignation ends the game for the side to move', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Friends' }).click();
    await page.getByTestId('start-local').click();

    await playMove(page, 'e2', 'e4');
    // Black is on move and resigns (with confirmation).
    await page.getByTestId('resign').click();
    await page.getByTestId('confirm-resign').click();
    await expect(page.getByTestId('human-status')).toHaveText(/White wins/);
    await expect(page.getByTestId('result-banner')).toContainText('resigned');
  });
});

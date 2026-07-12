import { test, expect } from '@playwright/test';

/**
 * The one-time "what moved" tour (app/WhatMovedTour.tsx):
 *  - brand-new browsers are marked (`chesser-ia-tour-v2` = 'new-user') and
 *    never see it;
 *  - browsers carrying pre-IA local state see the 4-step tour exactly once —
 *    "Got it" (or Escape) persists the flag and it never reappears;
 *  - users who dismissed the Phase-1 interim note (legacy `chesser-ia-tour`
 *    = 'dismissed') still get the finished tour once.
 */

test.describe('one-time "what moved" tour', () => {
  test('a brand-new browser never sees the tour and is marked as new', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Main' }).first()).toBeVisible();
    await expect(page.getByTestId('ia-tour')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('chesser-ia-tour-v2'))).toBe('new-user');
    // The session writes its own state as it runs — still no tour on reload.
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Main' }).first()).toBeVisible();
    await expect(page.getByTestId('ia-tour')).toHaveCount(0);
  });

  test('an existing pre-IA browser sees the stepped tour once; "Got it" persists', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    // Pre-IA evidence: any persisted chesser store marks an existing user.
    await page.addInitScript(() => {
      localStorage.setItem('chesser-settings', JSON.stringify({ state: { theme: 'dark' }, version: 0 }));
    });
    await page.goto('/');

    const dialog = page.getByRole('dialog', { name: 'Things moved around' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Step 1 of 4')).toBeVisible();

    await dialog.getByRole('button', { name: 'Next' }).click();
    await expect(dialog.getByText('Step 2 of 4')).toBeVisible();
    await dialog.getByRole('button', { name: 'Next' }).click();
    // The surprising move is called out explicitly.
    await expect(dialog.getByText(/Archive → Profile/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Next' }).click();
    await expect(dialog.getByText('Step 4 of 4')).toBeVisible();
    await dialog.getByRole('button', { name: 'Got it' }).click();

    await expect(page.getByTestId('ia-tour')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('chesser-ia-tour-v2'))).toBe('dismissed');

    // Never again.
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Main' }).first()).toBeVisible();
    await expect(page.getByTestId('ia-tour')).toHaveCount(0);
    await ctx.close();
  });

  test('phase-1 dismissers still get the finished tour once; Escape dismisses for good', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('chesser-ia-tour', 'dismissed'); // dismissed the Phase-1 note
      localStorage.setItem('chesser-settings', JSON.stringify({ state: { theme: 'light' }, version: 0 }));
    });
    await page.goto('/');

    await expect(page.getByTestId('ia-tour')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('ia-tour')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('chesser-ia-tour-v2'))).toBe('dismissed');

    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Main' }).first()).toBeVisible();
    await expect(page.getByTestId('ia-tour')).toHaveCount(0);
    await ctx.close();
  });
});

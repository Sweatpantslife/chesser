import { test, expect, type Page } from '@playwright/test';

/**
 * Trust & privacy layer, end to end against the built app: the policy pages,
 * the first-run storage notice, data export, the delete-account flow (server
 * AND local state actually gone), display-name moderation surfacing in the
 * sign-up form, and the abuse-report affordance on public profiles.
 */

const PASSWORD = 'hunter22';
const uniq = Math.random().toString(36).slice(2, 8);

/** Dismissing the notice up front keeps it out of unrelated assertions. */
async function dismissNotice(page: Page): Promise<void> {
  const got = page.getByRole('button', { name: 'Got it' });
  if (await got.isVisible().catch(() => false)) await got.click();
}

async function registerViaUi(page: Page, username: string): Promise<void> {
  await page.getByRole('button', { name: 'Sign in' }).first().click();
  await page.getByRole('button', { name: 'Create account' }).first().click();
  await page.getByPlaceholder('username').fill(username);
  await page.getByPlaceholder('password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).last().click();
}

test.describe('policy pages', () => {
  test('privacy policy and terms render and cross-link', async ({ page }) => {
    await page.goto('/#/privacy');
    await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
    // Load-bearing claims stay on the page.
    await expect(page.getByText('never sell', { exact: false })).toBeVisible();
    await expect(page.getByText('bring-your-own-key', { exact: false })).toBeVisible();

    await page.getByRole('link', { name: 'Terms of Service' }).last().click();
    await expect(page.getByRole('heading', { name: 'Terms of Service' })).toBeVisible();
    await expect(page.getByText('Fair play')).toBeVisible();
  });

  test('the footer links to both pages from any view', async ({ page }) => {
    await page.goto('/');
    await dismissNotice(page);
    await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy' }).click();
    await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
    await page.getByRole('contentinfo').getByRole('link', { name: 'Terms' }).click();
    await expect(page.getByRole('heading', { name: 'Terms of Service' })).toBeVisible();
  });
});

test.describe('first-run storage notice', () => {
  test('shows once, links the policy, and stays dismissed after reload', async ({ page }) => {
    await page.goto('/');
    const notice = page.getByRole('region', { name: 'Data storage notice' });
    await expect(notice).toBeVisible();
    await expect(notice.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '#/privacy');

    await notice.getByRole('button', { name: 'Got it' }).click();
    await expect(notice).toBeHidden();

    await page.reload();
    // The Today page is up and the notice is not.
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Data storage notice' })).toHaveCount(0);
  });
});

test.describe('display-name moderation', () => {
  test('a staff-style name is rejected by the server and surfaces in the form', async ({ page }) => {
    await page.goto('/');
    await dismissNotice(page);
    await registerViaUi(page, 'chesser-admin');
    await expect(page.getByRole('alert')).toContainText(/reserved/i);
  });

  test('a profane name is rejected; a clean one registers fine', async ({ page }) => {
    await page.goto('/');
    await dismissNotice(page);
    await registerViaUi(page, 'sh1thead');
    await expect(page.getByRole('alert')).toContainText(/not allowed/i);

    await page.getByPlaceholder('username').fill(`clean-knight-${uniq}`);
    await page.getByRole('button', { name: 'Create account' }).last().click();
    await expect(page.getByRole('button', { name: `clean-knight-${uniq}` })).toBeVisible();
  });
});

test.describe('data export', () => {
  test('downloads a JSON export of the account', async ({ page }) => {
    const user = `export-hero-${uniq}`;
    await page.goto('/');
    await dismissNotice(page);
    await registerViaUi(page, user);
    await expect(page.getByRole('button', { name: user })).toBeVisible();

    await page.getByRole('button', { name: user }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export my data' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`chesser-export-${user}.json`);

    const path = await download.path();
    const fs = await import('node:fs');
    const body = JSON.parse(fs.readFileSync(path!, 'utf8')) as {
      app: string;
      account: { username: string };
      social: { sharePrefs: { profile: boolean } };
    };
    expect(body.app).toBe('chesser');
    expect(body.account.username).toBe(user);
    expect(body.social.sharePrefs.profile).toBe(false); // private by default
  });
});

test.describe('delete account', () => {
  test('typed confirmation erases the server account and clears local state', async ({ page }) => {
    const user = `delete-hero-${uniq}`;
    await page.goto('/');
    await dismissNotice(page);
    await registerViaUi(page, user);
    await expect(page.getByRole('button', { name: user })).toBeVisible();

    await page.getByRole('button', { name: user }).click();
    await page.getByRole('button', { name: 'Delete my account…' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('heading', { name: 'Delete this account?' })).toBeVisible();

    // The destructive button stays disabled until the exact word is typed.
    const deleteBtn = dialog.getByRole('button', { name: 'Delete forever' });
    await expect(deleteBtn).toBeDisabled();
    await dialog.getByLabel('Type DELETE to confirm').fill('delete');
    await expect(deleteBtn).toBeDisabled();
    await dialog.getByLabel('Type DELETE to confirm').fill('DELETE');
    await deleteBtn.click();

    // The app reloads signed out, with local state wiped (notice is back).
    await expect(page.getByRole('button', { name: 'Sign in' }).first()).toBeVisible();
    await expect(page.getByRole('region', { name: 'Data storage notice' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('chesser-auth'))).toBeNull();

    // Server side: the credentials are gone for good.
    const res = await page.request.post('/api/auth/login', { data: { username: user, password: PASSWORD } });
    expect(res.status()).toBe(401);
  });
});

test.describe('abuse reports', () => {
  test('a signed-in visitor can report a public profile; repeats dedupe', async ({ page, request }) => {
    // Target: an account with a public profile, set up via the API.
    const target = `report-target-${uniq}`;
    const reg = await request.post('/api/auth/register', { data: { username: target, password: PASSWORD } });
    expect(reg.ok()).toBeTruthy();
    const { token } = (await reg.json()) as { token: string };
    const prefs = await request.put('/api/social/prefs', {
      headers: { Authorization: `Bearer ${token}` },
      data: { prefs: { profile: true } },
    });
    expect(prefs.ok()).toBeTruthy();

    // Reporter: registers in the browser, then opens the target's profile.
    const reporter = `reporter-${uniq}`;
    await page.goto('/');
    await dismissNotice(page);
    await registerViaUi(page, reporter);
    await expect(page.getByRole('button', { name: reporter })).toBeVisible();

    await page.goto(`/#/profile/${target}`);
    await expect(page.getByRole('heading', { name: target })).toBeVisible();
    await page.getByRole('button', { name: 'Report this profile' }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: 'Impersonation' }).check();
    await dialog.getByLabel('Details (optional)').fill('Pretends to be someone else.');
    await dialog.getByRole('button', { name: 'Send report' }).click();
    await expect(dialog.getByText('your report was recorded')).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();

    // Reporting the same profile again is an idempotent no-op, not an error.
    await page.getByRole('button', { name: 'Report this profile' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Send report' }).click();
    await expect(page.getByRole('dialog').getByText('your report was recorded')).toBeVisible();
  });

  test('signed-out visitors are asked to sign in instead of a form', async ({ page, request }) => {
    const target = `report-anon-${uniq}`;
    const reg = await request.post('/api/auth/register', { data: { username: target, password: PASSWORD } });
    const { token } = (await reg.json()) as { token: string };
    await request.put('/api/social/prefs', {
      headers: { Authorization: `Bearer ${token}` },
      data: { prefs: { profile: true } },
    });

    await page.goto(`/#/profile/${target}`);
    await dismissNotice(page);
    await page.getByRole('button', { name: 'Report this profile' }).click();
    await expect(page.getByRole('dialog').getByText('reports need an account')).toBeVisible();
  });
});

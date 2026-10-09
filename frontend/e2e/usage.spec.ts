import { expect, test, type Page } from '@playwright/test';

// Cycle 5 P2.6: Settings -> Usage against a stubbed BFF (spec 10A.4, A41, A47).
// No backend: every `/api/client/*` read the connected app makes is fulfilled here.

const DAY_RESET = '2026-10-06T00:00:00+00:00';
const MONTH_RESET = '2026-11-01T00:00:00+00:00';

const KE = {
  engine: 'ke',
  uploads: { month: '2026-10', base: 20, extra: 10, used: 18, remaining: 12, unlimited: false, resets_at: MONTH_RESET },
  writing: {
    today: { used_fraction: 1, available: false, resets_at: DAY_RESET },
    month: { used_fraction: 0.85, available: true, resets_at: MONTH_RESET },
  },
  documents: { today: { used_fraction: 0.05, available: true, resets_at: DAY_RESET } },
};

const UNAVAILABLE = {
  ...KE,
  uploads: { ...KE.uploads, base: null, extra: null, remaining: null, unlimited: false },
  writing: {
    today: { used_fraction: null, available: false, resets_at: DAY_RESET },
    month: { used_fraction: null, available: false, resets_at: MONTH_RESET },
  },
  documents: { today: { used_fraction: null, available: false, resets_at: DAY_RESET } },
};

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function connectedPage(page: Page, baseURL: string, usage: { status: number; body: unknown }, engine: 'ke' | 'm1' = 'ke') {
  await page.context().addCookies([{ name: 'aa_client_token', value: 'synthetic-local-token', url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
  // Registered first, so the specific stubs below take precedence over it.
  await page.route('**/api/client/**', route => route.fulfill(json({ error: 'Not stubbed.' }, 404)));
  await page.route('**/api/client/content-items', route => route.fulfill(json({ items: [] })));
  await page.route('**/api/client/calendar', route => route.fulfill(json({ slots: [] })));
  await page.route('**/api/client/social/**', route => route.fulfill(json([])));
  await page.route('**/api/client/profile', route => route.fulfill(json({ identity: { display_name: 'Amina Yusuf', profession: 'Documentary producer', client_name: 'ISTV', timezone: 'Europe/London' }, document_count: 4 })));
  await page.route('**/api/client/engine', route => route.fulfill(json({ knowledge_engine: engine })));
  let reads = 0;
  await page.route('**/api/client/usage', route => { reads += 1; return route.fulfill(json(usage.body, usage.status)); });
  return { reads: () => reads };
}

async function openUsage(page: Page, phone: boolean) {
  await page.goto('/refined/home');
  if (phone) await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Settings' }).click();
  else await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByRole('tab', { name: /Usage/ }).click();
}

const noOverflow = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

test('desktop: uploads and three budget bars with UTC resets, and no dollars', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const stub = await connectedPage(page, baseURL!, { status: 200, body: KE });
  await openUsage(page, false);

  const panel = page.getByRole('tabpanel');
  await expect(panel.getByText('18 of 30 uploads used this month · 12 left')).toBeVisible();
  await expect(panel.getByText('Resets 1 November, 00:00 UTC', { exact: true })).toBeVisible();
  await expect(panel.getByText('Limit reached · resets 00:00 UTC')).toBeVisible();
  await expect(panel.getByText('Nearly used up · resets 1 November, 00:00 UTC')).toBeVisible();
  await expect(panel.getByRole('progressbar', { name: 'Writing today: 100% used' })).toBeVisible();
  await expect(panel.getByRole('progressbar', { name: 'Writing this month: 85% used' })).toBeVisible();
  await expect(panel.getByRole('progressbar', { name: 'Document processing today: 5% used' })).toBeVisible();
  await expect(panel).not.toContainText('$');
  await expect(panel).not.toContainText('Usage balance is not reported');
  await expect(page.getByRole('tab', { name: /Usage/ })).toContainText('Uploads and writing this month');
  // Read when the section opens (twice in development, where React mounts effects twice).
  expect(stub.reads()).toBeGreaterThanOrEqual(1);
  await noOverflow(page);
  await page.screenshot({ path: 'test-results/e2e/usage-desktop.png' });
});

test('phone: the same figures fit a 390px screen', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await connectedPage(page, baseURL!, { status: 200, body: KE });
  await openUsage(page, true);

  const panel = page.getByRole('tabpanel');
  await expect(panel.getByText('18 of 30 uploads used this month · 12 left')).toBeVisible();
  await expect(panel.getByText('Limit reached · resets 00:00 UTC')).toBeVisible();
  await expect(panel.getByRole('progressbar')).toHaveCount(3);
  await noOverflow(page);
  await page.screenshot({ path: 'test-results/e2e/usage-phone.png', fullPage: true });
});

test('phone: unknown figures read as unavailable, never 0', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await connectedPage(page, baseURL!, { status: 200, body: UNAVAILABLE });
  await openUsage(page, true);

  const panel = page.getByRole('tabpanel');
  await expect(panel.getByText("Uploads aren't set up for this account yet")).toBeVisible();
  await expect(panel.getByText('Not available')).toHaveCount(3);
  await expect(panel.getByRole('progressbar')).toHaveCount(0);
  await expect(panel).not.toContainText('0%');
  await expect(panel).not.toContainText('Limit reached');
});

test('desktop: a 503 says usage is unavailable, with no figures', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await connectedPage(page, baseURL!, { status: 503, body: { error: 'usage_unavailable' } });
  await openUsage(page, false);

  const panel = page.getByRole('tabpanel');
  await expect(panel.getByRole('alert')).toHaveText("Usage isn't available right now");
  await expect(panel.getByRole('progressbar')).toHaveCount(0);
  await expect(panel).not.toContainText('%');
});

test('desktop: under M1 only the copy that was always there (A47)', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const stub = await connectedPage(page, baseURL!, { status: 200, body: { engine: 'm1' } }, 'm1');
  await openUsage(page, false);

  const panel = page.getByRole('tabpanel');
  await expect(page.getByRole('tab', { name: /Usage/ })).toContainText('Generations left this month');
  await expect(panel.getByText('Usage balance is not reported by the previous backend')).toBeVisible();
  await expect(panel.getByText('What counts as a generation')).toBeVisible();
  await expect(panel).not.toContainText('Writing');
  await expect(panel).not.toContainText('UTC');
  await expect(panel.getByRole('progressbar')).toHaveCount(0);
  await expect(panel).not.toContainText('Loading');
  // Under M1 the usage route is never read (A47).
  expect(stub.reads()).toBe(0);
});

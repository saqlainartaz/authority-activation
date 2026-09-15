import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const client = {
  id: 'synthetic-client',
  name: 'Authority Activation Synthetic',
  timezone: 'Europe/London',
  status: 'active',
  created_at: '2026-09-15T09:00:00.000Z',
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/internal/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let json: unknown = {};
    if (path === '/api/internal/clients') json = [client];
    else if (path.endsWith('/summary')) json = {
      atom_counts: { insight: 4, proof_point: 3, pain_point: 2, objection: 1 },
      plays: [{ play_id: 'authority', missing_atom_types: ['quote', 'terminology'] }],
      selected_play_id: 'authority',
      voice_profile: { latest_version: 2, approved_version: 2 },
      generated_at: '2026-09-15T09:00:00.000Z',
    };
    else if (path.endsWith('/users')) json = [{ id: 'synthetic-person' }];
    else if (path.endsWith('/onboarding-tokens')) json = [{ revoked_at: null }];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
  });
});

async function openAdmin(page: Page) {
  await page.goto('/internal');
  await page.getByLabel('Internal passcode').fill('synthetic-only');
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
}

test('operator shell follows the client design language at desktop, tablet, and phone widths', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAdmin(page);
  const desktopSidebar = await page.locator('.internal-sidebar').boundingBox();
  expect(desktopSidebar?.width).toBeGreaterThanOrEqual(236);
  expect(desktopSidebar?.width).toBeLessThanOrEqual(240);
  const metricColumns = await page.locator('.internal-content .grid').first().evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' '));
  expect(metricColumns).toHaveLength(4);
  await page.screenshot({ path: '../docs/integration/screenshots/admin-redesign-desktop.png', fullPage: true });

  await page.setViewportSize({ width: 1000, height: 800 });
  const tabletNav = page.locator('.internal-module-nav');
  await expect(tabletNav).toBeVisible();
  expect((await tabletNav.boundingBox())?.height).toBeLessThan(70);
  await page.screenshot({ path: '../docs/integration/screenshots/admin-redesign-tablet.png', fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  const widths = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(widths.scroll).toBe(widths.client);
  await page.screenshot({ path: '../docs/integration/screenshots/admin-redesign-phone.png', fullPage: true });
});

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const client = { id: 'synthetic-client', name: 'Authority Activation Synthetic', timezone: 'Europe/London', status: 'active', created_at: '2026-09-15T09:00:00.000Z' };

test.beforeEach(async ({ page }) => {
  await page.route('**/api/internal/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = {};
    if (path === '/api/internal/clients') json = [client];
    else if (path === '/api/internal/client-login-link') json = { url: 'https://authority.example/refined/signin?token=synthetic-token' };
    else if (path.endsWith('/summary')) json = { atom_counts: {}, plays: [], selected_play_id: '', voice_profile: { latest_version: null, approved_version: null }, generated_at: '2026-09-15T09:00:00.000Z' };
    else if (path.endsWith('/users')) json = [{ id: 'synthetic-person', display_name: 'Synthetic Person', email: 'person@example.invalid' }];
    else if (path.endsWith('/documents') || path.endsWith('/atoms') || path.endsWith('/onboarding-tokens')) json = [];
    else if (path.endsWith('/held')) json = { client_id: client.id, held_count: 0, system_fault_count: 0, items: [], generated_at: '2026-09-15T09:00:00.000Z' };
    else if (path === '/api/internal/voice-profile') json = null;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
  });
});

async function openClient(page: Page) {
  await page.goto('/internal');
  await page.getByLabel('Internal passcode').fill('synthetic-only');
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await page.getByRole('button', { name: 'Open Authority Activation Synthetic' }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
}

test('operator shell keeps navigation usable at desktop, tablet, and phone widths', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openClient(page);
  await expect(page.locator('.idc-context')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your side' })).toBeVisible();

  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(page.getByLabel('Client section')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const widths = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(widths.scroll).toBe(widths.client);
});

test('login-link copy works when the modern Clipboard API is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    document.execCommand = command => command === 'copy';
  });

  await openClient(page);
  await page.locator('.idc-context').getByRole('button', { name: 'Access' }).click();
  await page.getByLabel('Recipient').selectOption('synthetic-person');
  await page.getByRole('button', { name: 'Generate link' }).click();
  await expect(page.getByText('https://authority.example/refined/signin?token=synthetic-token')).toBeVisible();
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  await expect(page.getByText('Login link copied to clipboard.')).toBeAttached();
});

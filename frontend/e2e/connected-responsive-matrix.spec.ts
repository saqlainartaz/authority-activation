import { expect, test } from '@playwright/test';

const token = process.env.AA_E2E_TOKEN;
const baseURL = process.env.AA_E2E_BASE_URL ?? 'http://localhost:3100';
if (!token) throw new Error('AA_E2E_TOKEN is required.');

for (const width of [390, 767, 768, 1179, 1180, 1440]) {
  test(`connected Business DNA fits the approved frame at ${width}px`, async ({ page }) => {
    const dark = width === 390 || width === 1179;
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.context().addCookies([{
      name: 'aa_client_token',
      value: token,
      url: baseURL,
      httpOnly: true,
      sameSite: 'Lax',
    }]);
    await page.addInitScript(theme => {
      localStorage.setItem('authority-refined-appearance', theme);
    }, dark ? 'dark' : 'light');

    await page.goto('/refined/profile');
    await expect(page.getByRole('heading', { name: 'Business DNA', exact: true }).first()).toBeVisible();
    await expect(page.getByText('Sarah Whitfield')).toBeVisible();
    await expect(page.getByText('I combine cohort evidence with practical delegation systems.')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: `../docs/integration/screenshots/business-dna-connected-${width}-${dark ? 'dark' : 'light'}.png`,
      fullPage: true,
    });
  });
}

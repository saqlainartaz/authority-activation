import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const token = process.env.AA_E2E_TOKEN;
if (!token) throw new Error('AA_E2E_TOKEN is required.');

async function finishOnboardingIfNeeded(page: Page) {
  if (new URL(page.url()).pathname !== '/refined/onboarding') return;
  await page.getByLabel('Tell us about what you or your business does—in your own words.').fill('I run a leadership consultancy that helps founders build teams that make decisions without them.');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Who do you most want your work to reach or help?').fill('Founders whose growing businesses still depend on every decision reaching them.');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('What do people usually come to you for, or what do you most want to be known for?').fill('Helping founders delegate decisions without losing standards or control.');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByText('Something else, I will type it', { exact: true }).click();
  await page.getByLabel('Your own answer').fill('Turn proven experience into useful public ideas.');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('What questions, doubts or misunderstandings come up most often about your work?').fill('How can I delegate without quality dropping?');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('What examples, results, experiences or stories best show the value of what you do?').fill('The last cohort saved about eleven hours a week each inside the first month.');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByText('Warm and conversational.', { exact: true }).click();
  await page.getByRole('button', { name: 'Open my workspace' }).click();
}

function formatButton(page: Page, label: string) {
  const channel = { LinkedIn: 'li', Instagram: 'ig', X: 'x', Facebook: 'fb' }[label as 'LinkedIn' | 'Instagram' | 'X' | 'Facebook'];
  return page.locator(`.rf-draft-pane [data-channel="${channel}"]`);
}

async function draftBody(page: Page): Promise<string> {
  return (await page.locator('.rf-draft-pane .sheet .post-p').allTextContents()).join('\n').trim();
}

test('Promo Partner generates four channel drafts and preserves exact media versions', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  await test.step('enter the synthetic connected account and verify the calendar-led home', async () => {
    await page.goto(`/api/client-login?token=${encodeURIComponent(token!)}`);
    await finishOnboardingIfNeeded(page);
    await page.goto('/refined/home');
    await expect(page.getByLabel('Promo Partner home')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Content calendar' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Write a Post' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Calendar' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Switch to .* mode/ })).toHaveCount(0);
  });

  const bodies = new Map<string, string>();
  await test.step('generate distinct grounded drafts for all four closed channels', async () => {
    await page.goto('/refined/workspace');
    if (await page.getByRole('heading', { name: 'What are you working on today?' }).count() === 0) {
      await page.getByRole('button', { name: 'New post' }).click();
      const confirm = page.getByRole('button', { name: /End and start new|Discard and start new/ });
      await confirm.click();
      await expect(page.getByRole('heading', { name: 'What are you working on today?' })).toBeVisible();
    }
    for (const channel of ['Instagram', 'X', 'Facebook']) {
      await page.getByRole('button', { name: channel, exact: true }).click();
    }
    for (const channel of ['LinkedIn', 'Instagram', 'X', 'Facebook']) {
      await expect(page.getByRole('button', { name: channel, exact: true })).toHaveAttribute('aria-pressed', 'true');
    }
    // The clicked four-channel selector wins even when the brief mentions only LinkedIn.
    await page.getByPlaceholder(/Tell it what happened/).fill('Write a grounded post about our LinkedIn campaign and how the last cohort saved eleven hours a week inside the first month.');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('button', { name: 'Keep as draft' })).toBeVisible({ timeout: 90_000 });

    for (const [channel, lead] of [
      ['LinkedIn', 'A useful detail from your source:'],
      ['Instagram', 'One detail worth pausing on.'],
      ['X', 'One useful detail:'],
      ['Facebook', 'Here is a detail from behind the work.'],
    ] as const) {
      await formatButton(page, channel).click();
      await expect(page.locator('.rf-draft-pane .sheet')).toContainText(lead);
      bodies.set(channel, await draftBody(page));
    }
    expect(new Set(bodies.values()).size).toBe(4);
    await expect.poll(() => new URL(page.url()).searchParams.get('channels')).toBe('li,ig,x,fb');
    await page.reload();
    for (const [channel, lead] of [
      ['LinkedIn', 'A useful detail from your source:'],
      ['Instagram', 'One detail worth pausing on.'],
      ['X', 'One useful detail:'],
      ['Facebook', 'Here is a detail from behind the work.'],
    ] as const) {
      await formatButton(page, channel).click();
      await expect(page.locator('.rf-draft-pane .sheet')).toContainText(lead);
    }
    await expect(page.getByRole('group', { name: 'Suggested revisions' })).toContainText('Shorter');
    await expect(page.getByRole('group', { name: 'Suggested revisions' })).toContainText('Longer');
    await expect(page.getByRole('group', { name: 'Suggested revisions' })).toContainText('Punchier');
  });

  const imagePath = path.resolve(process.cwd(), '..', '..', 'prototype', 'promo-partner-home-desktop.png');
  let contentItemId = '';
  await test.step('attach, preview, schedule, and reopen an Instagram image', async () => {
    await formatButton(page, 'Instagram').click();
    await page.locator('.rf-draft-pane input[type="file"]').setInputFiles(imagePath);
    await expect(page.locator('.rf-draft-pane .rf-post-media img')).toBeVisible();
    const imageActions = page.locator('.rf-draft-pane').getByRole('group', { name: 'Image actions' });
    await expect(imageActions.getByRole('button', { name: 'Replace Image', exact: true })).toBeVisible();
    await expect(imageActions.getByRole('button', { name: 'Remove image' })).toBeVisible();
    await expect(page.locator('.rf-draft-pane').getByRole('link', { name: 'Download image' })).toHaveCount(0);
    await expect(page.locator('.rf-draft-pane').getByText('promo-partner-home-desktop.png', { exact: true })).toHaveCount(0);
    await expect(page.locator('.rf-draft-pane').getByPlaceholder('Describe this image (optional)')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Preview' }).click();
    await expect(page.locator('.rf-draft-pane .sheet img')).toHaveAttribute('alt', '');
    await expect(page.locator('.rf-draft-pane').getByText('promo-partner-home-desktop.png', { exact: true })).toHaveCount(0);
    await expect(page.locator('.rf-draft-pane').getByLabel('Image alt text')).toHaveCount(0);
    await expect(page.locator('.rf-draft-pane').getByRole('button', { name: 'Replace Image', exact: true })).toHaveCount(0);
    await expect(page.locator('.rf-draft-pane').getByRole('button', { name: 'Remove image' })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Write' }).click();
    contentItemId = new URL(page.url()).searchParams.get('session') ? await page.evaluate(async () => {
      const sessionId = new URL(location.href).searchParams.get('session');
      const response = await fetch(`/api/client/chat/sessions/${encodeURIComponent(sessionId || '')}`);
      const envelope = await response.json();
      return envelope.session.content_item_id as string;
    }) : '';
    expect(contentItemId).toBeTruthy();

    await page.getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('button', { name: 'Tomorrow' }).click();
    await page.getByLabel('Time').fill('09:15');
    await page.getByRole('button', { name: 'Schedule', exact: true }).click();
    await expect(page.getByText(/Scheduled for .*09:15/)).toBeVisible();
    await formatButton(page, 'LinkedIn').click();
    await expect(page.locator('.rf-draft-pane .sheet')).toContainText('A useful detail from your source:');

    await page.goto('/refined/home');
    await page.getByRole('button', { name: /[1-9]\d* scheduled posts?/ }).first().click();
    await expect(page.locator('.rf-day-agenda')).toContainText('Chat generation');

    await page.goto('/refined/library');
    await expect(page.getByRole('tab', { name: 'Calendar' })).toHaveCount(0);
    const row = page.locator(`tr[data-content-id="${contentItemId}"]`);
    await expect(row).toContainText('Scheduled');
    await row.locator('.rf-post-open').click();
    await expect(page.getByRole('link', { name: 'Download image' })).toBeVisible();
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.locator('.rf-post-media img')).toBeVisible();
  });

  await test.step('replace and remove media without rewriting old versions', async () => {
    await page.locator('input[type="file"]').setInputFiles(imagePath);
    await page.getByRole('button', { name: 'Keep as draft' }).click();
    await expect(page.getByText('Draft saved to your Library')).toBeVisible();

    await page.goto('/refined/library');
    const row = page.locator(`tr[data-content-id="${contentItemId}"]`);
    await expect(row).toContainText('Draft');
    await row.locator('.rf-post-open').click();
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await page.getByRole('button', { name: 'Remove image' }).click();
    await expect(page.locator('.rf-post-media img')).toHaveCount(0);
    await page.getByRole('button', { name: 'Keep as draft' }).click();
    await expect(page.getByText('Draft saved to your Library')).toBeVisible();

    const history = await page.evaluate(async id => {
      const response = await fetch(`/api/client/content-items/${encodeURIComponent(id)}/versions`);
      return response.json();
    }, contentItemId) as { versions: Array<{ media: { media_id: string } | null }> };
    const media = history.versions.map(version => version.media?.media_id ?? null);
    expect(media.at(-1)).toBeNull();
    expect(media.at(-2)).toBeTruthy();
    expect(media.at(-3)).toBeTruthy();
    expect(media.at(-2)).not.toBe(media.at(-3));
    for (const mediaId of [media.at(-2), media.at(-3)]) {
      const status = await page.evaluate(async id => (await fetch(`/api/client/post-media/${encodeURIComponent(id || '')}`)).status, mediaId);
      expect(status).toBe(200);
    }
  });

  await test.step('appearance stays in Settings and the responsive frame has no horizontal overflow', async () => {
    await page.goto('/refined/home');
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByLabel('Theme')).toBeVisible();
    await expect(page.getByText('Only use my sources')).toHaveCount(0);
    await expect(page.getByText('Learning', { exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');

    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate(value => localStorage.setItem('authority-refined-appearance', value), theme);
      for (const width of [390, 767, 768, 1179, 1180, 1440]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await page.reload();
        await expect(page.getByRole('heading', { name: 'Content calendar' })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
        await page.screenshot({ path: `test-results/e2e/promo-partner-home-${width}-${theme}.png`, fullPage: true });
      }
    }
  });
});

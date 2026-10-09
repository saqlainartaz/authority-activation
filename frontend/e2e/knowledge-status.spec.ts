import { expect, test, type Page } from '@playwright/test';

import { knowledgeStatus, legacyStatus } from '../src/lib/knowledge-status';
import { uploadErrorCopy } from '../src/lib/upload-errors';

// Cycle 5 P2.7: the Knowledge screen against a stubbed BFF (spec §7.2-7.4, A26, A27, A47).
// No backend: every `/api/client/*` read the connected app makes is fulfilled here. The
// stubbed BFF answers with exactly what the real one builds, from the same helpers
// (`knowledgeStatus`, `uploadErrorCopy`); `tests/client/knowledge-routes.test.ts` checks
// that the real routes produce them. Run it like `e2e/usage.spec.ts`:
//   node e2e/support/fake-me-backend.mjs 8199
//   ENGINE_URL=http://127.0.0.1:8199 ENGINE_SERVICE_KEY=e2e NEXT_PUBLIC_AUTHORITY_DEMO=0 npx next dev --port 3101
//   AA_E2E_BASE_URL=http://localhost:3101 npx playwright test e2e/knowledge-status.spec.ts

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

// A source accepted, then paused by the client's documents daily limit (A27). Its resume
// time is far ahead, so the screen does not read the list again while the test runs.
const RESUMES = '2099-01-02T00:01:00+00:00';
const pausedStatus = knowledgeStatus(
  { state: 'parsed', paused_reason: 'daily_spending_limit', next_eligible_at: RESUMES }, null, [],
);
const PAUSED_SOURCE = {
  id: 'f2a1c0de-0000-4000-8000-000000000001', client_id: 'c1', source_type: 'board_pack.pdf', source_authority: 'CLIENT',
  sha256: '', status: legacyStatus(pausedStatus), pipeline_version: 2, created_at: '2026-10-06T09:00:00Z', knowledge: pausedStatus,
};
const M1_SOURCE = {
  id: '0123456789ab', client_id: 'c1', source_type: 'brand_doc', source_authority: 'CONVERSATIONAL', sha256: 'x',
  status: 'atomised', pipeline_version: 1, created_at: '2026-10-01T10:00:00Z',
};

// The monthly upload refusal as the backend sends it (A26), and the BFF's answer to it.
const MONTHLY = {
  detail: 'monthly_upload_limit',
  limit: { meter: 'uploads_monthly', period: 'month', used: 30, allowed: 30, used_fraction: 1, resets_at: '2026-11-01T00:00:00+00:00', reason: 'monthly_upload_limit' },
};
const MONTHLY_COPY = uploadErrorCopy(429, MONTHLY)!;

// Settings -> Usage, which "View usage" opens (spec §7.4): the same balance and reset.
// `documents.today` is what the backend answers for a client whose source is paused on
// the documents day limit (Ruling 40): the day 96% spent and a 5% call refused, so the
// fraction is below 1 and `available` is false. `tests/test_ke_day_limit_waits.py::
// test_the_a27_usage_answer_for_a_paused_source_is_the_backends` drives that state
// through the real C3 map handler and asserts exactly this answer from `/v1/usage`.
const USAGE = {
  engine: 'ke',
  uploads: { month: '2026-10', base: 20, extra: 10, used: 30, remaining: 0, unlimited: false, resets_at: '2026-11-01T00:00:00+00:00' },
  writing: {
    today: { used_fraction: 0.1, available: true, resets_at: '2026-10-07T00:00:00+00:00' },
    month: { used_fraction: 0.1, available: true, resets_at: '2026-11-01T00:00:00+00:00' },
  },
  documents: { today: { used_fraction: 0.96, available: false, resets_at: '2026-10-07T00:00:00+00:00' } },
};

// Ruling 38: a released source stays Available; its own detail adds a waiting update.
const RELEASED_SOURCE = {
  ...PAUSED_SOURCE, id: 'f2a1c0de-0000-4000-8000-000000000002', source_type: 'brand_story.pdf', status: 'atomised',
  knowledge: knowledgeStatus({ state: 'ready' }, { state: 'active', yield: 'evidence' }, []),
};
const RELEASED_DETAIL = {
  ...RELEASED_SOURCE,
  knowledge: knowledgeStatus(
    { state: 'ready', paused_reason: 'daily_spending_limit', next_eligible_at: RESUMES }, { state: 'active', yield: 'evidence' }, [],
  ),
};
const PROCESSING_SOURCE = {
  ...PAUSED_SOURCE, id: 'f2a1c0de-0000-4000-8000-000000000003', source_type: 'interview.txt',
  knowledge: knowledgeStatus({ state: 'cleaning' }, null, []),
};
const AVAILABLE_NOW = { ...PROCESSING_SOURCE, status: 'atomised', knowledge: knowledgeStatus({ state: 'ready' }, { state: 'active' }, []) };

type ListAnswer = { status: number; body: unknown };

async function knowledgePage(
  page: Page, baseURL: string, engine: 'ke' | 'm1', documents: unknown[],
  options: { list?: (read: number) => ListAnswer; details?: Record<string, unknown> } = {},
) {
  await page.context().addCookies([{ name: 'aa_client_token', value: 'synthetic-local-token', url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
  // Registered first, so the specific stubs below take precedence over it.
  await page.route('**/api/client/**', route => route.fulfill(json({ error: 'Not stubbed.' }, 404)));
  await page.route('**/api/client/content-items', route => route.fulfill(json({ items: [] })));
  await page.route('**/api/client/calendar', route => route.fulfill(json({ slots: [] })));
  await page.route('**/api/client/social/**', route => route.fulfill(json([])));
  await page.route('**/api/client/profile', route => route.fulfill(json({ identity: { display_name: 'Amina Yusuf', profession: 'Documentary producer', client_name: 'ISTV', timezone: 'Europe/London' }, document_count: documents.length })));
  await page.route('**/api/client/engine', route => route.fulfill(json({ knowledge_engine: engine })));
  await page.route('**/api/client/usage', route => route.fulfill(json(USAGE)));
  const uploads: string[] = [];
  let reads = 0;
  await page.route('**/api/client/documents', route => {
    if (route.request().method() === 'POST') {
      uploads.push(route.request().url());
      return route.fulfill(json({ error: MONTHLY_COPY, detail: MONTHLY.detail, limit: MONTHLY.limit }, 429));
    }
    reads += 1;
    const answer = options.list ? options.list(reads) : { status: 200, body: documents };
    return route.fulfill(json(answer.body, answer.status));
  });
  for (const [id, detail] of Object.entries(options.details ?? {})) {
    await page.route(`**/api/client/documents/${id}`, route => route.fulfill(json(detail)));
  }
  await page.goto('/refined/train?tab=knowledge');
  return { uploads: () => uploads.length, reads: () => reads };
}

const noOverflow = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

test('A27 desktop: a paused source shows its reason and when it continues, with no delete or re-upload', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await knowledgePage(page, baseURL!, 'ke', [PAUSED_SOURCE]);

  const row = page.locator('.rf-uploaded-source').filter({ hasText: 'board pack.pdf' });
  await expect(row.locator('.rf-source-meta')).toHaveText('Paused · daily spending limit');
  await expect(row).toContainText('Continues after 00:01 UTC on 2 January');
  await expect(page.locator('.rf-coverage')).toContainText('0 available');

  await row.locator('.rf-source-open').click();
  const popup = page.getByRole('dialog');
  // P7.2: the popup's Status shows the label, then its line.
  await expect(popup.locator('.rf-peek-property').filter({ hasText: 'Status' })).toHaveText('StatusPaused · daily spending limitContinues after 00:01 UTC on 2 January');
  await expect(popup.getByRole('button', { name: /Remove|Reprocess|Delete/ })).toHaveCount(0);
  await expect(popup).not.toContainText(/upload (it )?again|re-upload|failed/i);
  await page.screenshot({ path: 'test-results/e2e/knowledge-paused-desktop.png' });
});

test('A27 phone: the paused source fits a 390px screen', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await knowledgePage(page, baseURL!, 'ke', [PAUSED_SOURCE]);

  const row = page.locator('.rf-uploaded-source').filter({ hasText: 'board pack.pdf' });
  await expect(row.locator('.rf-source-meta')).toHaveText('Paused · daily spending limit');
  await expect(row).toContainText('Continues after 00:01 UTC on 2 January');
  await noOverflow(page);
  await page.screenshot({ path: 'test-results/e2e/knowledge-paused-phone.png', fullPage: true });
});

test('A26 desktop: a monthly-limit upload is refused beside the file, with the reset date, and no row', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const stub = await knowledgePage(page, baseURL!, 'ke', []);

  // The header's Add files: an empty list also shows the A35 empty state's own button.
  await page.getByRole('button', { name: 'Add files' }).first().click();
  // The screen ignores files until its document list has loaded (the input is disabled).
  await expect(page.getByRole('button', { name: 'Choose files' })).toBeEnabled();
  await page.getByLabel('Choose knowledge files').setInputFiles({ name: 'board-pack.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 synthetic') });

  const alert = page.getByRole('dialog').getByRole('alert');
  await expect(alert).toHaveText(`board-pack.pdf: ${MONTHLY_COPY}`);
  await expect(alert).toContainText('30 of 30 uploads used this month');
  await expect(alert).toContainText('It resets on 1 November at 00:00 UTC.');
  await expect(alert).not.toContainText(/shortly|monthly_upload_limit/);
  expect(stub.uploads()).toBe(1);
  // Not accepted, so no source row was made for it.
  await page.keyboard.press('Escape');
  await expect(page.locator('.rf-uploaded-source')).toHaveCount(0);
  await expect(page.locator('.rf-section-heading')).toContainText('0 sources');
  await page.screenshot({ path: 'test-results/e2e/knowledge-upload-refused-desktop.png' });
});

test('M1 desktop: the screen shows exactly what it always did (A47)', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await knowledgePage(page, baseURL!, 'm1', [M1_SOURCE]);

  const row = page.locator('.rf-uploaded-source').filter({ hasText: 'brand doc' });
  await expect(row.locator('.rf-source-meta')).toHaveText('Learned');
  await expect(row).toContainText('01234567 · atomised');
  await expect(page.locator('.rf-coverage')).toContainText('1 atomised');
  await row.getByRole('button').click();
  const popup = page.getByRole('dialog');
  await expect(popup.getByRole('button', { name: 'Remove' })).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Reprocess' })).toBeVisible();
  await expect(popup).not.toContainText(/UTC|Paused|Available/);
});

// ---- fix round 1 ------------------------------------------------------------

const settingsUsage = async (page: Page) => {
  await expect(page.getByRole('tab', { name: /Usage/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toContainText('30 of 30 uploads used this month');
  // The paused source's limit reads reached, not "Nearly used up", at 96% (Ruling 40).
  const documents = page.locator('.rf-usage-meter').filter({ hasText: 'Document processing today' });
  await expect(documents).toHaveAttribute('data-state', 'reached');
  await expect(documents).toContainText('96% used');
  await expect(documents).toContainText('Limit reached');
  // One dialog at a time: the Knowledge popup or Add files closed first.
  await expect(page.getByRole('dialog')).toHaveCount(1);
};

test('A26 desktop: View usage beside the refused file opens Settings at Usage, with the same balance', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await knowledgePage(page, baseURL!, 'ke', []);
  // The header's Add files: an empty list also shows the A35 empty state's own button.
  await page.getByRole('button', { name: 'Add files' }).first().click();
  await expect(page.getByRole('button', { name: 'Choose files' })).toBeEnabled();
  await page.getByLabel('Choose knowledge files').setInputFiles({ name: 'board-pack.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 synthetic') });
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Not accepted.');

  await page.getByRole('dialog').getByRole('button', { name: 'View usage' }).click();
  await settingsUsage(page);
  await expect(page.getByRole('dialog')).toContainText('Settings');
  await page.screenshot({ path: 'test-results/e2e/knowledge-view-usage-desktop.png' });
});

test('A27 desktop: View usage on the paused row and in its popup opens Settings at Usage', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await knowledgePage(page, baseURL!, 'ke', [PAUSED_SOURCE], { details: { [PAUSED_SOURCE.id]: PAUSED_SOURCE } });
  const row = page.locator('.rf-uploaded-source').filter({ hasText: 'board pack.pdf' });
  await row.getByRole('button', { name: 'View usage' }).click();
  await settingsUsage(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await row.locator('.rf-source-open').click();
  await page.getByRole('dialog').getByRole('button', { name: 'View usage' }).click();
  await settingsUsage(page);
});

test('A27 phone: View usage opens the Usage section itself', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await knowledgePage(page, baseURL!, 'ke', [PAUSED_SOURCE]);
  await page.locator('.rf-uploaded-source').getByRole('button', { name: 'View usage' }).click();
  await expect(page.getByRole('dialog')).toContainText('30 of 30 uploads used this month');
  await noOverflow(page);
});

test('Ruling 38: a released source stays Available, and its opened detail names the waiting update', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await knowledgePage(page, baseURL!, 'ke', [RELEASED_SOURCE], { details: { [RELEASED_SOURCE.id]: RELEASED_DETAIL } });
  const row = page.locator('.rf-uploaded-source').filter({ hasText: 'brand story.pdf' });
  await expect(row.locator('.rf-source-meta')).toHaveText('Available');
  await expect(row).not.toContainText('Updating');

  await row.locator('.rf-source-open').click();
  await expect(page.getByRole('dialog').locator('.rf-peek-property').filter({ hasText: 'Status' }))
    .toHaveText('StatusAvailableUpdating paused · continues after 00:01 UTC on 2 January (daily limit)');
});

test('I1: a failed refresh marks the list stale on the list itself, and Retry recovers it', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // The list answers by phase, not by read count (development mounts read it twice).
  let phase: 'processing' | 'down' | 'recovered' = 'processing';
  const stub = await knowledgePage(page, baseURL!, 'ke', [], {
    list: () => phase === 'processing' ? { status: 200, body: [PROCESSING_SOURCE] }
      : phase === 'down' ? { status: 502, body: { error: 'Something broke on our side.' } }
        : { status: 200, body: [AVAILABLE_NOW] },
  });
  const row = page.locator('.rf-uploaded-source').filter({ hasText: 'interview.txt' });
  await expect(row.locator('.rf-source-meta')).toHaveText('Processing');
  phase = 'down';

  const stale = page.locator('.rf-knowledge-stale');
  await expect(stale).toContainText(/Couldn.t refresh · showing status from \d\d:\d\d UTC/, { timeout: 15_000 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(row.locator('.rf-source-meta')).toHaveText('Processing');

  phase = 'recovered';
  await stale.getByRole('button', { name: 'Retry' }).click();
  await expect(row.locator('.rf-source-meta')).toHaveText('Available');
  await expect(stale).toHaveCount(0);
  expect(stub.reads()).toBeGreaterThanOrEqual(3);
});

test('M1 desktop: no View usage and no stale note (A47)', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await knowledgePage(page, baseURL!, 'm1', [M1_SOURCE]);
  await expect(page.locator('.rf-uploaded-source .rf-source-meta')).toHaveText('Learned');
  await expect(page.getByRole('button', { name: 'View usage' })).toHaveCount(0);
  await expect(page.locator('.rf-knowledge-stale')).toHaveCount(0);
});

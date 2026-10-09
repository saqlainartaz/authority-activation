import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

/**
 * TEST BED (2026-09-28): one real document from the client's own Knowledge screen into the
 * knowledge engine (C1 -> C2 -> C3, run by the backend's own workers in KE_ENGINE=live), then
 * a post from the c4 agent in the workspace. Paid: it spends real model calls on both sides.
 *
 *   AA_TESTBED_PHASE=upload  AA_E2E_TOKEN=<onboarding token> AA_TESTBED_SOURCE=<file>
 *   AA_TESTBED_PHASE=write   AA_E2E_TOKEN=<same token>
 *   AA_TESTBED_OUT=<git-ignored folder for screenshots; they show client text>
 *
 * Two phases because C3's mapping finishes a few minutes after the screen shows "Available"
 * (the screen knows C1 and C2, not C3): the operator checks C3 is done between them. Before
 * Cycle 5 P2.7 the screen said "Learned" here; under the rehaul engine it now shows the
 * spec §7.2 labels.
 */
const phase = process.env.AA_TESTBED_PHASE;
const token = process.env.AA_E2E_TOKEN;
const out = process.env.AA_TESTBED_OUT;
if (!token || !out || (phase !== 'upload' && phase !== 'write')) {
  throw new Error('AA_TESTBED_PHASE (upload|write), AA_E2E_TOKEN and AA_TESTBED_OUT are required.');
}

// A stuck step fails in 30 s rather than waiting out the long phase timeouts.
test.use({ actionTimeout: 30_000 });

test.beforeEach(async ({ page }) => {
  await page.goto(`/api/client-login?token=${encodeURIComponent(token)}`);
  // A new client answers onboarding before anything else. It is not what this test
  // is about, so it goes through the screen's own route (PUT /api/client/onboarding)
  // rather than its screens. The answers become what the agent knows about the
  // client, so every one is neutral: what the post says has to come from the document.
  const neutral = 'Please use my uploaded material.';
  const saved = await page.evaluate(async text => {
    const required = ['sixty_day_hustle_role', 'mawer_capital', 'content_focus', 'istv_voice'];
    const response = await fetch('/api/client/onboarding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clarifications: required.map(question_id => ({
        question_id, question_version: 'business-clarification/2.0.0', selected: ['__other__'], text,
      })) }),
    });
    return { status: response.status, body: await response.text() };
  }, neutral);
  expect(saved.status, saved.body).toBe(200);
  await page.goto('/refined/workspace');
  await expect(page).toHaveURL(/\/refined\/workspace/);
});

test('upload a real document through the Knowledge screen until it is learned', async ({ page }) => {
  test.skip(phase !== 'upload');
  const source = process.env.AA_TESTBED_SOURCE;
  if (!source || !fs.existsSync(source)) throw new Error('AA_TESTBED_SOURCE must name an existing file.');
  test.setTimeout(30 * 60_000);
  await page.goto('/refined/train?tab=knowledge');
  await page.getByRole('button', { name: 'Add files' }).click({ timeout: 30_000 });
  // The screen ignores files until its document list has loaded (the input is disabled).
  await expect(page.getByRole('button', { name: 'Choose files' })).toBeEnabled();
  await page.getByLabel('Choose knowledge files').setInputFiles(source);
  // The screen shows the file name with underscores as spaces; the page collapses runs of them.
  const words = path.basename(source).split(/[_\s]+/).filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const row = page.locator('.rf-uploaded-source').filter({ hasText: new RegExp(words.join('\\s+')) }).first();
  await expect(row).toBeVisible();
  // A source whose C2 yield is empty is successfully processed too (review M5).
  await expect(row.locator('.rf-source-meta')).toHaveText(/^(Available|Processed · no usable information)$/, { timeout: 25 * 60_000 });
  await page.screenshot({ path: path.join(out, 'knowledge-learned.png'), fullPage: true });
});

test('ask the agent for a post and get a checked draft that shows its sources', async ({ page }) => {
  test.skip(phase !== 'write');
  test.setTimeout(10 * 60_000);
  await page.goto('/refined/workspace');
  await page.getByPlaceholder(/Tell it what happened/).fill(
    'Write a LinkedIn post about what we offer and who it is for. Keep it grounded in what you know about us.');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('button', { name: 'Keep as draft' })).toBeVisible({ timeout: 5 * 60_000 });
  await page.screenshot({ path: path.join(out, 'workspace-draft.png'), fullPage: true });
  const session = new URL(page.url()).searchParams.get('session');
  expect(session).toBeTruthy();
  const evidence = await page.evaluate(
    async id => fetch(`/api/client/chat/sessions/${id}`).then(response => response.json()), session);
  const latest = evidence.variants.at(-1);
  // Counts only: the draft itself is client text and stays in the screenshot folder.
  fs.writeFileSync(path.join(out, 'draft-summary.json'), JSON.stringify({
    status: latest.status ?? null, sources: latest.sources?.length ?? 0, variants: evidence.variants.length,
  }, null, 2));
  expect(latest.sources.length).toBeGreaterThan(0);
});

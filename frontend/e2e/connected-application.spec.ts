import { expect, request as playwrightRequest, test } from '@playwright/test';

const token = process.env.AA_E2E_TOKEN;
const adminPasscode = process.env.AA_E2E_INTERNAL_PASSCODE;
const serviceKey = process.env.AA_E2E_SERVICE_KEY;
if (!token || !adminPasscode || !serviceKey) {
  throw new Error('AA_E2E_TOKEN, AA_E2E_INTERNAL_PASSCODE and AA_E2E_SERVICE_KEY are required.');
}

test('connected client and admin journeys use the isolated previous backend', async ({ page }) => {
  await test.step('authentication gates, errors, and admin surface', async () => {
    await page.goto('/refined/home');
    await expect(page).toHaveURL(/\/refined\/signin/);
    await page.getByLabel('Email').fill('synthetic@example.com');
    await page.locator('input[name="password"]').fill('wrong-but-retained');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('.rf-auth-error')).toContainText('did not match');
    await expect(page.getByLabel('Email')).toHaveValue('synthetic@example.com');

    await page.goto('/internal');
    await page.getByLabel('Internal passcode').fill('wrong-passcode');
    await page.getByRole('button', { name: 'Open workspace' }).click();
    await expect(page.getByText('That passcode is not valid.', { exact: true })).toBeVisible();
    await page.getByLabel('Internal passcode').fill(adminPasscode);
    await page.getByRole('button', { name: 'Open workspace' }).click();
    await expect(page.getByText(/Authority Activation Synthetic/).first()).toBeVisible();
    for (const [button, heading] of [
      ['People', 'People'], ['Sources', 'Documents'], ['Knowledge', 'Knowledge review'],
      ['Voice profile', 'Voice profile'], ['Access', 'Issued login links'], ['Held drafts', 'Held drafts'],
    ] as const) {
      await page.getByRole('button', { name: new RegExp(`^${button}`) }).click();
      await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
    }
    await page.screenshot({ path: '../docs/integration/screenshots/admin-empty-held-desktop.png', fullPage: true });

    await page.getByRole('button', { name: 'Add client + person' }).click();
    await page.getByLabel('Client or company name').fill('Cross Tenant Synthetic');
    await page.getByLabel('Person name').fill('Other Tenant Person');
    await page.getByLabel('Email').fill(`other-${Date.now()}@example.com`);
    await page.getByLabel('Profession (optional)').fill('Consultant');
    await page.getByRole('button', { name: 'Create client + person' }).click();
    await expect(page.getByText('Workspace and first person created. Add source material next.')).toBeVisible();
  });

  let foreignDocumentId = '';
  await test.step('prepare a foreign tenant object for an authorization denial', async () => {
    const engine = await playwrightRequest.newContext({
      baseURL: 'http://127.0.0.1:8001',
      extraHTTPHeaders: { 'X-API-Key': serviceKey },
    });
    const clients = await engine.get('/v1/clients');
    expect(clients.ok()).toBeTruthy();
    const other = (await clients.json() as Array<{ id: string; name: string }>).find(row => row.name === 'Cross Tenant Synthetic');
    expect(other).toBeTruthy();
    const uploaded = await engine.post(`/v1/clients/${other!.id}/documents`, {
      multipart: {
        file: { name: 'foreign.txt', mimeType: 'text/plain', buffer: Buffer.from('Other Tenant Person: This material belongs only to the other tenant.') },
        source_type: 'brand_doc',
        source_authority: 'CONVERSATIONAL',
      },
    });
    expect(uploaded.ok()).toBeTruthy();
    foreignDocumentId = (await uploaded.json() as { id: string }).id;
    await engine.dispose();
  });

  await test.step('one-time access, approved onboarding presentation, and session restoration', async () => {
    await page.goto(`/api/client-login?token=${encodeURIComponent(token)}`);
    if (new URL(page.url()).pathname === '/refined/onboarding') {
      await page.getByText('Yes', { exact: true }).click();
      await page.getByText('Three days', { exact: true }).click();
      await page.getByText('Consulting', { exact: true }).click();
      await page.getByRole('button', { name: 'Next' }).click();
      await page.getByLabel('What is “the Engine”?').fill('A structured leadership operating system');
      await page.getByRole('button', { name: 'Next' }).click();
      await page.getByLabel('In a sentence or two, what does the company do?').fill('We help founders build leadership teams that make decisions without them.');
      await page.getByRole('button', { name: 'Next' }).click();
      await expect(page.getByText(/audience choice remains local/i)).toBeVisible();
      await page.getByRole('button', { name: 'Open my workspace' }).click();
      await expect(page.locator('.rf-auth-error')).toContainText('does not ask that question');
      await expect(page.getByText('We help founders build leadership teams that make decisions without them.')).toBeVisible();
      await expect(page).toHaveURL(/\/refined\/onboarding/);
      await page.screenshot({ path: '../docs/integration/screenshots/onboarding-unsupported-error-desktop.png', fullPage: true });

      // The approved audience labels and old catalogue are intentionally not
      // conflated, and the approved questions contain no backend guardrail.
      // Supply both as explicit synthetic test setup so generation can exercise
      // the supported stack; neither value is presented as a successful UI save.
      const compatible = await page.evaluate(async () => {
        const pre = await fetch('/api/client/onboarding').then(response => response.json());
        const answer = pre.answers ?? {};
        const keys = ['never_say', 'voice_constraints', 'tone', 'tldr', 'insight', 'pain_point', 'objection', 'proof_point', 'quote', 'terminology'];
        const payload = Object.fromEntries(keys.map(key => [key, Array.isArray(answer[key]) ? answer[key] : []]));
        payload.audience = [pre.audience_options[0].key];
        payload.never_say = ['Never invent evidence or outcomes.'];
        return fetch('/api/client/onboarding', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(response => response.status);
      });
      expect(compatible).toBe(200);
    }
    await page.goto('/refined/workspace');
    await expect(page).toHaveURL(/\/refined\/workspace/);
    await expect(page.getByPlaceholder(/Tell it what happened/)).toBeVisible();
  });

  await test.step('source persistence, async truth, and cross-tenant denial', async () => {
    await page.goto('/refined/train?tab=knowledge');
    await expect(page.locator('.rf-uploaded-source').filter({ hasText: 'sales call transcript' }).first()).toBeVisible();
    const denied = await page.evaluate(async id => fetch(`/api/client/documents/${encodeURIComponent(id)}`).then(response => response.status), foreignDocumentId);
    expect(denied).toBe(404);

    await page.getByRole('button', { name: 'Add files' }).click();
    await page.getByLabel('Choose knowledge files').setInputFiles({
      name: 'new-synthetic-source.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Sarah Whitfield: Customers now delegate their first function within ninety days.'),
    });
    const row = page.locator('.rf-uploaded-source').filter({ hasText: 'brand doc' }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('atomised', { timeout: 30_000 });
    await page.reload();
    await expect(page.locator('.rf-uploaded-source').filter({ hasText: 'brand doc' }).first()).toContainText('atomised');
    await page.screenshot({ path: '../docs/integration/screenshots/knowledge-connected-desktop.png', fullPage: true });
  });

  let contentItemId = '';
  await test.step('grounded streaming, citations, edit versions, and persistence', async () => {
    await page.goto('/refined/workspace');
    await page.getByPlaceholder(/Tell it what happened/).fill('Write a post.');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('What should this LinkedIn post be about?', { exact: true })).toBeVisible({ timeout: 45_000 });
    await page.reload();
    await expect(page.getByText('What should this LinkedIn post be about?', { exact: true })).toBeVisible();
    await page.getByPlaceholder(/Tell it what happened/).fill('Use the source fact that the last cohort saved about eleven hours a week in the first month.');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('button', { name: 'Keep as draft' })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole('complementary')).toContainText('A useful detail from your source');
    await page.screenshot({ path: '../docs/integration/screenshots/workspace-connected-light-desktop.png', fullPage: true });
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '../docs/integration/screenshots/workspace-connected-dark-phone.png', fullPage: true });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole('button', { name: 'Switch to light mode' }).click();
    const session = new URL(page.url()).searchParams.get('session');
    expect(session).toBeTruthy();
    const sessionEvidence = await page.evaluate(async id => fetch(`/api/client/chat/sessions/${id}`).then(response => response.json()), session);
    expect(sessionEvidence.variants.at(-1).sources.length).toBeGreaterThan(0);

    const firstParagraph = page.getByLabel('Draft paragraph. Press Enter to edit.').first();
    await firstParagraph.press('Enter');
    const editor = page.getByLabel('Edit paragraph').first();
    await editor.fill(`${await editor.inputValue()}\n\nEdited safely before saving.`);
    await editor.blur();
    await page.getByRole('button', { name: 'Keep as draft' }).click();
    await expect(page.getByPlaceholder(/Tell it what happened/)).toBeVisible();

    const persisted = await page.evaluate(async () => fetch('/api/client/content-items').then(response => response.json()));
    const latest = persisted.items.at(-1);
    contentItemId = latest.content_item_id;
    const versions = await page.evaluate(async id => fetch(`/api/client/content-items/${id}/versions`).then(response => response.json()), contentItemId);
    expect(versions.versions.length).toBeGreaterThanOrEqual(2);
    await page.reload();
    await page.goto(`/refined/workspace?post=${encodeURIComponent(contentItemId)}`);
    await expect(page.getByRole('complementary')).toContainText('Edited safely before saving.');
  });

  await test.step('approval, scheduling, rescheduling, and direct links', async () => {
    await page.getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('button', { name: 'Tomorrow' }).click();
    await page.getByLabel('Time').fill('09:15');
    await page.getByRole('button', { name: 'Schedule', exact: true }).click();
    await expect(page.getByText(/Scheduled for .*09:15/)).toBeVisible();
    await page.goto('/refined/library');
    const postRow = page.locator('tr').filter({ hasText: 'A useful detail from your source' }).first();
    await expect(postRow).toContainText('Scheduled');
    await postRow.locator('.rf-post-open').click();
    await page.getByRole('button', { name: 'Change schedule' }).click();
    await page.getByRole('button', { name: 'Next Monday' }).click();
    await page.getByLabel('Time').fill('10:30');
    await page.getByRole('button', { name: 'Schedule', exact: true }).click();
    await expect(page.getByText(/Scheduled for .*10:30/)).toBeVisible();
    await page.reload();
    await expect(page.locator('tr').filter({ hasText: 'A useful detail from your source' }).first()).toContainText('Scheduled');
  });

  await test.step('client-side cancellation is truthful about the unsupported server operation', async () => {
    await page.goto('/refined/workspace');
    await page.getByPlaceholder(/Tell it what happened/).fill('Start another grounded draft, then stop showing it.');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByText(/no server-side turn-cancellation endpoint/i)).toBeVisible();
  });

  await test.step('logout invalidates the browser session', async () => {
    await page.goto('/refined/home');
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('tab', { name: /Account/ }).click();
    await page.getByRole('button', { name: /log out/i }).click();
    await expect(page).toHaveURL(/\/refined\/signin/);
    await page.goto(`/refined/workspace?post=${encodeURIComponent(contentItemId)}`);
    await expect(page).toHaveURL(/\/refined\/signin/);
  });
});

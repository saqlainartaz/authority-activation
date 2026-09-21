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
      await expect(page.getByText('Welcome, Sarah Whitfield. A few answers will help shape your Business DNA.')).toBeVisible();
      await page.getByLabel('Tell us about what you or your business does—in your own words.').fill('I run a leadership consultancy that helps founders build teams that make decisions without them.');
      await page.getByRole('button', { name: 'Next' }).click();
      await page.getByLabel('Who do you most want your work to reach or help?').fill('Founders whose growing businesses still depend on every decision reaching them.');
      await page.getByRole('button', { name: 'Next' }).click();
      await page.getByLabel('What do people usually come to you for, or what do you most want to be known for?').fill('Helping founders delegate decisions without losing standards or control.');
      await page.getByRole('button', { name: 'Next' }).click();
      // Optional differentiator: the ordinary Next control advances blank.
      await page.getByRole('button', { name: 'Next' }).click();
      // A custom single choice stays on the packet until its real text is supplied.
      await page.getByText('Something else, I will type it', { exact: true }).click();
      await expect(page.getByLabel('Your own answer')).toBeVisible();
      await page.getByLabel('Your own answer').fill('Turn proven experience into useful public ideas.');
      await page.getByRole('button', { name: 'Next' }).click();
      // Optional problem/goal stays empty.
      await page.getByRole('button', { name: 'Next' }).click();
      await page.getByLabel('What questions, doubts or misunderstandings come up most often about your work?').fill('How can I delegate without quality dropping?');
      await page.getByRole('button', { name: 'Next' }).click();
      await page.getByLabel('What examples, results, experiences or stories best show the value of what you do?').fill('The last cohort saved about eleven hours a week each inside the first month.');
      await page.getByRole('button', { name: 'Next' }).click();
      // An ordinary tone choice auto-advances to review.
      await page.getByText('Warm and conversational.', { exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Does this sound right?' })).toBeVisible();
      await expect(page.getByText('Not added yet')).toHaveCount(2);
      await page.screenshot({ path: '../docs/integration/screenshots/onboarding-business-dna-review-desktop.png', fullPage: true });
      await page.getByRole('button', { name: 'Open my workspace' }).click();
      await expect(page).toHaveURL(/\/refined\/workspace/);
    }
    await page.goto('/refined/workspace');
    await expect(page).toHaveURL(/\/refined\/workspace/);
    await expect(page.getByPlaceholder(/Tell it what happened/)).toBeVisible();
  });

  await test.step('Business DNA is persisted, editable, cancellable, and failure-safe', async () => {
    await page.goto('/refined/profile');
    await expect(page.getByText('Sarah Whitfield')).toBeVisible();
    await expect(page.getByText('I run a leadership consultancy that helps founders build teams that make decisions without them.')).toBeVisible();
    await page.screenshot({ path: '../docs/integration/screenshots/business-dna-connected-desktop.png', fullPage: true });

    const identity = page.getByRole('heading', { name: 'Identity' }).locator('..').locator('..');
    await identity.getByRole('button', { name: 'Edit' }).click();
    const overview = page.getByLabel('About you');
    await overview.fill('This cancelled edit must never be persisted.');
    await identity.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('This cancelled edit must never be persisted.')).toHaveCount(0);

    const credibility = page.getByRole('heading', { name: 'What makes it credible' }).locator('..').locator('..');
    await credibility.getByRole('button', { name: 'Edit' }).click();
    const approach = page.getByLabel('What makes you different');
    await approach.fill('I combine cohort evidence with practical delegation systems.');
    let failOnce = true;
    await page.route('**/api/client/onboarding', async route => {
      if (route.request().method() === 'PUT' && failOnce) {
        failOnce = false;
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Synthetic profile outage."}' });
        return;
      }
      await route.continue();
    });
    await credibility.getByRole('button', { name: /Save/ }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Synthetic profile outage' })).toBeVisible();
    await expect(approach).toHaveValue('I combine cohort evidence with practical delegation systems.');
    await credibility.getByRole('button', { name: /Save/ }).click();
    await expect(page.getByText('I combine cohort evidence with practical delegation systems.')).toBeVisible();
    await page.unroute('**/api/client/onboarding');
    await page.reload();
    await expect(page.getByText('I combine cohort evidence with practical delegation systems.')).toBeVisible();
  });

  await test.step('Train Your AI reviews authoritative provisional atoms', async () => {
    await page.goto('/refined/train?tab=questions');
    const waiting = page.getByText(/\d+ waiting/).first();
    await expect(waiting).toBeVisible();
    const before = Number((await waiting.textContent())?.match(/\d+/)?.[0]);
    expect(before).toBeGreaterThan(1);
    const firstText = await page.locator('.rf-question-atom').textContent();
    expect(firstText?.trim().length).toBeGreaterThan(0);
    const atomEnvelope = await page.evaluate(async () => fetch('/api/client/atoms').then(response => response.json()));
    const firstAtom = atomEnvelope.atoms.filter((atom: { status: string }) => atom.status === 'provisional')[0];
    await page.getByRole('button', { name: /Confirm/ }).click();
    await expect(page.getByText(`${before - 1} waiting`)).toBeVisible();
    const replay = await page.evaluate(async ({ atomId }) => {
      const response = await fetch(`/api/client/atoms/${encodeURIComponent(atomId)}/decision`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'confirm', idempotency_key: crypto.randomUUID() }),
      });
      return { status: response.status, body: await response.json() };
    }, { atomId: firstAtom.atom_id });
    expect(replay.status).toBe(200);
    expect(replay.body.unchanged).toBe(true);
    await page.reload();
    await expect(page.getByText(`${before - 1} waiting`)).toBeVisible();

    const retainedText = await page.locator('.rf-question-atom').textContent();
    await page.route('**/api/client/atoms/*/decision', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Synthetic review outage."}' }), { times: 1 });
    await page.getByRole('button', { name: /Confirm/ }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Synthetic review outage' })).toBeVisible();
    await expect(page.locator('.rf-question-atom')).toHaveText(retainedText || '');
    await expect(page.getByText(`${before - 1} waiting`)).toBeVisible();
    await page.getByRole('button', { name: /Confirm/ }).click();
    await expect(page.getByText(`${before - 2} waiting`)).toBeVisible();
    await page.screenshot({ path: '../docs/integration/screenshots/train-connected-atom-review-desktop.png', fullPage: true });
    await expect(page.getByRole('tab', { name: 'Knowledge' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Guidance' })).toBeVisible();
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

  await test.step('the conversational agent receives Business DNA and a client can start a fresh session', async () => {
    await page.goto('/refined/workspace');
    await page.getByPlaceholder(/Tell it what happened/).fill('Who am I?');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('.rf-agent-message').filter({ hasText: 'Sarah Whitfield' })).toContainText('Leadership consultant', { timeout: 30_000 });
    await expect(page.locator('.rf-agent-message').filter({ hasText: 'Sarah Whitfield' })).toContainText('leadership consultancy');
    await page.getByRole('button', { name: 'New post' }).click();
    await page.getByRole('button', { name: 'End and start new' }).click();
    await expect(page.getByRole('heading', { name: 'What are you working on today?' })).toBeVisible();
  });

  let contentItemId = '';
  await test.step('grounded streaming, citations, edit versions, and persistence', async () => {
    await page.goto('/refined/workspace');
    await page.getByPlaceholder(/Tell it what happened/).fill('Choose the strongest useful post from my knowledge.');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('button', { name: 'Keep as draft' })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole('complementary')).toContainText('A useful detail from your source');
    await expect(page.getByRole('button', { name: 'Show evidence' })).toBeEnabled();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Keep as draft' })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole('complementary')).toContainText('A useful detail from your source');
    await expect(page.getByRole('button', { name: 'Show evidence' })).toBeEnabled();
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
    contentItemId = sessionEvidence.session.content_item_id;
    expect(contentItemId).toBeTruthy();

    const firstParagraph = page.getByLabel('Draft paragraph. Press Enter to edit.').first();
    await firstParagraph.press('Enter');
    const editor = page.getByLabel('Edit paragraph').first();
    await editor.fill(`${await editor.inputValue()}\n\nEdited safely before saving.`);
    await editor.blur();
    await page.getByRole('button', { name: 'Keep as draft' }).click();
    await expect(page.getByPlaceholder(/Tell it what happened/)).toBeVisible();

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
    const agentRoute = '**/api/client/chat/sessions/*/agent';
    let markRequestStarted!: () => void;
    let releaseRequest!: () => void;
    const requestStarted = new Promise<void>(resolve => { markRequestStarted = resolve; });
    const requestGate = new Promise<void>(resolve => { releaseRequest = resolve; });
    await page.route(agentRoute, async route => {
      markRequestStarted();
      await requestGate;
      await route.abort('aborted').catch(() => undefined);
    });
    await page.goto('/refined/workspace');
    await page.getByPlaceholder(/Tell it what happened/).fill('Start another grounded draft, then stop showing it.');
    await page.getByRole('button', { name: 'Send' }).click();
    await requestStarted;
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByText(/no server-side turn-cancellation endpoint/i)).toBeVisible();
    releaseRequest();
    await page.unroute(agentRoute);
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

import { expect, test, type Page } from '@playwright/test';

import { deletingStatus, knowledgeStatus, legacyStatus } from '../src/lib/knowledge-status';
import { applySourceOverview, type SourceOverviewEntry } from '../src/lib/source-overview';
import { LEGACY_OFFICE_COPY, TOO_LARGE_COPY } from '../src/lib/upload-contract';

// Cycle 5 P7.2 + P7.3: the Knowledge list on the rehaul engine, against a stubbed BFF,
// at a phone and a desktop width (spec §7.1-7.3; A17, A19, A20, A21, A35):
// name search and Clear search, the source popup, Use this source off and on (pending,
// then the enforced state; the intent key and revision sent), the inline question
// answered through the question store, and a mixed batch upload where the good files
// upload and each refused file gets its own line. P8.3: a signed-in member deletes a
// file (asked first, the key and revision sent), it reads Deleting, then it goes with
// the one-time notice; a link session is never offered Delete file.
//
// The stubbed BFF answers with the same helpers the real one uses (`knowledgeStatus`,
// `applySourceOverview`); `tests/client/source-routes.test.ts` checks the real routes.
// Run it like `e2e/knowledge-status.spec.ts`:
//   node e2e/support/fake-me-backend.mjs 8199
//   ENGINE_URL=http://127.0.0.1:8199 ENGINE_SERVICE_KEY=e2e NEXT_PUBLIC_AUTHORITY_DEMO=0 npx next dev --port 3101
//   AA_E2E_BASE_URL=http://localhost:3101 npx playwright test e2e/knowledge-sources.spec.ts

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MB = 1024 * 1024;

const MIXED = '11111111-1111-4111-8111-111111111111';
const PRICING = '22222222-2222-4222-8222-222222222222';
const CALL = '33333333-3333-4333-8333-333333333333';
const available = knowledgeStatus({ state: 'ready' }, { state: 'active', yield: 'evidence' }, []);
const base = (id: string, filename: string) => ({
  id, client_id: 'c1', source_type: filename, source_authority: 'CLIENT', sha256: '', status: legacyStatus(available) as string,
  pipeline_version: 2, created_at: '2026-10-06T09:00:00Z', knowledge: available, filename, closed: false,
});

const noOverflow = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

async function stubKnowledge(page: Page, baseURL: string, { signedIn = false }: { signedIn?: boolean } = {}) {
  await page.context().addCookies([{ name: 'aa_client_token', value: 'synthetic-local-token', url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
  await page.route('**/api/client/**', route => route.fulfill(json({ error: 'Not stubbed.' }, 404)));
  await page.route('**/api/client/content-items', route => route.fulfill(json({ items: [] })));
  await page.route('**/api/client/calendar', route => route.fulfill(json({ slots: [] })));
  await page.route('**/api/client/social/**', route => route.fulfill(json([])));
  await page.route('**/api/client/profile', route => route.fulfill(json({ identity: { display_name: 'Amina Yusuf', profession: 'Physiotherapist', client_name: 'ISTV', timezone: 'Europe/London' }, document_count: 3 })));
  await page.route('**/api/client/engine', route => route.fulfill(json({ knowledge_engine: 'ke', signed_in: signedIn })));
  await page.route('**/api/client/atoms', route => route.fulfill(json({ client_id: 'c', atoms: [], atom_counts: {}, generated_at: '2026-10-08T12:00:00Z' })));

  const state = {
    // P8.3: how many list reads still show a deleted file as Deleting before its purge finishes.
    purgeReads: 0,
    documents: [base(MIXED, 'Acme and Beta joint brief.pdf'), base(PRICING, 'pricing 2026.docx'), base(CALL, 'Discovery call.vtt')],
    overview: [
      { document_id: MIXED, labels: [{ label: 'Acme Physio', kind: 'organization' }, { label: 'Beta Fitness', kind: 'brand' }],
        use: { state: 'on', requested: null, revision: 2 } },
      { document_id: PRICING, labels: [{ label: 'Acme Physio', kind: 'organization' }], use: { state: 'on', requested: null, revision: 0 } },
    ] as SourceOverviewEntry[],
    switches: [] as Array<Record<string, unknown>>,
    // How many reads of a pending change answer pending before it is enforced.
    pendingReads: 0,
    questions: [{
      id: 'q-price', packet_id: null, origin: 'event', subject_ref: 'conflict:offering.terms', issue_ref: 'c-1', knowledge_revision: 'k',
      control: 'single', prompt: 'Which membership price is current?', why: 'This file and another one disagree.',
      options: [{ id: 'k0', label: 'USD 49 a month' }, { id: 'k1', label: 'USD 59 a month' }], allow_alternative: false,
      allow_uncertain: true, evidence_refs: [{ document_id: MIXED }], status: 'open', created_at: '2026-10-08T12:00:00Z', pending_answer: null,
    }] as Array<Record<string, unknown>>,
    surfaces: [] as string[],
    answers: [] as Array<Record<string, unknown>>,
    uploads: [] as string[],
  };
  const entry = (id: string) => state.overview.find(item => item.document_id === id);
  const listed = () => applySourceOverview(state.documents, state.overview);
  const settle = () => {
    for (const item of state.overview) {
      if (item.use.state === 'pending' && state.pendingReads-- <= 0) item.use = { state: item.use.requested ?? 'on', requested: null, revision: item.use.revision };
    }
  };

  await page.route(url => url.pathname === '/api/client/documents', route => {
    if (route.request().method() === 'POST') {
      // The browser only sends what the D08 contract accepts; record what arrived.
      const name = /filename="([^"]+)"/.exec(route.request().postDataBuffer()?.toString('latin1') ?? '')?.[1] ?? '?';
      state.uploads.push(name);
      const document = { ...base(`99999999-0000-4000-8000-00000000000${state.uploads.length}`, name),
        knowledge: knowledgeStatus({ state: 'received' }, null, []), status: 'uploaded' };
      state.documents.unshift(document);
      return route.fulfill(json(document, 201));
    }
    // A deleted file stays (Deleting) until its purge finishes, then leaves the list.
    if (state.documents.some(document => (document as { deleting?: boolean }).deleting) && state.purgeReads-- <= 0) {
      state.documents = state.documents.filter(document => !(document as { deleting?: boolean }).deleting);
    }
    return route.fulfill(json(listed()));
  });
  await page.route(url => /^\/api\/client\/documents\/[^/]+$/.test(url.pathname), route => {
    const id = route.request().url().split('/').pop()!;
    return route.fulfill(json(listed().find(document => document.id === id) ?? { error: 'Not found.' }));
  });
  await page.route(url => /^\/api\/client\/sources\/[^/]+\/lifecycle$/.test(url.pathname), route => {
    const id = route.request().url().split('/').slice(-2)[0];
    const current = entry(id) ?? { document_id: id, labels: [], use: { state: 'on' as const, requested: null, revision: 0 } };
    if (!entry(id)) state.overview.push(current);
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { intent_key: string; operation: string; expected_lifecycle_revision: number };
      state.switches.push(body);
      if (body.expected_lifecycle_revision !== current.use.revision) {
        return route.fulfill(json({ error: 'This source changed since you opened it. Its current setting is shown.', detail: 'stale_source_state' }, 409));
      }
      const revision = current.use.revision + 1;
      if (body.operation === 'delete') {
        const index = state.documents.findIndex(document => document.id === id);
        state.documents[index] = { ...state.documents[index], closed: true, knowledge: deletingStatus(), deleting: true } as never;
        state.purgeReads = 1;
        return route.fulfill(json({ request: { id: `r${revision}`, operation: 'delete', lifecycle_revision: revision,
          request_state: 'complete', outcome: { deleted: true } }, source: { document_id: id, state: 'deleting', requested: null, revision },
          replayed: false }, 201));
      }
      current.use = { state: 'pending', requested: body.operation === 'disable' ? 'off' : 'on', revision };
      state.pendingReads = 1;
      return route.fulfill(json({ request: { id: `r${revision}`, operation: body.operation, lifecycle_revision: revision,
        request_state: 'pending', outcome: null }, source: { document_id: id, ...current.use }, replayed: false }, 201));
    }
    settle();
    return route.fulfill(json({ document_id: id, ...current.use }));
  });
  await page.route(url => url.pathname === '/api/client/questions', route => {
    const surface = new URL(route.request().url()).searchParams.get('surface') ?? '';
    state.surfaces.push(surface);
    const id = surface.startsWith('source:') ? surface.slice('source:'.length) : null;
    const shown = state.questions.filter(question => !id || (question.evidence_refs as Array<{ document_id: string }>).some(ref => ref.document_id === id));
    return route.fulfill(json({ surface, questions: shown }));
  });
  await page.route('**/api/client/questions/*/answers', route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    state.answers.push(body);
    state.questions = [];
    return route.fulfill(json({ id: 'a-1', question_id: 'q-price', disposition: body.disposition, payload: body.payload ?? {}, effects: [],
      application_note: null, created_at: '2026-10-08T12:00:00Z', replayed: false, application_state: 'applied',
      question_status: 'answered', what_changed: 'Membership is USD 59 a month.' }, 201));
  });
  await page.route('**/api/client/questions/answers/a-1', route => route.fulfill(json({
    id: 'a-1', question_id: 'q-price', disposition: 'answer', payload: { option: 'k1' }, application_state: 'applied', effects: [],
    application_note: null, what_changed: 'Membership is USD 59 a month.', question_status: 'answered', created_at: '2026-10-08T12:00:00Z', replayed: true,
  })));
  await page.goto('/refined/train?tab=knowledge');
  return state;
}

const rows = (page: Page) => page.locator('.rf-uploaded-source');

for (const [label, width, height] of [['phone', 390, 844], ['desktop', 1280, 900]] as const) {
  test(`${label}: search, the popup, Use this source off and on, and the inline question answered`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height });
    const stub = await stubKnowledge(page, baseURL!);

    // A17: name, type and date, status and labels; search by name; Clear search restores.
    await expect(rows(page)).toHaveCount(3);
    const mixed = rows(page).filter({ hasText: 'Acme and Beta joint brief.pdf' });
    await expect(mixed).toContainText('PDF · 6 Oct 2026');
    await expect(mixed.locator('.rf-source-label')).toHaveText(['Acme Physio', 'Beta Fitness']);
    await expect(mixed.locator('.rf-source-meta')).toHaveText('Available');
    const search = page.getByRole('searchbox', { name: 'Search sources by name' });
    await search.fill('PRICING');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page)).toContainText('pricing 2026.docx');
    await page.locator('.rf-source-search').getByRole('button', { name: 'Clear search' }).click();
    await expect(rows(page)).toHaveCount(3);
    await search.fill('invoice');
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator('.rf-source-empty')).toContainText('No sources match “invoice”');
    await noOverflow(page);
    await page.locator('.rf-source-empty').getByRole('button', { name: 'Clear search' }).click();
    await expect(rows(page)).toHaveCount(3);
    await search.fill('joint');
    await page.screenshot({ path: `test-results/e2e/knowledge-sources-search-${label}.png`, fullPage: true });

    // A20: the popup, with identity, status, the switch and the inline question.
    await rows(page).filter({ hasText: 'joint brief' }).locator('.rf-source-open').click();
    const popup = page.getByRole('dialog');
    await expect(popup).toHaveCount(1);
    await expect(popup.getByRole('heading', { name: 'Acme and Beta joint brief.pdf' })).toBeVisible();
    await expect(popup).toContainText('Available');
    await expect(popup).toContainText('Acme Physio');
    const toggle = popup.getByRole('switch', { name: 'Use this source' });
    await expect(toggle).toBeEnabled();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(popup.getByRole('heading', { name: 'Which membership price is current?' })).toBeVisible();
    expect(stub.surfaces).toContain(`source:${MIXED}`);
    await expect(popup.getByRole('button', { name: /Download|Remove|Reprocess|Delete/ })).toHaveCount(0);
    await noOverflow(page);
    await page.screenshot({ path: `test-results/e2e/knowledge-sources-popup-${label}.png` });

    // A21: off -- the key and the revision read are sent, Pending shows, then Off; the row reads Not in use.
    await toggle.click();
    await expect(popup.locator('.rf-source-use [role="status"]')).toHaveText('Pending · turning off');
    await expect(popup.locator('.rf-source-use [role="status"]')).toHaveText('Off');
    await expect(popup).toContainText('Not in use');
    expect(stub.switches[0]).toMatchObject({ operation: 'disable', expected_lifecycle_revision: 2 });
    expect(UUID.test(String(stub.switches[0].intent_key))).toBe(true);
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await page.screenshot({ path: `test-results/e2e/knowledge-sources-off-${label}.png` });

    // ... and on again, against the newer revision, with a new key.
    await toggle.click();
    await expect(popup.locator('.rf-source-use [role="status"]')).toHaveText('On');
    expect(stub.switches[1]).toMatchObject({ operation: 're_enable', expected_lifecycle_revision: 3 });
    expect(stub.switches[1].intent_key).not.toBe(stub.switches[0].intent_key);
    await expect(popup).toContainText('Available');

    // A20: the inline question answers through the question store, with a browser key.
    await popup.getByText('USD 59 a month').click();
    await popup.getByRole('button', { name: /Save answer/ }).click();
    await expect(popup.getByRole('status').filter({ hasText: 'What changed' })).toContainText('Membership is USD 59 a month.');
    expect(stub.answers).toHaveLength(1);
    expect(stub.answers[0]).toMatchObject({ disposition: 'answer', payload: { option: 'k1' } });
    expect(UUID.test(String(stub.answers[0].idempotency_key))).toBe(true);

    // One dialog throughout; closing returns to the same search.
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await popup.getByRole('button', { name: 'Close' }).first().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(search).toHaveValue('joint');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).locator('.rf-source-meta')).toHaveText('Available');
  });

  test(`${label}: a mixed batch keeps its good files, and each refused file says why (A19)`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height });
    const stub = await stubKnowledge(page, baseURL!);
    await expect(rows(page)).toHaveCount(3);

    await page.getByRole('button', { name: 'Add files' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('PDF, DOCX, PPTX, XLSX, TXT, MD, CSV, SRT, VTT, PNG or JPG files.');
    await expect(dialog).toContainText('Up to about 13 pages (or a 40-minute transcript) per file, and up to 20 MB.');
    await expect(dialog).not.toContainText('Up to 20 MB each');
    const accept = await page.getByLabel('Choose knowledge files').getAttribute('accept');
    expect(accept?.split(',')).not.toContain('.doc');
    await expect(page.getByRole('button', { name: 'Choose files' })).toBeEnabled();
    await page.getByLabel('Choose knowledge files').setInputFiles([
      { name: 'good.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 synthetic') },
      { name: 'old.doc', mimeType: 'application/msword', buffer: Buffer.from('legacy') },
      { name: 'huge.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(21 * MB, 1) },
      { name: 'good.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('PK synthetic') },
    ]);

    const alert = dialog.getByRole('alert');
    await expect(alert).toHaveText(`old.doc: ${LEGACY_OFFICE_COPY}\nhuge.pdf: ${TOO_LARGE_COPY}`);
    await expect(alert).toContainText('Save it as .docx / .xlsx / .pptx and upload again.');
    expect(stub.uploads).toEqual(['good.pdf', 'good.docx']);
    await noOverflow(page);
    await page.screenshot({ path: `test-results/e2e/knowledge-sources-batch-${label}.png` });
    await page.keyboard.press('Escape');
    await expect(rows(page)).toHaveCount(5);
    await expect(rows(page).filter({ hasText: 'good.docx' }).locator('.rf-source-meta')).toHaveText('Processing');
    await expect(rows(page).filter({ hasText: 'old.doc' })).toHaveCount(0);
  });
}

for (const [label, width, height] of [['phone', 390, 844], ['desktop', 1280, 900]] as const) {
  test(`${label}: a signed-in member deletes a file: asked first, Deleting, then gone with a notice (P8.3)`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height });
    const stub = await stubKnowledge(page, baseURL!, { signedIn: true });
    await expect(rows(page)).toHaveCount(3);

    await rows(page).filter({ hasText: 'pricing 2026.docx' }).locator('.rf-source-open').click();
    const popup = page.getByRole('dialog');
    await expect(popup.getByRole('switch', { name: 'Use this source' })).toBeEnabled();
    await popup.getByRole('button', { name: 'Delete file' }).click();

    // Asked first, in the same dialog: what goes, what stays, final, and the upload still counts.
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(popup.getByRole('heading', { name: 'Delete this file?' })).toBeVisible();
    await expect(popup).toContainText('“pricing 2026.docx” and its earlier versions, and everything learned only from them, will be removed from your workspace.');
    await expect(popup).toContainText("Saved posts stay as they are. This can't be undone, and the upload still counts toward this month's allowance.");
    expect(stub.switches).toHaveLength(0);
    await noOverflow(page);
    await page.screenshot({ path: `test-results/e2e/knowledge-sources-delete-confirm-${label}.png` });
    await popup.getByRole('button', { name: 'Delete file' }).click();

    // Sent once, with a browser key and the revision read; the row reads Deleting.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(stub.switches).toHaveLength(1);
    expect(stub.switches[0]).toMatchObject({ operation: 'delete', expected_lifecycle_revision: 0 });
    expect(UUID.test(String(stub.switches[0].intent_key))).toBe(true);
    const row = rows(page).filter({ hasText: 'pricing 2026.docx' });
    await expect(row.locator('.rf-source-meta')).toHaveText('Deleting');
    await page.screenshot({ path: `test-results/e2e/knowledge-sources-deleting-${label}.png` });

    // The purge finishes: the row goes, and the notice shows once.
    await expect(rows(page)).toHaveCount(2);
    const notice = page.locator('.rf-knowledge-deleted');
    await expect(notice).toContainText('Deleted from your workspace now.');
    await noOverflow(page);
    await page.screenshot({ path: `test-results/e2e/knowledge-sources-deleted-${label}.png` });
    await notice.getByRole('button', { name: 'Dismiss' }).click();
    await expect(notice).toHaveCount(0);
  });
}

test('A35: no files yet offers Add files', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().addCookies([{ name: 'aa_client_token', value: 'synthetic-local-token', url: baseURL!, httpOnly: true, sameSite: 'Lax' }]);
  await page.route('**/api/client/**', route => route.fulfill(json({ error: 'Not stubbed.' }, 404)));
  await page.route('**/api/client/content-items', route => route.fulfill(json({ items: [] })));
  await page.route('**/api/client/calendar', route => route.fulfill(json({ slots: [] })));
  await page.route('**/api/client/social/**', route => route.fulfill(json([])));
  await page.route('**/api/client/profile', route => route.fulfill(json({ identity: { display_name: 'Amina Yusuf', profession: 'Physiotherapist', client_name: 'ISTV', timezone: 'Europe/London' }, document_count: 0 })));
  await page.route('**/api/client/engine', route => route.fulfill(json({ knowledge_engine: 'ke' })));
  await page.route(url => url.pathname === '/api/client/documents', route => route.fulfill(json([])));
  await page.goto('/refined/train?tab=knowledge');

  const empty = page.locator('.rf-source-empty');
  await expect(empty).toContainText('No files yet');
  await empty.getByRole('button', { name: 'Add files' }).click();
  await expect(page.getByRole('dialog')).toContainText('Choose your files');
  await noOverflow(page);
});

import { expect, test, type Page } from '@playwright/test';

// Cycle 5 P6.8 (review I-4, I-3): "What would you like us to know?" in Train Your
// AI on the new engine, against a stubbed BFF, at a phone and a desktop width.
// - a note is one item of the kind the client chooses (2026-10-08): "Something
//   about me or my business" (the default) adds a fact; "How I want my posts
//   written" proposes one guidance line; "Add to my guidance" opens the guidance
//   with the line appended, and only the client's Save writes it (the PUT goes
//   through the guidance route, compare-and-set). No question is ever created;
// - an answer saved but not applied keeps its question with "We couldn't save
//   that yet — try again", and Try again re-sends the SAME key.
//
// Run as `questions-onboarding.spec.ts` is run:
//   node e2e/support/fake-me-backend.mjs 8199
//   ENGINE_URL=http://127.0.0.1:8199 ENGINE_SERVICE_KEY=e2e NEXT_PUBLIC_AUTHORITY_DEMO=0 npx next dev --port 3101
//   AA_E2E_BASE_URL=http://localhost:3101 npx playwright test e2e/contributions.spec.ts

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINE = 'Never name Sam.';

const noOverflow = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

const question = (id: string, prompt: string, extra: Record<string, unknown> = {}) => ({
  id, packet_id: null, origin: 'monthly', subject_ref: `missing:${id}:account`, issue_ref: null, knowledge_revision: 'missing',
  control: 'long', prompt, why: 'So posts reach the right people.', options: [], allow_alternative: false,
  allow_uncertain: true, evidence_refs: [], status: 'open', created_at: '2026-10-08T12:00:00Z', pending_answer: null, ...extra,
});

async function stubTraining(page: Page, baseURL: string) {
  await page.context().addCookies([{ name: 'aa_client_token', value: 'synthetic-local-token', url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
  await page.route('**/api/client/**', route => route.fulfill(json({ error: 'Not stubbed.' }, 404)));
  await page.route('**/api/client/engine', route => route.fulfill(json({ knowledge_engine: 'ke' })));
  await page.route('**/api/client/content-items', route => route.fulfill(json({ items: [] })));
  await page.route('**/api/client/calendar', route => route.fulfill(json({ slots: [] })));
  await page.route('**/api/client/social/**', route => route.fulfill(json([])));
  await page.route('**/api/client/profile', route => route.fulfill(json({ identity: { display_name: 'Amina Yusuf', profession: 'Physiotherapist', client_name: 'ISTV', timezone: 'Europe/London' }, document_count: 2 })));
  await page.route('**/api/client/atoms', route => route.fulfill(json({ client_id: 'c', atoms: [], atom_counts: {}, generated_at: '2026-10-08T12:00:00Z' })));
  const state = {
    questions: [] as Array<Record<string, unknown>>,
    contributed: [] as Array<{ intent_key: string; text: string; kind: string }>,
    proposed: false,
    guidance: { guideline_id: 'g-1', revision: 3, text: 'Write warmly.' } as { guideline_id: string; revision: number; text: string },
    saves: [] as Array<Record<string, unknown>>,
    answers: [] as Array<{ idempotency_key: string; disposition: string; payload?: unknown }>,
    applyOnRetry: false,
  };
  await page.route(url => url.pathname === '/api/client/questions', route =>
    route.fulfill(json({ surface: 'questions', questions: state.questions })));
  await page.route('**/api/client/contributions/proposals', route => route.fulfill(json({
    proposals: state.proposed && !state.guidance.text.includes(LINE)
      ? [{ instruction: LINE, source: 'contribution', source_id: 'c-1', created_at: '2026-10-08T12:00:00Z' }] : [],
  })));
  await page.route(url => url.pathname === '/api/client/contributions', route => {
    const body = route.request().postDataJSON() as { intent_key: string; text: string; kind: string };
    state.contributed.push(body);
    const writing = body.kind === 'writing';
    if (writing) state.proposed = true;
    const effect = writing
      ? { kind: 'guidance', change: 'proposed', instruction: body.text, summary: 'Suggested a change to your writing guidance. Nothing is saved until you confirm it.' }
      : { kind: 'fact', change: 'added', summary: `Added for ISTV: ${body.text}` };
    return route.fulfill(json({
      id: `c-${state.contributed.length}`, text: body.text, kind: body.kind, application_state: 'applied',
      pending_reason: null, application_note: null, effects: [effect], what_changed: effect.summary,
      created_at: '2026-10-08T12:00:00Z', replayed: false,
    }, 201));
  });
  await page.route('**/api/client/writing-settings**', route => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      state.saves.push(body);
      state.guidance = { guideline_id: 'g-1', revision: state.guidance.revision + 1, text: String(body.text) };
    }
    return route.fulfill(json(state.guidance));
  });
  await page.route('**/api/client/questions/*/answers', route => {
    const body = route.request().postDataJSON() as { idempotency_key: string; disposition: string; payload?: unknown };
    state.answers.push(body);
    const applied = state.applyOnRetry && state.answers.length > 1;
    const reply = { id: 'a-1', question_id: 'aud', disposition: body.disposition, payload: body.payload ?? {}, effects: [],
      application_note: null, created_at: '2026-10-08T12:00:00Z', replayed: state.answers.length > 1,
      application_state: applied ? 'applied' : 'pending', question_status: applied ? 'answered' : 'open',
      what_changed: applied ? 'Added for ISTV: Families in Leeds.' : "Saved. It hasn't been applied yet." };
    if (!applied) {
      state.questions = [question('aud', 'Who does the business serve?', { pending_answer: {
        id: 'a-1', idempotency_key: body.idempotency_key, disposition: body.disposition, payload: body.payload ?? {},
        application_state: 'pending', what_changed: "Saved. It hasn't been applied yet." } })];
    } else {
      state.questions = [];
    }
    return route.fulfill(json(reply, applied ? 200 : 201));
  });
  await page.route('**/api/client/questions/answers/a-1', route => route.fulfill(json({
    id: 'a-1', question_id: 'aud', disposition: 'answer', payload: { text: 'Families in Leeds.' }, application_state: 'applied',
    effects: [{ kind: 'fact', change: 'added', summary: 'Added for ISTV: Families in Leeds.' }], application_note: null,
    what_changed: 'Added for ISTV: Families in Leeds.', question_status: 'answered', created_at: '2026-10-08T12:00:00Z', replayed: true,
  })));
  return state;
}

for (const [label, width, height] of [['phone', 390, 844], ['desktop', 1280, 900]] as const) {
  test(`${label}: a fact note adds a fact, a writing note proposes one line, and the client adds it to guidance`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height });
    const stub = await stubTraining(page, baseURL!);
    await page.goto('/refined/train?tab=questions');

    const box = page.locator('.rf-contribute');
    await expect(box.getByRole('heading', { name: 'What would you like us to know?' })).toBeVisible();
    // The default: something about me or my business.
    await expect(box.getByRole('radio', { name: 'Something about me or my business' })).toBeChecked();
    const note = box.getByRole('textbox', { name: 'What would you like us to know?' });
    await note.fill('Membership is 59 a month.');
    await box.getByRole('button', { name: 'Send' }).click();
    await expect(box.getByRole('status')).toContainText('Added for ISTV: Membership is 59 a month.');
    await expect(note).toHaveValue('');

    // How I want my posts written: one proposed line, never saved automatically.
    await box.getByRole('radio', { name: 'How I want my posts written' }).check();
    await note.fill(LINE);
    await box.getByRole('button', { name: 'Send' }).click();
    const proposals = box.locator('.rf-contribute-proposals');
    expect(stub.contributed.map(sent => [sent.kind, sent.text])).toEqual([['fact', 'Membership is 59 a month.'], ['writing', LINE]]);
    await expect(page.locator('.rf-qcard')).toHaveCount(0); // no question is ever created
    await expect(proposals).toContainText(LINE);
    expect(stub.saves).toEqual([]); // nothing is saved automatically
    await noOverflow(page);
    await page.screenshot({ path: `test-results/e2e/contribution-${label}.png` });

    // "Add to my guidance": the guidance with the line appended; only Save writes it.
    await proposals.getByRole('button', { name: 'Add to my guidance' }).click();
    const editor = page.getByRole('dialog');
    await expect(editor.getByRole('textbox', { name: 'Guidance' })).toHaveValue(`Write warmly.\n${LINE}`);
    expect(stub.saves).toEqual([]);
    await editor.getByRole('button', { name: 'Save guidance' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(proposals).toHaveCount(0);
    expect(stub.saves).toEqual([{ text: `Write warmly.\n${LINE}`, expected_revision: 3, expected_guideline_id: 'g-1' }]);
    expect(stub.contributed).toHaveLength(2);
    expect(UUID.test(stub.contributed[0].intent_key)).toBe(true);
    await noOverflow(page);
  });

  test(`${label}: an answer not applied yet keeps its question, and Try again re-sends the same key`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height });
    const stub = await stubTraining(page, baseURL!);
    stub.questions = [question('aud', 'Who does the business serve?')];
    await page.goto('/refined/train?tab=questions');

    const card = page.locator('.rf-qcard');
    await card.getByRole('textbox').fill('Families in Leeds.');
    await card.getByRole('button', { name: 'Save answer' }).click();

    await expect(card.getByText('We couldn’t save that yet — try again').or(card.getByText("We couldn't save that yet — try again"))).toBeVisible();
    await expect(card.getByRole('button', { name: 'Save answer' })).toHaveCount(0);
    await noOverflow(page);
    stub.applyOnRetry = true;
    await card.getByRole('button', { name: 'Try again' }).click();

    await expect(page.getByRole('status').filter({ hasText: 'What changed' })).toContainText('Added for ISTV: Families in Leeds.');
    await expect(page.getByText('Nothing to clarify right now')).toBeVisible();
    expect(stub.answers.map(answer => answer.idempotency_key)).toEqual([stub.answers[0].idempotency_key, stub.answers[0].idempotency_key]);
    expect(stub.answers[1]).toEqual({ idempotency_key: stub.answers[0].idempotency_key, disposition: 'answer', payload: { text: 'Families in Leeds.' } });
  });
}

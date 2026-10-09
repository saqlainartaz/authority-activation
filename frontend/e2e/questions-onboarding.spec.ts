import { expect, test, type Page, type Route } from '@playwright/test';

// Cycle 5 P6.5/P6.6: onboarding on the new engine through to complete, and
// Train Your AI -> Questions answering one question and showing what changed,
// against a stubbed BFF, at a phone width and a desktop width (spec 4-5; A05-A08,
// A35). Every `/api/client/*` call is answered here; the fake `/v1/me` serves the
// proxy gate (the `synthetic-onboarding-token` client has not finished onboarding).
//
// Run as `usage.spec.ts` is run:
//   node e2e/support/fake-me-backend.mjs 8199
//   ENGINE_URL=http://127.0.0.1:8199 ENGINE_SERVICE_KEY=e2e NEXT_PUBLIC_AUTHORITY_DEMO=0 npx next dev --port 3101
//   AA_E2E_BASE_URL=http://localhost:3101 npx playwright test e2e/questions-onboarding.spec.ts

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Answer = { questionId: string; body: { idempotency_key: string; disposition: string; payload?: Record<string, unknown> } };

const question = (id: string, prompt: string, extra: Record<string, unknown> = {}) => ({
  id, packet_id: 'p-1', origin: 'onboarding', subject_ref: `missing:${id}`, issue_ref: null, knowledge_revision: 'k1',
  control: 'short', prompt, why: 'So your posts describe your work the way you do.', options: [],
  allow_alternative: false, allow_uncertain: true, evidence_refs: [], status: 'open', created_at: '2026-10-08T12:00:00Z',
  ...extra,
});

const noOverflow = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

async function stubBase(page: Page, baseURL: string, token: string, engine: 'ke' | 'm1' = 'ke') {
  await page.context().addCookies([{ name: 'aa_client_token', value: token, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
  // Registered first, so the specific stubs below take precedence over it.
  await page.route('**/api/client/**', route => route.fulfill(json({ error: 'Not stubbed.' }, 404)));
  await page.route('**/api/client/engine', route => route.fulfill(json({ knowledge_engine: engine })));
}

async function stubOnboarding(page: Page, baseURL: string) {
  await stubBase(page, baseURL, 'synthetic-onboarding-token');
  const packet = [
    question('services', 'What do you offer, in your own words?', { control: 'single', options: [{ id: 'physio', label: 'Physiotherapy' }, { id: 'coaching', label: 'Running coaching' }], allow_alternative: true }),
    question('location', 'Where are you based?'),
    question('audience', 'Who do you mostly work with?', { control: 'long' }),
  ];
  const answered: Answer[] = [];
  let generating = true;
  await page.route('**/api/client/onboarding/state', route => {
    const remaining = packet.length - answered.length;
    return route.fulfill(json(generating
      ? { state: 'generating', packet_id: 'p-1', total: 0, remaining: 0 }
      : { state: remaining ? 'ready' : 'complete', packet_id: 'p-1', total: packet.length, remaining }));
  });
  await page.route(url => url.pathname === '/api/client/questions' && url.searchParams.get('surface') === 'onboarding', route =>
    route.fulfill(json({ surface: 'onboarding', questions: packet.slice(answered.length) })));
  await page.route('**/api/client/questions/*/answers', async (route: Route) => {
    const questionId = route.request().url().split('/questions/')[1].split('/')[0];
    const body = route.request().postDataJSON() as Answer['body'];
    answered.push({ questionId, body });
    return route.fulfill(json({ id: `a-${answered.length}`, question_id: questionId, disposition: body.disposition, payload: body.payload ?? {}, application_state: 'no_change', effects: [], application_note: null, what_changed: 'Nothing was changed.', question_status: 'answered', created_at: '2026-10-08T12:00:00Z', replayed: false }, 201));
  });
  return { answered, ready: () => { generating = false; } };
}

async function stubTraining(page: Page, baseURL: string) {
  await stubBase(page, baseURL, 'synthetic-local-token');
  await page.route('**/api/client/content-items', route => route.fulfill(json({ items: [] })));
  await page.route('**/api/client/calendar', route => route.fulfill(json({ slots: [] })));
  await page.route('**/api/client/social/**', route => route.fulfill(json([])));
  await page.route('**/api/client/profile', route => route.fulfill(json({ identity: { display_name: 'Amina Yusuf', profession: 'Physiotherapist', client_name: 'ISTV', timezone: 'Europe/London' }, document_count: 2 })));
  await page.route('**/api/client/writing-settings**', route => route.fulfill(json(null)));
  await page.route('**/api/client/atoms', route => route.fulfill(json({ client_id: 'c', atoms: [], atom_counts: {}, generated_at: '2026-10-08T12:00:00Z' })));
  // The production conflict card (P6.8, review M-8): one option per contender, then
  // "Both are right" and "I can't say", and no "Not sure".
  const conflict = question('price', 'Which membership price is current?', {
    origin: 'monthly', packet_id: 'm-1', control: 'single', allow_uncertain: false,
    options: [{ id: 'k0', label: 'USD 49 a month' }, { id: 'k1', label: 'USD 59 a month' },
      { id: 'both', label: 'Both are right, in different situations' }, { id: 'unsure', label: "I can't say which is right" }],
    why: 'So posts quote the price you charge today.',
  });
  const state = { listReads: 0, failList: true, loseFirstAnswer: true, answered: [] as Answer[], answerReads: 0 };
  await page.route(url => url.pathname === '/api/client/questions' && url.searchParams.get('surface') === 'questions', route => {
    state.listReads += 1;
    // Every read fails until the test says otherwise (development mounts effects twice).
    if (state.failList) return route.fulfill(json({ error: 'Something broke on our side.' }, 502));
    return route.fulfill(json({ surface: 'questions', questions: state.answered.length ? [] : [conflict] }));
  });
  await page.route('**/api/client/questions/*/answers', async (route: Route) => {
    const body = route.request().postDataJSON() as Answer['body'];
    state.answered.push({ questionId: 'price', body });
    if (state.loseFirstAnswer) { state.loseFirstAnswer = false; return route.abort('connectionreset'); }
    // Applied (P6.8, I-3: only an applied answer closes its question; the what-changed is read back).
    return route.fulfill(json({ id: 'a-1', question_id: 'price', disposition: 'answer', payload: body.payload, application_state: 'applied', effects: [], application_note: null, what_changed: 'Settled.', question_status: 'answered', created_at: '2026-10-08T12:00:00Z', replayed: false }, 201));
  });
  await page.route('**/api/client/questions/answers/a-1', route => {
    state.answerReads += 1;
    return route.fulfill(json({ id: 'a-1', question_id: 'price', disposition: 'answer', payload: { option: 'k1' }, application_state: 'applied', effects: [{ kind: 'conflict', change: 'resolved', summary: 'Membership price is now USD 59 a month.' }], application_note: null, what_changed: 'Membership price is now USD 59 a month.', question_status: 'answered', created_at: '2026-10-08T12:00:00Z', replayed: false }));
  });
  return state;
}

for (const [label, width, height] of [['phone', 390, 844], ['desktop', 1280, 900]] as const) {
  test(`${label}: onboarding on the new engine, from preparing questions through to complete`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height });
    const stub = await stubOnboarding(page, baseURL!);
    await page.goto('/refined/onboarding');

    // Generating: a preparation screen, no workspace.
    await expect(page.getByRole('heading', { name: 'We’re preparing a few questions for you' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open my workspace' })).toHaveCount(0);
    stub.ready();
    await page.getByRole('button', { name: 'Check again' }).click();

    // Ready: one shared card, its position and its one-line benefit.
    const card = page.locator('.rf-qcard');
    await expect(card.getByText('1 of 3')).toBeVisible();
    await expect(card.getByRole('heading', { name: 'What do you offer, in your own words?' })).toBeVisible();
    await expect(card.getByText('Why we’re asking').or(card.getByText("Why we're asking"))).toBeVisible();
    await expect(card.getByRole('button', { name: 'Save answer' })).toBeDisabled();
    await card.getByText('Something else').click();
    await card.getByLabel('Something else: your answer').fill('Sports massage');
    await noOverflow(page);
    await page.screenshot({ path: `test-results/e2e/onboarding-ke-${label}.png` });
    await card.getByRole('button', { name: 'Save answer' }).click();

    // 2 of 3: skipped. 3 of 3: not sure. Nothing is mandatory (D01).
    await expect(card.getByText('2 of 3')).toBeVisible();
    await card.getByRole('button', { name: 'Skip' }).click();
    await expect(card.getByText('3 of 3')).toBeVisible();
    await card.getByRole('button', { name: 'Not sure' }).click();

    await expect(page.getByRole('heading', { name: 'You’re good to go.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open my workspace' })).toBeVisible();
    expect(stub.answered.map(answer => [answer.questionId, answer.body.disposition, answer.body.payload])).toEqual([
      ['services', 'answer', { alternative: 'Sports massage' }], ['location', 'skip', undefined], ['audience', 'unknown', undefined],
    ]);
    expect(stub.answered.every(answer => UUID.test(answer.body.idempotency_key))).toBe(true);
    expect(new Set(stub.answered.map(answer => answer.body.idempotency_key)).size).toBe(3);
    await noOverflow(page);
  });

  test(`${label}: Train Your AI -> Questions answers one question and shows what changed`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height });
    const stub = await stubTraining(page, baseURL!);
    await page.goto('/refined/train?tab=questions');

    // A failed read is "Questions unavailable" with Retry, never the empty state (A35).
    await expect(page.getByText('Questions unavailable')).toBeVisible();
    await expect(page.getByText('Nothing to clarify right now')).toHaveCount(0);
    stub.failList = false;
    await page.getByRole('button', { name: 'Retry' }).click();

    const card = page.locator('.rf-qcard');
    await expect(card.getByRole('heading', { name: 'Which membership price is current?' })).toBeVisible();
    await expect(card.getByText('So posts quote the price you charge today.')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Not sure' })).toHaveCount(0);
    await card.getByText('USD 59 a month').click();
    await card.getByRole('button', { name: 'Save answer' }).click();

    // The reply is lost: the answer stays, and sending it again reuses the same key (A08).
    await expect(card.getByRole('alert')).toBeVisible();
    await card.getByRole('button', { name: 'Save answer' }).click();

    await expect(page.getByRole('status').filter({ hasText: 'What changed' })).toContainText('Membership price is now USD 59 a month.');
    await expect(page.getByText('Nothing to clarify right now')).toBeVisible();
    expect(stub.answered.map(answer => answer.body)).toEqual([
      { idempotency_key: stub.answered[0].body.idempotency_key, disposition: 'answer', payload: { option: 'k1' } },
      { idempotency_key: stub.answered[0].body.idempotency_key, disposition: 'answer', payload: { option: 'k1' } },
    ]);
    expect(UUID.test(stub.answered[0].body.idempotency_key)).toBe(true);
    expect(stub.answerReads).toBeGreaterThanOrEqual(1);
    await noOverflow(page);
    await page.screenshot({ path: `test-results/e2e/questions-tab-${label}.png` });
  });
}

// M1 is unchanged: the questionnaire and the atom review, never the new cards.
// The M1 catalogue, as `onboarding-responsive.spec.ts` serves it.
const VERSION = 'business-clarification/2.0.0';
const questions = [
  ["sixty_day_hustle_role", "60 Day Hustle", "Public sources describe your role on 60 Day Hustle in different ways. Which describes it accurately?", "single", true, ["I host it.", "I host it and I am a producer.", "I co-created it, host it and executive produce it."]],
  ["mawer_capital", "Mawer Capital", "How should your posts treat Mawer Capital today?", "single", true, ["As an active brand I post about.", "Only as part of my past work.", "Leave it out of my posts."]],
  ["content_focus", "Your focus", "What should most of your posts focus on right now?", "single", true, ["My personal brand.", "Inside Success TV.", "An even mix of both."]],
  ["istv_voice", "Inside Success TV's voice", "When you ask for a post written as Inside Success TV rather than as you, how should it sound? Choose all that apply.", "multi", true, ["Cinematic and inspiring.", "Warm and focused on our cast.", "Bold and energetic, like me.", "Professional and understated."]],
  ["usable_figures", "Figures we can use", "Which revenue, ad-spend or growth figures from your websites may we use in posts, and for which business and time period?", "long", false, []],
  ["istv_turning_point", "A turning point", "Tell us about one hard decision you made while building Inside Success TV: what you decided, what happened, and what you learned.", "long", false, []],
].map(([question_id, review_label, prompt, input_type, required, choices]) => ({
  question_id,
  question_version: VERSION,
  review_label,
  prompt,
  input_type,
  required,
  choices,
  exclusive_choices: [],
  max_text_chars: 2_000,
}));

const m1Prefill = {
  user: { display_name: 'Amina Yusuf', email: 'amina@example.test', profession: 'Founder' },
  audience_options: [],
  answers: {},
  confirmed_at: null,
  guardrail_questions: [],
  questions: [],
  clarification_questions: questions,
  trust: 'untrusted',
};

test('M1: onboarding is the questionnaire, and Questions is the atom review', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await stubBase(page, baseURL!, 'synthetic-onboarding-token', 'm1');
  await page.route('**/api/client/onboarding', route => route.fulfill(json(m1Prefill)));
  let stateReads = 0;
  await page.route('**/api/client/onboarding/state', route => { stateReads += 1; return route.fulfill(json({}, 404)); });
  await page.goto('/refined/onboarding');
  await expect(page.getByText('Question 1 of 6')).toBeVisible();
  await expect(page.getByRole('heading', { name: questions[0].prompt as string })).toBeVisible();
  await expect(page.locator('.rf-qcard')).toHaveCount(0);
  expect(stateReads).toBe(0);

  await page.context().clearCookies();
  await stubTraining(page, baseURL!);
  await page.route('**/api/client/engine', route => route.fulfill(json({ knowledge_engine: 'm1' })));
  await page.route('**/api/client/atoms', route => route.fulfill(json({ client_id: 'c', atom_counts: { insight: 1 }, generated_at: '2026-10-08T12:00:00Z',
    atoms: [{ atom_id: '11111111-1111-4111-8111-111111111111', atom_type: 'insight', can_deprecate: true, text: 'Twelve founder documentaries.', status: 'provisional', created_at: '2026-10-08T10:00:00Z', source_label: 'Interview transcript', document_id: 'doc-1', untrusted_fields: ['text'], trust: 'untrusted' }] })));
  let questionReads = 0;
  page.on('request', request => { if (request.url().includes('/api/client/questions')) questionReads += 1; });
  await page.goto('/refined/train?tab=questions');
  await expect(page.getByRole('heading', { name: 'Does this sound right?' })).toBeVisible();
  await expect(page.getByText('Twelve founder documentaries.')).toBeVisible();
  await expect(page.locator('.rf-qcard')).toHaveCount(0);
  expect(questionReads).toBe(0);
});

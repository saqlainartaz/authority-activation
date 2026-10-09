import { expect, test, type Page } from '@playwright/test';

// Cycle 5 P9.4: Business DNA on the new engine, against a stubbed BFF (spec 3.1-3.2;
// A01-A03, A35; Ruling 88), at a phone and a desktop width.
// - Open DNA: an account with nothing known says it is still being built, with the
//   files' real status; each section has its honest empty state. No voice call is
//   made on load.
// - Add a correction from a section: the existing contribution form opens inside it,
//   the section shows what changed, and the page re-reads (the fact appears).
// - Two profiles: the selector appears, the browser remembers the pick, and a pick
//   that is revoked falls back to the selection state.
// - The voice sample is generated only when asked, labelled as generated writing.
// - Under M1 the questionnaire view renders and nothing new is read.
// Gate screenshots (D13 is screenshot acceptance): test-results/e2e/dna-*.png.
//
// Run as `usage.spec.ts` is run:
//   node e2e/support/fake-me-backend.mjs 8199
//   ENGINE_URL=http://127.0.0.1:8199 ENGINE_SERVICE_KEY=e2e NEXT_PUBLIC_AUTHORITY_DEMO=0 npx next dev --port 3101
//   AA_E2E_BASE_URL=http://localhost:3101 npx playwright test e2e/business-dna-inventory.spec.ts

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const IDS = ['identity', 'audience', 'offers', 'positioning', 'proof', 'voice'] as const;
type Item = { knowledge_id: string; meaning_id: string; statement: string; modality: string; reported_by: string | null; interpretation: boolean };
type Profile = { id: string; name: string; kind: string };

const ACCOUNT: Profile = { id: 'account', name: 'Acme Physio', kind: 'account' };
const ACME: Profile = { id: '11111111-1111-4111-8111-111111111111', name: 'Acme Physio', kind: 'organization' };
const ANN: Profile = { id: '22222222-2222-4222-8222-222222222222', name: 'Ann Lee', kind: 'person' };

const item = (statement: string, extra: Partial<Item> = {}): Item => ({
  knowledge_id: `k-${statement.length}-${statement.slice(0, 8)}`, meaning_id: 'x', statement, modality: 'asserted',
  reported_by: null, interpretation: false, ...extra,
});

const FILLED: Partial<Record<(typeof IDS)[number], Item[]>> = {
  identity: [item('Acme Physio treats back and neck pain for desk workers.'), item('Founded in Leeds in 2019.')],
  audience: [item('Office workers in Leeds with recurring back pain.'), item('Runners returning from injury.')],
  offers: [item('A six-week back care course, GBP 300.'), item('One-to-one assessments on weekday evenings.')],
  positioning: [item('Hands-on treatment, not app-based exercise plans.'), item('A second clinic in York next year.', { modality: 'planned' })],
  proof: [item('A marathon runner back to training in four weeks.'), item('Pain scores halved after the course.', { modality: 'reported', reported_by: 'A patient survey' }),
    item('Patience is the method.', { interpretation: true }), item('Registered with the HCPC.')],
};

type State = {
  profiles: Profile[];
  known: Record<string, Partial<Record<(typeof IDS)[number], Item[]>>>;
  revoked: Set<string>;
  guidance: string | null;
  voiceCalls: number;
  contributions: Array<{ text: string; kind: string; section?: string }>;
  reads: string[];
};

async function stub(page: Page, baseURL: string, state: State, engine: 'ke' | 'm1' = 'ke') {
  await page.context().addCookies([{ name: 'aa_client_token', value: 'synthetic-local-token', url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
  await page.route('**/api/client/**', route => route.fulfill(json({ error: 'Not stubbed.' }, 404)));
  await page.route('**/api/client/engine', route => route.fulfill(json({ knowledge_engine: engine })));
  await page.route('**/api/client/content-items', route => route.fulfill(json({ items: [] })));
  await page.route('**/api/client/calendar', route => route.fulfill(json({ slots: [] })));
  await page.route('**/api/client/social/**', route => route.fulfill(json([])));
  await page.route('**/api/client/profile', route => route.fulfill(json({ identity: { display_name: 'Amina Yusuf', profession: 'Physiotherapist', client_name: 'Acme Physio', timezone: 'Europe/London' }, document_count: 2 })));
  await page.route('**/api/client/writing-settings**', route => route.fulfill(json(state.guidance === null ? null
    : { perspective_mode: 'neutral', guideline_id: 'g-1', revision: 1, text_digest: 'd'.repeat(64), text: state.guidance })));
  await page.route('**/api/client/documents', route => route.fulfill(json([
    { id: 'd1', source_type: 'brochure.pdf', source_authority: 'CLIENT', status: 'uploaded', created_at: '2026-10-09T09:00:00Z',
      knowledge: { label: 'Processing', tone: 'working', detail: 'Reading the file' } },
  ])));
  await page.route(url => url.pathname === '/api/client/profiles', route => {
    state.reads.push('profiles');
    return route.fulfill(json({ profiles: state.profiles.filter(p => !state.revoked.has(p.id)) }));
  });
  await page.route('**/api/client/profiles/*/dna', route => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/')[4]);
    state.reads.push(`dna:${id}`);
    const profile = state.profiles.find(p => p.id === id);
    if (!profile || state.revoked.has(id)) return route.fulfill(json({ error: "That profile isn't available.", detail: 'profile_not_found' }, 404));
    const known = state.known[id] ?? {};
    const sections = IDS.map(section => ({ id: section, items: known[section] ?? [] }));
    const others = state.profiles.filter(p => p.id !== id && !state.revoked.has(p.id) && p.kind !== 'account');
    return route.fulfill(json({
      profile, sections, empty: sections.every(section => section.items.length === 0),
      relationships: id === ANN.id && others.some(p => p.id === ACME.id) ? [{ profile: ACME, relation: 'founder of', direction: 'outgoing' }] : [],
    }));
  });
  // A line waiting from elsewhere (Train Your AI lists it); the DNA section's form must not.
  await page.route('**/api/client/contributions/proposals', route => route.fulfill(json({
    proposals: [{ instruction: 'Never name Sam.', source: 'answer', source_id: 'a-1', created_at: '2026-10-09T12:00:00Z' }] })));
  await page.route(url => url.pathname === '/api/client/contributions', route => {
    const body = route.request().postDataJSON() as { intent_key: string; text: string; kind: string; section?: string };
    state.contributions.push({ text: body.text, kind: body.kind, section: body.section });
    const target = state.profiles[0].id;
    // As the backend files it: under the section the note was sent from, else Identity.
    const into = (body.section ?? 'identity') as (typeof IDS)[number];
    state.known[target] = { ...state.known[target], [into]: [...(state.known[target]?.[into] ?? []), item(body.text)] };
    const summary = `Added for Acme Physio: ${body.text}`;
    return route.fulfill(json({
      id: `c-${state.contributions.length}`, text: body.text, kind: body.kind, application_state: 'applied', pending_reason: null,
      application_note: null, effects: [{ kind: 'fact', change: 'added', summary }], what_changed: summary,
      created_at: '2026-10-09T12:00:00Z', replayed: false,
    }, 201));
  });
  await page.route('**/api/client/voice', route => {
    state.voiceCalls += 1;
    const body = route.request().postDataJSON() as { preview_id: string };
    return route.fulfill(json({ outcome: 'preview', preview_id: body.preview_id, sample: 'Back pain at your desk? Three small changes help more than one big one. What would you try first?',
      proposed_guidance: '- Warm, plain first person.', starting_proposal: false, approaching: null }));
  });
}

const fresh = (extra: Partial<State> = {}): State => ({
  profiles: [ACCOUNT], known: {}, revoked: new Set(), guidance: null, voiceCalls: 0, contributions: [], reads: [], ...extra,
});

const noOverflow = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

const section = (page: Page, id: string) => page.locator(`[data-section="${id}"]`);

/** The whole page for the gate (D13): the DNA scrolls inside its own pane, so grow the window to fit it. */
async function shoot(page: Page, name: string) {
  const size = page.viewportSize()!;
  const height = await page.evaluate(() => {
    const pane = document.querySelector('.rf-dna-scroll');
    return pane ? pane.scrollHeight + pane.getBoundingClientRect().top + 80 : document.documentElement.scrollHeight;
  });
  await page.setViewportSize({ width: size.width, height: Math.max(size.height, Math.ceil(height)) });
  await page.screenshot({ path: `test-results/e2e/${name}.png` });
  await page.setViewportSize(size);
}

for (const [label, width, height] of [['phone', 390, 844], ['desktop', 1280, 900]] as const) {
  test(`${label}: an empty profile is honest, a correction from a section shows what changed, and no voice call is made`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height });
    const state = fresh();
    await stub(page, baseURL!, state);
    await page.goto('/refined/profile');

    await expect(page.getByRole('heading', { name: "We're still building your business profile" })).toBeVisible();
    await expect(page.getByText('Your files: 1 Processing.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add files' })).toBeVisible();
    await expect(section(page, 'audience')).toContainText('Audience details not added yet');
    await expect(section(page, 'positioning')).toContainText('Tell us what makes your approach different.');
    await expect(section(page, 'proof')).toContainText('No examples added yet');
    await expect(section(page, 'voice')).toContainText('Voice not set');
    await expect(page.getByLabel('Business')).toHaveCount(0); // one profile: no selector
    await noOverflow(page);
    await shoot(page, `dna-empty-${label}`);

    // A correction, from the Audience section, through the existing one-item form.
    await section(page, 'audience').getByRole('button', { name: 'Correct or add' }).click();
    const form = section(page, 'audience').locator('.rf-contribute');
    await expect(form.getByRole('radio', { name: 'Something about me or my business' })).toBeChecked();
    await form.getByRole('textbox', { name: 'What would you like us to know?' }).fill('We mostly see office workers with back pain.');
    await form.getByRole('button', { name: 'Send' }).click();

    await expect(section(page, 'audience').getByRole('status')).toContainText('What changed');
    await expect(section(page, 'audience').getByRole('status')).toContainText('Added for Acme Physio: We mostly see office workers with back pain.');
    await expect(page.locator('.rf-contribute-outcome')).toHaveCount(1); // that section only
    await expect(form).not.toContainText('Never name Sam.'); // only this note's outcome, not every waiting line
    // The fact lands in the section it was sent from, whose empty line is gone (fix round 1, I-2).
    await expect(section(page, 'audience').locator('.rf-dna-items')).toContainText('We mostly see office workers with back pain.');
    await expect(section(page, 'audience')).not.toContainText('Audience details not added yet');
    await expect(section(page, 'identity')).not.toContainText('We mostly see office workers with back pain.');
    await expect(page.getByRole('heading', { name: "We're still building your business profile" })).toHaveCount(0);
    expect(state.contributions).toEqual([{ text: 'We mostly see office workers with back pain.', kind: 'fact', section: 'audience' }]);
    await noOverflow(page);
    await shoot(page, `dna-correction-${label}`);
    expect(state.voiceCalls).toBe(0);
  });

  test(`${label}: a filled profile, compact sections that expand in place, and a sample only when asked`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height });
    const state = fresh({ known: { account: FILLED }, guidance: '- Warm, plain first person.' });
    await stub(page, baseURL!, state);
    await page.goto('/refined/profile');

    await expect(section(page, 'audience')).toContainText('Office workers in Leeds with recurring back pain.');
    await expect(section(page, 'positioning')).toContainText('A second clinic in York next year.Plan');
    await expect(section(page, 'proof')).toContainText('Reported by A patient survey');
    await expect(section(page, 'proof')).not.toContainText('Registered with the HCPC.');
    await section(page, 'proof').getByRole('button', { name: 'Show all 4' }).click();
    await expect(section(page, 'proof')).toContainText('Registered with the HCPC.');
    await expect(section(page, 'voice').getByRole('button', { name: 'Show a sample' })).toBeVisible();
    expect(state.voiceCalls).toBe(0);
    await noOverflow(page);
    await shoot(page, `dna-filled-${label}`);

    await section(page, 'voice').getByRole('button', { name: 'Show a sample' }).click();
    await expect(section(page, 'voice')).toContainText('Example written by AI — not saved');
    await expect(section(page, 'voice')).toContainText('It is not information about your business.');
    expect(state.voiceCalls).toBe(1);
  });

  test(`${label}: two profiles show the selector, remember the pick, and fall back when it is revoked`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height });
    const state = fresh({ profiles: [ACME, ANN], known: { [ACME.id]: FILLED, [ANN.id]: { identity: [item('Ann Lee is a physiotherapist and the founder.')] } } });
    await stub(page, baseURL!, state);
    await page.goto('/refined/profile');

    await expect(page.getByRole('heading', { name: 'Choose which business to view' })).toBeVisible();
    // A founder and her business: the business (the account's main subject) holds Offers and
    // Audience, so nothing is unreachable (fix round 1; the backend's rule, stubbed here).
    await page.getByLabel('Business').selectOption(ACME.id);
    await expect(section(page, 'offers')).toContainText('A six-week back care course, GBP 300.');
    await expect(section(page, 'audience')).toContainText('Office workers in Leeds with recurring back pain.');
    await noOverflow(page);
    await shoot(page, `dna-two-profiles-business-${label}`);

    await page.getByLabel('Business').selectOption(ANN.id);
    await expect(section(page, 'identity')).toContainText('Ann Lee is a physiotherapist and the founder.');
    await expect(section(page, 'identity')).toContainText('Ann Lee founder of Acme Physio');
    await noOverflow(page);
    await shoot(page, `dna-two-profiles-${label}`);

    await page.reload();
    await expect(page.getByLabel('Business')).toHaveValue(ANN.id); // remembered in this browser
    await expect(section(page, 'identity')).toContainText('Ann Lee is a physiotherapist and the founder.');

    state.revoked.add(ANN.id);
    await page.reload();
    await expect(page.locator('[data-section]')).toHaveCount(IDS.length); // the only permitted profile opens
    await expect(section(page, 'identity')).toContainText('Acme Physio');
    await expect(page.getByText('Ann Lee')).toHaveCount(0);
    await expect(page.getByLabel('Business')).toHaveCount(0);
    expect(state.voiceCalls).toBe(0);
  });
}

test('under M1 the questionnaire view renders and nothing new is read', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const state = fresh();
  await stub(page, baseURL!, state, 'm1');
  await page.route('**/api/client/onboarding', route => route.fulfill(json({ error: 'M1 questionnaire.' }, 503)));
  await page.goto('/refined/profile');

  await expect(page.getByText('M1 questionnaire.')).toBeVisible();
  await expect(page.locator('[data-section]')).toHaveCount(0);
  expect(state.reads).toEqual([]);
  expect(state.voiceCalls).toBe(0);
});

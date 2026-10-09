import { expect, test, type Page } from '@playwright/test';

// Cycle 5 P5.3: Train Your AI -> Guidance -> the voice card, against a stubbed
// BFF (spec 6; A13, A14; Ruling 68). Generate, adjust, save: the saved text then
// appears in the Guidance tab's own editor. No writing-settings write happens
// before Save. Compare, the fact screen with Restore and a voice's own guidance
// were removed as over-engineered, 2026-10-08, with their flows.
//
// Run as `usage.spec.ts` is run (the fake /v1/me on 8199, `next dev` on 3101):
//   node e2e/support/fake-me-backend.mjs 8199
//   ENGINE_URL=http://127.0.0.1:8199 ENGINE_SERVICE_KEY=e2e NEXT_PUBLIC_AUTHORITY_DEMO=0 npx next dev --port 3101
//   AA_E2E_BASE_URL=http://localhost:3101 npx playwright test e2e/voice-card.spec.ts

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

type Stub = { writes: Array<{ method: string; body: unknown }>; voiceBodies: Array<Record<string, unknown>> };

async function connected(page: Page, baseURL: string, engine: 'ke' | 'm1' = 'ke'): Promise<Stub> {
  const stub: Stub = { writes: [], voiceBodies: [] };
  let saved: Record<string, unknown> | null = null;
  let generation = 0;
  await page.context().addCookies([{ name: 'aa_client_token', value: 'synthetic-local-token', url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
  // Registered first, so the specific stubs below take precedence over it.
  await page.route('**/api/client/**', route => route.fulfill(json({ error: 'Not stubbed.' }, 404)));
  await page.route('**/api/client/content-items', route => route.fulfill(json({ items: [] })));
  await page.route('**/api/client/calendar', route => route.fulfill(json({ slots: [] })));
  await page.route('**/api/client/social/**', route => route.fulfill(json([])));
  await page.route('**/api/client/atoms', route => route.fulfill(json({ client_id: 'c', atoms: [], atom_counts: {}, generated_at: '2026-10-07T12:00:00Z' })));
  await page.route('**/api/client/profile', route => route.fulfill(json({ identity: { display_name: 'Amina Yusuf', profession: 'Physiotherapist', client_name: 'ISTV', timezone: 'Europe/London' }, document_count: 2 })));
  await page.route('**/api/client/engine', route => route.fulfill(json({ knowledge_engine: engine })));
  await page.route('**/api/client/writing-perspectives', route => route.fulfill(json({ authors: [], brands: [] })));
  await page.route('**/api/client/writing-settings**', async route => {
    const method = route.request().method();
    if (method === 'GET') return route.fulfill(json(saved));
    const body = route.request().postDataJSON() as { text: string };
    stub.writes.push({ method, body });
    saved = { perspective_mode: 'neutral', guideline_id: 'g-1', revision: 1, text_digest: 'd'.repeat(64), text: body.text };
    return route.fulfill(json(saved));
  });
  await page.route('**/api/client/voice', async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    stub.voiceBodies.push(body);
    generation += 1;
    const base = body.base as { sample: string; proposed_guidance: string } | undefined;
    const answer = body.kind === 'adjust'
      ? { sample: `${base?.sample}\n\nRevised: ${body.instruction}`, proposed_guidance: `${base?.proposed_guidance}\n- ${body.instruction}` }
      : { sample: 'A quick note from the clinic this week. What would you add?', proposed_guidance: '- Warm, plain first person.\n- Under 150 words.' };
    return route.fulfill(json({
      outcome: 'preview', preview_id: body.preview_id, ...answer,
      starting_proposal: saved === null, approaching: null, generation,
    }));
  });
  return stub;
}

test('generate, adjust and save: the saved text appears in the Guidance tab', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const stub = await connected(page, baseURL!);
  await page.goto('/refined/train?tab=guidance');

  const card = page.locator('.rf-voice-card');
  await expect(card.getByRole('heading', { name: 'Try a voice' })).toBeVisible();
  await expect(page.getByText('No writing guidance saved yet')).toBeVisible();

  // Generate: a labelled starting proposal, nothing saved.
  await card.getByRole('button', { name: 'Generate a sample' }).click();
  await expect(card.getByText('A quick note from the clinic this week.')).toBeVisible();
  await expect(card.getByText('Example written by AI — not saved')).toBeVisible();
  await expect(card.getByText('Starting proposal', { exact: true })).toBeVisible();

  // Adjust: a revised sample, and the guidance that will be saved, before any save.
  await card.getByRole('button', { name: 'Adjust' }).click();
  await card.getByLabel('What should change?').fill('warmer, fewer emojis');
  await card.getByRole('button', { name: 'Revise' }).click();
  await expect(card.getByText('Revised: warmer, fewer emojis')).toBeVisible();
  await expect(card.getByLabel('Guidance to save')).toHaveValue('- Warm, plain first person.\n- Under 150 words.\n- warmer, fewer emojis');

  // No Compare, no fact list (removed 2026-10-08).
  await expect(card.getByRole('button', { name: 'Compare another version' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Restore' })).toHaveCount(0);

  // Edit, then Save.
  const toSave = card.getByLabel('Guidance to save');
  await toSave.fill('- Warm, plain first person.\n- Fewer emojis.');
  expect(stub.writes).toEqual([]);
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(card.getByText('Saved. All your writing will use this.')).toBeVisible();

  // Exactly one write, of the text shown, against "none saved yet".
  expect(stub.writes).toEqual([{ method: 'PUT', body: { text: '- Warm, plain first person.\n- Fewer emojis.', expected_revision: null, expected_guideline_id: null } }]);
  // The Guidance tab's own editor shows it as saved.
  await expect(page.getByLabel('Writing guidance')).toHaveValue('- Warm, plain first person.\n- Fewer emojis.');
  await expect(page.locator('.rf-guidance .rf-section-heading').getByText('Saved')).toBeVisible();

  // Two generations, each with its own preview id.
  expect(new Set(stub.voiceBodies.map(body => body.preview_id)).size).toBe(stub.voiceBodies.length);
  expect(stub.voiceBodies.map(body => body.kind)).toEqual(['generate', 'adjust']);
});

test('under M1 there is no voice card', async ({ page, baseURL }) => {
  await connected(page, baseURL!, 'm1');
  await page.goto('/refined/train?tab=guidance');
  await expect(page.getByText('No writing guidance saved yet')).toBeVisible();
  await expect(page.locator('.rf-voice-card')).toHaveCount(0);
});

test('the voice card fits a phone screen', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await connected(page, baseURL!);
  await page.goto('/refined/train?tab=guidance');
  const card = page.locator('.rf-voice-card');
  await card.getByRole('button', { name: 'Generate a sample' }).click();
  await card.getByRole('button', { name: 'Use this voice' }).click();
  await expect(card.getByLabel('Guidance to save')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('Try again after a failed generation sends a new preview id (Ruling 69)', async ({ page, baseURL }) => {
  await connected(page, baseURL!);
  const ids: string[] = [];
  // Registered last, so it answers before the stub above: a 502, then a sample.
  await page.route('**/api/client/voice', async route => {
    const body = route.request().postDataJSON() as { preview_id: string };
    ids.push(body.preview_id);
    if (ids.length === 1) return route.fulfill(json({ error: 'Bad gateway' }, 502));
    return route.fulfill(json({
      outcome: 'preview', preview_id: body.preview_id, sample: 'Second attempt.', proposed_guidance: '- Plain.',
      starting_proposal: true, approaching: null,
    }));
  });
  await page.goto('/refined/train?tab=guidance');
  const card = page.locator('.rf-voice-card');
  await card.getByRole('button', { name: 'Generate a sample' }).click();
  await expect(card.getByRole('alert')).toContainText('Bad gateway');
  await card.getByRole('button', { name: 'Try again' }).click();
  await expect(card.getByText('Second attempt.')).toBeVisible();
  expect(ids).toHaveLength(2);
  expect(ids[1]).not.toBe(ids[0]);
});

test('a sample in a named voice saves the one general guidance, with no perspective (D06)', async ({ page, baseURL }) => {
  const author = '8b1c1f8e-0000-4000-8000-000000000007';
  const stub = await connected(page, baseURL!);
  // Registered last, so it answers before the stub above.
  await page.route('**/api/client/writing-perspectives', route => route.fulfill(json({
    authors: [{ ref: { kind: 'entity', id: author, revision: 1 }, label: 'Mara Ellison' }], brands: [],
  })));
  await page.goto('/refined/train?tab=guidance');
  const card = page.locator('.rf-voice-card');

  await card.getByLabel('Voice').selectOption({ label: 'Mara Ellison (as yourself)' });
  await expect(card.getByText('instead of your general guidance')).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Use general guidance instead' })).toHaveCount(0);
  await card.getByRole('button', { name: 'Generate a sample' }).click();
  await card.getByRole('button', { name: 'Use this voice' }).click();
  await expect(card.getByText('Guidance that will be saved for all your writing')).toBeVisible();
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(card.getByText('Saved. All your writing will use this.')).toBeVisible();

  expect(stub.voiceBodies[0]).toMatchObject({ perspective: { mode: 'personal', author_id: author } });
  expect(stub.writes).toEqual([{ method: 'PUT', body: { text: '- Warm, plain first person.\n- Under 150 words.', expected_revision: null, expected_guideline_id: null } }]);
});

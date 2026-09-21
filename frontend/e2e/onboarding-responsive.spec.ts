import { expect, test } from '@playwright/test';

const VERSION = 'business-dna/1.0.0';
const questions = [
  ['business_overview', 'About you', 'Tell us about what you or your business does—in your own words.', 'long', true, []],
  ['audience_context', 'Audience', 'Who do you most want your work to reach or help?', 'long', true, []],
  ['known_for', 'Strongest point', 'What do people usually come to you for, or what do you most want to be known for?', 'long', true, []],
  ['distinctive_approach', 'What makes you different', 'What makes your work, approach or experience different?', 'long', false, []],
  ['content_objective', 'Main objective', 'What should your content help you do most right now?', 'single', true, ['Build recognition and trust.', 'Explain what I do more clearly.', 'Start conversations with potential customers.', 'Share useful expertise and ideas.', 'Support an offer, launch or change.', 'Stay visible to the people who matter.']],
  ['problem_or_goal', 'The problem', 'What problem, need or goal does your work address?', 'long', false, []],
  ['recurring_questions', 'Common questions', 'What questions, doubts or misunderstandings come up most often about your work?', 'long', false, []],
  ['proof', 'Proof', 'What examples, results, experiences or stories best show the value of what you do?', 'long', false, []],
  ['tone', 'Writing tone', 'How should your writing usually sound?', 'single', false, ['Clear and direct.', 'Warm and conversational.', 'Thoughtful and authoritative.', 'Bold and energetic.', 'Calm and measured.']],
].map(([question_id, review_label, prompt, input_type, required, choices]) => ({
  question_id,
  question_version: VERSION,
  review_label,
  prompt,
  input_type,
  required,
  choices,
}));

const prefill = {
  user: { display_name: 'Amina Yusuf', email: 'amina@example.test', profession: 'Founder' },
  audience_options: [],
  answers: {},
  confirmed_at: null,
  guardrail_questions: [],
  questions,
  trust: 'untrusted',
};

function completedPrefill() {
  return {
    ...prefill,
    answers: {
      questionnaire: {
        version: VERSION,
        responses: questions.map((question, ordinal) => ({
          question_id: question.question_id,
          question_version: VERSION,
          question: question.prompt,
          answers: [question.input_type === 'single' && Array.isArray(question.choices) ? String(question.choices[0]) : `Answer ${ordinal + 1}`],
          submitted_at: '2026-09-20T10:00:00Z',
          ordinal,
        })),
      },
    },
    confirmed_at: '2026-09-20T10:00:00Z',
  };
}

for (const width of [390, 767, 768, 1179, 1180, 1440]) {
  test(`connected onboarding preserves its frame at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.context().addCookies([{
      name: 'aa_client_token',
      value: 'synthetic-local-token',
      url: 'http://localhost:3100',
      httpOnly: true,
      sameSite: 'Lax',
    }]);
    await page.route('**/api/client/onboarding', async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(prefill) });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ answers: {}, confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString(), actor: 'client-user:test', dynamic_writeback: [], trust: 'untrusted' }),
      });
    });

    await page.goto('/refined/onboarding');
    await expect(page.getByText('Question 1 of 9')).toBeVisible();
    await expect(page.getByText(/Welcome, Amina Yusuf/)).toBeVisible();
    await expect(page.getByRole('heading', { name: questions[0].prompt as string })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next' })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const footer = await page.locator('.rf-onboarding-footer').boundingBox();
    expect(footer).not.toBeNull();
    expect(footer!.y + footer!.height).toBeLessThanOrEqual(width === 390 ? 844 : 900);
    await page.screenshot({ path: `test-results/e2e/onboarding-connected-${width}.png`, fullPage: true });
  });
}

test('connected onboarding can retry a transient prefill failure', async ({ page }) => {
  await page.context().addCookies([{
    name: 'aa_client_token',
    value: 'synthetic-local-token',
    url: 'http://localhost:3100',
    httpOnly: true,
    sameSite: 'Lax',
  }]);
  let reads = 0;
  let recover = false;
  await page.route('**/api/client/onboarding', async route => {
    reads += 1;
    if (!recover) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Setup is temporarily unavailable."}' });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(prefill) });
  });

  await page.goto('/refined/onboarding');
  await expect(page.getByRole('alert').filter({ hasText: 'temporarily unavailable' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.getByText('Loading your setup…')).toHaveCount(0);
  recover = true;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('Question 1 of 9')).toBeVisible();
  expect(reads).toBeGreaterThanOrEqual(2);
});

test('final onboarding save locks review navigation and an expired session returns to sign-in', async ({ page }) => {
  await page.context().addCookies([{ name: 'aa_client_token', value: 'synthetic-local-token', url: 'http://localhost:3100', httpOnly: true, sameSite: 'Lax' }]);
  let releaseSave!: () => void;
  const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
  await page.route('**/api/client/onboarding', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(completedPrefill()) });
      return;
    }
    await saveGate;
    await route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Your session has expired."}' });
  });

  await page.goto('/refined/onboarding');
  await expect(page.getByRole('heading', { name: 'Does this sound right?' })).toBeVisible();
  await page.getByRole('button', { name: 'Open my workspace' }).click();
  await expect(page.getByRole('button', { name: 'Change About you' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Back' })).toBeDisabled();
  await page.context().clearCookies();
  releaseSave();
  await expect(page).toHaveURL(/\/refined\/signin$/);
});

test('an expired onboarding prefill returns to sign-in', async ({ page }) => {
  await page.context().addCookies([{ name: 'aa_client_token', value: 'synthetic-local-token', url: 'http://localhost:3100', httpOnly: true, sameSite: 'Lax' }]);
  await page.route('**/api/client/onboarding', async route => {
    await page.context().clearCookies();
    await route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Your session has expired."}' });
  });

  await page.goto('/refined/onboarding');

  await expect(page).toHaveURL(/\/refined\/signin$/);
});

import { expect, test } from '@playwright/test';

const VERSION = 'business-clarification/1.0.0';
const questions = [
  ['work_today', 'Your work today', 'In your interview, you said you still see some therapy clients while directing the practice and creating retreats. Which best describes how you spend your working time today?', 'single', true, ['Mostly seeing therapy clients.', 'Mostly directing the practice and supporting the team.', 'Mostly creating or leading retreats and education.', 'My time is fairly evenly split across these.']],
  ['therapy_locations', 'Where you work', 'Your materials mention in-person and online therapy across Washington and California, but different clinicians may serve different locations. Where do you personally see therapy clients today? Choose all that apply.', 'multi', true, ['In person in Washington.', 'Online with clients in Washington.', 'Online with clients in California.', 'I am not currently seeing therapy clients.']],
  ['practice_start_year', 'Founding year', 'One account says you started your private practice in 2015, while another says 2016. Which year is right?', 'single', true, ['2015.', '2016.', 'I would like to check before answering.']],
  ['retreat_role', 'Your role in retreats', 'In your recorded interview, you explain that a trained team can run retreats when you cannot attend. Which parts do you personally handle for most retreats today? Choose all that apply.', 'multi', true, ['Creating the retreat concept and programme.', 'Teaching or facilitating sessions.', 'Leading the experience on site.', 'Choosing or working with venues and partners.', 'Training and overseeing the retreat team.']],
  ['retreat_misunderstanding', 'A common misunderstanding', 'Your materials describe therapist retreats that bring together continuing education, travel, and time to rest. What do people often misunderstand about that experience, and how would you explain it in your own words?', 'long', false, []],
  ['anything_else', 'Anything else', 'Is there anything else you would like us to understand about your business or the work you do?', 'long', false, []],
].map(([question_id, review_label, prompt, input_type, required, choices]) => ({
  question_id,
  question_version: VERSION,
  review_label,
  prompt,
  input_type,
  required,
  choices,
  exclusive_choices: question_id === 'therapy_locations' ? ['I am not currently seeing therapy clients.'] : [],
  max_text_chars: 2_000,
}));

const prefill = {
  user: { display_name: 'Amina Yusuf', email: 'amina@example.test', profession: 'Founder' },
  audience_options: [],
  answers: {},
  confirmed_at: null,
  guardrail_questions: [],
  questions: [],
  clarification_questions: questions,
  trust: 'untrusted',
};

function completedPrefill() {
  return {
    ...prefill,
    answers: {
      clarification_questionnaire: {
        version: VERSION,
        responses: questions.map((question, ordinal) => ({
          question_id: question.question_id,
          question_version: VERSION,
          question: question.prompt,
          answers: [question.input_type !== 'long' && Array.isArray(question.choices) ? String(question.choices[0]) : `Answer ${ordinal + 1}`],
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
    await expect(page.getByText('Question 1 of 6')).toBeVisible();
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
  await expect(page.getByText('Question 1 of 6')).toBeVisible();
  expect(reads).toBeGreaterThanOrEqual(2);
});

test('connected onboarding explains the answer limit before submission', async ({ page }) => {
  await page.context().addCookies([{
    name: 'aa_client_token',
    value: 'synthetic-local-token',
    url: 'http://localhost:3100',
    httpOnly: true,
    sameSite: 'Lax',
  }]);
  await page.route('**/api/client/onboarding', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(prefill),
  }));

  await page.goto('/refined/onboarding');
  await page.getByRole('radio', { name: 'Something else, I will type it' }).click();
  const answer = page.getByRole('textbox', { name: 'Your own answer' });
  const next = page.getByRole('button', { name: 'Next' });

  await answer.fill('x'.repeat(2_001));
  await expect(answer).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('2001 / 2000 characters · Shorten this answer to continue.')).toBeVisible();
  await expect(next).toBeDisabled();

  await answer.fill('x'.repeat(2_000));
  await expect(page.getByText('2000 / 2000 characters')).toBeVisible();
  await expect(next).toBeEnabled();
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
  await expect(page.getByRole('button', { name: 'Change Your work today' })).toBeDisabled();
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

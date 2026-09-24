import { expect, test } from '@playwright/test';

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

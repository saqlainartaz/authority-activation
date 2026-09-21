import { expect, test, type Page } from '@playwright/test';

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

function record(questionId: string, answer: string, ordinal: number) {
  const question = questions.find(candidate => candidate.question_id === questionId)!;
  return {
    question_id: questionId,
    question_version: VERSION,
    question: question.prompt,
    answers: [answer],
    submitted_at: '2026-09-20T10:00:00Z',
    ordinal,
  };
}

const populatedAnswers = {
  questionnaire: {
    version: VERSION,
    responses: [
      record('business_overview', 'Inside Success TV produces documentary-led stories about founders and their work.', 0),
      record('audience_context', 'Business owners and curious viewers who value candid, useful stories.', 1),
      record('known_for', 'Finding the human story behind a business.', 2),
      record('distinctive_approach', 'We combine documentary craft with practical business context.', 3),
      record('content_objective', 'Build recognition and trust.', 4),
      record('problem_or_goal', 'Make complex founder journeys easy to understand.', 5),
      record('recurring_questions', 'How do you choose which founder story to tell?', 6),
      record('proof', 'A growing catalogue of independently produced founder documentaries.', 7),
      record('tone', 'Warm and conversational.', 8),
    ],
  },
};

function prefill(answers: Record<string, unknown>) {
  return {
    user: { display_name: 'Amina Yusuf', email: 'amina@example.test', profession: 'Documentary producer' },
    audience_options: [],
    answers,
    confirmed_at: Object.keys(answers).length ? '2026-09-20T10:00:00Z' : null,
    guardrail_questions: [],
    questions,
    trust: 'untrusted',
  };
}

function canonicalAnswers(responses: Array<{ question_id: string; selected: string[]; text: string }>) {
  return {
    questionnaire: {
      version: VERSION,
      responses: responses.map((response, ordinal) => record(
        response.question_id,
        response.selected[0] === '__other__' ? response.text : response.selected[0] || response.text,
        ordinal,
      )),
    },
  };
}

async function mockConnectedPage(page: Page, answers: Record<string, unknown>, failSave = false) {
  await page.context().addCookies([{
    name: 'aa_client_token',
    value: 'synthetic-local-token',
    url: 'http://localhost:3100',
    httpOnly: true,
    sameSite: 'Lax',
  }]);
  await page.route('**/api/client/content-items', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }));
  await page.route('**/api/client/calendar', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"slots":[]}' }));
  await page.route('**/api/client/profile', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ identity: { display_name: 'Amina Yusuf', profession: 'Documentary producer', client_name: 'ISTV', timezone: 'Europe/London' }, document_count: 4 }) }));
  await page.route('**/api/client/onboarding', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(prefill(answers)) });
      return;
    }
    if (failSave) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Profile service is temporarily unavailable."}' });
      return;
    }
    const body = route.request().postDataJSON() as { responses: Array<{ question_id: string; selected: string[]; text: string }> };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ answers: canonicalAnswers(body.responses), confirmed_at: '2026-09-20T10:10:00Z' }) });
  });
}

test('Business DNA is minimal, populated, dark, and fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('authority-refined-appearance', 'dark'));
  await mockConnectedPage(page, populatedAnswers);
  await page.goto('/refined/profile');

  await expect(page.getByRole('heading', { name: 'Business DNA', exact: true }).first()).toBeVisible();
  await expect(page.getByText('Amina Yusuf')).toBeVisible();
  await expect(page.getByText('Finding the human story behind a business.')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByText('DNA')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByText('Settings')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: 'test-results/e2e/business-dna-populated-dark-phone.png', fullPage: true });
});

test('Business DNA reports empty optional data honestly at tablet width', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await mockConnectedPage(page, {});
  await page.goto('/refined/profile');

  await expect(page.getByText('Not added yet').first()).toBeVisible();
  await expect(page.getByText(/example|score|complete|recommended/i)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: 'test-results/e2e/business-dna-empty-light-tablet.png', fullPage: true });
});

test('a failed section save keeps the editor and unsaved text on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockConnectedPage(page, populatedAnswers, true);
  await page.goto('/refined/profile');

  const credibility = page.getByRole('heading', { name: 'What makes it credible' }).locator('..').locator('..');
  await credibility.getByRole('button', { name: 'Edit' }).click();
  const approach = page.getByLabel('What makes you different');
  await approach.fill('A revised approach that must survive the failed save.');
  await credibility.getByRole('button', { name: /Save/ }).click();

  await expect(page.getByRole('alert').filter({ hasText: 'temporarily unavailable' })).toBeVisible();
  await expect(approach).toHaveValue('A revised approach that must survive the failed save.');
  await expect(credibility.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await page.screenshot({ path: 'test-results/e2e/business-dna-failed-save-light-desktop.png', fullPage: true });
});

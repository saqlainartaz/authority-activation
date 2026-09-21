import { expect, test, type Page, type Route } from '@playwright/test';

type Atom = {
  atom_id: string;
  atom_type: string;
  can_deprecate: boolean;
  text: string;
  status: string;
  created_at: string;
  source_label: string;
  document_id: string;
  untrusted_fields: string[];
  trust: 'untrusted';
};

const atoms: Atom[] = [
  { atom_id: '11111111-1111-4111-8111-111111111111', atom_type: 'insight', can_deprecate: true, text: '<b>Documentary craft</b> & practical business context.', status: 'provisional', created_at: '2026-09-20T10:00:00Z', source_label: 'Interview transcript', document_id: 'doc-1', untrusted_fields: ['text'], trust: 'untrusted' },
  { atom_id: '22222222-2222-4222-8222-222222222222', atom_type: 'proof_point', can_deprecate: false, text: 'Twelve independently produced founder documentaries.', status: 'provisional', created_at: '2026-09-20T11:00:00Z', source_label: 'Onboarding', document_id: 'doc-2', untrusted_fields: ['text'], trust: 'untrusted' },
  { atom_id: '33333333-3333-4333-8333-333333333333', atom_type: 'tldr', can_deprecate: true, text: 'Already reviewed.', status: 'confirmed', created_at: '2026-09-20T09:00:00Z', source_label: 'Onboarding', document_id: 'doc-3', untrusted_fields: ['text'], trust: 'untrusted' },
];

async function mockShell(page: Page) {
  await page.context().addCookies([{ name: 'aa_client_token', value: 'synthetic-local-token', url: 'http://localhost:3100', httpOnly: true, sameSite: 'Lax' }]);
  await page.route('**/api/client/content-items', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }));
  await page.route('**/api/client/calendar', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"slots":[]}' }));
  await page.route('**/api/client/profile', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ identity: { display_name: 'Amina Yusuf', profession: 'Producer', client_name: 'ISTV', timezone: 'Europe/London' }, document_count: 3 }) }));
}

function atomsBody(rows: Atom[]) {
  return JSON.stringify({ client_id: 'client-a', atoms: rows, atom_counts: { insight: 1, proof_point: 1, tldr: 1 }, generated_at: '2026-09-20T12:00:00Z' });
}

test('connected Train questions review only real provisional atoms in the existing deck', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockShell(page);
  let decisionRequests = 0;
  let firstBody: { decision: string; idempotency_key: string } | null = null;
  let releaseDecision!: () => void;
  const decisionGate = new Promise<void>(resolve => { releaseDecision = resolve; });
  await page.route('**/api/client/atoms', route => route.fulfill({ status: 200, contentType: 'application/json', body: atomsBody(atoms) }));
  await page.route('**/api/client/atoms/*/decision', async route => {
    decisionRequests += 1;
    firstBody = route.request().postDataJSON();
    await decisionGate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ client_id: 'client-a', atom_id: atoms[0].atom_id, status: 'confirmed', unchanged: false, decided_at: '2026-09-20T12:01:00Z' }) });
  });

  await page.goto('/refined/train?tab=questions');
  await expect(page.getByLabel(/unanswered questions/i)).toHaveCount(0);
  await expect(page.getByText('2 waiting')).toBeVisible();
  await expect(page.getByText('<b>Documentary craft</b> & practical business context.')).toBeVisible();
  await expect(page.locator('.rf-question-atom b')).toHaveCount(0);
  await expect(page.getByText('Brand strategy · From Interview transcript')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Not accurate' })).toBeVisible();

  const confirm = page.locator('.rf-question-decisions .rf-question-save');
  await confirm.click();
  await expect(confirm).toBeDisabled();
  await expect(confirm).toContainText('Saving');
  releaseDecision();
  await expect(page.getByText('1 waiting')).toBeVisible();
  expect(decisionRequests).toBe(1);
  expect(firstBody).toMatchObject({ decision: 'confirm', idempotency_key: expect.stringMatching(/^[0-9a-f-]{36}$/i) });
  await expect(page.getByText('Twelve independently produced founder documentaries.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Not accurate' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/e2e/connected-training-dark-card-phone.png', fullPage: true });
});

test('failed atom decision keeps the card and reuses its key for an unchanged retry', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await mockShell(page);
  const bodies: Array<{ decision: string; idempotency_key: string }> = [];
  await page.route('**/api/client/atoms', route => route.fulfill({ status: 200, contentType: 'application/json', body: atomsBody([atoms[0]]) }));
  await page.route('**/api/client/atoms/*/decision', async (route: Route) => {
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Review service is temporarily unavailable."}' });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ client_id: 'client-a', atom_id: atoms[0].atom_id, status: 'deprecated', unchanged: true, decided_at: '2026-09-20T12:02:00Z' }) });
  });

  await page.goto('/refined/train?tab=questions');
  await expect(page.locator('.rf-sidebar .rf-unread')).toHaveCount(0);
  await page.getByRole('button', { name: 'Not accurate' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'temporarily unavailable' })).toBeVisible();
  await expect(page.getByText('1 waiting')).toBeVisible();
  await expect(page.getByText('<b>Documentary craft</b> & practical business context.')).toBeVisible();
  await page.getByRole('button', { name: 'Not accurate' }).click();
  await expect(page.getByRole('heading', { name: 'You’re all caught up' })).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
  await expect(page.getByText('Marked as not accurate')).toHaveCount(0);
});

test('an atom read failure never renders the all-caught-up success state', async ({ page }) => {
  await mockShell(page);
  await page.route('**/api/client/atoms', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: '{"error":"Knowledge review is temporarily unavailable."}',
  }));

  await page.goto('/refined/train?tab=questions');

  await expect(page.getByRole('alert').filter({ hasText: 'temporarily unavailable' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'You’re all caught up' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Questions unavailable' })).toBeVisible();
});

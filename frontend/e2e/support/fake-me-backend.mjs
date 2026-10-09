// A stand-in product API for the Playwright specs that stub every BFF call in
// the browser (`e2e/usage.spec.ts`). Next's proxy gate reads `GET /v1/me` on the
// SERVER before any refined page renders, which `page.route` cannot reach, so
// this answers that one read: a signed-in client who finished onboarding. Every
// other path is a 404. No credential is checked and nothing is stored.
//
// Cycle 5 P6.5: the token `synthetic-onboarding-token` is a client who has NOT
// finished onboarding, so the onboarding specs can reach `/refined/onboarding`.
//
// Run it, then start the app against it:
//   node e2e/support/fake-me-backend.mjs 8199
//   ENGINE_URL=http://127.0.0.1:8199 ENGINE_SERVICE_KEY=e2e NEXT_PUBLIC_AUTHORITY_DEMO=0 npx next dev --port 3101
//   AA_E2E_BASE_URL=http://localhost:3101 npx playwright test e2e/usage.spec.ts
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 8199);

createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (request.method === 'GET' && path === '/v1/me') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      client_id: '00000000-0000-4000-8000-000000000001',
      user_id: '00000000-0000-4000-8000-000000000002',
      onboarding_complete: request.headers['x-onboarding-token'] !== 'synthetic-onboarding-token',
      knowledge_engine: 'ke',
    }));
    return;
  }
  response.writeHead(404, { 'Content-Type': 'application/json' });
  response.end('{"detail":"not stubbed"}');
}).listen(port, '127.0.0.1', () => console.log(`fake /v1/me on 127.0.0.1:${port}`));

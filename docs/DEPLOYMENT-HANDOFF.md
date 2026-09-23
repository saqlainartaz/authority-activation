# Vercel and backend deployment handoff

This is a local readiness handoff. Nothing was published or deployed, so hosted behavior is not verified.

## Vercel project settings

| Setting | Value |
| --- | --- |
| Root directory | `frontend` (the repository's nested Next project) |
| Framework preset | Next.js |
| Node version | 22.x or newer; minimum 22.12 |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | leave blank; use Next.js default |
| Development command | `npm run dev` |

`next.config.ts` already traces `src/agent/instructions.md` and `src/agent/skills/**/*.md` into the agent function. The SSE agent handler exports `maxDuration = 300`, longer than its internal 120-second deadline. Confirm the selected Vercel plan supports that value: Vercel terminates functions that exceed the configured duration, and current plan limits vary ([official duration documentation](https://vercel.com/docs/functions/configuring-functions/duration)).

The application uses the Node.js runtime, not Edge, because the agent loads server-only filesystem assets and backend calls can stream for a full turn. Keep functions close to the separately hosted backend/database region.

## Required rollout order for structured agent intent

Deploy the compatible Python backend before deploying this web build. The
reviewed backend change is merged as
`66a7ab6f34a57b0f831d56b706d210abd8eb6f1e` through backend PR #32 (reviewed
head `14f3ba04beca8fd935f0c0201c2f3cf0bc3bcea7`). This record confirms source
integration only; it does not establish that the Render service is already
running that merge commit.
The backend fields `subject` and `retrieval_query` are optional, so the updated
backend accepts both the old and new web requests. The old backend forbids
unknown request fields, so deploying the new web build first would make
`prepare_generation` receive a 422 response. After the backend health and one
legacy context request pass, deploy the web build and run the flexible-agent
smoke matrix in `E2E-CHEAT-SHEET.md`. This is a handoff instruction only; no
deployment was performed here.

## Web environment inventory

| Variable | Consumer and purpose | Required / exposure / timing | Local | Preview | Production | Safe example / source |
| --- | --- | --- | --- | --- | --- | --- |
| `ENGINE_URL` | `src/lib/engine.ts`, `product.ts`; Python API origin | Required for connected mode; server-only; runtime | yes | yes | yes | `https://engine-preview.example.invalid`; supplied by backend host |
| `ENGINE_SERVICE_KEY` | Same BFF clients; authenticates Next to Python | Required; secret, server-only; runtime | yes | yes | yes | `<random-secret-at-least-16-chars>`; create and set identically as backend `SERVICE_API_KEY` |
| `INTERNAL_PASSCODE` | `src/lib/internal-auth.ts`; fail-closed admin gate | Required to use `/internal`; secret, server-only; runtime | yes | separate | separate | `<random-admin-passcode>`; operator supplies |
| `ANTHROPIC_API_KEY` | TypeScript marketing-copy driver | Required for normal connected generation; secret, server-only; runtime | only for authorized provider checks | separate | yes | `<provider-key>`; Anthropic account owner supplies |
| `NEXT_PUBLIC_AUTHORITY_DEMO` | `src/refined/state.tsx`; enables fixture/demo mode | Optional; public and inlined at build time | `1` only for isolated demo | unset | unset | `1`; never use for a deployment claimed as connected |
| `AUTHORITY_AGENT_DRIVER` | Agent route; selects keyless deterministic validation driver | Test-only optional; server-only; runtime/module load | `deterministic` for tests | unset | unset | Operator-controlled local test flag |
| `AUTHORITY_DETERMINISTIC_DELAY_MS` | Deterministic driver; makes Stop behavior observable | Test-only optional; server-only; runtime | `600` | unset | unset | Integer 0–2000 |

`NODE_ENV` is platform-managed. In production it makes client auth cookies `Secure`; all auth cookies are also `httpOnly`, `SameSite=Lax`, and path `/`. Configure Preview and Production variables separately; Vercel applies changed values only to new deployments ([official environment documentation](https://vercel.com/docs/environment-variables)).

Do not put service/provider secrets in any `NEXT_PUBLIC_*` variable. Do not copy a production service key into Preview. Preview needs its own isolated backend/database/raw store and synthetic accounts.

## Origins, cookies, and links

- Use one canonical HTTPS hostname per environment. Mutating auth routes compare the browser's `Origin` host to the request host.
- Generated admin login/invite links derive their origin from the incoming request; configure the final Vercel domain before distributing any link.
- The Python backend can stay on a different origin because browsers call the same-origin Next BFF, not Python directly. Allow outbound HTTPS from Vercel to `ENGINE_URL`.
- Reverse proxies must not buffer or truncate `text/event-stream` responses from the agent route.

### LinkedIn OAuth and client integration (local change, not deployed)

The 2026-09-23 local refinement adds `PATCH /api/client/social/accounts/[accountId]/auto-publish`
and requires backend social migrations `0025` and `0026` from PR #37 on the
main-based lineage. A connected account defaults to scheduled auto-publish on;
turning it off cancels queued scheduled jobs and leaves calendar plans, while Post now
remains explicit. Deploy backend migration/API and the Next route together. The
deployment-level publishing gate remains default-off regardless of this preference.

The local Next BFF now exposes `POST /api/client/social/linkedin/start`,
`GET /api/client/social/linkedin/callback`, and session-authenticated account,
provider and publication reads. A separate publish-now BFF route forwards to the
Python API. Settings → Integrations now shows a LinkedIn icon, personal-profile
label, verified connection state, token expiry and Connect/Reconnect control;
the Library exposes Post now for approved LinkedIn items
only when the backend enables publishing, plus a Posted status and publication
outcome. No provider token is stored in the browser. The backend
OAuth `POST` cannot itself receive LinkedIn's browser `GET`; the Next callback
exchanges the code server-side using the same httpOnly client session, then
redirects to `/refined/home?linkedin=...`; the client opens Integrations, removes
the query marker, and reads actual account state from the backend. The query
marker is informational, not proof of a connection.

For a given HTTPS hostname, register **exactly**
`https://<hostname>/api/client/social/linkedin/callback` in LinkedIn's Auth
tab and set the backend `LINKEDIN_REDIRECT_URI` to the identical URL. The
browser must start OAuth while signed in on that same origin. Vercel's existing
production hostname is not usable for this flow until these frontend routes,
the compatible Python backend/migration, and the matching server-only runtime
configuration are deployed. The unrelated Promo Partner deployment does not
provide them. A local HTTPS tunnel must reach the Next app and preserve the
signed-in origin; Vercel cannot call an unexposed localhost backend.

Backend runtime also needs `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, and
`SOCIAL_TOKEN_ENCRYPTION_KEYS`. Keep all values server-only and out of Git and
browser storage. `LINKEDIN_PUBLISHING_ENABLED` remains false by default; the
operator's personal-account test set it true in an isolated local runtime and
verified immediate text, immediate single-image, and scheduled text delivery.
Production enablement requires a separate provider-terms and rollout decision.
LinkedIn's [API Terms §3.1(26)](https://www.linkedin.com/legal/l/api-terms-of-use)
expressly prohibit using the APIs to automate posting, while its
[Posts API documentation](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api)
documents `w_member_social` for member publishing. The operator considers
human-approved scheduling compliant, but the unattended worker's status under
that restriction has not been confirmed by LinkedIn or qualified legal review;
do not infer authorization merely from scope access or a successful test.
For the current local visual preview, the worker and publishing are off, and
Reconnect is disabled because developer credentials are not loaded in that
process. Production flag changes need the terms question resolved;
pushing or merging code alone does not enable publishing. The temporary
`http://localhost:3101/api/client/social/linkedin/callback` registration in
the LinkedIn developer portal still needs removal when that portal accepts
the change. The current frontend/backend onboarding question-shape mismatch
is a separate overhaul issue and can obstruct a normal login walkthrough.

## Upload compatibility

The approved browser accepts individual files up to 20 MiB and the Python backend supports the inherited upload route. The current same-origin Next BFF receives each multipart body before forwarding it. Vercel Functions currently enforce a 4.5 MB request-body limit, so files above that platform limit will be rejected before this code runs ([official Vercel upload guidance](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)).

Therefore, a Vercel launch must choose one of these explicitly:

1. accept/document a Vercel-specific maximum below 4.5 MB; or
2. add an authorized direct-upload/presigned-storage contract and then update the frontend; or
3. host the Next Node server on infrastructure supporting the approved 20 MiB transport.

No direct-upload subsystem was invented in this work. This prerequisite does not affect smaller uploads or the other supported workflows.

## Separately hosted Python stack

Deploying the Vercel project does **not** deploy any of the following:

- Python 3.13 FastAPI application: `uvicorn app.main:create_app --factory`
- PostgreSQL 17 plus pgvector
- schema migrations, run separately with the admin-only connection
- the background worker (currently in-process when `WORKER_ENABLED=true`)
- persistent immutable raw-file storage

Backend runtime variables:

| Variable | Purpose | Required | Safe example / source |
| --- | --- | --- | --- |
| `SERVICE_API_KEY` | Authenticates the Next BFF | yes | Same secret as web `ENGINE_SERVICE_KEY` |
| `DATABASE_URL` | RLS-subject `engine_app` connection | yes in production | Managed PostgreSQL app-role URL |
| `ADMIN_DATABASE_URL` | Migration/admin connection only | migration process | Managed PostgreSQL admin-role URL |
| `WORKER_DATABASE_URL` | `engine_worker` job connection | yes when worker enabled | Managed PostgreSQL worker-role URL |
| `RAW_STORAGE_ROOT` | Immutable uploaded raw objects | yes | Mounted persistent path such as `/data/raw` |
| `WORKER_ENABLED` | Starts in-process job poller | yes | `true` for one designated service instance |
| `JOB_POLL_INTERVAL` | Poll interval seconds | optional | `0.5` |
| `CONTEXT_FULL_CORPUS_MAX_CHARS` | Whole-corpus context fast-path ceiling | optional | `100000` |
| `ENGINE_LLM_PROVIDER` | Python structured-knowledge LLM provider | yes by policy | `fake` for keyless tests; production provider chosen by operator |
| `ENGINE_EMBEDDING_PROVIDER` | Embedding provider | yes by policy | `fake` for keyless tests |
| `ANTHROPIC_API_KEY` | Python Anthropic provider, when selected | conditional secret | Provider account |
| `ENGINE_ANTHROPIC_MODEL` | Python model override | optional | Backend-supported model id |
| `VOYAGE_API_KEY` | Voyage embeddings, when selected | conditional secret | Provider account |
| `ENGINE_VOYAGE_MODEL` | Voyage model override | optional | Backend-supported model id |
| `PYTHON_DOTENV_DISABLED` | Prevents implicit parent dotenv discovery in controlled environments | recommended | `1` |

The current raw store is filesystem-backed. Use a persistent volume attached to the backend instance; ephemeral serverless filesystems are incompatible. If multiple API instances are required, a shared durable storage implementation is a prerequisite. Run exactly the intended worker topology so the in-process poller is not accidentally multiplied.

## Operator handoff

Once accounts, domains, provider authority, managed PostgreSQL/pgvector, durable storage, backend hosting, and the upload-size decision are complete, the web-project configuration should take roughly ten minutes:

1. import the repository into Vercel and set Root Directory to `frontend`;
2. select Node 22.x and default Next build output;
3. add the four production web secrets/URLs and distinct Preview values;
4. confirm the 300-second function duration is allowed;
5. deploy Preview, then run the smoke tests below.

This estimate excludes provisioning the backend, database, storage, provider accounts, DNS, or security review.

## Deployment smoke tests

1. `GET /refined/signin` returns 200 with the expected Referrer-Policy.
2. Python `GET /health` returns 200 from the backend host.
3. A bad login and a cross-origin login receive the same generic refusal; a valid synthetic Preview login sets a secure httpOnly cookie.
4. Direct-load `/refined/home`, `/refined/train?tab=knowledge`, `/refined/library`, and `/internal`.
5. Upload a small synthetic text file; observe accepted/processing/atomised or failed truthfully and reload.
6. Generate a synthetic grounded draft; observe SSE, a persisted citation, edit version, approval, schedule, reload, and logout.
7. Confirm a synthetic foreign-tenant document id is indistinguishable from absent (404).
8. Check function/backend logs for secrets and verify none are returned to the browser.

Actual deployment verification remains unexecuted until separately authorized.

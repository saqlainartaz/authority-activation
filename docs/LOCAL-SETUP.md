# Reproducible local setup

## Layout and prerequisites

- Web project root: `local/stakeholder-integration/frontend/frontend`
- Isolated compatible backend: `local/stakeholder-integration/backend`
- Node: 22.12 or newer (verification used Node 24.13)
- Python: 3.13 or newer
- PostgreSQL 17 with pgvector

Do not point these commands at the overhaul's services or an ambient database. Create a new loopback-only database on a non-default port with a unique `aa_stakeholder_*` name. Do not use an existing database, and do not read a repository `.env`.

## Backend

From the isolated backend checkout:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
```

Supply configuration through the process environment. Values below are safe shapes, not credentials:

```text
SERVICE_API_KEY=<random-local-value-at-least-16-characters>
ADMIN_DATABASE_URL=postgresql+psycopg://<migration-role>:<password>@127.0.0.1:<isolated-port>/<new-database>
DATABASE_URL=postgresql+psycopg://engine_app:<password>@127.0.0.1:<isolated-port>/<new-database>
WORKER_DATABASE_URL=postgresql+psycopg://engine_worker:<password>@127.0.0.1:<isolated-port>/<new-database>
RAW_STORAGE_ROOT=<new-task-owned-directory>
WORKER_ENABLED=true
ENGINE_LLM_PROVIDER=fake
ENGINE_EMBEDDING_PROVIDER=fake
PYTHON_DOTENV_DISABLED=1
```

Run migrations with the admin URL, then start the API:

```powershell
.\.venv\Scripts\alembic.exe upgrade head
.\.venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8001
```

`WORKER_ENABLED=true` starts the previous stack's in-process polling worker. Fake providers are deterministic and make no paid/live calls. For production-like provider checks, separate explicit authorization and provider credentials are required.

## Web

From `frontend/frontend`:

```powershell
npm ci
```

Set only process-local variables (the names are documented in `DEPLOYMENT-HANDOFF.md`):

```text
ENGINE_URL=http://127.0.0.1:8001
ENGINE_SERVICE_KEY=<same-value-as-SERVICE_API_KEY>
INTERNAL_PASSCODE=<random-local-admin-passcode>
ANTHROPIC_API_KEY=<required-only-for-real-model-path>
```

For normal production behavior, leave `NEXT_PUBLIC_AUTHORITY_DEMO` and `AUTHORITY_AGENT_DRIVER` unset. For keyless connected verification only, set `AUTHORITY_AGENT_DRIVER=deterministic`; this still executes the real TypeScript agent loop and Python context/draft verification but replaces the paid model decision.

```powershell
npm run dev
# or:
npm run build
npm run start -- --hostname localhost --port 3101
```

Use the same hostname throughout a session. Login and other mutating BFF routes compare the request `Origin` host with their own host; mixing `127.0.0.1` and `localhost` will correctly fail the same-origin check.

## Checks

```powershell
npm run check
npm run build
npm run test:e2e
```

The connected browser test additionally requires `AA_E2E_BASE_URL`, `AA_E2E_TOKEN`, `AA_E2E_INTERNAL_PASSCODE`, and `AA_E2E_SERVICE_KEY`. Generate a fresh token with the isolated backend's `scripts/e2e_seed.py`; never reuse production/client material.

Backend tests now refuse to start unless all three `STAKEHOLDER_TEST_*_DATABASE_URL` values name the same loopback database, use a non-default port, and use an `aa_stakeholder_e2e_` database name. `NEUTRALITY_MAINT_URL` must point at a maintenance database in that same disposable PostgreSQL service. This guard exists so inherited tests cannot reset an ambient database.

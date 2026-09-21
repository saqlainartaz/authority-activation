# Feature-gap report

These accepted gaps do not block the supported integrations. The approved layout and interaction presentation remain present; none is reported as a successful backend operation.

| Feature / screen | Expected operation | Backend evidence examined | Why not integrated / remaining behavior | What would be needed |
| --- | --- | --- | --- | --- |
| Dynamic per-client question generation, Onboarding | Generate a different questionnaire from each client's corpus | Backend catalogue, onboarding prefill/writeback and approved demo scope | The implemented catalogue is versioned and broadly applicable, with light display-name personalization; it is not model-generated per tenant. No dynamic-question capability is claimed. | Approved generation/evaluation contract, safe fallback catalogue, versioning and migration policy |
| Client-authored atom correction, Train Your AI | Rewrite an inaccurate provisional atom in place | Client atom list/decision APIs and append-only atom provenance | Confirm and eligible deprecate are connected. The previous backend exposes no client correction payload, so the UI does not invent one. | Provenance-preserving correction/supersession endpoint and review semantics |
| Profile editing, Settings / Account | Change display name/email/company | `GET /v1/me`, client/user routes, BFF callers | Previous client contract exposes identity reads but no self-service profile mutation. Fields are read-only. | Authenticated self-profile endpoint, validation, audit rules, and product copy |
| Password-recovery delivery, Sign in | Send a recovery email | Auth routes and provider configuration | No delivery endpoint/provider exists. The receipt presentation remains and explicitly says delivery is unsupported. | Approved mail provider, reset-token issuance/delivery contract, rate limits, templates |
| Guidance rules, Train your AI | Persist per-client generation rules | Context/constraint/atom APIs | No CRUD contract for arbitrary design guidance. Rules remain browser-local. | Versioned guidance entity and safe injection contract |
| Writing/learning preferences, Settings | Persist three design toggles | Client/profile/onboarding schemas | No corresponding stable backend fields. Preferences remain browser-local. | Named server fields, semantics, defaults, and migration policy |
| X generation, Workspace | Generate/save an X thread | Agent profiles, content platform enum, generation endpoints | Compatible agent supports LinkedIn only. Existing X fixture/local interaction remains and is labelled a demonstration. | Approved X content contract/profile and backend persistence; provider publishing is separate |
| Server-side generation cancellation, Workspace | Stop the active backend turn | Chat routes, commands, job interfaces | No cancellation token/endpoint is accepted by Python. Stop aborts browser display only and says the server may continue. | Authenticated idempotent cancel operation honored by agent/tool work |
| Original source filename/download, Knowledge | Download the uploaded raw source by its original name | Document output models and document routes | The client response exposes source type/id/status but no original name or authorized raw-file download. Server documents show backend state; local IndexedDB files can still be downloaded locally. | Tenant-scoped download endpoint, safe content headers, filename metadata, storage authorization |
| Usage and plan, Settings / Usage | Show true allowance and plan | Client/console/usage responses | Previous backend does not expose these values. The screen shows neutral unavailable values, never invented numbers. | Billing/allowance source of truth and authorized read endpoint |
| Unschedule while retaining approval, Library | Remove a slot without reverting content status | Schedule-slot/content transition routes | No compatible operation exists. Rescheduling is integrated; unschedule is not simulated. | Explicit cancellation transition and conflict/idempotency semantics |
| Email an admin-issued invite, Admin / Access | Deliver the generated link | Token issue/revoke endpoints and internal BFF | Admin can mint/copy/revoke a link; no email delivery exists. | Approved delivery provider and audited send endpoint |
| Publish or mark an external outcome, Library | Send to LinkedIn/X and report result | Content transitions and provider inventory | No social publishing subsystem/provider is present. No published result is invented. | New authorized provider integration, credential storage, queues, retries, webhooks, and product decisions |
| Full client data export, Settings / Data | Download an account export | Existing read/delete/document APIs | No single export contract or retention-policy implementation exists. Presentation remains without a false success. | Approved export scope, authorization, streaming/archive implementation, retention review |

## Scheduling boundary note

`start_new_post` is not this cancellation gap. The compatible backend supports
that command and the Workspace now uses it before or after a draft exists. It
finishes the old conversation and creates an authoritative replacement, but it
does not interrupt model work already executing for the old session.

The inherited wall-clock conversion normalizes a nonexistent Europe/London spring-forward time (for example 01:30 to 02:30 local) and chooses the later occurrence of a duplicated fall-back time. Tests pin this behavior. A different ambiguity policy would be a product/contract decision, not a frontend-only fix.

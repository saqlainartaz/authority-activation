# Manual end-to-end testing cheat sheet

Use this checklist with a synthetic account and synthetic content. The web app
is local, but connected mode writes to the configured backend and normal agent
turns can spend Anthropic usage. Do not paste credentials, magic links, client
documents, or provider keys into screenshots or bug reports.

## 1. Confirm connected mode

The local file is `frontend/frontend/.env.local`. It should contain these
server-only values, supplied by the operator:

```text
ENGINE_URL=<Render Python service HTTPS origin, with no /v1 suffix>
ENGINE_SERVICE_KEY=<same secret as Render SERVICE_API_KEY>
INTERNAL_PASSCODE=<local admin-console passcode>
ANTHROPIC_API_KEY=<Anthropic key for the TypeScript writing agent>
```

For a real connected check, `NEXT_PUBLIC_AUTHORITY_DEMO` must be absent or
blank, and `AUTHORITY_AGENT_DRIVER` must be absent or blank. No voice key is
needed by the frontend. Keep every secret out of `NEXT_PUBLIC_*` variables.

After changing `.env.local`, restart from `frontend/frontend`. Rebuild as well
if a `NEXT_PUBLIC_*` value changed:

```powershell
npm run build
npm run start -- --hostname localhost --port 3101
```

Open only `http://localhost:3101` throughout the test. Do not mix `localhost`
and `127.0.0.1`, because write routes enforce same-origin host matching.

## 2. Get into a synthetic client account

- Existing password account: open `/refined/signin` and sign in.
- Existing unused onboarding/invite link: open it directly. Treat the link as a
  password and do not share its URL.
- Admin-assisted entry: open `/internal`, enter `INTERNAL_PASSCODE`, select a
  synthetic client/person, then use Access to issue and copy an onboarding,
  invite, or reset link. Issuing a link writes a real backend token; it does not
  send an email.

Expected: `/refined/home` or `/refined/onboarding` loads, refresh preserves the
session, and a wrong password gives one generic refusal without clearing the
typed email.

## 3. Verify onboarding, Business DNA, and Train Your AI

Use a fresh synthetic person whose onboarding is incomplete.

1. Confirm the welcome uses the person's display name without placing their
   name inside stored answer JSON.
2. Answer the required open questions in natural sentences. Leave one optional
   long answer blank and use **Next**; it must advance without inventing text.
3. On a single-choice question, choose an ordinary option and confirm it
   advances automatically. Choose **Something else, I will type it** on another;
   it must stay on the question until custom text is entered and **Next** is used.
4. Review all nine answers. Blank optional fields must read **Not added yet**.
   Open the workspace, reload, and confirm onboarding remains complete.
5. Open **Business DNA**. Confirm exactly four minimal sections, authenticated
   name/profession, and the answers just supplied. Cancel one edit and confirm it
   disappears; save another and confirm it survives reload. If a save fails,
   the editor and unsaved text must remain.
6. Open **Train your AI → Questions**. Confirm the waiting count and text come
   from real provisional knowledge. Confirm one item; use **Not accurate** only
   when offered. Reload and confirm the decision remains. Guidance and writing
   preferences are still local-only gaps.

For ingestion inspection, the backend must contain each canonical record's
question id, catalogue version, exact question text, answer, ordinal and
submission time. The browser sends answer selections/text; it must not rename
questions or forge provenance.

## 4. Verify the corrected agent flow

Use a topic containing no confidential material.

1. Open `/refined/workspace` and enter an intentionally incomplete request,
   for example `How do I do it?`.
2. Confirm the starter cards disappear immediately and the submitted message
   remains as a user bubble.
3. Confirm an activity label appears before text, then the agent response
   streams into the conversation. It must look like one continuous agent turn,
   not several stacked AA replies.
4. When the agent asks a clarification, confirm there is no right-hand draft
   pane yet and the starter screen does not return. Confirm **New post** is
   already available.
5. Select **New post**. The confirmation must say that it will end this
   conversation; **Keep talking** must preserve the transcript. Open it again,
   choose **End and start new**, and confirm the URL receives a different
   `?session=...`, the old transcript disappears, and the fresh starter returns.
   Refresh and confirm that replacement session remains active. This is a real
   backend session operation even though no draft existed.
6. In the fresh session, enter `Give me some options`, then `You choose the
   best one`. The agent should offer or choose grounded account suggestions
   without repeatedly demanding a topic. It must not invent a story if the
   account has no supporting material.
   Also select each starter card once without sending. Confirm its composer
   text is a complete, natural request rather than a fragment ending in a
   colon. For **A customer question**, send the request and confirm the agent
   chooses a specific supported objection/question to retrieve. If the account
   genuinely has no candidates or matching material, it should offer three
   short hypotheses and ask which is real, not repeat “What should this post be
   about?” or claim a draft succeeded.
   Then run this flexible-retrieval matrix in separate new sessions:
   - `Write me a post based on my documentary. Find a catchy line from it.`
   - `I am talking about my ISTV documentary. Find the best angle.`
   - `What's a question clients keep asking me? Write the strongest supported one.`
   - `Choose the most useful lesson in my knowledge and write it for LinkedIn.`
   - one concrete topic phrased without the word `about`.
   For each, the agent should search semantically and attempt a grounded draft
   when matching material exists, rather than repeat the generic subject
   question. A filename or the request itself is not evidence. If the first
   result is mismatched, the agent may make one visibly different retrieval;
   it must not loop on equivalent queries. If no supporting material exists,
   expect one concise question or clearly labelled hypotheses, not a fabricated
   success.
7. Ask `Who am I, and how much data do you have about me?`. Confirm the answer
   uses your authenticated display name/profession and clearly labelled atom
   and represented-source counts. It must not claim that one empty generation
   snapshot means the whole account is empty, expose email/internal IDs, or
   invent document totals it cannot verify through the client credential.
8. Reply with a concrete, source-grounded topic. Confirm the conversation stays
   visible while the answer streams.
9. Confirm the draft appears only after the server has produced a real draft:
   as a right pane at 1,180 px and wider, and inline below 1,180 px.
   The conversation must remain mounted while the desktop pane expands/fades
   in; compact layouts should ease the result into the thread rather than snap
   to a different screen. With reduced motion enabled, the same state change
   should be effectively instant.
10. Copy the URL containing `?session=…`, reload it, and confirm the transcript
   and draft restore without duplicate messages.
11. Ask for a change. Confirm the existing draft remains visible while the next
   turn runs and failed work does not erase typed input.
12. Use **Keep as draft**, then open the item from Library and confirm the saved
   body and version survive reload.

The browser **Stop** action stops displaying the open stream only. The previous
backend has no server-side cancellation endpoint, so the server turn may still
finish; the UI must say this truthfully. **New post** is different: it uses the
supported session-replacement command, although a model request already in
flight for the old session may still complete against that old session.

## 5. Check navigation and responsive behavior

- Navigate Home → Library → Workspace using the sidebar without hard reloads.
  Pages should switch promptly, without each route visibly clearing and
  rebuilding all profile/library data.
- Test light and dark themes.
- In browser responsive mode, check widths 390, 767, 768, 1,179, 1,180, and
  1,440 px. There must be no horizontal page scroll.
- At 767 px and below, bottom navigation replaces the sidebar. At 768 px and
  above, the sidebar is available. The draft changes from inline to a separate
  pane between 1,179 and 1,180 px.
- Test a direct refresh on Home, Workspace with its session query, Library, and
  Train your AI with `?tab=knowledge`.

## 6. Exercise real persisted workflows

Every action in this section writes synthetic data to the configured Render
stack.

- Knowledge: upload a small synthetic `.txt` file. Confirm accepted/processing
  changes to atomised or failed truthfully, then reload and inspect it.
- Evidence: generate from that source and confirm **Show evidence** is enabled.
  On the compatible updated backend this must work before **Keep as draft** as
  well as after save/reload; the temporary browser receipt must not finish the
  conversation or leak into the model-facing runtime response.
  Select it: non-claim text should soften while supported spans remain legible
  and underlined. Open every numbered marker and confirm its popover shows a
  real quote, source label, and only the locator fields the backend returned.
  Compare these with the matching entry from
  `/api/client/content-items/<id>/versions`; the UI must not show the old sample
  revenue/pipeline citations. If the backend returns source labels but no
  receipt spans, the source list may remain, but the claim lens should be
  disabled rather than pretending sentence-level evidence exists. Edit a
  paragraph and confirm stale claim markers are cleared.
- Versions: edit a paragraph, save, reload, and confirm both the newest body and
  version history exist.
- Approval: approve one draft without a date and confirm it is approved, not
  scheduled.
- Scheduling: schedule another draft, reload, change its schedule, and verify
  the authoritative time persists in the account timezone.
- Admin: verify Overview, People, Sources, Knowledge, Voice profile, Access,
  and Held drafts load and all existing actions remain. At 1,180 px and above,
  confirm the client/module rail stays at the left and Overview metrics form
  four columns on a wide desktop. Below 1,180 px, confirm the modules become a
  compact horizontal rail above the content. At phone width, confirm there is
  no document-level horizontal scroll. Create records only under an explicitly
  disposable synthetic client.
- Logout: log out from Settings, then paste a previously copied protected URL.
  It must redirect to Sign in.

## 7. Know the expected gaps

Do not report these as regressions unless the backend contract has separately
changed: X generation is demo/local; Guidance and writing preferences are
browser-local; dynamic per-client onboarding questions and client-authored atom
correction are unsupported; profile editing, real recovery
email, original-source download, server-side turn cancellation, unschedule,
social publishing, full data export, and invite email delivery are unsupported.
See `FEATURE-GAPS.md` for evidence and prerequisites.

## 8. Record a useful bug report

Capture the route without credential query values, viewport width, theme,
exact synthetic input, expected and actual result, whether a hard reload fixes
it, HTTP status/response shape with secrets redacted, and a screenshot or short
screen recording. For agent issues, note whether the failure happened before
streaming, during clarification, before draft appearance, or while saving.

Run the local regression gates after any code change:

```powershell
npm run check
npm run build
```

The automated connected Playwright suite is intended for the isolated
disposable backend described in `LOCAL-SETUP.md`; do not point it at Render,
because it deliberately creates clients, uploads sources, generates drafts,
schedules content, and logs out the test account.

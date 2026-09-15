import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function source(relative) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) {
    failures.push(`${relative} is missing`);
    return "";
  }
  return fs.readFileSync(absolute, "utf8");
}

function requireText(label, text, needle) {
  if (!text.includes(needle))
    failures.push(`${label} is missing ${JSON.stringify(needle)}`);
}

function forbidText(label, text, pattern) {
  if (pattern.test(text))
    failures.push(`${label} contains forbidden ${pattern}`);
}

/** A representative mutation must make its assertion fail, or the assertion is decorative. */
function mutationTrips(label, text, needle) {
  const mutated = text.replaceAll(needle, "__chat_contract_mutation__");
  if (mutated === text || mutated.includes(needle)) {
    failures.push(
      `${label} mutation control does not trip for ${JSON.stringify(needle)}`,
    );
  }
}

// The `turns` BFF route (`.../[sessionId]/turns/route.ts`) and `sendChatTurn`/
// `ChatTurnCreate` in `product.ts` were deleted at step 6 of this plan (A14):
// §9 step 5 had already moved turn creation to `useAgentTurn`'s `.../agent`
// POST (see the `}/turns` precedent comment on `hook` below), which left the
// route with zero callers. This file's own `turns` binding and its assertions
// go with it, the same way `}/turns` already left the `hook` list.
const product = source("src/lib/product.ts");
const sessions = source("src/app/api/client/chat/sessions/route.ts");
const session = source("src/app/api/client/chat/sessions/[sessionId]/route.ts");
const commands = source(
  "src/app/api/client/chat/sessions/[sessionId]/commands/route.ts",
);
const hook = source("src/components/compose/useChatSession.ts");
const agentTurn = source("src/components/compose/useAgentTurn.ts");
const chatPath = source("src/components/compose/ChatPath.tsx");
const draftCard = source("src/components/compose/ChatDraftCard.tsx");
const sources = source("src/components/compose/ChatSources.tsx");
const variants = source("src/components/compose/ChatVariants.tsx");
const confirmations = source("src/components/compose/ChatConfirmDialog.tsx");
const rejectSheet = source("src/components/decide/RejectSheet.tsx");
const composePage = source("src/app/(app)/compose/page.tsx");
const startPost = source("src/lib/use-start-post.ts");
const variantSourcesTool = source("src/agent/tools/get-variant-sources.ts");
const stateSpec = source("e2e/chat-first-states.spec.ts");

requireText("product", product, 'cache: "no-store"');
for (const [name, text] of [
  ["sessions BFF", sessions],
  ["session BFF", session],
  ["commands BFF", commands],
])
  requireText(name, text, "clientToken()");

requireText("product", product, 'import "server-only"');
for (const type of [
  "ChatReadiness",
  "ChatSource",
  "ChatMessage",
  "ChatVariant",
  "ChatPendingConfirmation",
  "ChatTerminalState",
  "ChatSession",
  "ChatSessionEnvelope",
  "ChatSessionCreate",
  "ChatCommandCreate",
])
  requireText("product", product, `export type ${type}`);
for (const method of [
  "activeChatSession",
  "createChatSession",
  "readChatSession",
  "sendChatCommand",
])
  requireText("product", product, `function ${method}`);
for (const fixed of ['platform: "linkedin"', 'artifact: "social_post"'])
  requireText("product", product, fixed);
for (const pathNeedle of [
  "/v1/chat/sessions/active",
  '"/v1/chat/sessions"',
  "/commands",
])
  requireText("product", product, pathNeedle);

requireText("sessions BFF", sessions, "activeChatSession(token)");
requireText("sessions BFF", sessions, "createChatSession(token, body)");
requireText("session BFF", session, "await params");
requireText("session BFF", session, "readChatSession(token, sessionId)");
requireText(
  "commands BFF",
  commands,
  "sendChatCommand(token, sessionId, command)",
);
requireText("sessions BFF", sessions, "Object.keys(raw).some");
requireText("sessions BFF", sessions, "idempotency_key");
requireText("commands BFF", commands, "function exactKeys");
requireText("commands BFF", commands, "idempotency_key");
requireText("commands BFF", commands, "CONFIRM_KINDS");
requireText("commands BFF", commands, "start_new_post");
for (const contractNeedle of ["pending_confirmation_id", "confirmed: true"])
  requireText("commands BFF", commands, contractNeedle);
requireText(
  "commands BFF",
  commands,
  'exactKeys(raw, ["kind", "pending_confirmation_id", "confirmed", "idempotency_key"])',
);

/* ---------------------------------------------------------------------------
 * NARROWED (§9 step 6, Task 9). `generate`, `revise`, `show_sources` and
 * `reject_variant` became agent tools at step 4 and have had no browser
 * sender since step 5; the backend stopped accepting them the same step
 * (`DraftCommand` in `src/product/chat/commands.py`). Pinned as a forbid
 * against the BFF's own source, not a mere absence of the four in prose.
 *
 * SCOPED TO `commands` ONLY, not `product`: `product.ts` still legitimately
 * declares `operation: "generate" | "revise" | "resume"` for
 * `prepare_generation`'s own parameter (a different vocabulary — the
 * MODEL's tool argument, not a `/commands` kind) — scanning the whole file
 * would false-positive on that unrelated literal.
 *
 * `mutationTrips` doesn't fit here — it proves a PRESENT needle would
 * survive a mutation, which is backwards for a forbid. Instead the pattern
 * itself is proven capable of catching a real occurrence, against a
 * synthetic string, the same idiom `assert-agent-prompt-versions.mjs` uses
 * for its own mutation controls.
 * ------------------------------------------------------------------------- */
const REMOVED_COMMAND_KINDS = ["generate", "revise", "show_sources", "reject_variant"];
for (const kind of REMOVED_COMMAND_KINDS)
  forbidText("commands BFF no longer accepts removed kind", commands, new RegExp(`"${kind}"`));
for (const kind of REMOVED_COMMAND_KINDS) {
  if (!new RegExp(`"${kind}"`).test(`const KINDS = new Set(["${kind}"]);`)) {
    failures.push(`mutation control does not trip: forbidText's pattern misses a present ${JSON.stringify(kind)}`);
  }
}

for (const readiness of [
  "ready",
  "answer_needed",
  "blocked_by_conflict",
  "optional_enrichment",
])
  requireText("product readiness", product, `\"${readiness}\"`);
for (const terminal of ["refused", "held"])
  requireText("product terminal state", product, `\"${terminal}\"`);
requireText("product terminal state", product, "terminal_state");

requireText("hook", hook, '"use client"');
requireText("hook", hook, "import type");
// `}/turns` is gone from this list (not merely renumbered): §9 step 5 moved
// turn creation to `useAgentTurn`, which posts to `.../agent` instead. That
// route is pinned below, against `useAgentTurn.ts`'s own source (loaded as
// `agentTurn`) — NOT by any `check:agent-*` script, none of which loads this
// file; `check:agent-*` targets `src/agent/`, a different module tree.
for (const route of ['"/api/client/chat/sessions"', "}/commands"])
  requireText("hook", hook, route);
// The one assertion that pins WHERE a turn is actually sent, now that it left
// this file. `}/agent` is the POST path (`useAgentTurn.ts`'s `fetch` call);
// `turnId` is A11's one-turn-id-per-browser-turn contract, which every tool's
// idempotency key derives from server-side.
requireText("agent turn route", agentTurn, "}/agent");
requireText("agent turn route", agentTurn, "turnId");
requireText("hook", hook, "export type ChatUiPhase");
requireText("hook", hook, "export function useChatSession");
requireText("hook", hook, "export function phaseForChat");
// §9 STEP 5 REPLACED THE POLL WITH A STREAM. `setInterval` and the
// `generation_stage !== null` guard were the poll's own assertions; the column
// is cleared unconditionally on the agent lane (`chat.py`'s
// `_run_context_operation`), so asserting a phase derived from it would pin a
// state that can no longer occur. What replaces them asserts the STREAM is
// what the hook reads, and that it reads it through the shared parser rather
// than a second, private one.
requireText("hook", hook, "useAgentTurn");
requireText("hook", hook, "turn.status === \"streaming\"");
requireText("hook", hook, "turn.terminal !== null");
forbidText("hook has no poll", hook, /setInterval|clearInterval|generation_stage !== null/);
forbidText("hook has no second parser", hook, /getReader\(|TextDecoder/);
requireText("hook", hook, "HttpError");
for (const gone of ['case "verifying_grounding"', '"checking_context"', '"blocked_by_conflict"'])
  forbidText("hook drops the polled states", hook, new RegExp(gone.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
requireText("hook authoritative session", hook, "session.terminal_state !== null");
requireText("hook authoritative session", hook, "session.id");
forbidText(
  "hook",
  hook,
  /localStorage|sessionStorage|Date\.now|elapsed|percentage|Anthropic|ENGINE_SERVICE_KEY|ENGINE_URL/,
);
// The stream reader lives in ONE module, and it is not this one. `useAgentTurn`
// owns the fetch and the decode; the hook owns keying, phases and commands.
forbidText("hook", hook, /fetch\(/);
forbidText("hook", hook, /client_id|campaign_id|content_item_id/);
forbidText("hook", hook, /import\s+\{[^}]+\}\s+from\s+["']@\/lib\/product["']/);
// `useAgentTurn.ts` is the other client hook that touches `@/lib/product`
// (for `ChatSessionEnvelope`'s type only) — the same server-only rule as the
// hook above, or a value import here is a build-time failure at best and a
// leak at worst, and until now nothing pinned it.
forbidText("agent turn", agentTurn, /import\s+\{[^}]+\}\s+from\s+["']@\/lib\/product["']/);

for (const [label, text, needle] of [
  ["fixed platform", product, 'platform: "linkedin"'],
  ["stream outranks the envelope", hook, "turn.status === \"streaming\""],
  ["agent turn route", agentTurn, "}/agent"],
  ["agent turn route", agentTurn, "turnId"],
])
  mutationTrips(label, text, needle);

for (const [label, text, needles] of [
  [
    "chat path",
    chatPath,
    [
      "what do you want to write about?",
      "Describe the post you need",
      "echo.map",
      "This conversation expired after 24 hours.",
      'aria-live="polite"',
      'aria-label="Send request"',
      "copy_variant",
      "select_variant",
      "finish",
    ],
  ],
  [
    "compose page",
    composePage,
    ["useChatSession", "PageHeader", "LinkedInMark"],
  ],
  [
    "draft card",
    draftCard,
    [
      'status === "verified"',
      "whitespace-pre-line",
      "copyVerifiedDraft",
      // WAS "Finish this version", a single button that promoted the version and
      // then dead-ended: nothing offered approval and nothing offered a date. The
      // control is not relaxed by this change, it is re-aimed — it still fails if
      // the terminal action is deleted, but the terminal action is now a PAIR, and
      // pinning the old label would pin the dead end in place.
      "Save as draft",
      "Approve",
      "aria-busy",
    ],
  ],
  [
    "sources",
    sources,
    [
      "Grounded in",
      "Show sources",
      "No source details are available for this draft. Generate a new draft.",
      "usableSources",
    ],
  ],
  [
    "variants",
    variants,
    [
      "Previous drafts",
      'type="radio"',
      'status === "verified"',
      "overflow-y-auto",
    ],
  ],
  [
    "confirmations",
    confirmations,
    [
      "Start a new conversation?",
      "Unselected drafts in this conversation will be removed.",
      "Keep this conversation",
      "Never use “${phrase}” again?",
      "Keep current writing rules",
      "Save rule",
      "ConfirmDialog",
    ],
  ],
])
  for (const needle of needles) requireText(label, text, needle);

/* `chat readiness question` (asserting `session.readiness?.question` appears
 * in `ChatPath`) is GONE, not merely renamed: §9 step 5 deleted
 * `readinessQuestion()`, the ONLY reader of that field in this file, along
 * with the `requiredQuestionMissing` status line it existed to detect. The
 * question this used to guard now reaches the client as an ordinary
 * assistant message in `session.messages` (the agent's own prose, D4/D6) --
 * see "one question bubble" below, which already pins that transcript render
 * and is the assertion that actually covers this ground now. */
requireText(
  "pending confirmation kind",
  product,
  'kind: "durable_fact" | "durable_constraint"',
);
for (const [label, text, needle] of [
  [
    "durable fact dialog",
    confirmations,
    "Save “${phrase}” as a business fact?",
  ],
  [
    "durable fact dialog",
    confirmations,
    "This adds it to your business context, so this draft and future ones can use it.",
  ],
  ["durable fact dialog", confirmations, "Not now"],
  ["durable fact dialog", confirmations, "Save fact"],
  [
    "fact confirmation branch",
    chatPath,
    'confirmation.kind === "durable_fact"',
  ],
  [
    "constraint confirmation branch",
    chatPath,
    'confirmation.kind === "durable_constraint"',
  ],
  ["fact confirmation command", chatPath, 'kind: "confirm_durable_fact"'],
  ["constraint confirmation command", chatPath, 'kind: "confirm_constraint"'],
  ["fact confirmation identity", chatPath, 'actionId("save-fact")'],
  ["constraint confirmation identity", chatPath, 'actionId("save-rule")'],
]) {
  requireText(label, text, needle);
  mutationTrips(label, text, needle);
}

/* ---------------------------------------------------------------------------
 * The composer contract. Each control below names one observed defect, so a
 * later reader can tell what would break if it were deleted.
 * ------------------------------------------------------------------------- */

// One reading column at the width the rest of the app uses, padded at every
// breakpoint. `sm:px-0` is what let the composer sit flush to the container edge.
requireText("chat column", chatPath, "max-w-[720px]");
forbidText("chat column", chatPath, /max-w-\[1000px\]/);
forbidText("chat column", chatPath, /px-6 sm:px-0/);

// ONE input on the screen. The second textarea is what had no Enter handler,
// so its absence — not a handler added to it — is the fix.
forbidText("single composer", chatPath, /clarification-answer/);
forbidText("single composer", chatPath, /Send request<\/Button>/);

// A RUNNING TURN MUST NEVER DISABLE THE ONLY INPUT ON THE SCREEN. A turn can
// run the full 120s deadline (`src/agent/bounds.ts`), so this is the friction
// control for the whole step: the composer is gated by a dead session and by
// nothing else, and a send during a turn is queued rather than refused.
requireText("composer stays enabled", chatPath, "disabled={expired}");
requireText(
  "composer stays enabled",
  chatPath,
  "const canSend = message.trim().length > 0 && !expired;",
);
forbidText("composer stays enabled", chatPath, /disabled=\{busy \|\| /);
forbidText("composer stays enabled", chatPath, /disabled=\{[^}]*working/);

// TWO NUMBERS THAT MUST AGREE, IN TWO FILES. The composer warns the client
// before they press send; the hook silently discards anything over the same
// limit. If they drift, one of them lies — either a refusal the hook would
// not have made, or a send that vanishes with no explanation. Pinned to the
// literal in both files rather than to a comment asking someone to remember.
for (const [label, text, needle] of [
  ["composer limit mirrors the hook", chatPath, "COMPOSER_MAX_CHARS = 4_000"],
  ["composer limit mirrors the hook", agentTurn, "AGENT_TURN_MAX_CHARS = 4_000"],
]) {
  requireText(label, text, needle);
  mutationTrips(label, text, needle);
}

// Send sits inside the input row, not in a justify-end block underneath it.
forbidText("inline send", chatPath, /mt-4 flex justify-end/);

// Enter submits. This is a regression guard, not a new behaviour.
requireText("enter submits", chatPath, 'event.key !== "Enter"');

// Quiet unless blocked: no bare status word, and the optional-material note
// rides on the draft rather than interrupting the thread as a turn.
forbidText("quiet when ready", chatPath, /<StatusTurn>Ready<\/StatusTurn>/);
forbidText("quiet when ready", chatPath, /Optional enrichment:/);
requireText(
  "optional note on draft",
  draftCard,
  "More of your material would sharpen this draft.",
);

for (const [label, text, needle] of [
  ["chat column", chatPath, "max-w-[720px]"],
  ["composer stays enabled", chatPath, "disabled={expired}"],
  [
    "optional note on draft",
    draftCard,
    "More of your material would sharpen this draft.",
  ],
])
  mutationTrips(label, text, needle);

/* ---------------------------------------------------------------------------
 * "Start a post" NAVIGATES. It does not provision.
 *
 * Phase 8 moved creation to the first chat turn, but the callers kept minting a
 * `provisioning_key` and a `topic` that NOTHING reads — `compose/page.tsx` only
 * ever deleted them. The idempotency ceremony therefore guarded a value no
 * server sees, and its `inFlight` ref was set true and never reset: since the
 * Sidebar lives in the app shell and never remounts, one click killed every
 * "Start a post" button for the life of the page. A reload was the only cure.
 * ------------------------------------------------------------------------- */

requireText("start a post navigates", startPost, 'router.push("/compose")');
// Patterns match CODE, not prose. The doc comment in `use-start-post.ts` names
// all three of these deliberately, to explain why they are gone — a control that
// fires on its own documentation is a control that gets deleted rather than
// obeyed. So: a call, a member access, and a quoted param name.
forbidText("start a post navigates", startPost, /useIdempotencyKey\(/);
forbidText("start a post navigates", startPost, /inFlight\.current/);
// `provisioning_key` was an UNQUOTED object key in the old code
// (`new URLSearchParams({ provisioning_key: ... })`), so a quoted-only pattern
// passes on the very code it exists to forbid. Match the key/assign form, which
// prose never produces.
forbidText("start a post navigates", startPost, /provisioning_key\s*[:=]/);
forbidText("compose page", composePage, /["']provisioning_key["']/);

// The conversation is started INSIDE compose, and it is a conversation rather
// than a post — the dialog body already said so while its title did not.
requireText("new conversation copy", chatPath, "Start a new conversation");
forbidText("new conversation copy", chatPath, /Start a new post/);

for (const [label, text, needle] of [
  ["start a post navigates", startPost, 'router.push("/compose")'],
  ["new conversation copy", chatPath, "Start a new conversation"],
])
  mutationTrips(label, text, needle);

const UI_CONSIDERATIONS = [
  "UI-C01",
  "UI-C02",
  "UI-C03",
  "UI-C04",
  "UI-C05",
  "UI-C06",
  "UI-C07",
  "UI-C08",
  "UI-C09",
  "UI-C10",
  "UI-C11",
  "UI-C12",
  "UI-C13",
  "UI-C14",
  "UI-C15",
  "UI-C16",
  "UI-C17",
  "UI-C18",
  "UI-C19",
  "UI-C20",
  "UI-C21",
  "UI-C22",
  "UI-C23",
  "UI-C24",
  "UI-C25",
  "UI-C26",
  "UI-C27",
  "UI-C28",
  "UI-C29",
  "UI-C30",
  "UI-C31",
  "UI-C32",
  "UI-C33",
  "UI-C34",
  "UI-C35",
  "UI-C36",
  "UI-C37",
  "UI-C38",
  "UI-C39",
  "UI-C40",
];
for (const identifier of UI_CONSIDERATIONS)
  requireText("UI consideration state spec", stateSpec, identifier);
requireText("UI consideration state spec", stateSpec, "toHaveLength(40)");
for (const [label, text, pattern] of [
  [
    "chat path",
    chatPath,
    /Campaigns|PlatformStep|ObjectiveStep|completeness|percentage|ReadableStream|EventSource/,
  ],
  ["draft card", draftCard, /dangerouslySetInnerHTML|fetch\(/],
  ["sources", sources, /fetch\(|dangerouslySetInnerHTML/],
])
  forbidText(label, text, pattern);
mutationTrips("empty chat copy", chatPath, "what do you want to write about?");
mutationTrips("save-as-draft action", draftCard, "Save as draft");
mutationTrips("approve action", draftCard, "Approve");

/* ---------------------------------------------------------------------------
 * A finished draft must LEAD SOMEWHERE. The promote step (`finish`) was never
 * the defect — it worked, and it is still both arms' first call. The defect was
 * that it was the last thing on the screen: the client ended on a saved draft
 * with no approval and no date, on a card that offered neither.
 *
 * `content_item_id` is what makes the sequel possible. The engine publishes it
 * on the session envelope, and approve/schedule both resolve the version from
 * that item's live transition — so it is the only id either call needs, and
 * pinning it here is what stops the wiring being quietly reverted to a
 * dead end.
 *
 * The DIRECTION is the part worth guarding. The client RECEIVES this id; it
 * never chooses one. The hook's own forbid (above) still refuses the string
 * outright, because a content-item selector in a create, turn or command body
 * is exactly the tenant-selection hazard the browser allowlist exists to stop.
 * ------------------------------------------------------------------------- */

requireText("finished draft leads somewhere", product, "content_item_id: string | null");
for (const [label, text, needle] of [
  ["approve reads the published id", chatPath, "session?.session.content_item_id"],
  ["approve promotes before approving", chatPath, 'kind: "finish"'],
  ["approve calls the content-item route", chatPath, "/approve"],
  ["approve offers a date in place", chatPath, "SchedulePicker"],
  ["approve passes the item, not a slot", chatPath, "contentItemId={approved.content_item_id}"],
]) {
  requireText(label, text, needle);
  mutationTrips(label, text, needle);
}

/* ---------------------------------------------------------------------------
 * ONE COMPOSER, ONE DESTINATION (§9 step 5).
 *
 * This section used to assert the OPPOSITE and was right to: while readiness
 * routed the composer, a missing material fact answered with
 * `answer_clarification` rebuilt the snapshot exactly as blocked and returned
 * the same question forever, so which command an answer became decided whether
 * the block could ever clear.
 *
 * The agent removes the fork rather than picking a side. It reads gaps and
 * conflicts out of `context.v1`, asks in its own prose, and calls
 * `propose_durable_fact` ITSELF when a fact is what is missing
 * (`src/agent/tools/propose-durable-fact.ts`) -- so a clarification answer
 * sent to `/commands` is an answer the agent never sees as a turn. The forbids
 * below name the SHAPE of the routing that is now wrong, so this file fails on
 * that code rather than merely passing on this.
 *
 * `confirm_durable_fact` is untouched and must stay: PROPOSE is the tool,
 * CONFIRM is a human act (A7), and the dialog is where it happens.
 * ------------------------------------------------------------------------- */

forbidText("one destination", chatPath, /const sent = clarification/);
forbidText("one destination", chatPath, /kind: "answer_clarification"/);
forbidText("one destination", chatPath, /kind: "propose_durable_fact"/);
forbidText("one destination", chatPath, /requiredFactKey|readinessQuestion/);
forbidText("one destination", chatPath, /Blocked by conflict|ClarificationTurn|One answer needed/);
for (const [label, text, needle] of [
  ["one destination", chatPath, "onSendTurn(text)"],
  ["one question bubble", chatPath, "session?.messages.map"],
  ["confirmation stays a human act", chatPath, 'kind: "confirm_durable_fact"'],
  // Readiness still rides the envelope; only the ROUTING went. The draft
  // card's material note is the proof, and it reads readiness directly now.
  ["readiness still informs the draft", chatPath, 'session?.readiness?.status === "optional_enrichment"'],
]) {
  requireText(label, text, needle);
  mutationTrips(label, text, needle);
}

/* ---------------------------------------------------------------------------
 * D-B (2026-08-25, §9 step 6, Task 11). Reject no longer starts a
 * replacement generation — `RejectedOut` lost `regeneration` on the Python
 * side the same day. `RejectSheet.tsx:76` and `DraftActions.tsx:42` used to
 * read `result.regeneration.status`/`.job_id`; after that backend change
 * those were property reads on `undefined`, a runtime TypeError in a live
 * flow. Pinned here so neither the type nor the reads can silently return.
 *
 * Same `forbidText` + synthetic-mutation-control idiom as Task 9's removed
 * command kinds above: `mutationTrips` proves a PRESENT needle survives a
 * mutation, which is backwards for a forbid, so the pattern is instead
 * proven capable of matching a real occurrence against a synthetic string.
 * ------------------------------------------------------------------------- */
forbidText("product has no Regeneration type", product, /\bRegeneration\b/);
forbidText("RejectSheet reads no regeneration field", rejectSheet, /\bregeneration\b/);
if (!/\bRegeneration\b/.test("export type Regeneration = { status: string };")) {
  failures.push("mutation control does not trip: forbidText's pattern misses a present Regeneration type");
}
if (!/\bregeneration\b/.test("result.regeneration.status")) {
  failures.push("mutation control does not trip: forbidText's pattern misses a present regeneration read");
}

/* ---------------------------------------------------------------------------
 * TASK 13 (2026-08-26, §9 step 6). `get_variant_sources` un-stranded.
 *
 * From step 6 task 2 (2026-08-25) to this task it THREW unconditionally --
 * `show_sources`, the command kind it posted to `/commands`, was retired the
 * same step this tool was created, and no replacement route existed on the
 * Python side. The fix is `GET .../variants/{variant_id}/sources`
 * (`src/product/api/chat.py::read_variant_sources`) plus `getChatVariantSources`
 * in `lib/product.ts`; this guard is what stops the tool silently regressing
 * back to a stub -- thrown OR resolved-empty-unconditionally -- the way it did
 * once already without a test file catching it before the review that found
 * it (Task 9's own discovery, recorded at the top of this file's D-B section).
 *
 * `mutationTrips` doesn't fit the forbid half for the same reason it doesn't
 * fit the `REMOVED_COMMAND_KINDS` block above: it proves a PRESENT needle
 * would survive a mutation, backwards for a forbid. So the stub message is
 * proven catchable against a synthetic string instead, same idiom.
 * ------------------------------------------------------------------------- */
for (const [label, text, needle] of [
  ["variant-sources tool calls the real route", variantSourcesTool, "getChatVariantSources("],
  ["variant-sources tool reads the runtime token", variantSourcesTool, "context.token"],
  ["variant-sources tool reads the session id", variantSourcesTool, "context.sessionId"],
  ["product exposes the sources route", product, "function getChatVariantSources"],
  ["product sources route path", product, "/sources`"],
]) {
  requireText(label, text, needle);
  mutationTrips(label, text, needle);
}
const STUB_MESSAGE = "cannot be retrieved right now";
forbidText(
  "variant-sources tool no longer stubs",
  variantSourcesTool,
  new RegExp(STUB_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
);
if (!new RegExp(STUB_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(
  `throw new Error("Receipts ${STUB_MESSAGE}")`,
)) {
  failures.push("mutation control does not trip: forbidText's pattern misses the present stub message");
}

if (failures.length > 0) {
  console.error("assert-chat-contract failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  "assert-chat-contract — fixed BFF, server-only authority, and total client session controller verified",
);

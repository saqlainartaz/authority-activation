import fs from "node:fs";
import path from "node:path";

import { NoClientSession, requireClientToken } from "@/lib/client-session";
import {
  expiredLinkResponse,
  forwardProductError,
  getMe,
  getOnboarding,
  readJsonObject,
  recordAgentTurn,
  postTurnBudget,
  recordClientTurn,
  type ChatTurnBudgetCreate,
  type RuntimeSessionEnvelope,
  usesKnowledgeEngine,
} from "@/lib/product";

import { instructionsFor } from "@/agent/capabilities";
import type { AgentEvent } from "@/agent/events";
import { derivedKey } from "@/agent/lib/backend";
import { clientBriefMessage, projectClientBrief } from "@/agent/lib/client-brief";
import { readClientKnowledge } from "@/agent/lib/client-knowledge";
import { clientTimezone } from "@/lib/client-timezone";
import { compactSession, type SessionCompaction } from "@/agent/lib/compaction";
import { buildSystemBlocks, buildTurnMessages, todayMessage } from "@/agent/lib/context-assembly";
import type { TurnUsage } from "@/agent/lib/driver";
import { createExecutor } from "@/agent/lib/executor";
import { runMeteredOperation, type WritingReservation } from "@/agent/lib/metered-operation";
import { anthropicC4Driver, anthropicDriver } from "@/agent/lib/loop";
import { deterministicDriver } from "@/agent/lib/deterministic-driver";
import { skillVersion, type SkillVersion } from "@/agent/lib/prompt-versions";
import { recentPostsContext } from "@/agent/lib/recent-posts";
import { requestChars, type ReplyBounds } from "@/agent/lib/reply-cap";
import { nearCompaction } from "@/agent/lib/session-length";
import { encodeEvent } from "@/agent/lib/stream";
import { buildToolSpecs } from "@/agent/lib/tool-schemas";
import { boundTranscript, type BoundedTranscript } from "@/agent/lib/transcript-bound";
import { runAgentTurn } from "@/agent/lib/turn";
import { meterTurn } from "@/agent/lib/turn-settlement";
import {
  needsWorkspaceOverview,
  readWorkspaceOverview,
  workspaceOverviewMessage,
} from "@/agent/lib/workspace-overview";
import { PROFILES, profileKeyFor, resolveProfile } from "@/agent/profile";
import {
  assembleTranscript,
  excludingJustRecordedMessage,
  justRecordedMessage,
  type ModelMessage,
} from "@/agent/transcript";

/**
 * §5.1's lifecycle, §5.2's assembly and §5.3's stream, composed in one place.
 *
 * This is the ONE route that ties every earlier §9 step 4 task together:
 * `context-assembly.ts` (Task 3), `tool-schemas.ts` (Task 4), `turn.ts` (Task
 * 5), `loop.ts` (Task 6), the five tools (Task 7) and `stream.ts`/this route
 * (Task 8). Tool dispatch itself — the mutable handles/snapshot wiring
 * Ruling R2 requires, per-tool idempotency attempts — lives in
 * `src/agent/lib/executor.ts`, extracted out of this file in the Task 8 fix
 * round (item 5) specifically so it has a seam a test can call through
 * without a full `Request` harness. This file owns: the request, recording
 * both turns, assembling context, the driver (including the usage-tracking
 * wrapper below), and the stream.
 *
 * §5.1's eight steps, and where each lives below:
 *
 *   1. Read `{ message, turnId }` and NOTHING else.        `TURN_KEYS`
 *   2. Resolve the capability profile before the model sees anything.  `resolveProfile`
 *   3. Record the client's turn.                            `recordClientTurn`
 *   4. Read the envelope, assemble context.                 `excludingJustRecordedMessage` / `buildSystemBlocks` / `buildTurnMessages`
 *   5. Loop: model call -> tool dispatch -> repeat.          `runAgentTurn` + `createExecutor`
 *   6. Stream events.                                        `onEvent` below, live
 *   7. Record the agent's verbatim final text as kind=agent. `recordAgentTurn`
 *   8. Turn ends. Nothing agent-side persists.               `controller.close()`
 *
 * Identity never appears in step 1: it comes from `requireClientToken()`,
 * off this request's own cookie jar — the same accessor the three
 * client-credential tools already use internally, and the only accessor
 * this file uses too, so there is exactly one auth path on this surface.
 *
 * RULING R1 (controller, given verbatim). `buildSystemBlocks` and
 * `buildTurnMessages` exist so §4.8's ordering — instructions -> skill ->
 * material -> transcript -> bounded turn context -> current turn — actually reaches the model.
 * `runAgentTurn`'s `system` and `messages` options are what carry it; a route
 * that assembled context and then called `runAgentTurn({ driver, executor })`
 * with neither would make all of that dead code. Both are passed below.
 *
 * RULING R2 (controller, given verbatim). Material is a TOOL RESULT, not
 * turn input: at turn start there is no material, because it arrives only
 * when the model calls `prepare_generation`. So `buildTurnMessages` is called
 * with `material: []` here, and `createExecutor` (in `lib/executor.ts`) owns
 * the mutable `handles` map and `snapshotId`, both filled the moment
 * `prepare_generation` returns its `ContextV1`, via `renderMaterial` called
 * exactly ONCE, inside that module.
 *
 * FOUR DEFECTS FOUND WIRING THIS ROUTE FOR REAL, ALL FIXED WHERE THEY LIVE —
 * see each file's own comment for the reasoning; recorded here as an index:
 *
 *   - `submit-draft.ts`: read the drafts endpoint's response from the wrong
 *     (top-level vs. nested `payload`) location.
 *   - `turn.ts`: escaped `prepare_generation`'s ENTIRE result rather than
 *     splicing only the `material` field, which needlessly reopened the
 *     tag-forgery hole on `background`/`conflicts` too (Task 8 fix round,
 *     item 2 — corrected from this task's own first attempt).
 *   - `turn.ts`: counted a `submit_draft` attempt before the executor could
 *     say whether it ever reached Python — §4.7 mechanism 3 held only in
 *     scripted tests, not against a real executor (item 3).
 *   - THIS FILE (below): fed the client's own just-recorded message to the
 *     model TWICE every turn — once via the transcript (the recording
 *     endpoint's own response already ends with it), once via
 *     `buildTurnMessages`'s `clientMessage` parameter (item 1, CRITICAL —
 *     see `excludingJustRecordedMessage`'s own doc in `transcript.ts`).
 *
 * REAL-TIME STREAMING (item 4). `runAgentTurn` now takes an `onEvent`
 * callback, invoked synchronously as each event is produced — ALL FIVE event
 * types stream live, including `activity` (a tool round trip's own label
 * now appears when the call starts, not after the whole turn finishes) and
 * `draft.ready`/`terminal` (as soon as decided). The RETURNED `events`
 * array still exists (`outcome.events`) but this route no longer drains it
 * for streaming — `onEvent` already sent everything as it happened.
 */

// I2 (final whole-branch review). The platform's default serverless function
// timeout is far below one model call under `thinking: adaptive` — `loop.ts`'s
// `perCallTimeoutMs` alone can run close to `bounds.ts`'s 120s turn deadline —
// so without this the platform can sever the SSE connection mid-turn with no
// `terminal` event ever sent; the browser just sees the stream stop. MUST
// exceed `DEFAULT_LIMITS.deadlineMs`
// (`bounds.ts`) — the deadline is the loop's OWN, honest stop decision; the
// platform's function timeout is a hard kill from OUTSIDE the process, and it
// must never be the tighter of the two bounds, or the loop's own "held" /
// "deadline" explanation never reaches the client at all.
export const maxDuration = 300;

type Params = { params: Promise<{ sessionId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TURN_KEYS = new Set(["message", "turnId"]);

function refuse(message: string): Response {
  return Response.json({ error: message }, { status: 422 });
}

// Read once per process, not once per turn (the prompt files are re-read on
// every request otherwise) — `next.config.ts`'s `outputFileTracingIncludes`
// entry is what makes them present in a deployed build at all.
const INSTRUCTIONS = fs.readFileSync(path.join(process.cwd(), "src/agent/instructions.md"), "utf8");

// Which engine the agent reads through. 2026-09-28: it follows the backend's one
// switch (`KE_ENGINE`), published per identity by `GET /v1/me`, read ONCE at the
// start of each turn and never between passes, so a turn's tool set cannot change
// mid-turn. Server-authored, so a browser cannot name it. `AGENT_CONTRACT`
// remains an engineering override (the evaluation runner sets it), read once at
// module load as before.
const AGENT_CONTRACT_OVERRIDE = process.env.AGENT_CONTRACT;

// One skill per profile, read for every skill any profile names — today that
// is exactly one file, but this stays correct without an edit here if A4's
// registry ever grows a second entry.
const SKILLS: Record<string, string> = Object.fromEntries(
  Array.from(new Set(Object.values(PROFILES).map((profile) => profile.skill))).map((skill) => [
    skill,
    fs.readFileSync(path.join(process.cwd(), "src/agent/skills", skill, "SKILL.md"), "utf8"),
  ]),
);

// Task 12 (§9 step 6). Read from the SAME in-memory file content as
// `INSTRUCTIONS`/`SKILLS` above, once per process — not a second disk read,
// and not a second frontmatter parser (`prompt-versions.ts`'s own doc).
// `null` entries (missing frontmatter / non-semver version) are dropped
// rather than sent: `assert-agent-prompt-versions.mjs` (A17) already fails
// the build before either could reach a deployed process, so this is
// defence in depth, not a state this array should ever actually narrow.
const INSTRUCTIONS_VERSION = skillVersion("instructions", INSTRUCTIONS);
const SKILL_VERSIONS: Record<string, SkillVersion | null> = Object.fromEntries(
  Object.entries(SKILLS).map(([skill, text]) => [skill, skillVersion(skill, text)]),
);

const DETERMINISTIC = process.env.AUTHORITY_AGENT_DRIVER === "deterministic";

/**
 * The provider driver for a contract (Cycle 5, P1.5 fix round 1, ruling 16).
 * A C4 reply's calls run with the SDK's retries off and retry only what cannot
 * have been billed, so the reservation's one-call margin is a bound; the M1
 * path keeps the SDK's retries exactly as before.
 */
function driverFor(contract: string) {
  if (DETERMINISTIC) return deterministicDriver;
  return contract === "c4" ? anthropicC4Driver : anthropicDriver;
}

export async function POST(request: Request, { params }: Params) {
  const { sessionId } = await params;
  if (!UUID.test(sessionId)) return refuse("sessionId must be a UUID.");

  let token: string;
  try {
    token = await requireClientToken();
  } catch (error) {
    if (error instanceof NoClientSession) return expiredLinkResponse();
    throw error;
  }

  // §5.1 step 1: nothing but message and turnId.
  const raw = await readJsonObject(request);
  if (Object.keys(raw).some((key) => !TURN_KEYS.has(key))) {
    return refuse("An agent turn can contain only message and turnId.");
  }
  if (typeof raw.message !== "string" || typeof raw.turnId !== "string") {
    return refuse("message and turnId must be text.");
  }
  const clientMessage = raw.message.trim();
  const turnId = raw.turnId.trim();
  if (clientMessage.length === 0 || clientMessage.length > 4000) {
    return refuse("message must be between 1 and 4000 characters.");
  }
  // A11: the browser mints ONE turn id; every tool's idempotency key derives
  // from it. It rides no free-form value for the same reason a sessionId
  // does not — a malformed one is a 422 at Python's wire, not a local bug.
  if (!UUID.test(turnId)) return refuse("turnId must be a UUID.");

  // §5.1 step 3: record the client's turn. Its own response IS the envelope
  // §5.1 step 4 reads — no separate GET is needed, and none is made.
  let envelope: RuntimeSessionEnvelope;
  try {
    envelope = await recordClientTurn(token, sessionId, {
      message: clientMessage,
      idempotency_key: derivedKey(turnId, "record_client_message", 1),
    });
  } catch (error) {
    return forwardProductError(error);
  }

  // The platform is trusted stored session state. The browser chose it only
  // through the closed create contract; it cannot choose a skill path or
  // change the platform of an existing session.
  // P5 contract switch, never from the request: a browser that could name the
  // contract could name `c4` for a session whose retained variants were written
  // under `context.v1`. The override wins when set; otherwise the backend says.
  let agentContract = AGENT_CONTRACT_OVERRIDE;
  if (agentContract === undefined) {
    try {
      agentContract = usesKnowledgeEngine(await getMe(token)) ? "c4" : "context.v1";
    } catch (error) {
      return forwardProductError(error);
    }
  }
  const profile =
    PROFILES[profileKeyFor(envelope.session.platform, agentContract === "c4" ? "c4" : undefined)] ??
    resolveProfile(envelope.session.platform);
  const skill = SKILLS[profile.skill];
  const skillVersions: SkillVersion[] = [INSTRUCTIONS_VERSION, SKILL_VERSIONS[profile.skill]].filter(
    (entry): entry is SkillVersion => entry !== null,
  );

  // §5.2: instructions -> skill -> material -> transcript -> bounded context -> current turn.
  // Material is `[]` here per Ruling R2 — it is not turn input.
  //
  // Item 1 (CRITICAL): `envelope.messages` already ends with the message
  // just recorded above — `excludingJustRecordedMessage` drops it (by
  // matching role/kind/body, never by position) BEFORE `assembleTranscript`
  // runs, so `buildTurnMessages`'s own `clientMessage` parameter remains the
  // ONE place this turn's message is rendered.
  // Under c4 the instructions gain the client-facing "what I can do" section,
  // generated from this profile (`capabilities.ts`); v1 gets the file as is.
  const system = buildSystemBlocks(instructionsFor(INSTRUCTIONS, profile), skill);
  const priorRows = excludingJustRecordedMessage(envelope.messages, clientMessage);
  const fullTranscript = assembleTranscript(priorRows);
  // Under c4 the conversation is sized by compaction (Cycle 5, P4.3,
  // `compaction.ts`), which runs once the reply is reserved, below; the hard
  // cap (`transcript-bound.ts`: 30k tokens, the opening message always kept)
  // stays as its safety cap and fallback. v1 keeps the whole transcript, as
  // every retained v1 session always has.
  const uncompacted: BoundedTranscript =
    profile.contract === "c4"
      ? boundTranscript(fullTranscript)
      : { messages: fullTranscript, omitted: 0, chars: fullTranscript.reduce((n, m) => n + m.content.length, 0) };
  const turnContext: ModelMessage[] = [];
  let onboarding: Awaited<ReturnType<typeof getOnboarding>> | null = null;
  try {
    onboarding = await getOnboarding(token);
    turnContext.push(clientBriefMessage(projectClientBrief(onboarding)));
  } catch {
    // Profile context is optional conversational context, never identity or
    // evidence authority. A temporary read failure cannot fabricate it or
    // prevent the agent from continuing through its ordinary tool boundary.
  }
  // Under c4 the agent can propose a time, so it is told today's date in the
  // client's own zone. v1 keeps main's turn exactly.
  if (profile.contract === "c4") {
    try {
      turnContext.push(todayMessage(new Date(), await clientTimezone(token)));
    } catch {
      // Without the zone the agent asks for a calendar date, which is honest.
    }
  }
  // Cycle 5, P4.1 (spec 10A.6): a session's first turn under c4 carries the
  // client's latest posts, by title, objective and posted date, so a new post
  // does not repeat one. Later turns have the conversation instead. A failed
  // read leaves the list out and the turn goes ahead.
  const recentPosts = await recentPostsContext(token, sessionId, profile.contract, fullTranscript.length);
  if (recentPosts !== null) turnContext.push(recentPosts);
  if (onboarding && needsWorkspaceOverview(clientMessage)) {
    try {
      turnContext.push(workspaceOverviewMessage(await readWorkspaceOverview(token, onboarding)));
    } catch {
      // Account context improves discovery but is not a precondition for a
      // writing turn. The agent can still answer honestly from its transcript
      // and generation snapshot when an overview read is temporarily down.
    }
  }
  // The handle Python issued for the turn just recorded. Found by WHAT THE
  // ROW IS, never by position, for the same reason
  // `excludingJustRecordedMessage` is: the day the envelope stops ending with
  // the appended row, a positional read would hand the model another turn's
  // handle and an assertion would be attributed to the wrong message.
  // See `justRecordedMessage`: the last row, and only if it is this message.
  const justRecorded = justRecordedMessage(envelope.messages, clientMessage);
  // Main's whole available source context precedes the conversation on every
  // v1 turn. NOT under c4: there, knowledge reaches the model only through
  // `read_knowledge`'s view-bound, fenced handles, and a second, unfenced copy
  // of the corpus beside them would let the model state what it cannot cite.
  // C4's `orient` read is the overview that stands in for it.
  const sourceContext = profile.contract === "c4" ? [] : [await readClientKnowledge(token)];
  const turnMessages = (transcript: ModelMessage[]) =>
    buildTurnMessages([], transcript, clientMessage, turnContext, justRecorded?.handle ?? null, sourceContext);
  // The contract travels with the tool list. `prepare_generation` means a
  // different thing under c4 — background, not citable material — and a model
  // told the v1 sentence cites what the fence has no view for.
  const tools = buildToolSpecs(profile.tools, profile.contract);
  // What every call of this turn sends besides the earlier conversation, for
  // compaction's before-a-reply measure.
  const fixedChars = requestChars(system, turnMessages([]).messages, tools);
  const selectedDriver = driverFor(profile.contract);

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentEvent) => controller.enqueue(encoder.encode(encodeEvent(event)));

      // The most recent pass's own text — used at step 7 to record the
      // agent's closing remark. Only meaningful when the turn ends
      // naturally (no tool calls on the final pass); see the "ended in
      // terminal" check below for why a bounds-triggered stop records
      // nothing extra here.
      let lastPassText = "";
      // The reply's FIRST agent call's usage, for the new-post suggestion
      // (Cycle 5, P4.4; P4.6, review I-1). That call carries what the next turn
      // carries too: the fixed prompt, the (compacted) conversation and this
      // turn's context, with none of this reply's knowledge reads, which are
      // never resent. The LAST call also held every read result, so one
      // read-heavy first reply used to suggest a new post.
      let firstPassUsage: TurnUsage | null = null;
      // True while the session summary runs (Cycle 5, P4.3): that pass is
      // metered with the reply, but it is not the agent's text or its size.
      let summarizing = false;
      // P5/P7. Reserved before the first model call, settled exactly once at
      // the true end of the turn. `null` under `context.v1`, which has no
      // C4 accounting and must keep behaving exactly as it did. `bounds` is
      // what the reservation says the reply may spend and send (Cycle 5,
      // P1.5); `null` when it could not be read, which refuses the reply.
      let reservation: { call_id: string; bounds: ReplyBounds | null } | null = null;
      // Every model call this turn makes, counted (`turn-settlement.ts`): the
      // usage summed across passes, for `submit_draft`'s `usage` argument (cost
      // telemetry, §9 step 4) read by `createExecutor` via `getUsage` below, and
      // the settlement those calls call for. The one piece of per-pass state
      // `lib/executor.ts` cannot own itself, because it has no visibility into
      // the driver's own results. A total skips a missing figure (`null + 5`
      // is 5), so only a turn whose every pass reported settles at cost
      // (outside review, pass 6).
      // Priced at the reservation's prices when it carried them (P1.5).
      const meter = meterTurn(selectedDriver, (result) => {
        if (summarizing) return;
        lastPassText = result.text;
        if (firstPassUsage === null) firstPassUsage = result.usage ?? null;
      }, () => reservation?.bounds?.prices);

      const { executor, state } = createExecutor({
        sessionId,
        turnId,
        token,
        getUsage: () => meter.usage(),
        skillVersions,
        // Off the resolved PROFILE, so the submission contract and the tool
        // set can never disagree about which cycle this turn is running.
        contract: profile.contract,
        // From the ENVELOPE the client's own turn returned. Without it,
        // `context.v2` answers `selected_draft: null` and a revise turn asks
        // the model to edit a draft it was never shown.
        selectedVariantId: envelope.selected_variant_id,
        // So `D{n}` is the server's `variant_no` and means the same draft on
        // every turn, not whichever draft this turn happened to meet first.
        knownVariants: envelope.variants,
        // What `schedule` acts on under c4. Server state, never the model's.
        contentItemId: envelope.session.content_item_id,
      });

      let endedInTerminal = false;

      // The reply itself: compaction, the loop, the closing remark. Under c4 it
      // runs inside `runMeteredOperation` (Cycle 5, P5.2, Ruling 68), which
      // reserves before it and settles after it -- the one copy of that
      // sequence, shared with the voice preview. `approaching` is the
      // reservation's 80% notice (P1.6; the backend names the BINDING meter's
      // reset and the meter, Ruling 37); `null` under `context.v1`.
      const reply = async (approaching: WritingReservation["approaching"]) => {
        try {
          if (approaching !== null) {
            // Before the turn's content, so the composer can show it as the
            // reply starts (P2.6 renders it). `meter` is left out when an older
            // backend did not name it.
            send(approaching.meter === null
              ? { type: "usage.approaching", resets_at: approaching.resetsAt }
              : { type: "usage.approaching", resets_at: approaching.resetsAt, meter: approaching.meter });
          }
          // Cycle 5, P4.3: under c4, a conversation over the compaction threshold
          // is summarised (Haiku, through the metered driver, so its cost is part
          // of this reply and its cap) and the summary plus the latest turns
          // replace the older messages. Never blocks the reply: any failure falls
          // back to the hard cap and writes no summary.
          let compaction: SessionCompaction | null = null;
          let bounded = uncompacted;
          if (profile.contract === "c4" && reservation?.bounds) {
            summarizing = true;
            try {
              compaction = await compactSession({
                token,
                sessionId,
                rows: priorRows,
                fixedChars,
                driver: meter.driver,
                prices: reservation.bounds.prices,
                maxCallInputTokens: reservation.bounds.limits.maxCallInputTokens,
              });
            } finally {
              summarizing = false;
            }
            bounded = compaction.transcript;
          }
          const { messages, cacheThrough } = turnMessages(bounded.messages);
          // Sizes and codes only, never content. Logged with the turn's trace.
          const transcriptSize = {
            messages: fullTranscript.length,
            chars: bounded.chars,
            omitted: bounded.omitted,
            ...(compaction
              ? {
                  compaction: compaction.stage,
                  compactionReason: compaction.reason,
                  summaryPrompt: compaction.promptVersion,
                  summaryMicrodollars: compaction.summaryCostMicrodollars,
                }
              : {}),
          };
          const sessionCompacted = compaction?.summaryInUse === true;
          // The returned `{ events, usage }` is not used here — `onEvent`
          // below already delivers every event live, and `lastPassText` and
          // the usage are tracked independently by `meter` above. A caller
          // that wanted the batched array for
          // some other reason could still read it off this call.
          const outcome = await runAgentTurn({
            driver: meter.driver,
            executor,
            tools,
            system,
            messages,
            cacheThrough,
            // Cycle 5, P1.5: the per-reply cap, the per-call input bound and
            // the prices, from the reservation. Undefined under `context.v1`,
            // which has no reservation and so no cap.
            limits: reservation?.bounds?.limits,
            prices: reservation?.bounds?.prices,
            // The summary's cost counts against the same per-reply cap.
            spentMicrodollars: compaction?.summaryCostMicrodollars ?? 0,
            // Item 4: every event streams live, in the exact order produced —
            // `activity` now appears when a tool round trip STARTS, not after
            // the whole turn (up to 120s) has already resolved.
            onEvent: (event) => {
              if (event.type === "terminal") endedInTerminal = true;
              // Cycle 5, P4.4: near the compaction threshold, or once the session
              // is summarised (P4.3), the composer suggests a new post. Said
              // once, as the turn ends. Never under M1.
              if (
                event.type === "turn.end" &&
                profile.contract === "c4" &&
                (nearCompaction(firstPassUsage) || sessionCompacted)
              ) {
                send({ type: "session.long" });
              }
              send(event);
            },
          });
          // ONE line per turn: what it did, never what anyone said -- names,
          // counts, outcomes, durations, tokens and the cache hit rate
          // (`TurnTrace`). What the final evaluation reads, and how a
          // regression in tool use or caching shows up before a client notices.
          console.info(
            "[agent.turn]",
            JSON.stringify({ contract: profile.contract, transcript: transcriptSize, ...outcome.trace }),
          );

          // §5.1 step 7, with D-A's one guard.
          //
          // A GENERATING TURN RECORDS TWO `kind=agent` ROWS, AND THAT IS
          // CORRECT. `submit_draft` carried the narration that accompanied the
          // draft, written before the checks ran, and Python wrote it in the
          // same transaction as the variant (A19). What lands here is the
          // remark the model wrote AFTER seeing the outcome — a different
          // utterance at a different moment, already streamed to the browser as
          // `message.delta`. Suppressing it would make a refresh silently
          // delete a sentence the client read, which is a worse failure than a
          // second bubble; consecutive same-role messages are legal, so
          // `assembleTranscript` rendering two adjacent assistant entries next
          // turn breaks nothing.
          //
          // The guard is BYTE-IDENTICAL equality and nothing looser. A model
          // that repeats its narration verbatim records once; a model that says
          // anything else records both. A similarity heuristic here would drop
          // real prose, which is the exact failure the paragraph above rejects.
          //
          // Only when the turn closed naturally — a bounds stop (tool/submit
          // ceiling, deadline) has no model-authored closing remark to persist;
          // its explanation already reached the browser via `onEvent` above,
          // and is not itself the agent's words.
          const alreadyRecorded = state.submittedAgentTexts.includes(lastPassText);
          if (!endedInTerminal && lastPassText.trim().length > 0 && !alreadyRecorded) {
            try {
              await recordAgentTurn(token, sessionId, {
                text: lastPassText,
                idempotency_key: derivedKey(turnId, "record_agent_turn", 1),
              });
            } catch {
              // Non-fatal: the browser already has this text via the
              // message.delta events it just received. Losing the PERSISTED
              // transcript row for a pure-conversation turn is the accepted
              // residual §5.1.1 names — recoverable by asking again, unlike a
              // verified draft's reasoning, which rides `submit_draft` and is
              // recorded transactionally with the draft itself.
            }
          }
        } catch (error) {
          // **Surfaced when the keyless driver is selected, and only then.**
          // The sentence below is the right one for a client and useless to
          // anyone diagnosing an integration run: the demonstration's first
          // failure was a swallowed exception that looked exactly like a
          // provider outage. The production path is untouched.
          if (process.env.AUTHORITY_AGENT_DRIVER === "deterministic") {
            console.error("[deterministic turn failed]", error);
          }
          // Unlike the success path, `runAgentTurn` never finished here —
          // whatever threw did so before or during that call — so this is the
          // one branch that sends its own `terminal` + `turn.end` pair, rather
          // than relying on events `onEvent` would otherwise have delivered.
          send({
            type: "terminal",
            outcome: "refused",
            explanation: "Something went wrong while writing this. Nothing was saved — try again.",
          });
          send({ type: "turn.end" });
        }
      };

      try {
        if (profile.contract === "c4") {
          await runMeteredOperation({
            post: ({ action, ...rest }) =>
              postTurnBudget(token, sessionId, { action, turn_id: turnId, ...rest } as ChatTurnBudgetCreate),
            meter,
            onReserved: (reserved) => {
              reservation = reserved;
            },
            // A refused reservation, or one whose bounds cannot hold the reply
            // (fail closed, ruling 17): the sentence is written here by
            // application code rather than by a model (D7), and no model call
            // is made. Neither says "nothing was saved": the message is
            // recorded first (P2 milestone review M6).
            onRefused: (explanation) => {
              send({ type: "terminal", outcome: "refused", explanation });
              send({ type: "turn.end" });
            },
            run: (reserved) => reply(reserved.approaching),
          });
        } else {
          await reply(null);
        }
      } finally {
        // §5.1 step 8: nothing agent-side persists beyond what was already
        // recorded above.
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  });
}

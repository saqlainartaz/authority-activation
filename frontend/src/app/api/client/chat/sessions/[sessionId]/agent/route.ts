import fs from "node:fs";
import path from "node:path";

import { NoClientSession, requireClientToken } from "@/lib/client-session";
import {
  expiredLinkResponse,
  forwardProductError,
  readJsonObject,
  recordAgentTurn,
  recordClientTurn,
  type RuntimeSessionEnvelope,
} from "@/lib/product";

import type { AgentEvent } from "@/agent/events";
import { derivedKey } from "@/agent/lib/backend";
import { buildSystemBlocks, buildTurnMessages } from "@/agent/lib/context-assembly";
import type { Driver, DriverRequest, TurnUsage } from "@/agent/lib/driver";
import { createExecutor } from "@/agent/lib/executor";
import { anthropicDriver } from "@/agent/lib/loop";
import { deterministicDriver } from "@/agent/lib/deterministic-driver";
import { skillVersion, type SkillVersion } from "@/agent/lib/prompt-versions";
import { encodeEvent } from "@/agent/lib/stream";
import { buildToolSpecs } from "@/agent/lib/tool-schemas";
import { runAgentTurn } from "@/agent/lib/turn";
import {
  needsWorkspaceOverview,
  readWorkspaceOverview,
  workspaceOverviewMessage,
} from "@/agent/lib/workspace-overview";
import { PROFILES, resolveProfile } from "@/agent/profile";
import { assembleTranscript, excludingJustRecordedMessage } from "@/agent/transcript";

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
 * material -> transcript -> current turn — actually reaches the model.
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

const ZERO_USAGE: TurnUsage = {
  inputTokens: null,
  outputTokens: null,
  cacheReadInputTokens: null,
  cacheCreationInputTokens: null,
};

const selectedDriver = process.env.AUTHORITY_AGENT_DRIVER === "deterministic"
  ? deterministicDriver
  : anthropicDriver;

/** `null + null` stays null; `null + 5` is 5 — mirrors `turn.ts`'s own `add`,
 *  duplicated rather than imported because that one is private to that
 *  module and the arithmetic is four lines. */
function addUsage(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return left + right;
}

function accumulateUsage(total: TurnUsage, next: TurnUsage): TurnUsage {
  return {
    inputTokens: addUsage(total.inputTokens, next.inputTokens),
    outputTokens: addUsage(total.outputTokens, next.outputTokens),
    cacheReadInputTokens: addUsage(total.cacheReadInputTokens, next.cacheReadInputTokens),
    cacheCreationInputTokens: addUsage(total.cacheCreationInputTokens, next.cacheCreationInputTokens),
  };
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

  // §5.1 step 2: resolve the capability profile before the model sees
  // anything. One entry exists (A4/E3) — "linkedin" is not read from the
  // request, matching A6: the platform is already known upstream of this
  // route, so asking the model (or the browser) to name it again would turn
  // a certainty into a probability for nothing.
  const profile = resolveProfile("linkedin");
  const skill = SKILLS[profile.skill];
  // Task 12: server state, resolved off the SAME profile the model never
  // chooses (A6) — never off anything the request carries.
  const skillVersions: SkillVersion[] = [INSTRUCTIONS_VERSION, SKILL_VERSIONS[profile.skill]].filter(
    (entry): entry is SkillVersion => entry !== null,
  );

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

  // §5.2: instructions -> skill -> material -> transcript -> current turn.
  // Material is `[]` here per Ruling R2 — it is not turn input.
  //
  // Item 1 (CRITICAL): `envelope.messages` already ends with the message
  // just recorded above — `excludingJustRecordedMessage` drops it (by
  // matching role/kind/body, never by position) BEFORE `assembleTranscript`
  // runs, so `buildTurnMessages`'s own `clientMessage` parameter remains the
  // ONE place this turn's message is rendered.
  const system = buildSystemBlocks(INSTRUCTIONS, skill);
  const transcript = assembleTranscript(excludingJustRecordedMessage(envelope.messages, clientMessage));
  const { messages: turnMessages } = buildTurnMessages([], transcript, clientMessage);
  let overview: ReturnType<typeof workspaceOverviewMessage> | null = null;
  if (needsWorkspaceOverview(clientMessage)) {
    try {
      overview = workspaceOverviewMessage(await readWorkspaceOverview(token));
    } catch {
      // Account context improves discovery but is not a precondition for a
      // writing turn. The agent can still answer honestly from its transcript
      // and generation snapshot when an overview read is temporarily down.
    }
  }
  const messages = [...turnMessages];
  if (overview) messages.splice(messages.length - 1, 0, overview);
  const tools = buildToolSpecs(profile.tools);

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentEvent) => controller.enqueue(encoder.encode(encodeEvent(event)));

      // Accumulated across every real model call this turn makes, for
      // `submit_draft`'s `usage` argument (cost telemetry, §9 step 4) — read
      // by `createExecutor` via `getUsage` below. This is the one piece of
      // per-pass state `lib/executor.ts` cannot own itself, because it has
      // no visibility into the driver's own results.
      let runningUsage: TurnUsage = ZERO_USAGE;
      // The most recent pass's own text — used at step 7 to record the
      // agent's closing remark. Only meaningful when the turn ends
      // naturally (no tool calls on the final pass); see the "ended in
      // terminal" check below for why a bounds-triggered stop records
      // nothing extra here.
      let lastPassText = "";

      const trackingDriver: Driver = {
        toProviderTools: selectedDriver.toProviderTools,
        async runTurn(request: DriverRequest) {
          const result = await selectedDriver.runTurn(request);
          runningUsage = accumulateUsage(runningUsage, result.usage);
          lastPassText = result.text;
          return result;
        },
      };

      const { executor, state } = createExecutor({
        sessionId,
        turnId,
        token,
        getUsage: () => runningUsage,
        skillVersions,
      });

      let endedInTerminal = false;
      try {
        // The returned `{ events, usage }` is not used here — `onEvent`
        // below already delivers every event live, and `lastPassText`/
        // `runningUsage` are tracked independently via `trackingDriver`'s
        // own closure above. A caller that wanted the batched array for
        // some other reason could still read it off this call.
        await runAgentTurn({
          driver: trackingDriver,
          executor,
          tools,
          system,
          messages,
          // Item 4: every event streams live, in the exact order produced —
          // `activity` now appears when a tool round trip STARTS, not after
          // the whole turn (up to 120s) has already resolved.
          onEvent: (event) => {
            if (event.type === "terminal") endedInTerminal = true;
            send(event);
          },
        });

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
      } catch {
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

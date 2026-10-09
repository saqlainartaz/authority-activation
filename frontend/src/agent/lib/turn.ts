import "server-only";

import {
  DEFAULT_LIMITS,
  MAX_IDENTICAL_CALLS,
  REPEATED_CALL_EXPLANATION,
  REPLY_CAP_EXPLANATION,
  shouldStop,
  type Limits,
  type TurnState,
} from "@/agent/bounds";
import type { AgentEvent } from "@/agent/events";
import { isTracedToolName } from "@/agent/profile";
import type { Driver, SystemBlock, ToolSpec, TurnResult, TurnUsage } from "@/agent/lib/driver";
import type { WriterPrices } from "@/agent/lib/pricing";
import { compactBeforeCall } from "@/agent/lib/compaction";
import { createReplyMeter, requestChars } from "@/agent/lib/reply-cap";
import type { PreflightProblem } from "@/agent/preflight";
import { escapeForBody, type ModelMessage, type ToolResultPart } from "@/agent/transcript";

/**
 * §5.1's loop, §5.4's bounds and §5.5's failure policy, in one place.
 *
 * A LOOP WE OWN RATHER THAN THE SDK'S TOOL RUNNER, and the reason is §5.5
 * rather than preference: a pre-flight rejection must NOT consume one of only
 * two submit attempts while a Python rejection must, and that asymmetry is
 * control flow. Under a runner the counting migrates into the tool function or
 * a hook, and the bound stops being the loop's own gate. `shouldStop` is called
 * at the top of every pass here, so the verdict AND its client-facing
 * explanation are in hand at the one place that can act on them.
 *
 * NO PROVIDER IMPORT. The driver is an interface, which is what lets every
 * assertion in `tests/agent/turn.test.ts` run with no key and no network.
 *
 * TWO CONTROLLER RULINGS OVER THE ORIGINAL BRIEF, both binding:
 *
 * R1 — CONTEXT GOES IN, AND TOOL RESULTS COME BACK. The first draft of this
 * loop called `driver.runTurn({ system: [], messages: [], ... })` with empty
 * literals on every pass, which meant Task 3's assembled context could never
 * reach the model, and threw away `execution.result` after every tool call —
 * a real model would never see a tool's answer and would repeat the same call
 * until the ceiling tripped. `RunTurnOptions.system` / `.messages` are now
 * optional inputs that seed a working message array; after every pass, the
 * model's own text (if any) is appended as an `assistant` message, and every
 * tool's outcome — success, pre-flight rejection, or Python rejection — is
 * appended as a `user` message so the NEXT pass's `driver.runTurn` sees it.
 * A rejection reason is fed back for the same reason `chat/generation.py`
 * feeds one back today: the model cannot correct a draft whose rejection
 * reason it never saw, and that correction is §5.5's whole mechanism.
 *
 * Tool results ride as delimited TEXT, following the idiom `transcript.ts`
 * and `context-assembly.ts` already use for everything else the model reads,
 * rather than as provider-shaped tool-result blocks — `ModelMessage` stays
 * `{ role, content }` exactly as it is, because widening it is a bigger
 * change than this task should make and the driver seam is meant to stay
 * provider-neutral. Anything server- or model-derived that gets interpolated
 * into a tag body is escaped with `escapeForBody`, for the same reason
 * `transcript.ts:36-40` gives: an unescaped literal closing tag in a tool
 * result could forge a trust boundary exactly as an unescaped client message
 * could.
 *
 * R5 — ONLY `terminal` ENDS THE TURN; `draft.ready` DOES NOT. The original
 * brief set `landed = true` on a successful `draft.ready` and broke the loop
 * immediately, which made its own usage test unsatisfiable (two driver calls
 * scripted, only the first pass's usage ever counted). After a successful
 * submit the loop now keeps going, so the model sees the submit result and
 * gets one more pass to close the conversation naturally — which lands on
 * the existing no-tool-calls branch below (`stopReason: "end_turn"`, no tool
 * calls). `shouldStop`'s `submit_ceiling` check already guards a second
 * `submit_draft` after a success (it fires at the top of the very next pass
 * if `submitDraftCalls` is already at the limit), so no second, separate
 * guard is added here — the bound belongs to `bounds.ts` alone.
 *
 * THREE REVIEW FIXES ON TOP OF R1/R5, all inside the `for (const call of
 * result.toolCalls)` loop below (R12, R13, R17 — findings 1 and 2 of Task 5's
 * first re-review, and the one finding of its second):
 *
 * R12 — the terminal branch `break`s the FOR-LOOP, not only sets `landed`.
 * `TurnResult.toolCalls` is an array; a single pass can return several calls.
 * Setting `landed = true` without breaking meant every call AFTER the one
 * that tripped the ceiling still reached `options.executor` on the same
 * pass — including `schedule` and `propose_durable_fact`, which have real
 * side effects — after the turn was already terminal. A stop that keeps
 * acting is not a stop.
 *
 * R13 — a `failed` submit at the ceiling gets its own terminal event, not
 * `rejected`'s generic one. `state.submitDraftCalls` increments unconditionally
 * for any `submit_draft` that clears pre-flight, so a `failed` execution
 * (Python errored) consumes an attempt exactly as `rejected` does. Before
 * this fix only `execution.kind === "rejected"` was checked at the ceiling,
 * so a `failed` submit produced no terminal event of its own — the turn
 * would loop to the next pass, and `shouldStop` (`bounds.ts`) would supply
 * its own generic `submit_ceiling` sentence there instead, which is a
 * category of the same problem R19 later fixes at the source: the wrong
 * text attributed to the wrong cause. `failed` now gets its own terminal
 * event carrying `execution.reason`.
 *
 * R17 — the ceiling check R13 widened is GATED ON `call.name ===
 * "submit_draft"`, matching the `ok`-path check two blocks above it. R13's
 * `rejected || failed` condition, alone, could otherwise fire on an unrelated
 * tool: two `submit_draft` calls in one pass both succeed (no break on
 * success, per R5, so `submitDraftCalls` can reach the ceiling with zero
 * rejections), and a later `schedule` call IN THE SAME ARRAY that returns
 * `failed` for an ordinary infrastructure hiccup would then end the turn
 * `held`, with the scheduling failure's reason misattributed as a
 * submit-ceiling rejection of a draft that had in fact verified twice. A
 * `failed` result from any OTHER tool is not special-cased further — it is
 * fed back to the model exactly like every other execution kind (the
 * unconditional `messages.push(toolResultMessage(...))` a few lines below),
 * which is very likely already the right answer: a `schedule` hiccup is not
 * a reason to end a conversation the model may still be able to recover.
 *
 * R19 lives in `bounds.ts`, not here, and is recorded there in full: R17's
 * own scenario — two `submit_draft` calls succeeding in one pass — proved
 * that `shouldStop`'s `submit_ceiling` explanation ("I tried twice and the
 * checks rejected both drafts") could fire on a turn where nothing was
 * rejected, because R5 made that ceiling reachable via two SUCCESSES and
 * `TurnState` has no way to tell the two routes apart. Fixed by rewording
 * the sentence to claim only what the counter actually knows (attempts used
 * up), not what it cannot (whether they were rejected). Nothing in this file
 * changed for it — `bounds.ts` owns its own explanation text.
 */

/**
 * `reachedPython` — added in the Task 8 fix round, ruling 3. §4.7 mechanism 3
 * promises a pre-flight rejection spends no `submit_draft` attempt. That
 * promise held only in this file's own scripted tests (via the
 * `preflightProblems` seam below) and NOT against the real executor: the
 * real pre-flight check runs one layer deeper, inside `submitDraft()`
 * itself, so the loop had no way to tell "rejected before ever reaching
 * Python" apart from "Python rejected it" — and it was counting BOTH.
 *
 * EXPLICIT, NOT INFERRED. This field is what an executor uses to say which
 * one happened, rather than the loop guessing from `reason`'s text or from
 * whether `result` looks a certain shape. It is OPTIONAL and the ABSENT
 * case means "counts" (`attemptReachedPython` below treats anything other
 * than a literal `false` as having reached Python) — an executor that
 * forgets to set it, or one for a tool where the distinction is
 * meaningless, defaults to the SAFE direction: the ceiling still binds. Only
 * a `submit_draft` call an executor can POSITIVELY prove never left the
 * process should ever set this to `false`.
 */
export type ToolExecution =
  /** `result` is MODEL-FACING: `describeExecution` JSON-stringifies it
   *  straight into the tool-result message. `runtime` is not — it is for
   *  values this loop must act on and a model must never be handed.
   *
   *  It exists because of one: a stored draft's `variant_id`. `draft.ready`
   *  carries that uuid to the BROWSER, which is correct and necessary; under
   *  c4 the model is told `D1` instead, because a uuid in a prompt is the
   *  thing this cycle exists to prevent. Before this field the two rode the
   *  same object, so projecting one silently stopped the other — the client
   *  would have lost its draft and no test would have said so. */
  | { kind: "ok"; result: Record<string, unknown>; runtime?: { variantId?: string; proposalId?: string } }
  | { kind: "rejected"; reason: string; reachedPython?: boolean }
  | { kind: "failed"; reason: string; reachedPython?: boolean };

export type ToolExecutor = (name: string, input: unknown) => Promise<ToolExecution>;

export type RunTurnOptions = {
  driver: Driver;
  executor: ToolExecutor;
  tools?: ToolSpec[];
  limits?: Partial<Limits>;
  now?: () => number;
  /** R1: the stable system prefix (instructions, skill) built by
   *  `buildSystemBlocks`. Optional so the brief's existing tests, which pass
   *  neither this nor `messages`, keep working unchanged — an omitted system
   *  is `[]`, exactly as it was before this field existed. */
  system?: SystemBlock[];
  /** R1: the seed message array — normally `buildTurnMessages(...).messages`,
   *  material + transcript + the current client turn. The loop appends to a
   *  working copy of this array as passes proceed; it never mutates the
   *  array the caller passed in. */
  messages?: ModelMessage[];
  /** The prompt-cache boundary in `messages`: the last message of the
   *  earlier conversation (`buildTurnMessages().cacheThrough`). Passed to the
   *  driver unchanged on every pass; appended messages come after it. */
  cacheThrough?: number | null;
  /** Test seam: pre-flight verdicts per submit attempt, newest first. Absent in
   *  production, where `src/agent/lib/executor.ts`'s real executor runs the
   *  real `preflight` — one layer deeper than this loop ever sees, which is
   *  exactly why `reachedPython` above exists: this seam cannot model that
   *  layering, only stand in for it in a unit test. */
  preflightProblems?: PreflightProblem[][];
  /**
   * Task 8 fix round, item 4. `runAgentTurn` otherwise returns ONE batched
   * array only once the whole turn (up to 120s, several model calls and tool
   * round trips) resolves — every `AgentEvent` this callback receives is
   * ALSO still in that returned array, in the same order; this is a second,
   * live delivery of the same events, not a replacement for the array.
   * Called synchronously, in the exact order each event is produced,
   * including `message.delta` (previously the caller's only way to stream in
   * real time, via wrapping `driver.runTurn`'s `onText` from the outside —
   * `activity`, `draft.ready` and `terminal` had no equivalent hook at all).
   */
  onEvent?: (event: AgentEvent) => void;
  /** Cycle 5, P1.5: the prices to hold the per-reply cap with, from the C4
   *  reservation. Used only when `limits` carries a cap or an input bound;
   *  absent, the runtime's own copy of the same table (`pricing.ts`). */
  prices?: WriterPrices;
  /** Cycle 5, P4.3: what this reply already spent before the loop (the session
   *  summary, `compaction.ts`), counted against the per-reply cap from the
   *  first pass. Used only when the reply is capped. */
  spentMicrodollars?: number;
};

export type TurnOutcome = { events: AgentEvent[]; usage: TurnUsage; trace: TurnTrace };

/**
 * What one turn DID, for observability and the evaluation that comes later.
 *
 * Every harness studied records this (Codex's tool_decision / tool_result
 * events, OpenHands' traces, Claude Code's cache-miss reporting: "monitor
 * cache hit rate like uptime"), and without it a run can say THAT a turn went
 * badly but not WHY. **No content, ever:** no message text, no tool arguments,
 * no tool results -- names, counts, outcomes, durations and tokens only, so a
 * trace can be logged and kept without becoming a second copy of client data.
 */
export type TurnTrace = {
  /** `model` when the driver named it (P1.5), so a pass can be priced at its own rates. */
  passes: { stopReason: TurnResult["stopReason"]; toolCalls: number; usage: TurnUsage; model?: string }[];
  tools: {
    name: string;
    outcome: "ok" | "rejected" | "failed" | "not_run";
    /** Whether the call reached the backend; null when the executor did not say. */
    reachedBackend: boolean | null;
    ms: number;
  }[];
  /** How the turn ended: a natural reply, or which limit stopped it. */
  end: { kind: "reply" | "limit"; reason: string | null };
  totals: TurnUsage & {
    /** Cached input over all input, when the provider reported every figure. */
    cacheHitRate: number | null;
  };
  durationMs: number;
};

/** A tool name the model returned is the model's text: logged only when it is
 *  a name the code itself wrote, so no client words reach the log through it. */
function tracedName(name: string): string {
  return isTracedToolName(name) ? name : "unknown";
}

function cacheHitRate(usage: TurnUsage): number | null {
  const { inputTokens, cacheReadInputTokens, cacheCreationInputTokens } = usage;
  if (inputTokens === null || cacheReadInputTokens === null || cacheCreationInputTokens === null) return null;
  const total = inputTokens + cacheReadInputTokens + cacheCreationInputTokens;
  return total > 0 ? cacheReadInputTokens / total : null;
}

const ZERO: TurnUsage = {
  inputTokens: null,
  outputTokens: null,
  cacheReadInputTokens: null,
  cacheCreationInputTokens: null,
};

/** `null + null` stays null; `null + 5` is 5. A provider reporting nothing is
 *  not the same fact as a provider reporting zero, all the way to storage. */
function add(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return left + right;
}

function accumulate(total: TurnUsage, next: TurnUsage): TurnUsage {
  return {
    inputTokens: add(total.inputTokens, next.inputTokens),
    outputTokens: add(total.outputTokens, next.outputTokens),
    cacheReadInputTokens: add(total.cacheReadInputTokens, next.cacheReadInputTokens),
    cacheCreationInputTokens: add(total.cacheCreationInputTokens, next.cacheCreationInputTokens),
  };
}

/** R1: wraps one tool's outcome as a delimited `user` message so the NEXT
 *  pass's `driver.runTurn` sees it — success, pre-flight rejection, and
 *  Python rejection alike. Follows the tag idiom of `transcript.ts` /
 *  `context-assembly.ts` rather than inventing a new one. `name` is ours
 *  (drawn from a closed set of tool names the model itself just called), not
 *  model text, so it is not escaped — same reasoning `render.ts` gives for
 *  its own attribute values. `body` arrives ALREADY prepared by
 *  `toolResultBody` below — this function does no escaping decisions of its
 *  own any more. */
/** One native tool result. See `ToolResultPart`: data only, `isError` on a
 *  rejection or failure. The body keeps the same escaping it always had --
 *  untrusted text inside it still must not forge the tags other content uses. */
function toolResultPart(
  call: { id: string; name: string },
  body: string,
  isError: boolean,
): ToolResultPart {
  return { toolUseId: call.id, name: call.name, content: body, isError };
}

function describeExecution(execution: ToolExecution): string {
  if (execution.kind === "ok") return JSON.stringify(execution.result);
  return execution.reason;
}

/**
 * Task 8 fix round, item 2. The FIRST version of this exemption escaped
 * `prepare_generation`'s entire `ok` result whenever it was exempted at all
 * — which incidentally also exempted `ContextV1.background` and
 * `.conflicts`, both equally `trust:"untrusted"` and equally
 * client-derived, from the SAME tag-forgery defense every other tool's
 * result gets, for NO compensating benefit: §4.7 mechanism 2's byte-fidelity
 * requirement is about `material` specifically — nothing else in this
 * envelope is ever compared byte-for-byte against anything Python stored.
 * A comment claiming "narrowly scoped" over code that exempted the whole
 * blob was wrong, and is corrected here rather than left standing.
 *
 * The fix splices rather than exempts: escape a SKELETON of the result with
 * `material` swapped for a sentinel, then substitute the sentinel for the
 * real material's own JSON-string-escaped (quotes/backslashes/control
 * characters — this is still going inside a JSON string) but NEVER
 * html-entity-escaped form. Every other field keeps the escaping every
 * other tool's result gets.
 *
 * The sentinel is a long, double-underscored, all-caps token distinctive
 * enough that real transcript prose will not collide with it — deliberately
 * NOT a control character (this repo's own `assert-no-control-characters.mjs`
 * guard would refuse a raw one sitting in this source file, and there is no
 * reason to fight that guard for a value that never reaches the model or any
 * output anyway: it exists for exactly one `JSON.stringify` round trip
 * before being substituted back out).
 */
const MATERIAL_SPLICE_SENTINEL = "__PREPARE_GENERATION_MATERIAL_SENTINEL__";

function preparedGenerationBody(result: Record<string, unknown>): string {
  const material = result.material;
  if (typeof material !== "string") {
    // No material field to protect (e.g. a malformed executor) — falls back
    // to the same escaping every other tool's result gets, safely.
    return escapeForBody(JSON.stringify(result));
  }
  const skeleton = JSON.stringify({ ...result, material: MATERIAL_SPLICE_SENTINEL });
  const escapedSkeleton = escapeForBody(skeleton);
  const sentinelAsJsonString = JSON.stringify(MATERIAL_SPLICE_SENTINEL);
  const materialAsJsonString = JSON.stringify(material);
  return escapedSkeleton.split(sentinelAsJsonString).join(materialAsJsonString);
}

/** The one call site deciding WHAT gets escaped, so `toolResultMessage`
 *  itself stays a pure wrapper. Only `prepare_generation`'s `ok` result ever
 *  takes the spliced path; everything else — every other tool, and a
 *  `prepare_generation` REJECTION (plain runtime-composed prose, not
 *  material) — gets the same escaping every tool result has always gotten. */
function toolResultBody(name: string, execution: ToolExecution): string {
  if (name === "prepare_generation" && execution.kind === "ok") {
    return preparedGenerationBody(execution.result);
  }
  return escapeForBody(describeExecution(execution));
}

/** Task 8 fix round, item 3. `execution.reachedPython` (see `ToolExecution`'s
 *  own doc) says whether a `submit_draft` attempt is countable against
 *  §5.5's ceiling. `"ok"` has no such field because a submit that VERIFIED
 *  or was held BY PYTHON always reached it by construction; only "rejected"
 *  and "failed" can originate on either side of that line. Absent on either
 *  of those two means "counts" — the safe default this file's own type
 *  comment states. */
function attemptReachedPython(execution: ToolExecution): boolean {
  return execution.kind === "ok" || execution.reachedPython !== false;
}

export async function runAgentTurn(options: RunTurnOptions): Promise<TurnOutcome> {
  const clock = options.now ?? (() => Date.now());
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const events: AgentEvent[] = [];
  let usage = ZERO;

  // Item 4: every event still lands in `events` (the returned array is
  // unchanged); `onEvent`, when given, ALSO sees it at the exact moment it
  // is produced, rather than only once the whole turn resolves.
  function emit(event: AgentEvent): void {
    events.push(event);
    options.onEvent?.(event);
  }

  const state: TurnState = {
    toolCalls: 0,
    submitDraftCalls: 0,
    startedAt: clock(),
    now: clock(),
  };

  const pending = [...(options.preflightProblems ?? [])];
  // The identical-call streak, across passes: the last call's name and
  // arguments, and how many times in a row it has been made.
  let lastCall: string | null = null;
  let streak = 0;
  // The previous call's reported usage: what step 1 of compaction measures.
  let lastPassUsage: TurnUsage | null = null;
  const trace: Omit<TurnTrace, "totals" | "durationMs"> = {
    passes: [],
    tools: [],
    end: { kind: "reply", reason: null },
  };
  const system = options.system ?? [];
  const tools = options.tools ?? [];
  // R1: a working copy. The caller's array is never mutated.
  let messages: ModelMessage[] = [...(options.messages ?? [])];

  // Cycle 5, P1.5: the per-reply cap and the per-call input bound, only when
  // the reservation set them (C4). The M1 path passes neither and meters nothing.
  const replyMeter =
    limits.maxReplyCostMicrodollars !== undefined || limits.maxCallInputTokens !== undefined
      ? createReplyMeter(options.prices, options.spentMicrodollars ?? 0)
      : null;
  // Whether this reply has already handed the client a draft. A reply stopped
  // by its cap after that has done its job, and ends as a normal reply would.
  let draftSubmitted = false;

  /** A reply out of budget: a normal end after a draft, else the application's
   *  honest sentence. Either way no further call is sent, and the route
   *  settles at what ran (P1.4). */
  function finishOverBudget(reason: "reply_cap" | "call_input_cap"): void {
    if (!draftSubmitted) {
      emit({ type: "terminal", outcome: "held", explanation: REPLY_CAP_EXPLANATION });
    }
    trace.end = { kind: "limit", reason };
  }

  for (;;) {
    state.now = clock();
    if (replyMeter) state.replyCostMicrodollars = replyMeter.cost();
    const verdict = shouldStop(state, limits);
    if (verdict.reason === "reply_cap") {
      finishOverBudget("reply_cap");
      break;
    }
    if (verdict.stop) {
      // EVERY stop carries its explanation. bounds.ts computed both; ending the
      // turn without saying why is the failure this branch exists to prevent.
      emit({ type: "terminal", outcome: "held", explanation: verdict.explanation ?? "" });
      trace.end = { kind: "limit", reason: verdict.reason };
      break;
    }

    // Cycle 5, P4.3, step 1: over the compaction threshold, older knowledge
    // results are cleared BEFORE the input estimate, so a reply that has grown
    // shrinks what it sends rather than stop (`compaction.ts`).
    messages = compactBeforeCall(messages, lastPassUsage);
    // Cycle 5, P1.5: a call larger than the per-call input bound is never sent.
    // The reservation assumed none is, so sending one could cross it.
    const sentChars = replyMeter ? requestChars(system, messages, tools) : 0;
    if (
      replyMeter &&
      limits.maxCallInputTokens !== undefined &&
      replyMeter.estimate(sentChars) > limits.maxCallInputTokens
    ) {
      finishOverBudget("call_input_cap");
      break;
    }

    // I3 (final whole-branch review). Previously this always passed
    // `limits.deadlineMs` — the FULL turn budget — on every pass, so the
    // deadline bounded the gap between passes rather than the turn itself:
    // worst case, a pass could start at ~119.9s elapsed and still be handed
    // a fresh 120s budget, landing wall time near 240s against a declared
    // 120s bound. Passing the REMAINING budget composes correctly with
    // `loop.ts`'s `perCallTimeoutMs` (which floors at
    // `MIN_PER_CALL_TIMEOUT_MS` for a small budget rather than handing the
    // SDK zero or a negative timeout) and with I2's `maxDuration`, which must
    // exceed this deadline for either bound to mean anything.
    const remainingMs = Math.max(limits.deadlineMs - (state.now - state.startedAt), 0);
    const result = await options.driver.runTurn({
      system,
      messages,
      tools,
      onText: (delta) => emit({ type: "message.delta", text: delta }),
      timeoutMs: remainingMs,
      cacheThrough: options.cacheThrough ?? null,
    });
    usage = accumulate(usage, result.usage);
    lastPassUsage = result.usage ?? null;
    replyMeter?.record(sentChars, result.model, result.usage);
    trace.passes.push({
      stopReason: result.stopReason,
      toolCalls: result.toolCalls.length,
      usage: result.usage,
      ...(result.model ? { model: result.model } : {}),
    });

    // R1: the model's own visible text becomes what it "said" on this pass,
    // exactly as `transcript.ts`'s `agent` branch treats a stored row — raw,
    // because it is the runtime's own record of the model's words, not
    // untrusted input needing a delimiter.
    //
    // With its tool calls and the provider's own blocks: the next pass must
    // see the calls it made, and its thinking, not only their results.
    if (result.text || result.toolCalls.length > 0) {
      messages.push({
        role: "assistant",
        content: result.text,
        ...(result.toolCalls.length > 0 ? { toolCalls: result.toolCalls } : {}),
        ...(result.providerBlocks ? { providerBlocks: result.providerBlocks } : {}),
      });
    }

    if (result.toolCalls.length === 0) {
      // I1 (final whole-branch review): NO re-emit here. `onText` above
      // already streamed this exact text, delta by delta, as the driver
      // produced it (`loop.ts`'s `stream.on("text", ...)` wiring) — emitting
      // `result.text` again as a second `message.delta` made a browser
      // concatenating deltas render the agent's closing remark twice.
      // Invisible to every test on this branch because no fake driver ever
      // called `onText` (see `tests/agent/turn.test.ts`'s `recordingDriver`,
      // fixed alongside this). Intermediate passes (the tool-call branch
      // below) never re-emitted; this was the one anomalous branch.
      break;
    }

    let landed = false;
    // Every result of this pass goes back in ONE user message, as the API
    // requires for parallel calls: one `tool_result` per `tool_use`.
    const results: ToolResultPart[] = [];
    for (const call of result.toolCalls) {
      const signature = `${call.name} ${JSON.stringify(call.input ?? null)}`;
      streak = signature === lastCall ? streak + 1 : 1;
      lastCall = signature;
      if (streak >= MAX_IDENTICAL_CALLS) {
        // Not run: its answer is the one the model already has twice over.
        emit({ type: "terminal", outcome: "held", explanation: REPEATED_CALL_EXPLANATION });
        trace.tools.push({ name: tracedName(call.name), outcome: "not_run", reachedBackend: false, ms: 0 });
        trace.end = { kind: "limit", reason: "repeated_call" };
        landed = true;
        break;
      }
      state.toolCalls += 1;

      if (call.name === "submit_draft") {
        const problems = pending.length > 0 ? (pending.shift() as PreflightProblem[]) : [];
        if (problems.length > 0) {
          // §4.7 mechanism 3: returned to the model at once, WITHOUT touching
          // submitDraftCalls, because it never reached Python. This is the
          // TEST SEAM's own version of that guarantee — the production path
          // proves the same thing via `reachedPython` below instead.
          emit({ type: "activity", label: "Checking the citations" });
          // R1: fed back so the model can correct it — the same detail a
          // real preflight() call would have produced.
          results.push(
            toolResultPart(call, escapeForBody(problems.map((problem) => problem.detail).join("; ")), true),
          );
          trace.tools.push({ name: tracedName(call.name), outcome: "rejected", reachedBackend: false, ms: 0 });
          continue;
        }
        // NOTE: `state.submitDraftCalls` is NO LONGER incremented here. See
        // `attemptReachedPython` below — the increment moved to AFTER the
        // executor call, item 3 of the Task 8 fix round, because whether
        // THIS specific call reached Python is a fact the executor alone
        // can know, and the loop used to guess by assuming it always did.
      }

      emit({ type: "activity", label: labelFor(call.name) });
      const startedCall = clock();
      const execution = await options.executor(call.name, call.input);
      trace.tools.push({
        name: tracedName(call.name),
        outcome: execution.kind,
        reachedBackend: execution.kind === "ok" ? true : (execution.reachedPython ?? null),
        ms: clock() - startedCall,
      });
      // R1: every outcome — ok, rejected, or failed — is fed back. A rejection
      // the model never sees is a rejection it cannot correct, and correcting
      // it is the entire point of §5.5's one silent retry.
      results.push(toolResultPart(call, toolResultBody(call.name, execution), execution.kind !== "ok"));

      // Item 3: count the attempt only now, and only if it actually reached
      // Python. A `submit_draft` call the executor can PROVE never left the
      // process (a local pre-flight rejection) leaves `submitDraftCalls`
      // untouched, matching what the test seam above already modelled —
      // this is that same guarantee, now true against the real executor.
      if (call.name === "submit_draft" && attemptReachedPython(execution)) {
        state.submitDraftCalls += 1;
      }

      if (execution.kind === "ok" && (call.name === "propose_schedule" || call.name === "propose_post_now") && execution.runtime?.proposalId) {
        // The card, for the browser. The model got the time as text; the id
        // never reaches it.
        emit({ type: "schedule.proposed", proposal_id: execution.runtime.proposalId });
      }

      if (execution.kind === "ok" && call.name === "submit_draft") {
        // `runtime` first: under c4 `result` carries the draft HANDLE, and
        // the browser needs the real id. v1 still answers on `result`.
        const variantId = execution.runtime?.variantId ?? execution.result.variant_id;
        if (typeof variantId === "string") {
          emit({ type: "draft.ready", variant_id: variantId });
          draftSubmitted = true;
          // R5: no `landed = true` here. draft.ready is not terminal — the
          // loop keeps going so the model sees the submit result and gets one
          // more pass to close out naturally, which lands on the no-tool-calls
          // branch above. A second `submit_draft` after this is still bounded,
          // by `shouldStop`'s `submit_ceiling` check at the top of the loop —
          // not by anything added here.
        }
      }

      // R12 (review finding 1): at the submit ceiling, a rejection OR a
      // failure ends the turn — and does so by BREAKING OUT OF THIS
      // FOR-LOOP, not merely setting `landed`. `TurnResult.toolCalls` is an
      // array; nothing forbids a model pass returning several calls in one
      // go. Before this fix, `landed = true` was set here but the loop kept
      // iterating over whatever calls followed in the same array, dispatching
      // every one of them to `options.executor` — including `schedule` and
      // `propose_durable_fact`, which have real side effects — AFTER the turn
      // had already been marked terminal. A stop that keeps acting is not a
      // stop. `break` here exits the for-loop immediately; the `if (landed)
      // break;` below then exits the outer `for (;;)` on the same pass.
      //
      // R13 (review finding 2): `failed` is not `rejected`. Both increment
      // `state.submitDraftCalls` (now conditionally — see item 3 above — but
      // still identically for `rejected` and `failed` alike, whenever the
      // attempt reached Python) — so a `failed` submit (Python errored)
      // consumes an attempt exactly as a `rejected` one does. But collapsing
      // the two into one `execution.kind === "rejected"` check meant a
      // `failed` submit at the ceiling got NO terminal event of its own: the
      // turn would loop back to the top and `shouldStop` (`bounds.ts`) would
      // supply its own `submit_ceiling` sentence there instead — which,
      // before R19 fixed the sentence itself at the source, attributed the
      // stop to a rejection that may never have happened. A `failed`
      // execution now gets its own terminal event, carrying its own
      // `execution.reason`, at the exact moment it trips the ceiling.
      // R17 (Task 5's re-review): gated on `call.name === "submit_draft"`,
      // matching the `ok`-path check two blocks above. Without that gate, the
      // widened `rejected || failed` condition above could fire on an
      // UNRELATED tool: two submit_draft calls in one pass both succeed
      // (submitDraftCalls reaches 2, no break, per R5), and then a `schedule`
      // call later IN THE SAME ARRAY returns `failed` for an ordinary
      // scheduling hiccup — the condition matched anyway, on
      // `submitDraftCalls >= maxSubmitDraftCalls` alone, and ended the turn
      // `held` with a scheduling error's reason misrepresented as a
      // submit-ceiling rejection of a draft that had in fact verified twice.
      // Before R13 this could not happen — `rejected` is not a kind an
      // unrelated tool plausibly returns — but `failed` is generic and ANY
      // tool can produce it, so widening the kind without narrowing the tool
      // reopened exactly the misleading-terminal-message failure R13 existed
      // to close. The ceiling is a bound on DRAFT SUBMISSIONS; a failure in
      // any other tool has nothing to do with it.
      //
      // Item 3 ALSO gates this on `attemptReachedPython(execution)`: a call
      // that never reached Python did not just move `submitDraftCalls`, so
      // it cannot be what pushed the counter over the ceiling — if the
      // ceiling was already reached by an EARLIER call in this same pass's
      // array, the next pass's `shouldStop` (top of the outer loop) is what
      // catches it, not this one.
      if (
        call.name === "submit_draft" &&
        attemptReachedPython(execution) &&
        (execution.kind === "rejected" || execution.kind === "failed") &&
        state.submitDraftCalls >= limits.maxSubmitDraftCalls
      ) {
        emit({ type: "terminal", outcome: "held", explanation: execution.reason });
        trace.end = { kind: "limit", reason: "submit_ceiling" };
        landed = true;
        break;
      }
    }

    if (results.length > 0) messages.push({ role: "user", content: "", toolResults: results });
    if (landed) break;
  }

  emit({ type: "turn.end" });
  return {
    events,
    usage,
    trace: { ...trace, totals: { ...usage, cacheHitRate: cacheHitRate(usage) }, durationMs: clock() - state.startedAt },
  };
}

function labelFor(toolName: string): string {
  if (toolName === "prepare_generation") return "Checking your client context";
  if (toolName === "submit_draft") return "Verifying claims and sources";
  if (toolName === "get_variant_sources") return "Fetching the receipts";
  if (toolName === "propose_durable_fact") return "Noting that for your knowledge base";
  if (toolName === "schedule") return "Putting it on the calendar";
  if (toolName === "propose_schedule") return "Preparing a time for you to confirm";
  if (toolName === "propose_post_now") return "Preparing the post for you to confirm";
  return "Working";
}

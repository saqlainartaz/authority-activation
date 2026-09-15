import "server-only";

import { ProductHttpError, safeProductSentence } from "@/lib/product";
import { EngineHttpError, safeEngineSentence } from "@/lib/engine";

import type { ModelCitation } from "@/agent/contracts/draft";
import { derivedKey, type ToolContext } from "@/agent/lib/backend";
import type { TurnUsage } from "@/agent/lib/driver";
import type { SkillVersion } from "@/agent/lib/prompt-versions";
import { TOOL_INPUT_SCHEMAS } from "@/agent/lib/tool-schemas";
import type { ToolExecution, ToolExecutor } from "@/agent/lib/turn";
import type { ToolName } from "@/agent/profile";
import { renderMaterial, type HandleMap } from "@/agent/render";
import { getVariantSources } from "@/agent/tools/get-variant-sources";
import { prepareGeneration } from "@/agent/tools/prepare-generation";
import { proposeDurableFact } from "@/agent/tools/propose-durable-fact";
import { schedule } from "@/agent/tools/schedule";
import { submitDraft } from "@/agent/tools/submit-draft";

/**
 * Task 8 fix round, item 5. This is the executor that used to live as an
 * inline closure inside `agent/route.ts`'s `ReadableStream.start()` — tool
 * dispatch, the mutable `handles`/`snapshotId` wiring Ruling R2 requires, and
 * per-tool idempotency attempts. It had no seam to call it through without a
 * full `Request` harness, which is exactly why none of it was unit-tested —
 * and every defect this task surfaced (the payload-unwrapping bug, the
 * escaping corruption, the attempt-accounting gap) lived in precisely this
 * untested code, found by a person wiring it rather than by a test.
 *
 * `route.ts` still owns: reading the request, recording the client's turn,
 * assembling context, constructing the driver (including the usage-tracking
 * wrapper — `usage` is read via `getUsage()` below rather than accumulated
 * here, because it depends on the driver's own per-pass results, which this
 * module has no visibility into), and streaming. This module owns dispatch.
 */

export type ExecutorState = {
  /** Ruling R2's mutable handle map — empty until `prepare_generation`
   *  succeeds, then live for the rest of the turn. Exposed (not private) so
   *  a caller — production or a test — can observe it changing across calls
   *  without needing a second, parallel way to ask "what does the executor
   *  currently know". */
  handles: HandleMap;
  /** Ruling R2's mutable snapshot id — `null` until `prepare_generation`
   *  succeeds. `submit_draft` reads this fresh on every call, so re-preparing
   *  mid-turn (§5.4: "re-retrieval is a feature") correctly moves it. */
  snapshotId: string | null;
  /** Every `agent_text` this turn actually got into `chat_messages`, in the
   *  order Python wrote it. §9 step 5's D-A: a generating turn legitimately
   *  records TWO `kind=agent` rows — the narration that rode `submit_draft`
   *  and the closing remark that follows it — and only a BYTE-IDENTICAL
   *  repeat is a duplicate worth suppressing. Populated only on an outcome
   *  that reached Python, because a pre-flight rejection wrote nothing and
   *  must not suppress a later recording. */
  submittedAgentTexts: string[];
};

export type CreateExecutorOptions = {
  sessionId: string;
  turnId: string;
  /** The client's onboarding/session token for this turn (final whole-branch
   *  review, C1) — read once by `route.ts` via `requireClientToken()` and
   *  threaded through every `ToolContext` this executor builds, rather than
   *  each tool re-deriving it. See `backend.ts`'s `ToolContext.token` doc. */
  token: string;
  /** Read fresh on every `submit_draft` call. Owned by the caller (`route.ts`
   *  wraps the driver to accumulate it across passes) because this module has
   *  no visibility into per-pass provider usage — only `route.ts`'s driver
   *  wrapper does. */
  getUsage: () => TurnUsage;
  /** Task 12 — threaded through every `ToolContext` this executor builds,
   *  the same way `token` is. See `backend.ts`'s `ToolContext.skillVersions`
   *  doc. */
  skillVersions: SkillVersion[];
};

export function isToolName(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(TOOL_INPUT_SCHEMAS, name);
}

/**
 * Final whole-branch review, I4. Every Python 4xx used to collapse to one
 * opaque sentence here — `` `${name} failed unexpectedly and could not
 * complete` `` — for a genuine infrastructure failure AND an ordinary,
 * actionable refusal alike (a `422 snapshot_not_generation_ready`, a `404`).
 * The generic sentence still spent an attempt (`turn.ts`'s
 * `attemptReachedPython` counts anything that reached this catch as having
 * reached Python) and gave the model nothing to correct — the same failure
 * shape the `schedule` timezone fix (Task 7 fix round, item 6) closed for a
 * different tool: a loop that burns attempts without ever converging, because
 * nothing tells the model what was actually wrong.
 *
 * `ProductHttpError.detail` (`lib/product.ts`) is FastAPI's own `detail` on
 * these routes — for `/context` and `/drafts` specifically, a bare kind
 * string (`"snapshot_not_generation_ready"`, `"citation_absent"`, ...), safe
 * by construction and exactly the kind of information the model can act on.
 * `safeProductSentence` is the SAME projection `forwardProductError` already
 * gives the BROWSER, exported so this file reuses it rather than risking a
 * second, silently-diverging version — the model gets the identical safe
 * sentence a human user would see, never the raw
 * `product POST ... -> 422: {...}` upstream-path-plus-body `error.message`
 * `ProductHttpError`'s own docstring warns against leaking. `safeEngineSentence`
 * (`lib/engine.ts`) is the same idea for the sibling error class — kept for
 * symmetry even though, after C1's fix, nothing under `src/agent/` can
 * actually throw one any more (every tool now calls a client-credential route
 * through `lib/product.ts`; `check:agent-service-credential` is what keeps
 * that true).
 *
 * A plain `Error` — validation feedback about the model's OWN input, e.g.
 * `schedule.ts`'s "when must be a local date and time…" — is still surfaced
 * verbatim; anything else (neither an `Error` nor one of the two HTTP error
 * classes) falls back to the generic sentence.
 */
function safeFailureReason(name: string, error: unknown): string {
  if (error instanceof ProductHttpError) return safeProductSentence(error.status, error.detail);
  if (error instanceof EngineHttpError) return safeEngineSentence(error.status, error.detail);
  if (error instanceof Error) return error.message;
  return `${name} failed unexpectedly and could not complete`;
}

/**
 * Builds one turn's executor plus the mutable state Ruling R2 requires,
 * paired so a caller (production or a test) can inspect `state` after each
 * call without a second channel for the same information.
 */
export function createExecutor(options: CreateExecutorOptions): { executor: ToolExecutor; state: ExecutorState } {
  const state: ExecutorState = { handles: new Map(), snapshotId: null, submittedAgentTexts: [] };

  // A11: attempts are counted per tool name, here — never supplied by the
  // model — so a retried logical operation (e.g. a second
  // `prepare_generation` because the first material was wrong) derives a
  // FRESH idempotency key rather than replaying the first call's key and
  // getting its cached answer back.
  const attempts = new Map<string, number>();
  function nextAttempt(name: string): number {
    const value = (attempts.get(name) ?? 0) + 1;
    attempts.set(name, value);
    return value;
  }

  const executor: ToolExecutor = async (name, input) => {
    if (!isToolName(name)) return { kind: "failed", reason: `unknown tool ${name}` };

    const parsed = TOOL_INPUT_SCHEMAS[name].safeParse(input);
    if (!parsed.success) {
      // The model's own malformed call, fed back so it can correct itself —
      // this is validation detail about ITS input, not server internals, so
      // it is safe to return verbatim. Never reached Python: nothing here
      // dispatched anywhere yet.
      return {
        kind: "rejected",
        reason: `invalid arguments for ${name}: ${parsed.error.message}`,
        reachedPython: false,
      };
    }

    const attempt = nextAttempt(name);
    const context: ToolContext = {
      sessionId: options.sessionId,
      turnId: options.turnId,
      handles: state.handles,
      token: options.token,
      skillVersions: options.skillVersions,
    };

    try {
      switch (name) {
        case "prepare_generation": {
          const args = parsed.data as { message: string; operation: "generate" | "revise" | "resume" };
          const contextV1 = await prepareGeneration(args, context, attempt);
          // Ruling R2: rendered exactly ONCE. `state.handles` is what
          // `submit_draft` reads on every later call via the SAME
          // `ToolContext.handles` reference this closure builds above.
          const rendered = renderMaterial(contextV1.material);
          state.handles = rendered.handles;
          state.snapshotId = contextV1.snapshot_id;
          return {
            kind: "ok",
            result: {
              status: contextV1.status,
              question: contextV1.question,
              subject: contextV1.subject,
              task: contextV1.task,
              voice: contextV1.voice,
              material: rendered.text,
              background: contextV1.background,
              banned_phrases: contextV1.banned_phrases,
              gaps: contextV1.gaps,
              conflicts: contextV1.conflicts,
            },
          };
        }
        case "submit_draft": {
          if (state.snapshotId === null) {
            return {
              kind: "rejected",
              reason: "no material has been prepared yet — call prepare_generation before submit_draft",
              // Never reached Python: nothing here made a network call.
              reachedPython: false,
            };
          }
          const args = parsed.data as { body: string; cited_atom_ids: ModelCitation[]; agent_text: string };
          const outcome = await submitDraft(
            {
              draft: { body: args.body, cited_atom_ids: args.cited_atom_ids },
              agentText: args.agent_text,
              snapshotId: state.snapshotId,
              usage: options.getUsage(),
            },
            context,
            attempt,
          );
          if (outcome.outcome === "held") {
            // `outcome.problems` present and non-empty is EXACTLY the local
            // pre-flight path (`submit-draft.ts`'s own early return, before
            // any network call) — the one case §4.7 mechanism 3 promises
            // spends no attempt. Its absence means Python itself held the
            // draft, which DID reach Python and must still count. This is
            // the explicit distinction Item 3 requires: read off a real,
            // named field (`problems`'s presence), never inferred from
            // `reason`'s text or guessed at.
            const reachedPython = !(outcome.problems && outcome.problems.length > 0);
            const reason =
              outcome.problems && outcome.problems.length > 0
                ? outcome.problems.map((problem) => problem.detail).join("; ")
                : outcome.rejectionKind
                  ? `the server's own checks held this draft: ${outcome.rejectionKind}`
                  : "the checks held this draft; there is no further detail available to explain why";
            // Python appends the `kind=agent` row OUTSIDE its verified/held
            // branch (`chat.py`'s own comment: "whichever branch ran") — so a
            // held submission that reached the server is recorded exactly as a
            // verified one is. Tracking only the verified texts would leave
            // the route's guard blind to a held attempt's `agent_text`, and
            // §5.5's one correction makes a held-then-verified turn the
            // ordinary shape of a rejection, not an edge case.
            if (reachedPython) state.submittedAgentTexts.push(args.agent_text);
            return { kind: "rejected", reason, reachedPython };
          }
          // Reached Python and was written in the same transaction as the
          // variant (A19). Recorded here rather than at the call site because
          // this is the only layer that sees `agent_text` at all.
          state.submittedAgentTexts.push(args.agent_text);
          return { kind: "ok", result: { outcome: outcome.outcome, variant_id: outcome.variant_id } };
        }
        case "get_variant_sources": {
          const args = parsed.data as { variant_id: string };
          const result = await getVariantSources({ variantId: args.variant_id }, context, attempt);
          return { kind: "ok", result };
        }
        case "propose_durable_fact": {
          const args = parsed.data as { text: string };
          const result = await proposeDurableFact({ text: args.text }, context, attempt);
          return { kind: "ok", result };
        }
        case "schedule": {
          const args = parsed.data as { content_item_id: string; when: string };
          const result = await schedule({ contentItemId: args.content_item_id, when: args.when }, context, attempt);
          return { kind: "ok", result };
        }
        default: {
          // Exhaustiveness check: if `ToolName` ever grows a 6th member
          // without a matching `case` above, `name` here is that member's
          // literal type, not `never`, and this line stops compiling —
          // rather than silently falling through and returning `undefined`
          // to `runAgentTurn`, which `strict` mode alone would not catch
          // (`noImplicitReturns` is not enabled in this project).
          const exhaustive: never = name;
          return { kind: "failed", reason: `unhandled tool ${exhaustive as string}` };
        }
      }
    } catch (error) {
      return { kind: "failed", reason: safeFailureReason(name, error) };
    }
  };

  return { executor, state };
}

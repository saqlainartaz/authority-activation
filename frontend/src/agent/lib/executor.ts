import "server-only";

import { ProductHttpError, safeProductSentence } from "@/lib/product";
import { EngineHttpError, safeEngineSentence } from "@/lib/engine";

import type { ModelCitation } from "@/agent/contracts/draft";
import { derivedKey, type ToolContext } from "@/agent/lib/backend";
import type { TurnUsage } from "@/agent/lib/driver";
import type { SkillVersion } from "@/agent/lib/prompt-versions";
import { inputSchemaFor } from "@/agent/lib/tool-schemas";
import type { ToolExecution, ToolExecutor } from "@/agent/lib/turn";
import { toolsFor, type ToolName } from "@/agent/profile";
import type { ContextV2 } from "@/agent/contracts/context";
import {
  buildGuidelineBlock,
  buildSelectedDraftBlock,
  buildTaskFactsBlock,
  buildSourcesBlock,
} from "@/agent/lib/context-assembly";
import {
  AppendOnlyHandles,
  renderBackgroundMaterial,
  renderMaterial,
  renderServerMaterial,
  type HandleMap,
} from "@/agent/render";
import { getVariantSources } from "@/agent/tools/get-variant-sources";
import { readKnowledge, type ReadKnowledgeArgs } from "@/agent/tools/read-knowledge";
import {
  listRecentContentTool,
  type ListRecentContentArgs,
} from "@/agent/tools/list-recent-content";
import {
  useTaskMaterial,
  type UseTaskMaterialArgs,
} from "@/agent/tools/use-task-material";
import { prepareGeneration } from "@/agent/tools/prepare-generation";
import type { PrepareGenerationArgs } from "@/agent/tools/prepare-generation";
import { proposeDurableFact } from "@/agent/tools/propose-durable-fact";
import { schedule } from "@/agent/tools/schedule";
import { proposeSchedule } from "@/agent/tools/propose-schedule";
import { proposePostNow } from "@/agent/tools/propose-post-now";
import { submitDraft, submitDraftC4 } from "@/agent/tools/submit-draft";

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
  /** The append-only namespace behind `handles`, under the c4 contract.
   *
   *  `handles` above is a plain Map because preflight and the payload
   *  builders want one; this is the thing that REFUSES a rebind. It was
   *  written, tested and referenced by nothing for two tasks — the
   *  reachability scan found it — while `state.handles = rendered.handles`
   *  replaced the map wholesale on every prepare. Under c4 that is D8
   *  exactly: §5.4 calls re-retrieval a feature, and a second prepare
   *  mid-turn discarded every handle the reads had issued, so a citation
   *  written against one failed preflight for no reason the model could
   *  see.
   *
   *  **Only the server's handles live here**, from `read_knowledge` and
   *  `use_task_material`. Wiring `prepare_generation`'s runtime-minted
   *  `M{n}` into it was a second bug on top of the first: positional handles
   *  re-mint, so the very rebind this class exists to refuse was one a
   *  legitimate second prepare would trigger every time. Prepared material is
   *  background now and binds nothing — `renderBackgroundMaterial`. */
  namespace: AppendOnlyHandles;
  /** Draft handles, `D{variant_no}` -> the real variant id, under c4.
   *
   *  **A variant id is an identifier, and the model was being handed one.**
   *  `submit_draft` answered with the raw `variant_id` and
   *  `<selected-draft variant="...">` rendered another, so every c4 turn that
   *  stored or revised a draft put uuids in the prompt — under a cycle whose
   *  premise is that none ever does. Two independent reviews missed it and so
   *  did ~600 tests, because the demonstration's identifier scan read the SSE
   *  stream instead of the prompt. Rewriting that scan to read what the model
   *  was actually handed found it on the first run.
   *
   *  The label is the SERVER's `variant_no`, seeded from the envelope and
   *  learned from each submit's response -- never counted here, which is what
   *  made an earlier version of this rebind across turns. The runtime keeps
   *  the map and substitutes the real id when the model points at one. */
  draftHandles: Map<string, string>;
  /** Draft handles the model has actually been SHOWN this turn -- in the
   *  selected-draft block or a submit result. `draftHandles` knows every
   *  variant (it is seeded from the envelope so numbering is stable), but a
   *  handle the model was never given must not resolve: with draft A shown as
   *  `D1`, a guessed `D2` used to reach draft B's sources. Fix verification,
   *  N3. */
  shownDrafts: Set<string>;
  /** The status of this turn's latest `context.v2` prepare, or `null` if none
   *  has run. Under c4 a submit is allowed only after a `ready` one: the
   *  prepare is what resolves WHO the turn writes as, and `answer_needed`
   *  means it could not -- the client has a question to answer first. */
  preparedV2: "ready" | "answer_needed" | null;
  /** The compare-and-set value for the NEXT submit: the selection the turn
   *  started with, then the variant this turn's own last verified submit
   *  stored. A frozen opening value refused a legitimate second submit in one
   *  turn, because the first store had moved the selection (N2). */
  expectedVariantId: string | null;
  /** The perspective the latest `context.v2` resolved, as the MODEL was told
   *  it -- mode plus the server's own author or brand id. `neutral` until a
   *  prepare says otherwise. Sent to `POST /basis` so the retained basis
   *  records the voice the draft was actually written in (O5). */
  perspective: {
    mode: "personal" | "brand" | "neutral";
    authorId: string | null;
    brandId: string | null;
  };
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
  /** Which submission contract this turn writes under. Defaults to
   *  `context.v1`, so every existing caller keeps the snapshot-and-atom-id
   *  path byte for byte. Set by `route.ts` off the resolved PROFILE, never
   *  off anything the request or the model carries. */
  contract?: "context.v1" | "c4";
  /** Which variant the client is looking at, threaded from the envelope so a
   *  revise turn can be handed the exact draft body. Without it, `context.v2`
   *  returns `selected_draft: null` and the model revises from memory. */
  selectedVariantId?: string | null;
  /** The session's variants as the server numbers them, from the envelope
   *  this turn opened with. Seeds the draft-handle map so `D{n}` means the
   *  same draft on every turn. See `draftHandle`. */
  knownVariants?: readonly { id: string; variant_no: number }[];
  /** This session's own content item, from the envelope. Under c4 it is what
   *  `schedule` acts on, because a c4 model is never given an item id. */
  contentItemId?: string | null;
  /** Where `read_knowledge` reads (Ruling 68): a voice preview's own view.
   *  Absent: the chat session's, as for every chat turn. */
  readTarget?: ToolContext["readTarget"];
};

/**
 * The perspective, as the model needs to read it.
 *
 * **The label, never the uuid.** Contracts §2.1 keeps entity ids and internal
 * identifiers out of a prompt; the model needs to know WHO it is writing as,
 * which is a name, and the ref stays in the basis where a receipt can pin it.
 * `null` label with a mode of `personal` would be a voice the model cannot
 * name, so it degrades to neutral rather than inventing one.
 */
function describePerspective(context: ContextV2): {
  mode: string;
  writing_as: string | null;
} {
  const ref = context.perspective.author ?? context.perspective.brand;
  const label = context.perspective.label ?? (ref ? null : null);
  return {
    mode: label === null && context.perspective.mode !== "neutral" ? "neutral" : context.perspective.mode,
    writing_as: label,
  };
}

/**
 * A variant's draft handle: `D{variant_no}`, the number the SERVER gave it.
 *
 * **It used to be minted here, positionally, and that broke guarantee 2.**
 * `D1` went to whichever variant this executor met first, and the executor is
 * rebuilt on every HTTP turn -- so a draft shown as `D1` on one turn could be a
 * different draft's `D1` on the next: the rebind D8 forbids, in a second
 * namespace. The outside review found it; I introduced it, in the same change
 * that took the raw variant ids out of the prompt.
 *
 * `variant_no` is assigned once per variant by `session_store.py` and never
 * reused within a session, so the handle is fixed for the view's whole life
 * and needs no counter here. A variant this turn has not been told about gets
 * NO handle rather than an invented one: an unnamed draft is a gap the model
 * can report, and a mis-named one is a citation that silently points
 * elsewhere.
 */
function draftHandle(state: ExecutorState, variantId: string): string | null {
  for (const [handle, id] of state.draftHandles) {
    if (id === variantId) return handle;
  }
  return null;
}

/** Name a draft TO THE MODEL: its handle, recorded as shown. Every place a
 *  handle enters a prompt goes through here, so "shown" cannot drift from
 *  "rendered". */
function showDraft(state: ExecutorState, variantId: string): string | null {
  const handle = draftHandle(state, variantId);
  if (handle !== null) state.shownDrafts.add(handle);
  return handle;
}

/** Learn the server's numbering for these variants. Append-only, like the
 *  read namespace: a handle already bound to a different variant is refused
 *  loudly, because that is the one thing this map exists to prevent. */
function learnVariants(
  state: ExecutorState,
  variants: readonly { id: string; variant_no: number }[] | undefined,
): void {
  for (const variant of variants ?? []) {
    const handle = `D${variant.variant_no}`;
    const bound = state.draftHandles.get(handle);
    if (bound !== undefined && bound !== variant.id) {
      throw new Error(`draft handle ${handle} is already bound to a different variant`);
    }
    state.draftHandles.set(handle, variant.id);
  }
}

function isToolName(name: string, contract: CreateExecutorOptions["contract"]): name is ToolName {
  return (toolsFor(contract) as readonly string[]).includes(name);
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
  const state: ExecutorState = {
    handles: new Map(),
    namespace: new AppendOnlyHandles(),
    draftHandles: new Map<string, string>(),
    perspective: { mode: "neutral", authorId: null, brandId: null },
    shownDrafts: new Set<string>(),
    preparedV2: null,
    expectedVariantId: options.selectedVariantId ?? null,
    snapshotId: null,
    submittedAgentTexts: [],
  };
  learnVariants(state, options.knownVariants);

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
    // Only a tool this contract OFFERS runs. Every tool the code knows has a
    // schema, including v1's `schedule`, so checking the schemas let a c4
    // turn schedule without the client's click.
    if (!isToolName(name, options.contract)) return { kind: "failed", reason: `unknown tool ${name}` };

    // The contract's own schema: under c4 a zod object that did not know
    // `perspective` would strip it without a word, and the fix would be a
    // field the model filled in that never reached the server.
    const parsed = inputSchemaFor(name, options.contract).safeParse(input);
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
      selectedVariantId: options.selectedVariantId ?? null,
      handles: state.handles,
      token: options.token,
      skillVersions: options.skillVersions,
      ...(options.readTarget ? { readTarget: options.readTarget } : {}),
    };

    try {
      switch (name) {
        case "prepare_generation": {
          const args = parsed.data as PrepareGenerationArgs;
          // **THE CONTRACT IS ASKED FOR, and it was not.** This called
          // `prepareGeneration(args, context, attempt)` with no runtime
          // argument, so `contract` was undefined and Python answered
          // `context.v1` even under the c4 profile: no perspective, no
          // guideline, no sources and no selected draft ever reached a model,
          // and every P6 example was demonstrable only in unit tests of code
          // no route called. Found by the second independent review.
          const prepared = await prepareGeneration(args, context, attempt, {
            perspectiveMode:
              options.contract === "c4"
                ? (args as { perspective?: "personal" | "brand" | "neutral" }).perspective
                : undefined,
            contract: options.contract === "c4" ? "context.v2" : undefined,
            // c4 sends the selection on every operation (C4 P2); v1 keeps main's
            // rule, only on a revise, which `prepareGeneration` applies itself.
            selectedVariantId: options.contract === "c4" ? options.selectedVariantId : undefined,
          });
          // **UNDER c4 THIS MATERIAL IS BACKGROUND, AND IT IS NOT CITABLE.**
          //
          // It used to run `renderMaterial` here under both contracts and
          // push the resulting `M{n}` into the append-only namespace. That was
          // wrong twice over, and the second independent review found both
          // halves. `M{n}` is minted in this runtime and exists in no read
          // view, so the fence cannot resolve it: a c4 model that cited what
          // it was shown had its draft refused. And `M{n}` is positional, so
          // a second prepare re-minted `M1` for different material and
          // `AppendOnlyHandles.set` correctly refused the rebind — turning
          // §5.4's "re-retrieval is a feature" into a thrown tool call.
          //
          // The citable namespace under c4 is the SERVER'S, issued by
          // `read_knowledge` and `use_task_material` against a real view.
          // Prepared material is context for writing, so it arrives with no
          // handle at all and `state.handles` is left exactly as the reads
          // built it. See `renderBackgroundMaterial`.
          let rendered: { text: string };
          if (options.contract === "c4") {
            rendered = renderBackgroundMaterial(prepared.material);
          } else {
            // Ruling R2: rendered exactly ONCE. `state.handles` is what
            // `submit_draft` reads on every later call via the SAME
            // `ToolContext.handles` reference this closure builds above.
            // v1 is unchanged, deliberately: its snapshot ids and its
            // `M{n}` numbering are per-prepare by design.
            const v1 = renderMaterial(prepared.material);
            state.handles = v1.handles;
            rendered = v1;
          }
          state.snapshotId = prepared.snapshot_id;
          const v2 = options.contract === "c4" ? (prepared as ContextV2) : null;
          if (v2 !== null) {
            // The LATEST prepare decides. A later one that asks a question
            // re-closes a turn an earlier one had opened.
            state.preparedV2 = v2.status === "ready" ? "ready" : "answer_needed";
            // **The piece's confirmed facts, bound for this turn.** A `TA{n}`
            // used to be citable only in the turn `use_task_material` issued
            // it, because the handle map is per turn and nothing reissued
            // them -- so a revision could not keep the client's own correction
            // as support (final outside sign-off). The server sends the SAME
            // set the basis will record, and they bind exactly as
            // `use_task_material` binds one: through the append-only
            // namespace, so a rebind is still refused.
            for (const fact of v2.task_assertions ?? []) {
              state.namespace.set(fact.handle, {
                atom_id: fact.handle,
                atom_type: "task_assertion",
                text: fact.text,
                trust: "untrusted",
              });
            }
            state.handles = state.namespace.asMap();
            // What the model is TOLD, not merely what the server resolved:
            // `describePerspective` degrades a mode with no nameable author to
            // neutral, and a basis recording an attribution the model was
            // never given would be a receipt for a voice nobody wrote in.
            const told = describePerspective(v2);
            state.perspective =
              told.mode === "neutral"
                ? { mode: "neutral", authorId: null, brandId: null }
                : {
                    mode: told.mode as "personal" | "brand",
                    authorId: v2.perspective.author?.id ?? null,
                    brandId: v2.perspective.brand?.id ?? null,
                  };
          }
          return {
            kind: "ok",
            result: {
              status: prepared.status,
              question: prepared.question,
              subject: prepared.subject,
              task: prepared.task,
              voice: prepared.voice,
              material: rendered.text,
              background: prepared.background,
              banned_phrases: prepared.banned_phrases,
              gaps: prepared.gaps,
              conflicts: prepared.conflicts,
              // The v2 extras, and only under c4. Spread conditionally rather
              // than emitted as nulls: a v1 turn's tool result must stay
              // byte-identical, because it sits inside the cached prefix.
              // Rendered by the SAME builders the assembly module owns, so
              // the `<guideline>` the model reads is the one whose
              // precedence sentence and escaping are tested. Emitting a
              // second, executor-local spelling here is how the two would
              // drift.
              ...(v2
                ? {
                    perspective: describePerspective(v2),
                    guideline:
                      v2.guideline === null
                        ? null
                        : buildGuidelineBlock(v2.guideline).content,
                    sources:
                      v2.sources.length > 0
                        ? buildSourcesBlock(v2.sources).content
                        : null,
                    task_facts:
                      (v2.task_assertions ?? []).length > 0
                        ? buildTaskFactsBlock(v2.task_assertions ?? []).content
                        : null,
                    selected_draft: (() => {
                      if (v2.selected_draft === null) return null;
                      const handle = showDraft(state, v2.selected_draft.variant_id);
                      // Unnamed means the selected draft is missing from the
                      // session's own variant list -- an invariant break.
                      // Omitted rather than shown under a handle nothing
                      // resolves, and never shown under its uuid.
                      return handle === null
                        ? null
                        : buildSelectedDraftBlock(v2.selected_draft, handle).content;
                    })(),
                  }
                : {}),
            },
          };
        }
        case "submit_draft": {
          const args = parsed.data as { body: string; title: string; cited_atom_ids: ModelCitation[]; agent_text: string };
          // THE CONTRACT DECIDES WHICH SUBMISSION, and it is the executor's
          // own option, never anything the model said. A model that could
          // choose would choose the path with the weaker checks.
          //
          // **UNDER c4 A SUBMIT REQUIRES A PREPARE THIS TURN.** This path used
          // to be allowed without one, on the reasoning that c4 material comes
          // from reads. But the prepare is also what resolves the PERSPECTIVE,
          // and without it the basis recorded neutral -- while the model could
          // still follow a client's "write this as me" and produce a personal
          // post. A receipt saying "neutral" for an attributed post is a false
          // record of who is speaking. The outside review flagged the gap and an
          // independent audit rejected my first reason for leaving it: "the
          // model was told no perspective" does not establish that it wrote
          // neutrally. Refused before any network call, so no attempt is spent
          // and the model is told exactly what to do instead.
          if (options.contract === "c4" && state.preparedV2 !== "ready") {
            // **A QUESTION IS NOT A GO-AHEAD.** The first version of this guard
            // accepted ANY prepare, including one that came back
            // `answer_needed` because the perspective was ambiguous -- which
            // resolves to neutral while the question is open. A model could
            // then submit "I founded..." before the client had said which
            // founder, and a verified draft was stored under a neutral receipt.
            // The contract requires clarification before unresolved attributed
            // writing; the final outside review found the gap in my fix.
            return {
              kind: "rejected",
              reason:
                state.preparedV2 === "answer_needed"
                  ? "the client has a question to answer before this piece can be written; ask it, and prepare again once they reply"
                  : "call prepare_generation before submit_draft: it resolves who this piece is written as, and a draft cannot be stored without that",
              reachedPython: false,
            };
          }
          const outcome =
            options.contract === "c4"
              ? await submitDraftC4(
                  {
                    draft: { body: args.body, cited_atom_ids: args.cited_atom_ids },
                    agentText: args.agent_text,
                    title: args.title,
                    usage: options.getUsage(),
                    // Server state from the envelope, never anything the model
                    // said: the selection this turn began with.
                    expectedVariantId: state.expectedVariantId,
                    perspectiveMode: state.perspective.mode,
                    perspectiveAuthorId: state.perspective.authorId,
                    perspectiveBrandId: state.perspective.brandId,
                  },
                  context,
                  attempt,
                )
              : await (async () => {
                  if (state.snapshotId === null) {
                    return {
                      outcome: "held" as const,
                      problems: [
                        {
                          kind: "not_prepared" as never,
                          detail:
                            "no material has been prepared yet — call prepare_generation before submit_draft",
                        },
                      ] as never,
                    };
                  }
                  return submitDraft(
                    {
                      draft: { body: args.body, cited_atom_ids: args.cited_atom_ids },
                      agentText: args.agent_text,
                      title: args.title,
                      snapshotId: state.snapshotId,
                      usage: options.getUsage(),
                    },
                    context,
                    attempt,
                  );
                })();
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
          // Under c4 the model is told the DRAFT HANDLE, not the variant id.
          // v1 is untouched: its cached prefix and its stored transcripts were
          // written against the uuid, and moving it would rewrite history for
          // every retained session.
          if (options.contract === "c4") {
            // The response carries the session's variants, the new one
            // included, so its handle is the server's number, not a guess.
            learnVariants(state, (outcome as { variants?: { id: string; variant_no: number }[] }).variants);
            // Storing SELECTS the new variant, so a second submit in this turn
            // must compare against this turn's own write, not the opening
            // selection -- which it has just replaced. A client switch made
            // after this point is still caught: it moves the selection away
            // from this value.
            if (outcome.outcome === "verified" && outcome.variant_id) {
              state.expectedVariantId = outcome.variant_id;
            }
            return {
              kind: "ok",
              result: {
                outcome: outcome.outcome,
                draft: outcome.variant_id ? showDraft(state, outcome.variant_id) : null,
              },
              // Off the model-facing object, so `draft.ready` still reaches
              // the browser with the real id. See `ToolExecution.runtime`.
              runtime: { variantId: outcome.variant_id },
            };
          }
          return { kind: "ok", result: { outcome: outcome.outcome, variant_id: outcome.variant_id } };
        }
        case "get_variant_sources": {
          const args = parsed.data as { variant_id: string };
          // The model points at `D1`; the runtime supplies the id. A model
          // that names something it was never shown gets a refusal it can
          // act on rather than a 404 from Python about an id it invented.
          let variantId = args.variant_id;
          if (options.contract === "c4") {
            const resolved = state.shownDrafts.has(args.variant_id)
              ? state.draftHandles.get(args.variant_id)
              : undefined;
            if (resolved === undefined) {
              return {
                kind: "rejected",
                reason:
                  `there is no draft ${args.variant_id} in this conversation; name one of the drafts you were shown`,
                reachedPython: false,
              };
            }
            variantId = resolved;
          }
          const result = await getVariantSources({ variantId }, context, attempt);
          return { kind: "ok", result };
        }
        case "propose_durable_fact": {
          const args = parsed.data as { text: string };
          const result = await proposeDurableFact({ text: args.text }, context, attempt);
          return { kind: "ok", result };
        }
        case "propose_post_now": {
          const { modelResult, proposalId } = await proposePostNow(context, attempt);
          return { kind: "ok", result: modelResult, runtime: { proposalId } };
        }
        case "propose_schedule": {
          const args = parsed.data as { when: string };
          const { modelResult, proposalId } = await proposeSchedule(args, context, attempt);
          return { kind: "ok", result: modelResult, runtime: { proposalId } };
        }
        case "schedule": {
          const args = parsed.data as { content_item_id?: string; when: string };
          // Under c4 the item is SERVER state, never the model's: the c4
          // schema has no id field, so a c4 model could only have supplied
          // one by leaking or inventing it.
          const contentItemId =
            options.contract === "c4" ? options.contentItemId : args.content_item_id;
          if (!contentItemId) {
            return {
              kind: "rejected",
              reason:
                "this conversation is not attached to a saved piece yet, so there is nothing to schedule",
              reachedPython: false,
            };
          }
          const result = await schedule({ contentItemId, when: args.when }, context, attempt);
          return { kind: "ok", result };
        }
        case "read_knowledge": {
          const args = parsed.data as ReadKnowledgeArgs;
          const result = await readKnowledge(args, context, attempt);
          // Handles come from the SERVER, and binding them is ONE operation
          // with rendering them: `renderServerMaterial` writes into the
          // append-only namespace as it renders, so the text the model reads
          // and the map preflight checks cannot disagree about what a handle
          // means. The hand-rolled skip-if-present loop that used to live
          // here did the same job with none of the namespace's protection:
          // it silently ignored a DIFFERENT binding for a handle it already
          // held, which is the reassignment D8 forbids.
          const { text: readMaterial } = renderServerMaterial(
            result.items.map((item) => ({
              handle: item.handle,
              atom: {
                atom_id: item.handle,
                atom_type: item.payload.kind,
                text: describeForModel(item.payload),
                trust: "untrusted" as const,
              },
            })),
            state.namespace,
          );
          state.handles = state.namespace.asMap();
          return {
            kind: "ok",
            result: {
              read_view: result.read_view,
              receipt: result.receipt,
              // The handle-tagged rendering, so the model sees `[K3]` beside
              // the words it may cite — the same affordance `renderMaterial`
              // gives the v1 path. The structured items ride along for the
              // fields a rendering cannot carry.
              material: readMaterial,
              items: result.items,
              sources: result.sources,
              coverage: result.coverage,
              diagnostics: result.diagnostics,
              next_cursor: result.next_cursor,
            },
          };
        }
        case "list_recent_content": {
          const args = parsed.data as ListRecentContentArgs;
          const result = await listRecentContentTool(args, context);
          // NOT added to `state.handles`. Prior writing is not citable, and
          // putting it in the handle namespace would make it look citable to
          // every downstream check that reads that map.
          return { kind: "ok", result };
        }
        case "use_task_material": {
          const args = parsed.data as UseTaskMaterialArgs;
          const result = await useTaskMaterial(args, context, attempt);
          // The assertion handle is the SERVER's, and it goes into the same
          // append-only namespace as read handles so a rebind is refused
          // there too. `TA{n}` cannot collide with `K{n}`/`E{n}`, which is
          // why the prefix is two letters.
          if (result.state === "used_for_task" && result.assertion !== null) {
            // Through the namespace, so a `TA{n}` cannot be rebound either.
            // This used to write straight into the map with no check at all.
            state.namespace.set(result.assertion, {
              atom_id: result.assertion,
              atom_type: "task_assertion",
              text: args.text,
              trust: "untrusted",
            });
            state.handles = state.namespace.asMap();
          }
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


/**
 * One line of citable text for a read item, so a claim can quote it.
 *
 * Deliberately NOT a re-render of the whole payload. The model already has
 * the structured item in the tool result; what the handle map needs is the
 * text a `quoted_text` would be taken from, and nothing else. Putting the
 * whole payload here would duplicate it into the prompt twice.
 */
function describeForModel(payload: {
  kind: string;
  statement?: string;
  excerpts?: { text: string }[];
}): string {
  if (payload.kind === "knowledge") {
    return payload.statement ?? "";
  }
  return (payload.excerpts ?? []).map((excerpt) => excerpt.text).join("\n");
}

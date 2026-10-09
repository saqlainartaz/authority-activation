import "server-only";

import {
  buildDraftPayload,
  buildDraftPayloadV2,
  type ModelDraft,
} from "@/agent/contracts/draft";
import { derivedKey, type ToolContext } from "@/agent/lib/backend";
import type { TurnUsage } from "@/agent/lib/driver";
import { preflight, type PreflightProblem } from "@/agent/preflight";
import { createChatBasis, submitChatDraft } from "@/lib/product";

/**
 * Submit a candidate draft for verification. Calls
 * `POST /v1/chat/sessions/{id}/drafts`. Wired in §9 step 4.
 *
 * The agent's own reply text rides this call (A19), so Python writes the variant
 * and the `kind=agent` message in ONE transaction — which is what closes the
 * crash window statelessness opened (§5.1.1).
 *
 * The model cites by HANDLE. `buildDraftPayload` substitutes real `atom_id`s
 * from server state before this leaves the runtime (§4.7).
 *
 * FIX, discovered wiring the real executor (§9 step 4 Task 8, `agent/route.ts`).
 * The route's response body is `RuntimeSessionOut` — `session`, `messages`,
 * `variants`, ..., `payload` — and `outcome`/`variant_id`/`rejection` all live
 * NESTED under that `payload` key (`chat.py::_run_draft_operation`,
 * `payload["variant_id"] = str(variant_id)` / `payload["rejection"] = {...}`),
 * never at the response's own top level. The previous version of this function
 * `return`ed the raw `engineJson(...)` call typed AS IF it were
 * `{outcome, variant_id?, problems?}` directly — which compiled (the type
 * parameter was inferred from this function's own declared return type, never
 * checked against what Python actually sends) but read `undefined` for both
 * fields on every real network call. Proved against
 * `tests/test_chat_agent_endpoints.py`'s own assertions
 * (`response.json()["payload"]["outcome"]`, `held.json()["payload"] ==
 * {"outcome": "held", "rejection": {"kind": "citation_absent"}}`). Left
 * uncaught this long because no test in this file's own tree exercises the
 * network branch — `preflight`'s local rejection path returns a literal that
 * always matched the declared shape, so only the Python-reachable branch was
 * silently wrong. This function's own external signature is UNCHANGED, so no
 * caller (`turn.ts`'s executor) needs to change for this fix.
 *
 * FIX (final whole-branch review, C1 — fatal, every turn). This route is
 * ALSO guarded by `require_onboarding_identity` (`chat.py:1345`) — the same
 * defect and same fix as `prepare-generation.ts`: this function used to call
 * `engineJson`, which sends only the service credential (`X-API-Key`), so
 * every submission died here too, at the very last call of every turn. It
 * now calls `submitChatDraft` (`lib/product.ts`), which sends both headers
 * via `clientJson`, with `context.token` threaded down through `ToolContext`.
 */
/**
 * P5, landed at P7. The `c4` branch: a basis, not a snapshot.
 *
 * **Two calls, and the order is the whole point.** The basis is minted
 * FIRST, from the server's own view, and only then is the draft submitted
 * against it. Submitting first and describing the basis afterwards would
 * let the exposure set be written by the thing it is supposed to constrain.
 *
 * **Handles stay handles.** `buildDraftPayloadV2` does not substitute a
 * uuid, because the server resolves each handle against the view that
 * issued it. The v1 substitution exists because a snapshot has no handle
 * namespace; a c4 view does.
 *
 * **Preflight still runs**, unchanged, so a citation the turn never held is
 * caught locally and costs no round trip and no submit attempt.
 */
export async function submitDraftC4(
  args: {
    draft: ModelDraft;
    agentText: string;
    /** The Library title, as v1's `submitDraft` sends it. */
    title?: string;
    usage: TurnUsage;
    perspectiveMode?: "personal" | "brand" | "neutral";
    /** The server's own ids for who the turn writes as, from `context.v2`. */
    perspectiveAuthorId?: string | null;
    perspectiveBrandId?: string | null;
    /** The selection this turn started with -- the compare-and-set value. */
    expectedVariantId?: string | null;
  },
  context: ToolContext,
  attempt = 1,
): Promise<{
  outcome: "verified" | "held";
  variant_id?: string;
  /** The session's variants after this submit, as the server numbers them.
   *  How the executor names the new draft `D{variant_no}` without counting. */
  variants?: { id: string; variant_no: number }[];
  problems?: PreflightProblem[];
  rejectionKind?: string;
}> {
  const problems = preflight(args.draft, context.handles, { allowUnquoted: true });
  if (problems.length > 0) return { outcome: "held", problems };

  const basis = await createChatBasis(context.token, context.sessionId, {
    idempotency_key: derivedKey(context.turnId, "chat_basis", attempt),
    perspective_mode: args.perspectiveMode ?? "neutral",
    perspective_author_id: args.perspectiveAuthorId ?? null,
    perspective_brand_id: args.perspectiveBrandId ?? null,
  });

  const payload = buildDraftPayloadV2(args.draft, context.handles, {
    basisId: basis.basis_id,
    agentText: args.agentText,
    idempotencyKey: derivedKey(context.turnId, "submit_draft", attempt),
    expectedVariantId: args.expectedVariantId,
    title: args.title,
  });

  const response = await submitChatDraft(context.token, context.sessionId, payload);

  // **A FENCED REFUSAL IS A REFUSAL.** The c4 path answers `refresh_required`
  // with `reasons` and `affected_handles`; that used to fall through the
  // success branch, so a draft that was NOT stored reached the model as a
  // success with its reasons stripped — and the client was told their draft
  // was ready. The second independent review found it in the demonstration's
  // own withdrawal transcript, which I had read and not noticed.
  if (response.payload.outcome !== "verified") {
    const reasons = response.payload.reasons ?? [];
    const affected = response.payload.affected_handles ?? [];
    return {
      outcome: "held",
      // The reason and the stale handle both travel. "Held" with neither is
      // a dead end for a model that has to decide what to re-read.
      rejectionKind: response.payload.outcome,
      problems: reasons.map((reason) => ({
        kind: response.payload.outcome,
        detail: affected.length > 0 ? `${reason} (${affected.join(", ")})` : reason,
      })) as unknown as PreflightProblem[],
    };
  }

  return {
    outcome: "verified",
    variant_id: response.payload.variant_id,
    variants: response.variants,
    rejectionKind: response.payload.rejection?.kind,
  };
}

export async function submitDraft(
  args: { draft: ModelDraft; agentText: string; title: string; snapshotId: string; usage: TurnUsage },
  context: ToolContext,
  attempt = 1,
): Promise<{
  outcome: "verified" | "held";
  variant_id?: string;
  problems?: PreflightProblem[];
  /** Only ever set on a HELD outcome that reached Python (`checks.py`'s seven
   *  server-side rejection kinds) — never on a local preflight hold, which
   *  reports its own richer `problems` instead. Absent otherwise. */
  rejectionKind?: string;
}> {
  // §4.7 mechanism 3: caught here, returned to the model, no Python round trip,
  // and no submit attempt spent — the caller in `turn.ts` owns that accounting.
  const problems = preflight(args.draft, context.handles);
  if (problems.length > 0) return { outcome: "held", problems };

  // §4.7 mechanism 1: the uuid comes from server state, never from the model.
  const payload = buildDraftPayload(args.draft, context.handles);

  const response = await submitChatDraft(context.token, context.sessionId, {
    snapshot_id: args.snapshotId,
    body: payload.body,
    title: args.title,
    cited_atom_ids: payload.cited_atom_ids,
    agent_text: args.agentText,
    idempotency_key: derivedKey(context.turnId, "submit_draft", attempt),
    usage: {
      input_tokens: args.usage.inputTokens,
      output_tokens: args.usage.outputTokens,
      cache_read_input_tokens: args.usage.cacheReadInputTokens,
      cache_creation_input_tokens: args.usage.cacheCreationInputTokens,
    },
    // Task 12 (§9 step 6). Server state (`context.skillVersions`, resolved
    // by `route.ts` before any tool ran), never the model's — A17's
    // premise that this wire already carried it was false until this
    // commit; see `DraftSubmitIn.skill_versions`'s own docstring.
    skill_versions: context.skillVersions,
  });

  // v1 answers `verified | held` and nothing else. The shared result type is
  // wider now because the c4 path needs `refresh_required`; narrowing here
  // rather than casting means that if v1 ever grew a third outcome, it would
  // be treated as a hold — not silently reported as a success, which is the
  // failure this whole change is about.
  return {
    outcome: response.payload.outcome === "verified" ? "verified" : "held",
    variant_id: response.payload.variant_id,
    rejectionKind: response.payload.rejection?.kind,
  };
}

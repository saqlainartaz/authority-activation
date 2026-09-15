import "server-only";

import { buildDraftPayload, type ModelDraft } from "@/agent/contracts/draft";
import { derivedKey, type ToolContext } from "@/agent/lib/backend";
import type { TurnUsage } from "@/agent/lib/driver";
import { preflight, type PreflightProblem } from "@/agent/preflight";
import { submitChatDraft } from "@/lib/product";

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
export async function submitDraft(
  args: { draft: ModelDraft; agentText: string; snapshotId: string; usage: TurnUsage },
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

  return {
    outcome: response.payload.outcome,
    variant_id: response.payload.variant_id,
    rejectionKind: response.payload.rejection?.kind,
  };
}

import "server-only";

import type { ContextV1, ContextV2 } from "@/agent/contracts/context";
import { derivedKey, type ToolContext } from "@/agent/lib/backend";
import { createChatContext } from "@/lib/product";

export type PrepareGenerationArgs = {
  message: string;
  operation: "generate" | "revise" | "resume";
  subject: string;
  retrieval_query: string;
};

/**
 * What the RUNTIME injects, never the model (C4 P2).
 *
 * `selectedVariantId` comes from the turn envelope, which is server state. A
 * model-supplied variant id would be a model choosing which draft the client
 * is looking at, and the point of the selected draft is that it is the one
 * they actually selected.
 */
export type PrepareGenerationRuntime = {
  selectedVariantId?: string | null;
  contract?: "context.v1" | "context.v2";
  /** The mode the client asked for, as the model reported it. c4 only. */
  perspectiveMode?: "personal" | "brand" | "neutral";
};

/**
 * Mint and freeze one snapshot, and return it projected as `context.v1`.
 * Calls `POST /v1/chat/sessions/{id}/context`. Wired in §9 step 4.
 *
 * NO `client_id` AND NO `idempotency_key` IN THE ARGUMENTS, ever (§3, A11). A
 * tool's input schema is what the MODEL fills in, so anything that must be true
 * rather than claimed cannot live there. Identity comes from the authenticated
 * session; the runtime derives per-tool idempotency keys from (turn id, tool,
 * attempt).
 *
 * There is deliberately no per-turn cap on this tool (§5.4): re-retrieval is a
 * feature, not a fault.
 *
 * FIX (final whole-branch review, C1 — fatal, every turn). `/v1/chat/sessions/
 * {id}/context` is guarded by `require_onboarding_identity`
 * (`src/product/api/chat.py:1306`) — the CLIENT credential (`X-API-Key` AND
 * `X-Onboarding-Token`), not the service-only credential `engineJson` (one
 * header, `X-API-Key`) attaches. `require_onboarding_identity` refuses
 * outright on a missing token (`auth.py:330-331`), so every real turn died at
 * this call. `createChatContext` (`lib/product.ts`, alongside
 * `recordClientTurn`/`recordAgentTurn`) uses `clientJson`, which sends both
 * headers; `context.token` is threaded down from the route's own
 * `requireClientToken()` call via `ToolContext` (see that type's own doc for
 * why A11 does not forbid this).
 */
export async function prepareGeneration(
  args: PrepareGenerationArgs,
  context: ToolContext,
  attempt = 1,
  runtime: PrepareGenerationRuntime = {},
): Promise<ContextV1 | ContextV2> {
  return createChatContext(context.token, context.sessionId, {
    message: args.message,
    operation: args.operation,
    subject: args.subject,
    retrieval_query: args.retrieval_query,
    clarification: args.operation === "resume" ? args.message : undefined,
    // Two rules, one per contract, in ONE key so neither can overwrite the
    // other. c4 (the runtime option) sends it on every operation: Python
    // resolves it against the session and ignores it where it does not apply.
    // v1 keeps main's rule, only on a revise. Absent stays absent, so a v1
    // body without a selection is byte-identical to what it always was.
    selected_variant_id:
      runtime.selectedVariantId ??
      (args.operation === "revise" && context.selectedVariantId ? context.selectedVariantId : undefined),
    // Defaults to v1. The `c4` profile passes `context.v2` at P5; until then
    // this tool returns exactly the shape it always did.
    contract: runtime.contract,
    // Omitted rather than defaulted, so a v1 request body is byte-identical to
    // what it always was. The server defaults an absent mode to neutral.
    ...(runtime.perspectiveMode ? { perspective_mode: runtime.perspectiveMode } : {}),
    idempotency_key: derivedKey(context.turnId, "prepare_generation", attempt),
  });
}

import "server-only";

import type { ContextV1 } from "@/agent/contracts/context";
import { derivedKey, type ToolContext } from "@/agent/lib/backend";
import { createChatContext } from "@/lib/product";

export type PrepareGenerationArgs = {
  message: string;
  operation: "generate" | "revise" | "resume";
  subject: string;
  retrieval_query: string;
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
): Promise<ContextV1> {
  return createChatContext(context.token, context.sessionId, {
    message: args.message,
    operation: args.operation,
    subject: args.subject,
    retrieval_query: args.retrieval_query,
    ...(args.operation === "revise" && context.selectedVariantId
      ? { selected_variant_id: context.selectedVariantId }
      : {}),
    clarification: args.operation === "resume" ? args.message : undefined,
    idempotency_key: derivedKey(context.turnId, "prepare_generation", attempt),
  });
}

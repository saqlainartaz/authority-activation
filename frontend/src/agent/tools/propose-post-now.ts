import "server-only";

import { derivedKey, type ToolContext } from "@/agent/lib/backend";
import { proposeSchedule as createProposal } from "@/lib/product";

/**
 * Propose publishing this conversation's post now. Publishes nothing.
 *
 * The same card pattern as `propose_schedule` (operator ruling, 2026-09-24):
 * the agent proposes, and the client's click -- made with THEIR credential,
 * which the model never holds -- publishes, through main's own Post now rules.
 * The model is told whether the post will go out automatically, and nothing
 * that identifies the proposal.
 */
export async function proposePostNow(
  context: ToolContext,
  attempt = 1,
): Promise<{ modelResult: { status: string; delivery: string }; proposalId: string }> {
  const proposal = await createProposal(context.token, context.sessionId, {
    kind: "post_now",
    idempotency_key: derivedKey(context.turnId, "propose_post_now", attempt),
  });
  return {
    modelResult: { status: proposal.status, delivery: proposal.delivery.line },
    proposalId: proposal.id,
  };
}

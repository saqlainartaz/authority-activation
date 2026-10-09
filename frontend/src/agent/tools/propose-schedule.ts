import "server-only";

import { derivedKey, type ToolContext } from "@/agent/lib/backend";
import { proposeSchedule as createProposal } from "@/lib/product";

/**
 * Propose a time for this conversation's post. Schedules nothing.
 *
 * Replaces `schedule` under c4 (operator ruling, 2026-09-24): the agent
 * proposes, the client confirms, for anything that goes out. The server
 * records a proposal and the browser shows it as a card; the client's click on
 * that card -- a request made with THEIR credential, which the model never
 * holds -- is what schedules, through the Schedule button's own rules.
 *
 * The model is told the time as the client will read it and nothing else: the
 * proposal's id travels to the browser off the model-facing result
 * (`ToolExecution.runtime`), the way a draft's variant id does.
 */
export async function proposeSchedule(
  args: { when: string },
  context: ToolContext,
  attempt = 1,
): Promise<{ modelResult: { status: string; goes_out: string }; proposalId: string }> {
  const proposal = await createProposal(context.token, context.sessionId, {
    when: args.when,
    idempotency_key: derivedKey(context.turnId, "propose_schedule", attempt),
  });
  return {
    modelResult: { status: proposal.status, goes_out: proposal.goes_out },
    proposalId: proposal.id,
  };
}

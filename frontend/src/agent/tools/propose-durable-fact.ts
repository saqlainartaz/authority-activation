import "server-only";

import { sendChatCommand } from "@/lib/product";

import { derivedKey, type ToolContext } from "@/agent/lib/backend";

/**
 * PROPOSE a durable fact. Posts the existing `propose_durable_fact` command kind
 * to `/commands`. Wired in §9 step 4.
 *
 * PROPOSE, NOT CONFIRM — that is the authority line (A7). `confirm_durable_fact`
 * stays an explicit human act and is not a tool, because confirming writes an
 * atom into the client's own knowledge base.
 *
 * Same reuse as `get-variant-sources.ts`: `/commands` is a client-credential
 * route, so this calls `sendChatCommand` (from `lib/product.ts`) with
 * `context.token` — threaded down from the route's own `requireClientToken()`
 * call (see `backend.ts`'s `ToolContext.token` doc; final whole-branch
 * review, C1, corrected the earlier, wrong belief that this differed from
 * `prepare_generation`/`submit_draft`'s own credential).
 *
 * The MODEL-facing field is `text` (`tool-schemas.ts`); Python's `/commands`
 * wire shape for this kind is `message` (`ChatMessageCommand`, same as every
 * other message-carrying command kind — see
 * `src/app/api/client/chat/sessions/[sessionId]/commands/route.ts`'s
 * `PROPOSAL_KINDS` branch). That rename happens once, below. See `backend.ts`
 * for the general three-shape note this is one leg of.
 */
export async function proposeDurableFact(
  args: { text: string },
  context: ToolContext,
  attempt = 1,
): Promise<{ pendingConfirmationId: string }> {
  const envelope = await sendChatCommand(context.token, context.sessionId, {
    kind: "propose_durable_fact",
    message: args.text,
    idempotency_key: derivedKey(context.turnId, "propose_durable_fact", attempt),
  });
  if (!envelope.pending_confirmation) {
    // The command kind exists to produce exactly this; a null here means
    // Python accepted the command but minted no pending confirmation, which
    // is an invariant violation this tool cannot silently paper over —
    // returning an empty id would let the model believe a proposal exists
    // for the client to confirm when none does.
    throw new Error("propose_durable_fact: Python returned no pending confirmation to propose");
  }
  return { pendingConfirmationId: envelope.pending_confirmation.id };
}

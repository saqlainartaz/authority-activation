import "server-only";

import {
  taskMaterialOutcomeSchema,
  type TaskMaterialOutcome,
} from "@/agent/contracts/product-context";
import { derivedKey, type ToolContext } from "@/agent/lib/backend";
import { createTaskMaterial } from "@/lib/product";

/**
 * `use_task_material` — a fact the client just told us, used or proposed.
 *
 * **Two actions, one tool**, because contracts §4 says "task-use/save share
 * one small adapter". Two tools would be two places that decide what counts
 * as a validated client assertion, and the second one would eventually be
 * the lenient one.
 *
 * **The model names a MESSAGE HANDLE, never an id and never free text.**
 * §4: "Message handles are issued for authorized user messages supplied to
 * the model, not arbitrary IDs... An agent cannot fabricate a message
 * reference or turn its own reply into approval." The server resolves the
 * handle to a client turn and checks the exact text is in it; this tool's
 * job is to make sure there is no other way to ask.
 *
 * **`propose_save` does not save.** It mints a proposal the client must
 * confirm. The outcome parser below refuses an outcome missing the handle
 * its state promises, so a malformed response cannot reach the model as a
 * completed save.
 */

export type UseTaskMaterialArgs = {
  action: "use_for_task" | "propose_save";
  message: string;
  text: string;
  subject?: string | null;
  applicability?: string | null;
};

export class TaskMaterialArgumentError extends Error {}

export async function useTaskMaterial(
  args: UseTaskMaterialArgs,
  context: ToolContext,
  attempt = 1,
): Promise<TaskMaterialOutcome> {
  if (!args.message) {
    // Named here rather than left to a bare 422, so the model is told what
    // it omitted instead of being told only that it failed.
    throw new TaskMaterialArgumentError(
      "use_task_material needs the handle of the client message this came from",
    );
  }
  if (!args.text) {
    throw new TaskMaterialArgumentError(
      "use_task_material needs the exact words from that message",
    );
  }

  const raw = await createTaskMaterial(context.token, context.sessionId, {
    request: {
      action: args.action,
      message: args.message,
      text: args.text,
      subject: args.subject ?? null,
      applicability: args.applicability ?? null,
    },
    idempotency_key: derivedKey(context.turnId, "use_task_material", attempt),
  });

  return taskMaterialOutcomeSchema.parse(raw);
}

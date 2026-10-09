import "server-only";

import { modelReadResultSchema, type ModelReadResult } from "@/agent/contracts/read";
import { derivedKey, type ToolContext } from "@/agent/lib/backend";
import { createChatRead, createVoiceRead, type ChatReadCreate } from "@/lib/product";

/**
 * `read_knowledge` — the model's one way into authorized client knowledge.
 *
 * One tool with a selector rather than four tools. Contracts section 1 says
 * the selectors "may share tools/endpoints" and that no separate model call is
 * required to choose one; four near-identical tools is the silent selection
 * failure the platform-neutral names were chosen to avoid.
 *
 * **What the model may not say.** No `read_view`, no `client_id`, no budget,
 * no cursor it invented. The runtime supplies the idempotency key and the
 * server injects the view — a model that could name a view could name someone
 * else's. The argument type below simply has nowhere to put any of them.
 *
 * **The result is validated, not trusted.** `modelReadResultSchema` parses
 * what came back before the caller sees it. That is not defensive padding: the
 * envelope carries `coverage` and `diagnostics`, and a malformed one would let
 * the agent read `extent: "exhaustive"` off a result that never claimed it.
 */

export type ReadKnowledgeArgs = {
  selector: "orient" | "find" | "inspect" | "exact";
  purpose: string;
  query?: string;
  meaning_id?: string;
  refs?: string[];
  breadth?: "focused" | "broad";
  /** A `next_cursor` an earlier `find` returned. The server refuses one that
   *  was issued for a different query or breadth (`stale_cursor`). */
  cursor?: string;
};

export class ReadKnowledgeArgumentError extends Error {}

/**
 * Build the wire selector from the model's flattened arguments.
 *
 * Each branch REQUIRES the field its selector cannot work without, and says
 * which one is missing. An `exact` call with no `meaning_id` would otherwise
 * reach Python as a malformed request and come back as a bare 422, which
 * tells the model nothing it can act on.
 */
function toSelector(args: ReadKnowledgeArgs): ChatReadCreate["request"]["selector"] {
  switch (args.selector) {
    case "orient":
      return { kind: "orient" };
    case "find":
      if (!args.query) {
        throw new ReadKnowledgeArgumentError("find needs a query");
      }
      // find searches the client's source text, which carries no meanings,
      // and the server refuses a meaning it cannot apply (final outside
      // sign-off). Said here, where the model can act on it, rather than as a
      // bare refusal after the round trip.
      if (args.meaning_id) {
        throw new ReadKnowledgeArgumentError(
          "find searches source material by its words and cannot narrow by meaning_id; use exact to read a known meaning",
        );
      }
      return {
        kind: "find",
        query: args.query,
        source_handles: [],
        meaning_hints: [],
        breadth: args.breadth ?? "focused",
      };
    case "inspect":
      if (!args.refs || args.refs.length === 0) {
        throw new ReadKnowledgeArgumentError("inspect needs at least one ref");
      }
      return { kind: "inspect", refs: args.refs, expand_context: true };
    case "exact":
      if (!args.meaning_id) {
        throw new ReadKnowledgeArgumentError("exact needs a meaning_id");
      }
      return { kind: "exact", meaning_id: args.meaning_id, subject: null };
  }
}

export async function readKnowledge(
  args: ReadKnowledgeArgs,
  context: ToolContext,
  attempt = 1,
): Promise<ModelReadResult> {
  // A voice preview reads through its own view (Ruling 68); a chat turn
  // through its session's. Same body, same model-safe answer.
  const target = context.readTarget;
  const read = (body: ChatReadCreate) =>
    target?.kind === "voice_preview"
      ? createVoiceRead(context.token, target.previewId, body)
      : createChatRead(context.token, context.sessionId, body);
  const raw = await read({
    request: {
      scope: {
        // Handles only, and empty means "every authorized subject in scope" —
        // never every tenant. The model narrows by selector, not by scope.
        subjects: [],
        meaning_ids: args.meaning_id ? [args.meaning_id] : [],
        time_mode: "current",
        purpose: args.purpose,
      },
      selector: toSelector(args),
      // Passed through as given. It used to be hard-wired to null, so a
      // truncated search could never be continued however the model asked.
      cursor: args.cursor ?? null,
    },
    idempotency_key: derivedKey(context.turnId, "read_knowledge", attempt),
  });

  // Parsed, not cast. A cast would let a shape the server never promised flow
  // into the prompt as if it had.
  return modelReadResultSchema.parse(raw);
}

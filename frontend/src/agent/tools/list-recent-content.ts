import "server-only";

import {
  modelHistoryResultSchema,
  type ModelHistoryResult,
} from "@/agent/contracts/product-context";
import { type ToolContext } from "@/agent/lib/backend";
import { listRecentContent } from "@/lib/product";

/**
 * `list_recent_content` — what this client has written before.
 *
 * **Prior writing, never evidence.** Contracts §4: "Product history is
 * untrusted prior writing, not independent evidence of client facts." The
 * result carries no handle, so there is nothing here a claim could cite;
 * the model may match voice against it and may not source a fact from it.
 *
 * **An empty page is not an empty archive.** §4 again: "Empty results do not
 * prove no older/deleted writing ever existed." `truncated` says this page
 * stopped early and nothing more, which is why this tool does not collapse
 * `items: []` into a friendlier "you have not written about that" — that
 * sentence would be a claim the server never made.
 *
 * The model may not name a tenant, a session or a page size. It gets a query
 * and a cursor the server issued.
 */

export type ListRecentContentArgs = {
  query: string;
  cursor?: string | null;
};

/** Prior writing as the MODEL sees it: the text and its dates, no reference.
 *  `title` and `objective` (added for the new-session summary, Cycle 5 P4.1)
 *  are left out too, so this tool's result is exactly what it was. */
export type ModelFacingHistory = {
  items: Omit<ModelHistoryResult["items"][number], "ref" | "title" | "objective">[];
  next_cursor: string | null;
  truncated: boolean;
};

export async function listRecentContentTool(
  args: ListRecentContentArgs,
  context: ToolContext,
): Promise<ModelFacingHistory> {
  const raw = await listRecentContent(context.token, context.sessionId, {
    query: args.query,
    cursor: args.cursor ?? null,
  });
  // Parsed, not cast: `trust` is a pinned literal and a payload that failed
  // to carry it must not flow into the prompt as if the server had vouched
  // for it.
  const parsed = modelHistoryResultSchema.parse(raw);
  // **`ref` IS DROPPED HERE, and it used to reach the prompt whole.** Each
  // item's `ref` is the content version's uuid and its body's SHA-256 digest,
  // and the executor returns this result straight into the model's tool
  // message -- so every page of prior writing put identifiers in the prompt,
  // on a surface C4's projection never touched. Round 2 recorded it as
  // serious; the outside review found it independently and called it
  // blocking.
  //
  // Nothing is lost. Prior writing is deliberately uncitable -- no handle,
  // `trust: "prior_writing"` -- so the model has nothing to point at, and a
  // reference it cannot use is only an identifier it can leak. The server
  // keeps the ref; the runtime hands over the text.
  //
  // `next_cursor` stays: it is an opaque paging token the model must hand
  // back to see the next page, the same standing as a receipt token.
  return {
    items: parsed.items.map(({ ref: _ref, title: _title, objective: _objective, ...visible }) => visible),
    next_cursor: parsed.next_cursor,
    truncated: parsed.truncated,
  };
}

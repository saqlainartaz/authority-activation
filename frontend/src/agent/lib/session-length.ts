import "server-only";

import { COMPACTION_INPUT_TOKENS, measuredInputTokens } from "@/agent/lib/compaction";
import type { TurnUsage } from "@/agent/lib/driver";

export { measuredInputTokens };

/**
 * When the composer suggests starting a new post (Cycle 5, P4.4; spec 10A.6):
 * at or above 80% of the compaction threshold, measured from the reply's FIRST
 * agent call's reported usage (P4.6, review I-1).
 *
 * The first call sends what compaction's trigger estimates before a reply --
 * the fixed prompt plus the carried conversation and this turn's context -- so
 * the notice and compaction measure the same thing, one as the provider counted
 * it, the other as estimated. Later calls of the reply add its knowledge reads,
 * which are never carried to the next turn; measuring them made a read-heavy
 * FIRST reply suggest a new post.
 */
export const NEW_POST_SUGGESTION_FRACTION = 0.8;

/** Whether the session is long enough to suggest a new post. False when no
 *  model call reported at all. */
export function nearCompaction(firstPass: TurnUsage | null): boolean {
  if (firstPass === null) return false;
  return measuredInputTokens(firstPass) >= COMPACTION_INPUT_TOKENS * NEW_POST_SUGGESTION_FRACTION;
}

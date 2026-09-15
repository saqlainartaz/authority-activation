import "server-only";

import type { AgentEvent } from "@/agent/events";

/**
 * §5.3's five events, over SSE.
 *
 * HAND-BUILT RATHER THAN TAKEN FROM A FRAMEWORK, and A1′ explains why: the AI
 * SDK's data-stream protocol exists to stream model output into a React
 * component, and this union deliberately has NOWHERE to put a draft body. The
 * transport is ~30 lines; the protocol we would be adopting is the half we
 * refuse.
 *
 * The whole event is JSON-encoded, which is what makes a newline inside the
 * agent's prose safe — SSE frames are newline-delimited, so raw concatenation
 * would truncate a frame mid-sentence.
 */
export function encodeEvent(event: AgentEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

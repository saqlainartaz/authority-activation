import "server-only";

import type { MaterialV1 } from "@/agent/contracts/context";
import type { SystemBlock } from "@/agent/lib/driver";
import { renderMaterial, type HandleMap } from "@/agent/render";
import { escapeForBody, type ModelMessage } from "@/agent/transcript";

/**
 * §4.8's context ordering and §5.8's two cache breakpoints.
 *
 *   instructions -> skill -> material -> transcript -> current turn
 *   |___________ stable across turns ___________|   |__ varies __|
 *
 * PURE, AND SEPARATE FROM `loop.ts` ON PURPOSE. Ordering is a correctness
 * property with its own failure mode — get it wrong and nothing errors, the
 * cache simply never hits and the bill quietly doubles — so it earns tests that
 * do not need a provider.
 */

/** Breakpoint 1. Instructions and skill are byte-identical for every client
 *  (neither file contains client data — `tests/agent/skill.test.ts` pins that),
 *  so this prefix caches ACROSS clients, not merely across passes of one turn. */
export function buildSystemBlocks(instructions: string, skill: string): SystemBlock[] {
  return [
    { text: instructions, cache: false },
    { text: skill, cache: true },
  ];
}

/**
 * Breakpoint 2 sits at the end of the material block: stable for the whole turn
 * INCLUDING §5.5's correction retry, which reuses the same snapshot. That retry
 * is the second-cheapest cache hit in the system and it comes free from putting
 * the boundary here rather than after the transcript.
 */
export function buildTurnMessages(
  material: MaterialV1[],
  transcript: ModelMessage[],
  clientMessage: string,
): { messages: ModelMessage[]; handles: HandleMap } {
  const { text, handles } = renderMaterial(material);

  const messages: ModelMessage[] = [
    { role: "user", content: `<material-set>\n${text}\n</material-set>` },
    ...transcript,
    // See transcript.ts:36-40 for why this escaping matters: client bodies can forge tag boundaries.
    { role: "user", content: `<client-message>${escapeForBody(clientMessage)}</client-message>` },
  ];

  return { messages, handles };
}

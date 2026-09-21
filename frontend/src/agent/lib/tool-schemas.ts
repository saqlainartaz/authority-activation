import "server-only";

import { z } from "zod";

import type { ToolSpec } from "@/agent/lib/driver";
import { TOOL_NAMES, type ToolName } from "@/agent/profile";

/**
 * The model-facing tool schemas (§4.6's first schema — what the MODEL fills in,
 * NOT the Python-facing payload, which `contracts/draft.ts` owns).
 *
 * TWO PROPERTIES, BOTH ENFORCED BY TEST RATHER THAN BY CARE:
 *
 * 1. BYTE-DETERMINISTIC SERIALISATION. Tools render before system, so these
 *    definitions sit at the very front of the cached prefix (§5.8). Unstable key
 *    order means the cache never hits — with no error, no warning, and a bill
 *    that quietly doubles. `buildToolSpecs` therefore emits in `TOOL_NAMES`
 *    order regardless of the order asked for.
 * 2. NOTHING LOCATOR-SHAPED, AND NO `idempotency_key`. §4.6 and A11: the
 *    guarantee is the absent field, never a validator.
 */

const handleCitation = z.object({
  handle: z.string().describe("The bare handle of the material this claim rests on, e.g. M1 — never brackets, never a uuid"),
  quoted_span: z.string().describe("The words copied out of that material block. At least eight characters"),
  claim_text: z.string().describe("The words copied out of the body you are writing in this same response"),
});

export const TOOL_INPUT_SCHEMAS: Record<ToolName, z.ZodType> = {
  prepare_generation: z.object({
    message: z.string().min(1).max(4_000).describe("The client's writing request, preserving their meaning instead of inserting retrieval syntax"),
    operation: z.enum(["generate", "revise", "resume"]).describe("generate for a new piece, revise when reacting to an existing draft, resume to pick up unfinished work"),
    subject: z.string().min(1).max(500).describe("The intended topic or selection target. This is request context, never evidence. When the client delegates the choice, name a broad grounded target such as the strongest useful lesson in their available knowledge"),
    retrieval_query: z.string().min(1).max(2_000).describe("A standalone semantic search query for the client's knowledge. Include relevant conversation and source hints, but never invent facts or identifiers"),
  }),
  submit_draft: z.object({
    body: z.string().describe("The post itself, and only the post"),
    cited_atom_ids: z.array(handleCitation).describe("One entry per factual claim about the client"),
    agent_text: z.string().describe("What you want to say to the client. Never the post itself"),
  }),
  get_variant_sources: z.object({
    variant_id: z.string().describe("The id of a draft that is already stored"),
  }),
  propose_durable_fact: z.object({
    text: z.string().describe("The fact to propose for the client's knowledge base. Proposing is not confirming"),
  }),
  schedule: z.object({
    content_item_id: z.string().describe("The approved item to place on the calendar"),
    // Task 8 fix round, item 6: this used to say "ISO-8601", which a naive
    // datetime with no offset satisfies and Python's AwareDatetime 422s on.
    // The server now resolves the client's own timezone itself (§3 — an
    // offset is something that must be TRUE, not claimed), so the model
    // reports a plain local date and time and nothing else.
    when: z.string().describe(
      "The LOCAL date and time the client asked for, with NO timezone offset — e.g. 2026-08-20T09:00. Never include a Z or a +/-offset; the server already knows the client's own timezone.",
    ),
  }),
};

const DESCRIPTIONS: Record<ToolName, string> = {
  prepare_generation: "Retrieve and freeze a snapshot of this client's context from an explicit subject and standalone search query. Call before writing. One meaningfully different re-retrieval is allowed when the returned material is mismatched.",
  submit_draft: "Submit a candidate draft plus your reply for verification. Returns verified or held. Two calls per turn.",
  get_variant_sources: "Show the receipts behind a draft that is already stored.",
  propose_durable_fact: "Propose a fact for the client's knowledge base. Proposes only — confirming is the client's, always.",
  schedule: "Put an approved piece on the calendar for a date.",
};

/** Emits in `TOOL_NAMES` order ALWAYS — see property 1 above. */
export function buildToolSpecs(allowed: readonly ToolName[]): ToolSpec[] {
  const granted = new Set(allowed);
  return TOOL_NAMES.filter((name) => granted.has(name)).map((name) => ({
    name,
    description: DESCRIPTIONS[name],
    inputSchema: z.toJSONSchema(TOOL_INPUT_SCHEMAS[name]) as Record<string, unknown>,
  }));
}

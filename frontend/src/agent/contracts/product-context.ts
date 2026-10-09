import { z } from "zod";

/**
 * The product-context contracts of C4 §4, mirrored in zod.
 *
 * Product context sits OUTSIDE the generic engine read API, so these do not
 * live in `contracts/read.ts` and do not share its envelope. The mirroring
 * discipline is the same one: `.strict()` everywhere, parse rather than cast,
 * and a round-trip test against the Python shapes so the two cannot drift
 * silently.
 *
 * **`prior_writing` is a literal, not a string.** Product history is the one
 * surface that hands the model exact client text that is NOT evidence. If
 * `trust` were a free string, a malformed payload could label a two-year-old
 * draft as a source, and the model would ground a claim in something the
 * client merely wrote before. Pinning the literal makes that a parse failure.
 *
 * **There is no handle anywhere in `PriorContent`.** That absence is the
 * guarantee: a claim cites handles, and prior writing has none to cite.
 */

const productContentRefSchema = z
  .object({
    id: z.string(),
    version: z.number().int().min(1),
    body_digest: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

const priorContentSchema = z
  .object({
    ref: productContentRefSchema,
    body: z.string(),
    body_truncated: z.boolean(),
    status: z.string().nullable(),
    created_at: z.string(),
    published_at: z.string().nullable(),
    // Cycle 5, P4.1: the item's title and objective, additive on the Python
    // side, so optional here too. Client-authored and untrusted, like the body.
    title: z.string().nullable().optional(),
    objective: z.string().nullable().optional(),
    trust: z.literal("prior_writing"),
  })
  .strict();

export const modelHistoryResultSchema = z
  .object({
    items: z.array(priorContentSchema),
    next_cursor: z.string().nullable(),
    truncated: z.boolean(),
  })
  .strict()
  .refine(
    (result) => result.next_cursor === null || result.truncated,
    {
      message: "a result that is not truncated cannot offer a next page",
      path: ["next_cursor"],
    },
  );

/**
 * `used_for_task` with an assertion, or `proposed` with a proposal.
 *
 * The refinement is the whole point of parsing this at all: a `proposed`
 * outcome with no proposal handle would read to the model as a completed
 * save with nothing to point at, and "I've saved that" about a proposal the
 * server never minted is the exact claim §4 forbids.
 */
export const taskMaterialOutcomeSchema = z
  .object({
    state: z.enum(["used_for_task", "proposed"]),
    assertion: z.string().nullable(),
    proposal: z.string().nullable(),
  })
  .strict()
  .refine(
    (outcome) =>
      outcome.state === "used_for_task"
        ? typeof outcome.assertion === "string" && outcome.assertion.length > 0
        : typeof outcome.proposal === "string" && outcome.proposal.length > 0,
    { message: "the outcome must carry the handle its state promises" },
  );

const productToolFailureSchema = z
  .object({
    code: z.enum([
      "invalid_request",
      "access_denied",
      "clarification_required",
      "unavailable",
      "stale_cursor",
      "idempotency_conflict",
    ]),
    detail: z.string(),
  })
  .strict();

export type PriorContent = z.infer<typeof priorContentSchema>;
export type ModelHistoryResult = z.infer<typeof modelHistoryResultSchema>;
export type TaskMaterialOutcome = z.infer<typeof taskMaterialOutcomeSchema>;
export type ProductToolFailure = z.infer<typeof productToolFailureSchema>;

import "server-only";

import { z } from "zod";

import type { ToolSpec } from "@/agent/lib/driver";
import { C4_TOOL_NAMES, TOOL_NAMES, type ToolName } from "@/agent/profile";

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

// Module-private since review 5 (B1): the executor used to check a call's
// name against this table, and every tool the code knows has an entry, so a
// c4 turn could run v1's `schedule`. It now checks the contract's own list
// (`profile.ts::toolsFor`), and the schemas are reached through
// `inputSchemaFor`. `Record<ToolName, ...>` keeps the set closed at compile time.
const TOOL_INPUT_SCHEMAS: Record<ToolName, z.ZodType> = {
  prepare_generation: z.object({
    message: z.string().min(1).max(4_000).describe("The client's writing request, preserving their meaning instead of inserting retrieval syntax"),
    operation: z.enum(["generate", "revise", "resume"]).describe("generate for a new piece, revise when reacting to an existing draft, resume to pick up unfinished work"),
    subject: z.string().min(1).max(500).describe("The intended topic or selection target. This is request context, never evidence. When the client delegates the choice, name a broad grounded target such as the strongest useful lesson in their available knowledge"),
    retrieval_query: z.string().min(1).max(2_000).describe("A standalone semantic search query for the client's knowledge. Include relevant conversation and source hints, but never invent facts or identifiers"),
  }),
  submit_draft: z.object({
    body: z.string().describe("The post itself, and only the post"),
    title: z.string().trim().min(1).max(100).describe("A short, useful Library title grounded in the post. Not part of the published post"),
    cited_atom_ids: z.array(handleCitation).describe("One entry per factual claim about the client"),
    agent_text: z.string().describe("What you want to say to the client. Never the post itself"),
  }),
  get_variant_sources: z.object({
    variant_id: z.string().describe("The id of a draft that is already stored"),
  }),
  propose_durable_fact: z.object({
    text: z.string().describe("The fact to propose for the client's knowledge base. Proposing is not confirming"),
  }),
  list_recent_content: z.object({
    // A query and a cursor, and deliberately nothing else. No page size (the
    // server bounds it), no date range (recency is the server's second
    // selection signal), no tenant.
    query: z
      .string()
      .min(1)
      .max(500)
      .describe(
        "What this piece is about, in the client's own terms. Used to pick which earlier posts are worth showing, alongside how recent they are",
      ),
    cursor: z
      .string()
      .nullish()
      .describe("Only a cursor a previous result gave you. Never one you composed"),
  }),
  use_task_material: z.object({
    action: z
      .enum(["use_for_task", "propose_save"])
      .describe(
        "use_for_task to rely on it for this piece only, propose_save to offer it for the client's knowledge base. Neither one saves anything: propose_save asks the client and waits",
      ),
    message: z
      .string()
      .describe(
        "The handle of the client message this came from, e.g. U3. Never your own reply, and never a handle you did not see",
      ),
    text: z
      .string()
      .min(1)
      .max(2_000)
      .describe("The exact words from that message, copied. A paraphrase is refused"),
    subject: z
      .string()
      .nullish()
      .describe("The handle of what this is about, if a read gave you one"),
    applicability: z
      .string()
      .nullish()
      .describe("When this holds, if the client said. Leave unset for this task only"),
  }),
  read_knowledge: z.object({
    // The four selectors of contracts section 1, flattened into one tool.
    // One tool rather than four, because "no separate model call is required
    // to choose a selector" — four near-identical tools is the silent
    // selection failure the five platform-neutral names were named to avoid.
    selector: z
      .enum(["orient", "find", "inspect", "exact"])
      .describe(
        "orient for a compact overview before you reply, find to search the client's source material (calls, documents) by its words -- it does not search knowledge records, which orient and exact read, inspect to expand handles you already hold, exact for a known meaning",
      ),
    purpose: z
      .string()
      .min(1)
      .max(500)
      .describe("Why you are reading, in your own words. Used for the receipt, never as a filter"),
    query: z
      .string()
      .max(2_000)
      .optional()
      .describe("For find: a standalone search query. Literal names, numbers and currencies are kept as search terms"),
    meaning_id: z
      .string()
      .max(200)
      .optional()
      .describe("For exact: the meaning to read, e.g. offering.price. Returns every current scoped value, not one"),
    refs: z
      .array(z.string())
      .optional()
      .describe("For inspect: handles you were already given, e.g. K3 or E7. Never a uuid, never invented"),
    breadth: z
      .enum(["focused", "broad"])
      .optional()
      .describe("For find: broad packs everything eligible when it genuinely fits, and says so honestly when it does not"),
    // **THE CONTINUATION, and the model had no way to send it.** A truncated
    // `find` returns `next_cursor`, which the model received -- and this tool
    // had no field to hand it back in, so every "there is more" was a dead
    // end (final outside review). `read_knowledge` is c4-only, so v1's tool
    // bytes do not move.
    cursor: z
      .string()
      .min(1)
      .optional()
      .describe("For find: the next_cursor a previous find returned, to see the rest of the same search. Only a cursor you were given, with the same query and breadth"),
  }),
  propose_schedule: z.object({
    when: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/)
      .describe(
        "The LOCAL date and time the client asked for, with NO timezone offset, e.g. 2026-10-03T09:00. The server applies the client's own timezone.",
      ),
  }),
  // No arguments: the post is this conversation's own, and "now" is the
  // moment the client confirms, never a time the model names.
  propose_post_now: z.object({}),
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
  propose_schedule:
    "Propose a time for this conversation's approved post. Nothing is scheduled: the client confirms on a card.",
  propose_post_now:
    "Propose publishing this conversation's approved post now. Nothing is published: the client confirms on a card.",
  read_knowledge:
    "Read this client's authorized knowledge and source evidence. Handles you receive are stable: cite the same handle later and it still means the same thing. An empty result means nothing was retrieved, never that the client has no such fact.",
  list_recent_content:
    "Show what this client has written before, most recent first. This is their own prior writing, not evidence about their business: match their voice against it, never source a fact from it. An empty page means nothing matched this query on this page, never that they have written nothing.",
  use_task_material:
    "Take a fact the client just stated in this conversation and either rely on it for this piece or offer it for their knowledge base. Name the message they said it in and copy their exact words. Neither action saves anything; proposing asks them and waits.",
};

/**
 * Where c4 must tell the model something DIFFERENT, and only there.
 *
 * `prepare_generation` is the one entry, and the difference is not cosmetic.
 * Under v1 its material is what the model cites; under c4 the citable
 * namespace belongs to the server — `read_knowledge` and `use_task_material`
 * issue handles the fence can actually resolve — and prepared material is
 * background for voice and framing. The v1 sentence told a c4 model to freeze
 * a snapshot and write from it, which is how a draft ended up citing material
 * the fence had no view for. Every other tool means the same thing under both,
 * so every other entry is absent rather than duplicated: two copies of one
 * sentence is how the copies drift.
 *
 * A missing entry falls back to `DESCRIPTIONS`, so v1's emitted bytes cannot
 * move — the default argument keeps every existing caller on that path.
 */
const C4_DESCRIPTIONS: Partial<Record<ToolName, string>> = {
  // Each says WHEN to use the tool and what comes back, not only what it is
  // (Anthropic: "differentiate tools by WHEN to use them"). Rules for using a
  // result live here, never inside the result: a tool result is data, and an
  // instruction inside one is treated as untrusted.
  schedule:
    "Put the piece this conversation is working on onto the calendar. Use it when the client asks for a date and time and the piece has been approved. You name only the local date and time; the piece and the timezone are known.",
  propose_schedule:
    "Propose a time to publish this conversation's post. Use it when the client asks for the post to go out at a date and time, and the post has been approved. " +
    "It schedules NOTHING: it shows the client a card with the exact post and time, and only their click on it schedules. " +
    "Returns pending with the time as the client will read it. Tell them in one line that the card is ready to confirm; never say it is scheduled until a client-action in the conversation says so. " +
    "A newer proposal replaces the older card. " +
    "Resolve a relative date (\"next Friday\", \"tomorrow\") against <today>, in the client's own zone. " +
    'Example: {"when":"2026-10-03T09:00"}',
  propose_post_now:
    "Propose publishing this conversation's post right now. Use it when the client asks for the post to go out now, and the post has been approved. " +
    "It publishes NOTHING: it shows the client a card with the exact post, and only their click on it publishes. " +
    "Returns pending, with delivery saying whether the post will go out automatically. When the channel is not connected for automatic posting it is refused, and you tell the client they post it themselves. " +
    "Never say it is published until a client-action in the conversation says so. " +
    "Example: {}",
  prepare_generation:
    "Get this client's writing context. Call it at the start of every writing turn, new piece (operation generate) or revision (operation revise), before you draft. " +
    "Returns: status -- ready, or answer_needed with a question you must ask the client first; perspective -- who you write as; guideline -- the client's saved default, which a direction in this task outranks; sources; the selected draft and, in <draft-citations>, what it cited; <task-facts> -- facts the client confirmed for this piece, which you cite by their TA handle as they stand, with no re-read; and background material. " +
    "Background is for voice and framing only and carries no handle: you cannot cite it. Every client-specific claim must cite a handle from read_knowledge or use_task_material, or a TA handle from <task-facts>. " +
    // 2026-09-28: Sonnet 5 read an empty background as "the client has nothing"
    // and asked the client to describe their business in every writing case.
    "This result does NOT show what the client has shared: its background can be empty or thin while the client has plenty. So after it, call read_knowledge (orient first) before you draft and before you tell the client that anything is missing. " +
    "One meaningfully different re-retrieval is allowed when the background is mismatched. " +
    // Test-client rerun, 2026-09-27: "make it shorter and more personal" drew
    // "first person as the founder, or unnamed?" instead of a revision, though
    // the client had already chosen the voice. Tone is not perspective.
    "On a revision, keep the perspective the draft is already written in and send that same perspective. A tone request -- shorter, more personal, warmer, punchier, more casual -- changes the wording, not who is speaking: revise straight away, without asking. Ask who should speak only when the client asks to change it (\"write it as me\", \"from the brand\"). " +
    'Example: {"message":"write about our pricing","operation":"generate","subject":"membership pricing","retrieval_query":"membership price per month"}',
  read_knowledge:
    "Look up facts about this client. Use it before you state anything about the client, and pick the selector by what you need: " +
    "orient first, for an overview of what is known and which sources exist; " +
    "exact when you know the kind of fact, by meaning_id (e.g. offering.price): it returns every current value with its scope; " +
    "find to search the client's source documents by their words -- literal terms, no meaning_id; it does not search knowledge records; " +
    "inspect to open handles you already hold (refs), including a selected draft's <draft-citations>: a K, E or C handle from an earlier turn must be re-read with inspect before you cite it again, or the citation is refused. " +
    "Handles are stable for the whole conversation: K is a knowledge record, E a source passage, C its context, S a source label. Cite K, E or C; never S. " +
    "A truncated result returns next_cursor: send it back as cursor with the same query to continue. An empty result means nothing was found, never that the client has no such fact. " +
    'Example: {"selector":"exact","meaning_id":"offering.price","purpose":"post about membership pricing"}',
  submit_draft:
    "Store a finished draft. Use it once the post is written and every client-specific claim cites a handle you hold in this turn. " +
    "For each claim: claim_text is copied exactly from the body; quoted_span is an exact slice of the cited material, or empty to paraphrase. " +
    "Returns verified (stored; you are given its draft handle, e.g. D2) or held with the reasons. When held, fix what the reasons name and submit once more: two submits per turn. " +
    "A draft that was not verified was not stored; never tell the client it was.",
  get_variant_sources:
    "List, by name, the sources a stored draft draws on. Use it when the client asks where something in a draft came from. Takes a draft handle you were shown, e.g. D1.",
  list_recent_content:
    "Show what this client has posted before, most recent first. Use it to match their voice and avoid repeating a recent post. It is their own writing, not evidence: never cite it or source a fact from it. An empty page means nothing matched on this page, never that they have written nothing.",
  use_task_material:
    "Use a fact the client just stated in this conversation. Use it when they tell you something you need for this piece that is not in their knowledge. " +
    "Name the message it came from by its handle (the U handle on <client-message>) and copy their exact words. " +
    "use_for_task binds it to this piece and gives you a TA handle to cite; propose_save offers it for their knowledge base and waits for them. Neither saves anything. " +
    'Example: {"action":"use_for_task","message":"U5","text":"our programme is the Thursday evening intensive"}',
  propose_durable_fact:
    "Suggest a fact for the client's knowledge base. Use it when they state something that will stay true beyond this piece. It only proposes: the client confirms, always. Never say it has been saved.",
};

/**
 * Where c4's INPUT differs, and only there. Same rule as `C4_DESCRIPTIONS`:
 * a missing entry falls back to `TOOL_INPUT_SCHEMAS`, so v1's emitted bytes
 * and v1's argument validation cannot move.
 *
 * `prepare_generation` gains `perspective`, the MODE the client asked to
 * write in. The outside review's O5: nothing on the c4 path ever sent one, so
 * a request to write as a person or a brand was prepared and stored as
 * neutral. The mode is the model's to report because it is what the client
 * SAID; who that resolves to is not, and the model never names an entity.
 * The server checks the mode against the permitted set, picks the author or
 * brand when there is exactly one, and asks on the existing question channel
 * when there is more than one.
 */
const C4_INPUT_SCHEMAS: Partial<Record<ToolName, z.ZodType>> = {
  // **NO `content_item_id`.** The v1 schema asks the model to supply one, and
  // under c4 a model is never shown an identifier -- so the field could only
  // be filled by a leak or a guess. The outside review's O2. The item is this
  // conversation's own piece, which the runtime knows from server state.
  schedule: (TOOL_INPUT_SCHEMAS.schedule as z.ZodObject).omit({ content_item_id: true }),
  prepare_generation: (TOOL_INPUT_SCHEMAS.prepare_generation as z.ZodObject).extend({
    perspective: z
      .enum(["personal", "brand", "neutral"])
      .optional()
      .describe(
        "Who the client asked this piece to be written as: personal (as themselves), brand (as their business), or neutral. Omit when they did not say. Never guess a name; the server works out who that is. " +
          // Test-client check run, 2026-09-27: "more personal" was sent as `personal`
          // on a neutral draft, and the server then asked who should speak.
          "On a revision, send the perspective the draft already has: \"more personal\" is a tone request, not the personal mode",
      ),
  }),
};

/** The schema a model's arguments are validated against under `contract`. */
export function inputSchemaFor(
  name: ToolName,
  contract: "context.v1" | "c4" = "context.v1",
): z.ZodType {
  return (contract === "c4" ? C4_INPUT_SCHEMAS[name] : undefined) ?? TOOL_INPUT_SCHEMAS[name];
}

/**
 * Emits in `C4_TOOL_NAMES` order ALWAYS — see property 1 above.
 *
 * **Corrected at P6, and the bug it fixes was silent.** This used to filter
 * over `TOOL_NAMES`, the frozen v1 list. `read_knowledge` is not in that
 * list, so the `linkedin-c4` profile granted it and this function then
 * dropped it: the c4 model was shipped a tool set with no way to read
 * knowledge at all, with no error anywhere. `C4_TOOL_NAMES` is
 * `[...TOOL_NAMES, ...]`, so v1's emitted bytes are unchanged — the v1
 * profile grants none of the added names and they filter straight back out —
 * and the cached prefix a retained session depends on does not move.
 */
/** Every tool any profile can grant, in the one emission order. */
const ALL_TOOL_NAMES: readonly ToolName[] = [
  ...TOOL_NAMES,
  ...C4_TOOL_NAMES.filter((name) => !(TOOL_NAMES as readonly string[]).includes(name)),
];

export function buildToolSpecs(
  allowed: readonly ToolName[],
  contract: "context.v1" | "c4" = "context.v1",
): ToolSpec[] {
  // A FIXED order, whatever order a profile lists them in: the tool list
  // opens the cached prefix, so a reordering would miss the cache. The order
  // is every v1 tool, then the c4 ones -- not C4's own list, because c4 no
  // longer carries `schedule`, and filtering C4's list silently dropped
  // `schedule` from v1's prompt too (a test pinning v1's bytes caught it).
  const granted = new Set(allowed);
  return ALL_TOOL_NAMES.filter((name) => granted.has(name)).map((name) => ({
    name,
    description:
      (contract === "c4" ? C4_DESCRIPTIONS[name] : undefined) ?? DESCRIPTIONS[name],
    inputSchema: z.toJSONSchema(inputSchemaFor(name, contract)) as Record<string, unknown>,
  }));
}

import "server-only";

import { z } from "zod";

/**
 * The model-facing read contract — the TypeScript mirror of
 * `content_engine.ke.retrieval.schemas`'s `Model*` and `Wire*` types, pinned to
 * `contracts/read-schema.json`.
 *
 * THIS IS THE MODEL-FACING SCHEMA. Every reference here is an opaque
 * server-issued handle, never a uuid, a release id or a storage locator. The
 * Python side holds the trusted forms with real refs and revisions; conflating
 * the two is how a tenant id reaches an LLM, and `draft.ts` carries the same
 * warning for the same reason.
 *
 * Two things the runtime injects and the model therefore cannot supply:
 *
 * - **the read view.** `ModelReadRequest` has no `read_view` field at all. A
 *   model that could name a view could name someone else's.
 * - **tenant, actor, permissions and budget.** Server-derived, never parameters.
 *
 * Handles are immutable bindings, reusable across turns while eligible, and
 * never reassigned: a second search extends the view rather than repointing
 * `K2` at new text. Holding a handle is not authority to resolve it.
 *
 * These schemas are `.strict()` throughout, matching pydantic's
 * `extra="forbid"`. An unknown key fails admission rather than flowing through
 * as an unvalidated field, and there is no silent fallback to an older shape.
 */

/** Opaque backend-issued text. Never parsed, never constructed client-side. */
const handle = z.string().min(1);
const cursor = z.string().min(1);
const label = z.string().min(1);

const timeModeSchema = z.enum(["current", "historical", "any_eligible"]);
const breadthSchema = z.enum(["focused", "broad"]);

const diagnosticCodeSchema = z.enum([
  "no_match",
  "low_match",
  "processing_pending",
  "processing_failed",
  "index_pending",
  "keyword_fallback",
  "context_limit",
  "work_limit",
  "time_limit",
]);

const failureCodeSchema = z.enum([
  "unavailable",
  "access_denied",
  "invalid_request",
  "unsupported_version",
  "stale_cursor",
  "dependency_changed",
  "budget_exhausted",
]);

// --- request ---------------------------------------------------------------

const modelScopeSchema = z
  .object({
    /** Handles, not refs. Empty means every authorized subject in scope. */
    subjects: z.array(handle),
    /** Empty means every enabled meaning in scope — never every tenant. */
    meaning_ids: z.array(label),
    time_mode: timeModeSchema,
    purpose: label,
  })
  .strict();

const modelSelectorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("orient") }).strict(),
  z
    .object({
      kind: z.literal("find"),
      query: z.string(),
      /** Narrows to already authorized sources; empty imposes no filter. */
      source_handles: z.array(handle),
      /** A hint may widen discovery. It may never weaken an explicit scope. */
      meaning_hints: z.array(label),
      breadth: breadthSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("inspect"),
      refs: z.array(handle).min(1),
      expand_context: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("exact"),
      meaning_id: label,
      /** Exact lookup bypasses ranking and may return several scoped values. */
      subject: handle.nullable(),
    })
    .strict(),
]);

export const modelReadRequestSchema = z
  .object({
    scope: modelScopeSchema,
    selector: modelSelectorSchema,
    cursor: cursor.nullable(),
  })
  .strict();

// --- result ------------------------------------------------------------------

const wireSourceRefSchema = z
  .object({ handle, label })
  .strict();

const wireExcerptSchema = z
  .object({
    /**
     * Original code-point coordinates in the retained source. `text` is the
     * projection and can differ in length, so quoting goes through the server's
     * span map rather than slicing this string.
     */
    location: z
      .object({
        target_id: label,
        char_start: z.number().int().nonnegative(),
        char_end: z.number().int().positive(),
      })
      .strict(),
    text: z.string(),
    projection: handle,
  })
  .strict();

export const wirePayloadSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("knowledge"),
      handle,
      meaning_id: label,
      subject_label: label,
      reported_claimant_label: label.nullable(),
      modality: z.string(),
      statement: label,
      /** Kept structured: flattening a quantity to a string loses the currency. */
      value: z.record(z.string(), z.unknown()),
      qualifications: z.array(label),
      epistemic: z.string(),
      temporal: z.string(),
      unresolved: z.array(label),
      support_handles: z.array(handle),
      conflict_handles: z.array(handle),
    })
    .strict(),
  z
    .object({
      kind: z.literal("evidence"),
      handle,
      source: wireSourceRefSchema,
      excerpts: z.array(wireExcerptSchema).min(1),
      context_handles: z.array(handle),
      /**
       * C2's `speaker.roster_person_id` is privileged. It arrives as an
       * authorized handle or stays unavailable — never raw, and never laundered
       * through a safe-looking label.
       */
      speaker_handle: handle.nullable(),
      speaker_label: label.nullable(),
      tags: z.array(label),
    })
    .strict(),
  z
    .object({
      kind: z.literal("context"),
      handle,
      relation: label,
      structure_role: label.nullable(),
      scope: z.string().nullable(),
      excerpts: z.array(wireExcerptSchema),
    })
    .strict(),
]);

const sourceLabelSchema = z
  .object({
    handle,
    label,
    processing: z.enum(["ready", "pending", "failed"]),
  })
  .strict();

export const coverageSchema = z
  .object({
    extent: z.enum(["selected", "exhaustive"]),
    truncated: z.boolean(),
    processing: z.enum(["ready", "pending", "failed", "mixed"]),
    retrieval: z.enum(["ok", "degraded"]),
    index_pending: z.boolean(),
  })
  .strict()
  .refine((c) => !(c.extent === "exhaustive" && c.truncated), {
    message: "coverage cannot be exhaustive and truncated",
  })
  .refine((c) => !(c.extent === "exhaustive" && c.retrieval === "degraded"), {
    message: "coverage cannot be exhaustive while retrieval is degraded",
  });

const diagnosticSchema = z
  .object({ code: diagnosticCodeSchema, detail: label })
  .strict();

export const modelReadResultSchema = z
  .object({
    schema: z.literal("c4-tool-1"),
    read_view: handle,
    /** A handle: the model refers to the read, it does not read the receipt. */
    receipt: handle,
    items: z
      .array(z.object({ handle, payload: wirePayloadSchema }).strict()),
    sources: z.array(sourceLabelSchema),
    /**
     * Empty unless a scoped C3 assessment supplied one. There is no gap
     * producer in C3, and an empty result is "no retrieved match", never a
     * `missing` assessment.
     */
    gaps: z.array(z.record(z.string(), z.unknown())).default([]),
    coverage: coverageSchema,
    diagnostics: z.array(diagnosticSchema),
    next_cursor: cursor.nullable(),
  })
  .strict()
  .refine((r) => !(r.coverage.extent === "exhaustive" && r.next_cursor !== null), {
    message: "coverage cannot be exhaustive while a next cursor is set",
  })
  .refine(
    (r) => new Set(r.items.map((i) => i.handle)).size === r.items.length,
    { message: "read items must carry distinct handles" },
  );

export const readFailureSchema = z
  .object({
    schema: z.literal("c4-read-1"),
    code: failureCodeSchema,
    retryable: z.boolean(),
    correlation_id: z.string(),
  })
  .strict();

export type ModelScope = z.infer<typeof modelScopeSchema>;
export type ModelSelector = z.infer<typeof modelSelectorSchema>;
export type ModelReadRequest = z.infer<typeof modelReadRequestSchema>;
export type WirePayload = z.infer<typeof wirePayloadSchema>;
export type SourceLabel = z.infer<typeof sourceLabelSchema>;
export type Coverage = z.infer<typeof coverageSchema>;
export type Diagnostic = z.infer<typeof diagnosticSchema>;
export type ModelReadResult = z.infer<typeof modelReadResultSchema>;
export type ReadFailure = z.infer<typeof readFailureSchema>;

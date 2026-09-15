/* ---------------------------------------------------------------------------
 * The one list of locator-shaped field names, shared by every guard that
 * scans a vendored contract for one. PROV-01 across the language boundary
 * (spec §4.4): the model must never be handed a locator, and no payload may
 * carry one back — a locator invites "as I said at 14:32" in the post body,
 * a fabrication no grounding check catches because it is prose, not a
 * citation.
 *
 * Finding B1/15: `assert-draft-schema.mjs` carried its own five-name copy of
 * this list while `tests/agent/contracts.test.ts` carried a wider
 * eleven-name copy, and `assert-context-schema.mjs` — context.v1 being the
 * ALLOWLIST projection that exists specifically to publish no locator and no
 * `document_id` — ran no blacklist scan of its own at all. Two divergent
 * copies of a security-relevant list is the defect; this module is the fix.
 * Every call site imports THIS constant rather than re-typing the list, so
 * they cannot diverge again.
 * ------------------------------------------------------------------------- */

export const FORBIDDEN_LOCATOR_FIELDS = [
  "source_locator",
  "locator",
  "timecode",
  "line",
  "page",
  "document_id",
  "provenance",
  "payload",
  "url",
  "speaker",
  "score",
];

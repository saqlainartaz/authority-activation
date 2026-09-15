import "server-only";

import { createHash } from "node:crypto";

import type { SkillVersion } from "@/agent/lib/prompt-versions";
import type { HandleMap } from "@/agent/render";

/**
 * The runtime's half of every tool call: identity, idempotency, and the one
 * client the tools share.
 *
 * A11 — THE MODEL NEVER SUPPLIES AN IDEMPOTENCY KEY, and the guarantee is that
 * no tool `inputSchema` has the field (Task 4 asserts that). Keys are derived
 * from (turn id, tool, attempt) here, so the same logical operation retried
 * produces the same key and Python's operation ledger recognises it.
 *
 * RULING R6 — `derivedKey` MUST CLEAR 8 CHARACTERS FOR EVERY INPUT, NOT JUST
 * REALISTIC ONES. The brief's own test asserts `derivedKey("t", "x",
 * 1).length >= 8`, and `${turnId}:${tool}:${attempt}` for that input is
 * `"t:x:1"` — five characters, a 422 at the wire (`ChatMessageIn` /
 * `DraftSubmitIn` both declare `idempotency_key` with `min_length=8`). Hashing
 * the triple rather than concatenating it fixes the floor unconditionally: a
 * hex digest is a fixed, generous length regardless of how short the inputs
 * are, so there is no separate short-input branch to keep in sync with
 * Python's bound if it ever moves. SHA-256 is used only because
 * `node:crypto` already has it; nothing here depends on a cryptographic
 * property, only on the same triple producing the same bytes every time.
 *
 * THREE SHAPES, NOT TWO — read this before touching any of the five tool
 * files. A previous review flagged that the MODEL-facing schema
 * (`tool-schemas.ts`: flat, snake_case — `body`, `cited_atom_ids`,
 * `variant_id`, `content_item_id`, `when`) does not line up with the tool
 * functions' own signatures (nested/camelCase — `{ draft, agentText }`,
 * `variantId`, `contentItemId`). There is a THIRD shape besides: whatever the
 * Python (or `lib/product.ts`) endpoint on the other end actually accepts on
 * the wire, which is its own snake_case vocabulary and not always the same
 * field names as the model schema (`agent_text` vs. the wire's
 * `agent_text`+`usage.*`, `variant_id` vs. `content_item_id`, etc.).
 *
 * The rule this repo follows, so the rename never gets scattered: EACH TOOL
 * FUNCTION KEEPS ITS OWN CLEAN, TS-IDIOMATIC PARAMETER SHAPE (matching the
 * pre-existing stubs this task fills in) and performs exactly ONE rename, at
 * the single call site where it builds the outbound request body — see
 * `submit-draft.ts`'s `usage: {...}` block for the clearest example. The
 * OTHER rename — model schema (`tool-schemas.ts`) to a tool function's own
 * parameter shape — is deliberately NOT done in this file or in any of the
 * five tool files: that seam belongs to the executor a later task (§9 step 4
 * Task 8's agent route) builds, the thing that receives a
 * zod-validated `ProviderToolCall.input` and dispatches it to one of these
 * five functions. Recording the map here, rather than only in that later
 * file, is so whoever writes that executor finds the reasoning already
 * decided rather than re-deriving it from five inconsistent call sites.
 */

export type ToolContext = {
  sessionId: string;
  turnId: string;
  handles: HandleMap;
  /**
   * The client's onboarding/session token (final whole-branch review, C1).
   * `prepare_generation` and `submit_draft` call `/context` and `/drafts`,
   * both guarded by `require_onboarding_identity`
   * (`src/product/api/chat.py:1306`, `:1345`) — the SAME client credential
   * `get_variant_sources`/`propose_durable_fact`/`schedule` already needed,
   * not the service-only credential `@/lib/engine.ts` attaches. The route
   * (`agent/route.ts`) reads the token once, via `requireClientToken()`, and
   * threads it down through this field rather than each tool re-deriving it —
   * one source of truth for "whose session is this turn" instead of five.
   *
   * A11 IS UNAFFECTED. A11 governs the MODEL-facing `inputSchema` (no field a
   * tool's caller must not be able to fabricate); `ToolContext` is a runtime
   * struct the model never sees, so putting the token here is not the thing
   * A11 forbids — a previous version of this file's tools misapplied A11 to
   * reach the opposite, incorrect conclusion, which is where the credential
   * defect came from.
   */
  token: string;
  /**
   * Task 12 (§9 step 6). WHICH agent instructions and skill files produced
   * this turn — server state, resolved by `route.ts` from the same file
   * content `INSTRUCTIONS`/`SKILLS` already hold, threaded down the same
   * way `token` is rather than each tool re-deriving it. Read only by
   * `submit-draft.ts`, which maps it straight into `DraftSubmitIn.
   * skill_versions`. NOT model-facing — `tool-schemas.ts`'s `submit_draft`
   * has no such field, per A11/§3: this must be TRUE, not claimed, so it
   * cannot live in an `inputSchema` the model fills in.
   */
  skillVersions: SkillVersion[];
};

export function derivedKey(turnId: string, tool: string, attempt: number): string {
  return createHash("sha256").update(`${turnId}:${tool}:${attempt}`).digest("hex");
}

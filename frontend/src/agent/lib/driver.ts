import "server-only";

import type { ModelMessage } from "@/agent/transcript";

/**
 * §5.7 — the provider seam.
 *
 * A1′ takes no framework, so the provider-shaped surface is named here rather
 * than left implicit in the loop. THIS FILE IMPORTS NO VENDOR PACKAGE, and that
 * is the whole point: it is what a second provider's adapter is written
 * against, so anything Anthropic-shaped leaking in would make it Anthropic's
 * interface wearing a neutral name.
 *
 * Two functions, because that is the entire difference between the two
 * providers anyone would actually reach for:
 *
 *   toProviderTools     tool schema shape
 *   runTurn             the call, normalised
 *
 * DELETED (final whole-branch review, R28): a third function,
 * `toProviderMessages(context, material, transcript)`. Declared here,
 * implemented in `lib/loop.ts`, forwarded in `agent/route.ts`'s driver
 * wrapper, and stubbed in three test files — called by NOTHING. Its
 * signature was designed around material being turn INPUT, which Ruling R2
 * (§9 step 4, `turn.ts`) disproved: material is a TOOL RESULT, arriving only
 * once the model calls `prepare_generation`, never available at the top of a
 * turn the way this signature assumed. The provider difference it existed to
 * absorb — system-prompt placement, role mapping — is already absorbed
 * inside `runTurn`, which takes `system` and `messages` as separate
 * parameters below. Two functions that both fire is an honest seam; a third
 * that never fires, and whose parameters no longer match how this system
 * actually works, is a comment pretending to be an interface.
 *
 * ONE IMPLEMENTATION THIS CYCLE (`lib/loop.ts`), exactly as `profile.ts` carries
 * one capability profile. A1′ concedes openly that an interface shaped against
 * one provider will need bending when it sees a second — so do NOT add a
 * speculative second adapter, which would be shaped against a guess rather than
 * a provider. A1″ is the flip trigger, and this file is where it flips.
 */

/** One tool call the model asked for. `input` is UNKNOWN on purpose — it is
 *  model-generated, and Task 5 validates it with zod before anything reads it. */
export type ProviderToolCall = {
  id: string;
  name: string;
  input: unknown;
};

/** What one call cost. Mirrors Python's `ProviderUsage` field-for-field
 *  (`foundation/providers/base.py`, four fields as of §9 step 4) so the two
 *  halves of the same number are comparable without a translation table.
 *  `null` means the provider reported nothing, which is not zero. */
export type TurnUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadInputTokens: number | null;
  cacheCreationInputTokens: number | null;
};

/** The normalised result of one model call. This shape IS the abstraction —
 *  with one provider, "normalised" means exactly this type and nothing more. */
export type TurnResult = {
  text: string;
  toolCalls: ProviderToolCall[];
  stopReason: "tool_use" | "end_turn" | "max_tokens" | "other";
  usage: TurnUsage;
};

/** A tool as the runtime holds it, before any provider shapes it. */
export type ToolSpec = {
  name: string;
  description: string;
  /** JSON Schema. Generated from a zod schema in Task 4, never hand-written. */
  inputSchema: Record<string, unknown>;
};

/** A system-prompt segment. `cache` marks §5.8's breakpoint 1 — the boundary
 *  after instructions + skill, which is byte-identical for every client. */
export type SystemBlock = {
  text: string;
  cache: boolean;
};

/** Everything one model call needs, provider-neutral. */
export type DriverRequest = {
  system: SystemBlock[];
  messages: ModelMessage[];
  tools: ToolSpec[];
  /** Called with each text delta as it arrives. §5.3's `message.delta` is the
   *  only lever against a silent twenty-second gap, so streaming is not
   *  optional and this callback is not nullable. */
  onText: (delta: string) => void;
  /** Wall-clock allowance for THIS call. Set below `bounds.ts`'s deadline by
   *  the caller — see §5.8: `timeout × (maxRetries + 1)` could otherwise exceed
   *  the turn deadline and silently become the real bound. */
  timeoutMs: number;
};

export interface Driver {
  toProviderTools(tools: ToolSpec[]): unknown;
  runTurn(request: DriverRequest): Promise<TurnResult>;
}

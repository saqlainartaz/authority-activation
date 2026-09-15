import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import type { Driver, DriverRequest, ProviderToolCall, TurnResult } from "@/agent/lib/driver";

/**
 * The agent loop's provider half. THE ONLY FILE IN THE REPOSITORY PERMITTED A
 * PROVIDER SDK IMPORT (A2, machine-asserted by `assert-agent-boundary`). If a
 * vendor stalls or A1″'s flip trigger fires, this file is rewritten against
 * `lib/driver.ts` and the tools, instructions, skill, pure core and Python
 * contract survive untouched.
 *
 * §5.8's configuration, with provenance for each value:
 *
 *   model        claude-opus-5   parity with ENGINE_ANTHROPIC_MODEL
 *   max_tokens   4096            mirrors GENERATION_MAX_TOKENS — MEASURED, not
 *                                chosen: on 2026-08-17 the live request stopped
 *                                at 1,024; at 4,096 it ended normally
 *   streaming    on              required by §5.3 anyway, and it removes the
 *                                SDK's large-max_tokens HTTP-timeout class
 *   thinking     adaptive, low   DIVERGES FROM PYTHON DELIBERATELY. The Python
 *                                adapter pins {"type":"disabled"} because it
 *                                discards thinking blocks and they ate the
 *                                answer budget — sound for a single-shot call
 *                                with no tools. It does not transfer here: with
 *                                thinking disabled, claude-opus-5 occasionally
 *                                writes a tool call into VISIBLE TEXT, the turn
 *                                completes, and the call never runs. No error.
 *                                A silent no-op is exactly what bounds.ts was
 *                                written against.
 *
 * No temperature, top_p or top_k — each is a 400 on this model.
 *
 * SDK-SURFACE NOTE (installed @anthropic-ai/sdk@0.115.0, verified against
 * node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts and
 * lib/MessageStream.d.ts rather than assumed from documentation): the brief's
 * draft matched the installed types on every point checked — `withOptions`,
 * `messages.stream`, `finalMessage`, `thinking: {type:"adaptive"}`,
 * `output_config: {effort}`, and all four `usage` field names. The one
 * adjustment made here is the `on("text", ...)` listener signature, which
 * this SDK version delivers as `(textDelta, textSnapshot)` rather than a
 * single argument — a syntax accommodation, not a value change: `onText` is
 * still called with exactly the delta string §5.3 needs.
 *
 * THE PER-CALL TIMEOUT, R16 (review fix): `perCallTimeoutMs` below is what
 * actually keeps `timeout × (maxRetries + 1)` under `bounds.ts`'s deadline —
 * dividing the turn budget by 3 was NOT enough on its own, because that lands
 * on `deadlineMs` exactly rather than under it, and ignores the SDK's own
 * sleep between retries. `maxRetries` is now pinned to `MAX_RETRIES` in the
 * same `withOptions` call rather than left to inherit the SDK's default
 * (`client.js`: `this.maxRetries = options.maxRetries ?? 2`) — an unstated
 * dependency on a vendor default is a bound that breaks with no error the day
 * the vendor changes it. `RETRY_BACKOFF_ALLOWANCE_MS` accounts for the sleeps
 * the SDK inserts BETWEEN retries (`calculateDefaultRetryTimeoutMillis`:
 * unjittered exponential backoff, 0.5s doubling each attempt, capped at 8s —
 * for `MAX_RETRIES = 2` that is 0.5s then 1.0s, 1500ms total), which the
 * original draft ignored entirely. See `perCallTimeoutMs` for the arithmetic
 * and `tests/agent/loop.test.ts` for the strict-inequality test against
 * `bounds.ts`'s own `DEFAULT_LIMITS.deadlineMs` — the bound is `bounds.ts`'s,
 * never re-declared here, only respected.
 *
 * R18 (re-review of R16): `perCallTimeoutMs`'s strict inequality is NOT
 * unconditional — below `PER_CALL_TIMEOUT_FLOOR_THRESHOLD_MS` the floor
 * overrides the computed value and the guarantee lapses. See that function's
 * own docstring for the precise boundary. `bounds.ts`'s real `deadlineMs`
 * (120,000ms) sits far above the threshold (16,500ms at today's constants),
 * so this only matters for a caller passing a materially smaller deadline via
 * `RunTurnOptions.limits` — nothing does that today (`turn.ts` always passes
 * the fixed 120s deadline, itself a separately-tracked deferred item).
 */

export const MODEL = "claude-opus-5";
export const MAX_TOKENS = 4096;
export const EFFORT = "low" as const;

/** Pinned explicitly rather than inherited from the SDK's default (currently
 *  also 2) — see the header note. Passed to `withOptions` on every call, so a
 *  future SDK release changing its own default cannot silently move this
 *  file's timeout arithmetic out from under it. */
export const MAX_RETRIES = 2;

/** Worst-case, UNJITTERED sum of the SDK's own sleep between retries for
 *  `MAX_RETRIES = 2` (`calculateDefaultRetryTimeoutMillis` in the installed
 *  SDK: `min(0.5 * 2**n, 8.0)` seconds for `n` in `0..MAX_RETRIES-1`, jitter
 *  only ever REDUCES the sleep). `0.5 + 1.0 = 1.5s = 1500ms`. Recompute this
 *  by hand if `MAX_RETRIES` ever changes — it is not derived programmatically
 *  because the formula lives in vendor code this repo does not import for
 *  values, only for the one adapter call. */
export const RETRY_BACKOFF_ALLOWANCE_MS = 1_500;

/** A turn budget small enough to make the arithmetic below go to zero or
 *  negative must not hand the SDK a non-positive timeout — that reads to the
 *  SDK as "immediate", not "generous", and would make every call fail before
 *  it starts. Five seconds is comfortably above a single TLS+HTTP round trip
 *  to the API and is the floor rather than a value ever expected to bind
 *  against `bounds.ts`'s real 120s deadline. */
export const MIN_PER_CALL_TIMEOUT_MS = 5_000;

/** R18: the exact `turnBudgetMs` boundary below which `perCallTimeoutMs`'s
 *  strict-inequality guarantee lapses — see that function's docstring. DERIVED
 *  from the three constants above, never hand-typed as a bare number, so a
 *  change to any of `MAX_RETRIES`, `RETRY_BACKOFF_ALLOWANCE_MS` or
 *  `MIN_PER_CALL_TIMEOUT_MS` moves this threshold (and the test that pins it)
 *  automatically rather than leaving a stale number for someone to notice. */
export const PER_CALL_TIMEOUT_FLOOR_THRESHOLD_MS = MIN_PER_CALL_TIMEOUT_MS * (MAX_RETRIES + 1) + RETRY_BACKOFF_ALLOWANCE_MS;

/** §5.8 + R16 + R18: the per-call timeout for one `messages.stream()` call.
 *
 *  FOR `turnBudgetMs > PER_CALL_TIMEOUT_FLOOR_THRESHOLD_MS` (the only range
 *  `bounds.ts`'s real 120,000ms deadline ever falls in): the returned value
 *  keeps `timeout × (MAX_RETRIES + 1) + RETRY_BACKOFF_ALLOWANCE_MS` STRICTLY
 *  BELOW `turnBudgetMs`. `attempts` is the primary call plus `MAX_RETRIES`
 *  retries; the `- 1` before dividing is what turns "less than or equal" into
 *  "strictly less than" for budgets where the division would otherwise land
 *  exactly on the boundary (120,000 does, for the real deadline) — flooring a
 *  division can still hit an exact multiple, and §5.8 asks for headroom below
 *  the deadline, not equality with it.
 *
 *  AT OR BELOW `PER_CALL_TIMEOUT_FLOOR_THRESHOLD_MS`, that guarantee LAPSES:
 *  the function returns `MIN_PER_CALL_TIMEOUT_MS` regardless of how small
 *  `turnBudgetMs` is, and the resulting worst-case wall time
 *  (`MIN_PER_CALL_TIMEOUT_MS × (MAX_RETRIES + 1) + RETRY_BACKOFF_ALLOWANCE_MS`,
 *  i.e. exactly `PER_CALL_TIMEOUT_FLOOR_THRESHOLD_MS`) can equal or exceed
 *  `turnBudgetMs` itself. This is accepted rather than closed: below the
 *  threshold there is no per-call timeout worth handing the SDK that is both
 *  honest and useful — a value small enough to stay strictly bounded would be
 *  sub-second, and a real model call takes seconds, so an honestly-bounded
 *  timeout down there would just fail every call before it starts.
 *  `MIN_PER_CALL_TIMEOUT_MS` is chosen to be a timeout the SDK can actually
 *  use, not one provably inside a budget nothing production-sized ever passes
 *  — see `tests/agent/loop.test.ts` for the test pinning this exact boundary. */
export function perCallTimeoutMs(turnBudgetMs: number): number {
  const attempts = MAX_RETRIES + 1;
  const usable = turnBudgetMs - RETRY_BACKOFF_ALLOWANCE_MS - 1;
  const computed = Math.floor(usable / attempts);
  return Math.max(computed, MIN_PER_CALL_TIMEOUT_MS);
}

/** Constructed lazily so the module imports keylessly (AI_CODING_RULES). */
let client: Anthropic | null = null;
function sdk(): Anthropic {
  if (client === null) client = new Anthropic();
  return client;
}

export const anthropicDriver: Driver = {
  toProviderTools(tools) {
    return (tools as { name: string; description: string; inputSchema: Record<string, unknown> }[]).map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
  },

  async runTurn(request: DriverRequest): Promise<TurnResult> {
    const system = request.system.map((block) =>
      block.cache
        ? { type: "text" as const, text: block.text, cache_control: { type: "ephemeral" as const } }
        : { type: "text" as const, text: block.text },
    );

    const stream = sdk()
      // The per-call timeout sits STRICTLY below bounds.ts's deadline, and
      // `maxRetries` is pinned rather than inherited — see `perCallTimeoutMs`
      // and the header note (R16) for why both are necessary.
      .withOptions({ timeout: perCallTimeoutMs(request.timeoutMs), maxRetries: MAX_RETRIES })
      .messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        thinking: { type: "adaptive" },
        output_config: { effort: EFFORT },
        system,
        messages: request.messages as Anthropic.MessageParam[],
        tools: this.toProviderTools(request.tools) as Anthropic.Tool[],
      });

    // The installed SDK's `text` event carries `(textDelta, textSnapshot)`,
    // not the single argument the brief's draft assumed — verified against
    // `lib/MessageStream.d.ts`'s `MessageStreamEvents`. Only the delta is
    // forwarded; the snapshot is dropped here on purpose.
    stream.on("text", (delta) => request.onText(delta));
    const message = await stream.finalMessage();

    const toolCalls: ProviderToolCall[] = message.content
      .filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
      .map((block) => ({ id: block.id, name: block.name, input: block.input }));

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    return {
      text,
      toolCalls,
      stopReason:
        message.stop_reason === "tool_use" || message.stop_reason === "end_turn" || message.stop_reason === "max_tokens"
          ? message.stop_reason
          : "other",
      usage: {
        inputTokens: message.usage.input_tokens ?? null,
        outputTokens: message.usage.output_tokens ?? null,
        cacheReadInputTokens: message.usage.cache_read_input_tokens ?? null,
        cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? null,
      },
    };
  },
};

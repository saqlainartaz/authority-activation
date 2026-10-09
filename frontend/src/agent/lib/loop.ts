import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { markCertainlyUnbilled } from "@/agent/lib/call-billing";
import type { Driver, DriverRequest, ProviderToolCall, TurnResult } from "@/agent/lib/driver";
import type { ModelMessage } from "@/agent/transcript";

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

// LOCAL COMPARISON ONLY (e2e clone, 2026-09-28): AGENT_MODEL picks the model.
const AGENT_MODELS = ["claude-opus-5", "claude-sonnet-5"] as const;
const chosenModel = process.env.AGENT_MODEL ?? "claude-opus-5";
if (!(AGENT_MODELS as readonly string[]).includes(chosenModel)) throw new Error(`AGENT_MODEL must be one of ${AGENT_MODELS.join(", ")}`);
export const MODEL = chosenModel as (typeof AGENT_MODELS)[number];
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

/**
 * Messages as the provider receives them, with two prompt-cache breakpoints.
 *
 * **Only the system prefix was cached.** Everything after it -- the earlier
 * conversation, this turn's context, every tool result -- was re-sent at full
 * price on every pass, and a turn makes one pass per tool call plus a reply.
 * A comment elsewhere described a second breakpoint; no code sent one.
 *
 * - `cacheThrough`, the end of the earlier conversation: identical from one
 *   turn to the next (the chat only grows by appending), so it is the
 *   boundary that pays ACROSS turns.
 * - the newest message: everything before it is identical on the next pass,
 *   so it is the boundary that pays WITHIN a turn.
 *
 * - a message flagged `cache` (main's whole-client source context, merged
 *   into C4 2026-09-25): a stable prefix that pays across turns even when the
 *   conversation changed.
 *
 * **At most three here**, with the system one making the provider's limit of
 * four; more is a 400 from the API, not a slower call. When all three kinds
 * are present they fit exactly; if more messages were ever flagged, the
 * newest message and the conversation boundary win, then flagged messages in
 * order. Only the marker changes: the text the model reads is byte-identical.
 */
export const MAX_MESSAGE_CACHE_BREAKPOINTS = 3;

export function withCacheBreakpoints(
  messages: ModelMessage[],
  cacheThrough: number | null | undefined,
  markNewest = true,
): unknown[] {
  const last = messages.length - 1;
  const chosen = new Set<number>();
  for (const index of [
    // The newest message pays only when the next pass resends it. A one-off
    // call (the session summary, P4.3) is never resent, so marking it would
    // bill its input as a cache write for nothing (fix round 1, review M2).
    markNewest ? last : null,
    cacheThrough,
    ...messages.flatMap((message, i) => (message.cache ? [i] : [])),
  ]) {
    if (typeof index !== "number" || index < 0 || index > last) continue;
    if (chosen.size >= MAX_MESSAGE_CACHE_BREAKPOINTS && !chosen.has(index)) continue;
    chosen.add(index);
  }
  return messages.map((message, index) => {
    const blocks = providerContent(message);
    const marked = chosen.has(index);
    if (!marked) {
      // A plain text message goes as a string, which the API treats as one
      // text block -- byte-identical to what it always was.
      return { role: message.role, content: blocks ?? message.content };
    }
    const content = blocks ?? [{ type: "text" as const, text: message.content }];
    return { role: message.role, content: withCacheMark(content) };
  });
}

/**
 * The NATIVE tool blocks a message carries, or `null` for plain text.
 *
 * **Tool results used to travel as user TEXT** (`<tool-result tool="...">`),
 * the model's own tool calls were not sent back at all, and its thinking was
 * dropped between passes. Every serious harness, and the API itself, returns
 * the model's calls as its own `tool_use` blocks and their outcomes as
 * `tool_result` blocks in the next user message, with `is_error` on a
 * failure. The provider's blocks are returned UNCHANGED when present: thinking
 * blocks carry signatures that must come back verbatim.
 */
function providerContent(message: ModelMessage): unknown[] | null {
  if (message.role === "assistant" && message.providerBlocks && message.providerBlocks.length > 0) {
    return message.providerBlocks;
  }
  if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
    return [
      ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
      ...message.toolCalls.map((call) => ({
        type: "tool_use" as const,
        id: call.id,
        name: call.name,
        input: call.input,
      })),
    ];
  }
  if (message.role === "user" && message.toolResults && message.toolResults.length > 0) {
    // `tool_result` blocks first, as the API requires; any text follows them.
    return [
      ...message.toolResults.map((result) => ({
        type: "tool_result" as const,
        tool_use_id: result.toolUseId,
        content: result.content,
        ...(result.isError ? { is_error: true } : {}),
      })),
      ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
    ];
  }
  return null;
}

/** A cache breakpoint on a message's LAST block, the one position the API reads it from. */
function withCacheMark(blocks: unknown[]): unknown[] {
  const lastIndex = blocks.length - 1;
  return blocks.map((block, index) =>
    index === lastIndex
      ? { ...(block as Record<string, unknown>), cache_control: { type: "ephemeral" as const } }
      : block,
  );
}

/** Constructed lazily so the module imports keylessly (AI_CODING_RULES). */
let client: Anthropic | null = null;
function sdk(): Anthropic {
  if (client === null) client = new Anthropic();
  return client;
}

/**
 * Who retries a failed call (Cycle 5, P1.5 fix round 1, ruling 16).
 *
 * - `sdk`: the SDK's own retries, `MAX_RETRIES` of them, exactly as this file
 *   always did. The M1 (`context.v1`) path keeps it.
 * - `unbilled_only`: the SDK's retries OFF, and this driver retries a call
 *   itself, at most `AGENT_RETRIES` times, ONLY on a failure certain not to
 *   have been billed (`isUnbilledFailure`). A C4 reply uses it, because the SDK
 *   retries a timed-out stream too: the abandoned attempt may have been billed
 *   while only the final attempt's usage reaches the meter, and the reply's
 *   reservation (the cap plus ONE call) would then not be a bound. A timeout,
 *   an abort or a failure after the response began is thrown, so the pass's
 *   cost is unknown, the reply stops, and the turn settles `uncertain`.
 */
export type RetryPolicy = "sdk" | "unbilled_only";

/** The agent's own retries under `unbilled_only`. Equal to `MAX_RETRIES`, so
 *  `perCallTimeoutMs`'s arithmetic (attempts and backoff) holds unchanged. */
export const AGENT_RETRIES = MAX_RETRIES;

/** The same unjittered backoff the SDK uses: 0.5s, then 1s -- in total
 *  `RETRY_BACKOFF_ALLOWANCE_MS` for two retries. */
function retryBackoffMs(attempt: number): number {
  return 500 * 2 ** attempt;
}

/** HTTP statuses the API answers BEFORE generating anything: rate limited,
 *  service unavailable, overloaded. Nothing was generated, so nothing billed. */
const UNBILLED_STATUSES = new Set([429, 503, 529]);
/** Connection failures that happen before the request leaves this process. */
const UNSENT_CONNECTION_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]);

function isA(error: unknown, kind: unknown): boolean {
  return typeof kind === "function" && error instanceof (kind as new (...args: never[]) => unknown);
}

function causeCodes(error: unknown): string[] {
  const codes: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") codes.push(code);
    current = (current as { cause?: unknown }).cause;
  }
  return codes;
}

/**
 * Whether a failed call is CERTAIN not to have been billed, and so safe to
 * send again. Anything uncertain is not: a timeout or an abort (the provider
 * may have generated, and billed, before the client gave up), a reset
 * connection, any other server error, and ANY failure once the response began
 * -- an `overloaded_error` mid-stream follows generation that was billed.
 */
export function isUnbilledFailure(error: unknown, responseBegan: boolean): boolean {
  if (responseBegan) return false;
  if (isA(error, Anthropic.APIUserAbortError) || isA(error, Anthropic.APIConnectionTimeoutError)) return false;
  if (isA(error, Anthropic.APIConnectionError)) {
    return causeCodes(error).some((code) => UNSENT_CONNECTION_CODES.has(code));
  }
  if (isA(error, Anthropic.APIError)) {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" && UNBILLED_STATUSES.has(status);
  }
  return false;
}

/** The one SDK surface this driver uses, so a test can stand in a stub transport. */
type ProviderContentBlock = { type: string; [key: string]: unknown };
export type ProviderMessage = {
  content: ProviderContentBlock[];
  stop_reason: string | null;
  usage: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
};
type ProviderStream = {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  finalMessage(): Promise<ProviderMessage>;
};
export type AnthropicClientLike = {
  withOptions(options: { timeout: number; maxRetries: number }): {
    messages: { stream(params: Anthropic.MessageStreamParams): ProviderStream };
  };
};

export type AnthropicDriverOptions = {
  retry: RetryPolicy;
  /** The SDK client; a stub transport in tests. */
  client?: () => AnthropicClientLike;
  /** The pause between the agent's own retries; immediate in tests. */
  sleep?: (ms: number) => Promise<void>;
};

function toProviderTools(tools: { name: string; description: string; inputSchema: Record<string, unknown> }[]) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}

function toTurnResult(message: ProviderMessage, model: string): TurnResult {
  const toolCalls: ProviderToolCall[] = message.content
    .filter((block) => block.type === "tool_use")
    .map((block) => ({ id: block.id as string, name: block.name as string, input: block.input }));

  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text as string)
    .join("");

  return {
    text,
    toolCalls,
    // Returned so the loop can send this pass back unchanged, thinking
    // blocks and their signatures included.
    providerBlocks: message.content as unknown[],
    stopReason:
      message.stop_reason === "tool_use" || message.stop_reason === "end_turn" || message.stop_reason === "max_tokens"
        ? message.stop_reason
        : "other",
    // The model requested, which is the id the price table is keyed by.
    model,
    usage: {
      inputTokens: message.usage.input_tokens ?? null,
      outputTokens: message.usage.output_tokens ?? null,
      cacheReadInputTokens: message.usage.cache_read_input_tokens ?? null,
      cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? null,
    },
  };
}

export function createAnthropicDriver(options: AnthropicDriverOptions): Driver {
  const transport = options.client ?? (() => sdk() as unknown as AnthropicClientLike);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const attempts = options.retry === "unbilled_only" ? AGENT_RETRIES + 1 : 1;
  const maxRetries = options.retry === "sdk" ? MAX_RETRIES : 0;

  return {
    toProviderTools(tools) {
      return toProviderTools(tools as { name: string; description: string; inputSchema: Record<string, unknown> }[]);
    },

    async runTurn(request: DriverRequest): Promise<TurnResult> {
      const system = request.system.map((block) =>
        block.cache
          ? { type: "text" as const, text: block.text, cache_control: { type: "ephemeral" as const } }
          : { type: "text" as const, text: block.text },
      );
      // Cycle 5, P4.3: a call may name another model (the session summary runs
      // on Haiku 4.5). Adaptive thinking and `effort` are the agent models'
      // settings only: Haiku 4.5 supports neither, so a call on another model
      // is sent without them, and without tools when it has none. Its output
      // ceiling may be lower than `MAX_TOKENS`, never higher.
      const model = request.model ?? MODEL;
      const agentModel = (AGENT_MODELS as readonly string[]).includes(model);
      const params = {
        model,
        max_tokens: Math.min(request.maxTokens ?? MAX_TOKENS, MAX_TOKENS),
        ...(agentModel ? { thinking: { type: "adaptive" }, output_config: { effort: EFFORT } } : {}),
        system,
        messages: withCacheBreakpoints(request.messages, request.cacheThrough, agentModel) as Anthropic.MessageParam[],
        ...(agentModel || request.tools.length > 0
          ? { tools: toProviderTools(request.tools) as Anthropic.Tool[] }
          : {}),
      } as Anthropic.MessageStreamParams;

      for (let attempt = 0; ; attempt += 1) {
        // Set once the HTTP response arrives (the SDK's `connect`) or any text
        // streams: from then on generation may have been billed.
        let responseBegan = false;
        try {
          const stream = transport()
            // The per-call timeout sits STRICTLY below bounds.ts's deadline, and
            // `maxRetries` is pinned rather than inherited — see `perCallTimeoutMs`
            // and the header note (R16) for why both are necessary. Zero under
            // `unbilled_only`: the retries are this loop's, below.
            .withOptions({ timeout: perCallTimeoutMs(request.timeoutMs), maxRetries })
            .messages.stream(params);

          stream.on("connect", () => {
            responseBegan = true;
          });
          // The installed SDK's `text` event carries `(textDelta, textSnapshot)`,
          // not the single argument the brief's draft assumed — verified against
          // `lib/MessageStream.d.ts`'s `MessageStreamEvents`. Only the delta is
          // forwarded; the snapshot is dropped here on purpose.
          stream.on("text", (delta) => {
            responseBegan = true;
            request.onText(delta as string);
          });
          return toTurnResult(await stream.finalMessage(), model);
        } catch (error) {
          const unbilled = options.retry === "unbilled_only" && isUnbilledFailure(error, responseBegan);
          // Out of retries on a failure that cannot have been billed: marked,
          // so the turn settles at the passes that ran (Ruling 63, concern 2).
          if (attempt + 1 >= attempts) throw unbilled ? markCertainlyUnbilled(error) : error;
          if (!unbilled) throw error;
          await sleep(retryBackoffMs(attempt));
        }
      }
    },
  };
}

/** The M1 (`context.v1`) driver: the SDK's own retries, unchanged. */
export const anthropicDriver: Driver = createAnthropicDriver({ retry: "sdk" });

/** The C4 driver: retries only what cannot have been billed (ruling 16). */
export const anthropicC4Driver: Driver = createAnthropicDriver({ retry: "unbilled_only" });

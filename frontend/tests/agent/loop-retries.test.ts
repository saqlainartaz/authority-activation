import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import type { DriverRequest, TurnUsage } from "@/agent/lib/driver";
import { AGENT_RETRIES, MAX_RETRIES, createAnthropicDriver, type AnthropicClientLike } from "@/agent/lib/loop";
import { runAgentTurn, type ToolExecution } from "@/agent/lib/turn";
import { meterTurn } from "@/agent/lib/turn-settlement";

/**
 * Fix round 1, ruling 16: a C4 reply's provider retries.
 *
 * With the SDK's own retries on, a stream that timed out was retried by the SDK,
 * and the abandoned attempt may have been billed while only the final
 * attempt's usage reached the meter -- so "the cap plus one call" was not a
 * bound. A C4 driver runs with the SDK's retries OFF and retries a call itself,
 * at most twice, only on a failure certain not to have been billed. Anything
 * else ends that pass with an unknown cost: the reply stops, and settles
 * `uncertain`. The M1 driver keeps the SDK's retries exactly as before.
 *
 * The transport is a stub: no key, no network.
 */

type Step =
  | { kind: "ok"; usage?: TurnUsage }
  | { kind: "fail_before_response"; error: Error }
  | { kind: "fail_after_response"; error: Error };

const USAGE = { input_tokens: 1_000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function stubTransport(script: Step[]) {
  const options: Record<string, unknown>[] = [];
  let streams = 0;
  const client: AnthropicClientLike = {
    withOptions(opts) {
      options.push(opts as Record<string, unknown>);
      return {
        messages: {
          stream: () => {
            const step = script[Math.min(streams++, script.length - 1)];
            const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
            return {
              on(event: string, callback: (...args: unknown[]) => void) {
                (handlers[event] ??= []).push(callback);
                return this;
              },
              async finalMessage() {
                if (step.kind === "fail_before_response") throw step.error;
                // The real SDK emits `connect` once the HTTP response arrives.
                for (const callback of handlers.connect ?? []) callback();
                if (step.kind === "fail_after_response") throw step.error;
                return {
                  content: [{ type: "text", text: "done" }],
                  stop_reason: "end_turn",
                  usage: USAGE,
                };
              },
            };
          },
        },
      };
    },
  };
  return { client, options, streams: () => streams };
}

const noSleep = async () => {};

function c4Driver(script: Step[]) {
  const transport = stubTransport(script);
  return { transport, driver: createAnthropicDriver({ retry: "unbilled_only", client: () => transport.client, sleep: noSleep }) };
}

const request: DriverRequest = { system: [], messages: [], tools: [], onText: () => {}, timeoutMs: 120_000 };

const rateLimited = () =>
  new Anthropic.RateLimitError(429, { type: "error", error: { type: "rate_limit_error" } }, "rate limited", new Headers());
const overloaded = () =>
  Anthropic.APIError.generate(529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, undefined, new Headers());
const unavailable = () => Anthropic.APIError.generate(503, { type: "error", error: { type: "api_error" } }, undefined, new Headers());
const refused = () =>
  new Anthropic.APIConnectionError({
    cause: Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) }),
  });
const unresolved = () =>
  new Anthropic.APIConnectionError({
    cause: Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }) }),
  });

describe("a C4 driver's retries", () => {
  it("turns the SDK's own retries off", async () => {
    const { transport, driver } = c4Driver([{ kind: "ok" }]);
    await driver.runTurn(request);
    expect(transport.options[0]).toMatchObject({ maxRetries: 0 });
  });

  it("retries a 429 and the reply is priced once", async () => {
    const { transport, driver } = c4Driver([{ kind: "fail_before_response", error: rateLimited() }, { kind: "ok" }]);
    const meter = meterTurn(driver);

    await runAgentTurn({ driver: meter.driver, executor: async (): Promise<ToolExecution> => ({ kind: "ok", result: {} }) });

    expect(transport.streams()).toBe(2);
    // One pass, at Opus 5: 1,000 x $5/M + 100 x $25/M = 7,500.
    expect(meter.settlement()).toEqual({ outcome: "settled", actualMicrodollars: 7_500 });
    expect(transport.options.every((opts) => opts.maxRetries === 0)).toBe(true);
  });

  it.each([
    ["529 overloaded", overloaded],
    ["503 before generation", unavailable],
    ["connection refused", refused],
    ["name not resolved", unresolved],
  ])("retries %s, which cannot have been billed", async (_name, error) => {
    const { transport, driver } = c4Driver([{ kind: "fail_before_response", error: error() }, { kind: "ok" }]);
    const result = await driver.runTurn(request);
    expect(transport.streams()).toBe(2);
    expect(result.text).toBe("done");
  });

  it(`retries at most ${AGENT_RETRIES} times`, async () => {
    const { transport, driver } = c4Driver([{ kind: "fail_before_response", error: rateLimited() }]);
    await expect(driver.runTurn(request)).rejects.toBeInstanceOf(Anthropic.RateLimitError);
    expect(transport.streams()).toBe(AGENT_RETRIES + 1);
  });

  it.each([
    ["a timeout", () => new Anthropic.APIConnectionTimeoutError()],
    ["an abort", () => new Anthropic.APIUserAbortError()],
    ["a reset connection", () => new Anthropic.APIConnectionError({ cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }) })],
    ["a 500", () => Anthropic.APIError.generate(500, { type: "error", error: { type: "api_error" } }, undefined, new Headers())],
  ])("never retries %s, which may have been billed", async (_name, error) => {
    const { transport, driver } = c4Driver([{ kind: "fail_before_response", error: error() }, { kind: "ok" }]);
    await expect(driver.runTurn(request)).rejects.toThrow();
    expect(transport.streams()).toBe(1);
  });

  it("never retries a failure after the response began, even an overloaded one", async () => {
    const { transport, driver } = c4Driver([{ kind: "fail_after_response", error: overloaded() }, { kind: "ok" }]);
    await expect(driver.runTurn(request)).rejects.toThrow();
    expect(transport.streams()).toBe(1);
  });

  it("a timeout stops the reply and settles it uncertain", async () => {
    const { transport, driver } = c4Driver([{ kind: "fail_before_response", error: new Anthropic.APIConnectionTimeoutError() }]);
    const meter = meterTurn(driver);

    await expect(
      runAgentTurn({ driver: meter.driver, executor: async (): Promise<ToolExecution> => ({ kind: "ok", result: {} }) }),
    ).rejects.toThrow();

    expect(transport.streams()).toBe(1);
    expect(meter.settlement()).toEqual({ outcome: "uncertain" });
  });
});

describe("the M1 driver's retries", () => {
  it("are the SDK's own, unchanged", async () => {
    const transport = stubTransport([{ kind: "fail_before_response", error: rateLimited() }, { kind: "ok" }]);
    const driver = createAnthropicDriver({ retry: "sdk", client: () => transport.client, sleep: noSleep });

    // The SDK retries inside one stream; the driver makes no attempt of its own.
    await expect(driver.runTurn(request)).rejects.toBeInstanceOf(Anthropic.RateLimitError);
    expect(transport.streams()).toBe(1);
    expect(transport.options[0]).toMatchObject({ maxRetries: MAX_RETRIES });
  });
});

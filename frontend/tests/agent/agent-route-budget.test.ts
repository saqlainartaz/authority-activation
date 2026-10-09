import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TurnResult } from "@/agent/lib/driver";

import { RESERVE_RESPONSE } from "./support/reserve-response";

/**
 * The agent route with its reservation, driven end to end against stubs (Cycle
 * 5, P1.5 fix round 1, rulings 16 and 17). The product calls, the session
 * cookie and the model drivers are stubbed; the route, the loop, the meter and
 * the settlement are the shipping code.
 */

const state = vi.hoisted(() => ({
  reserve: null as unknown,
  reserveError: null as unknown,
  budget: [] as Record<string, unknown>[],
  calls: [] as string[],
  steps: [] as Array<unknown>,
  /** Answer reserves as the backend does since Ruling 70: one turn id, one
   *  reservation; a second reserve for an id already held is a 409. */
  oneKeyOneRun: false,
  reserved: new Set<string>(),
}));

vi.mock("@/lib/client-session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/client-session")>()),
  requireClientToken: async () => "token",
}));

vi.mock("@/lib/product", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/product")>()),
  recordClientTurn: async (_token: string, _session: string, body: { message: string }) => ({
    session: { id: "s", platform: "linkedin", content_item_id: null },
    messages: [{ id: "m1", role: "user", kind: "task", body: body.message, command_kind: null, handle: "U1" }],
    variants: [],
    selected_variant_id: null,
  }),
  getOnboarding: async () => {
    throw new Error("not needed");
  },
  postTurnBudget: async (_token: string, _session: string, body: Record<string, unknown>) => {
    state.budget.push(body);
    if (body.action === "reserve" && state.reserveError !== null) throw state.reserveError;
    if (body.action === "reserve" && state.oneKeyOneRun) {
      const id = String(body.turn_id);
      if (state.reserved.has(id)) {
        throw Object.assign(new Error("product POST turn-budget -> 409"), {
          status: 409, body: { detail: { code: "turn_in_progress", detail: "a reply under this id is already being written" } },
        });
      }
      state.reserved.add(id);
    }
    return body.action === "reserve" ? state.reserve : { settled: body.outcome };
  },
  recordAgentTurn: async () => ({}),
}));

vi.mock("@/lib/client-timezone", () => ({
  clientTimezone: async () => {
    throw new Error("no zone");
  },
}));

vi.mock("@/agent/lib/client-knowledge", () => ({
  readClientKnowledge: async () => ({ role: "user", content: "<client-knowledge></client-knowledge>", cache: true }),
}));

vi.mock("@/agent/lib/loop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/agent/lib/loop")>();
  const scripted = (label: string) => ({
    toProviderTools: (tools: unknown) => tools,
    runTurn: async (): Promise<TurnResult> => {
      state.calls.push(label);
      const step = state.steps.shift();
      if (step instanceof Error) throw step;
      return step as TurnResult;
    },
  });
  return { ...actual, anthropicDriver: scripted("m1"), anthropicC4Driver: scripted("c4") };
});

const SESSION = "44444444-4444-4444-8444-444444444444";

const REPLY: TurnResult = {
  text: "done",
  toolCalls: [],
  stopReason: "end_turn",
  usage: { inputTokens: 1_000, outputTokens: 100, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  model: "claude-opus-5",
};

async function turn(contract: "c4" | "context.v1"): Promise<string> {
  process.env.AGENT_CONTRACT = contract;
  vi.resetModules();
  const { POST } = await import("@/app/api/client/chat/sessions/[sessionId]/agent/route");
  const response = await POST(
    new Request("http://localhost/api/client/chat/sessions/x/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Write a post about our opening hours.", turnId: crypto.randomUUID() }),
    }),
    { params: Promise.resolve({ sessionId: SESSION }) },
  );
  return await response.text();
}

const settles = () => state.budget.filter((body) => body.action === "settle");

beforeEach(() => {
  delete process.env.AUTHORITY_AGENT_DRIVER;
  state.reserve = RESERVE_RESPONSE;
  state.reserveError = null;
  state.budget = [];
  state.calls = [];
  state.steps = [];
  state.oneKeyOneRun = false;
  state.reserved = new Set();
});

afterEach(() => {
  delete process.env.AGENT_CONTRACT;
});

describe("a C4 reply and its reservation", () => {
  it("runs on the C4 driver and settles at what ran", async () => {
    state.steps = [REPLY];
    await turn("c4");
    expect(state.calls).toEqual(["c4"]);
    expect(settles()).toEqual([expect.objectContaining({ outcome: "settled", actual_microdollars: 7_500 })]);
  });

  it("stops at an unbilled-or-not-known failure and settles uncertain", async () => {
    state.steps = [new Error("the stream timed out")];
    const stream = await turn("c4");
    expect(state.calls).toEqual(["c4"]);
    expect(stream).toContain('"outcome":"refused"');
    expect(settles()).toEqual([expect.objectContaining({ outcome: "uncertain" })]);
  });

  it.each([
    ["no bounds at all", { call_id: RESERVE_RESPONSE.call_id, reserved_microdollars: 1_852_400 }],
    ["a zero cap", { ...RESERVE_RESPONSE, reply_cap_microdollars: 0 }],
    ["no input bound", { ...RESERVE_RESPONSE, max_call_input_tokens: undefined }],
    ["no output bound", { ...RESERVE_RESPONSE, max_call_output_tokens: undefined }],
    ["no prices", { ...RESERVE_RESPONSE, prices: undefined }],
    ["malformed prices", { ...RESERVE_RESPONSE, prices: { "claude-opus-5": { input: "5" } } }],
  ])("refuses the reply with %s: no model call, and the reservation is released", async (_name, reserve) => {
    state.reserve = reserve;
    state.steps = [REPLY];

    const stream = await turn("c4");

    expect(state.calls).toEqual([]);
    expect(stream).toContain('"type":"terminal"');
    expect(stream).toContain('"outcome":"refused"');
    expect(settles()).toEqual([expect.objectContaining({ outcome: "cancelled_unsent" })]);
  });
});

/** The stream's events, in order. */
const events = (stream: string) =>
  stream.split("\n\n").filter((frame) => frame.startsWith("data:")).map((frame) => JSON.parse(frame.slice(5)));

/** A 429 as `lib/product.ts` throws it: the status, FastAPI's `detail`, the whole body. */
const refused429 = (body: Record<string, unknown>) =>
  Object.assign(new Error("product POST turn-budget -> 429"), { status: 429, detail: body.detail, body });

const OLD_DETAIL = { code: "budget_exhausted", detail: "this turn's worst case does not fit the approved budget" };

describe("a refused reservation (Cycle 5, P1.6)", () => {
  it("names the limit and its UTC reset when the 429 carries one", async () => {
    state.reserveError = refused429({
      detail: OLD_DETAIL,
      limit: {
        meter: "writing_daily", period: "day", used_fraction: 1,
        resets_at: "2026-10-05T00:00:00+00:00", reason: "budget_exhausted",
      },
    });

    const stream = events(await turn("c4"));

    expect(state.calls).toEqual([]);
    expect(stream).toEqual([
      {
        type: "terminal",
        outcome: "refused",
        explanation: "Today's writing limit is reached. It resets at 00:00 UTC.",
      },
      { type: "turn.end" },
    ]);
  });

  it("names the month and its reset day for the monthly limit", async () => {
    state.reserveError = refused429({
      detail: OLD_DETAIL,
      limit: {
        meter: "writing_monthly", period: "month", used_fraction: 1,
        resets_at: "2026-11-01T00:00:00+00:00", reason: "budget_exhausted",
      },
    });

    const stream = events(await turn("c4"));

    expect(stream[0].explanation).toBe(
      "This month's writing limit is reached. It resets on 1 November at 00:00 UTC.",
    );
  });

  it("says a bucket's budget is used up when the 429 names no limit, never 'try again shortly' (P2.6)", async () => {
    state.reserveError = refused429({ detail: OLD_DETAIL });

    const stream = events(await turn("c4"));

    expect(state.calls).toEqual([]);
    expect(stream).toEqual([
      {
        type: "terminal",
        outcome: "refused",
        explanation: "This campaign's writing budget is used up.",
      },
      { type: "turn.end" },
    ]);
  });

  // Changed expectations (P2.9, P2 milestone review M6): both cases kept the old
  // sentence, "Nothing was sent and nothing was saved — try again shortly". The
  // message is saved before the reserve, and a configuration refusal does not clear
  // by itself, so neither half was true for it.
  it("sends a configuration refusal (503 unavailable) to support, never 'try again shortly'", async () => {
    state.reserveError = Object.assign(new Error("product POST turn-budget -> 503"), {
      status: 503, detail: { code: "unavailable" }, body: { detail: { code: "unavailable" } },
    });

    const stream = events(await turn("c4"));

    expect(state.calls).toEqual([]);
    expect(stream[0].explanation).toBe("Writing isn't available for this account right now. Please contact support.");
    expect(stream[0].explanation).not.toMatch(/try again|nothing was saved/i);
  });

  it("says a failure that is neither a budget nor a configuration refusal was not started, not unsaved", async () => {
    state.reserveError = Object.assign(new Error("product POST turn-budget -> 502"), {
      status: 502, body: { detail: "bad gateway" },
    });

    const stream = events(await turn("c4"));

    expect(state.calls).toEqual([]);
    expect(stream[0].explanation).toBe("I can't start this one right now. Nothing was sent — try again shortly.");
    expect(stream[0].explanation).not.toMatch(/nothing was saved/i);
  });
});

describe("one turn id is one reservation and one run (Ruling 70, P5 review I-1)", () => {
  const conflict = (code: string) => Object.assign(new Error("product POST turn-budget -> 409"), {
    status: 409, body: { detail: { code, detail: "x" } },
  });

  it("a reserve refused as turn_in_progress says a reply is already running, and runs nothing", async () => {
    state.reserveError = conflict("turn_in_progress");
    state.steps = [REPLY];

    const stream = events(await turn("c4"));

    expect(state.calls).toEqual([]);
    expect(settles()).toEqual([]);
    expect(stream).toEqual([
      { type: "terminal", outcome: "refused", explanation: "A reply to this message is already being written." },
      { type: "turn.end" },
    ]);
    // The route never retries the id: one reserve, and nothing after it.
    expect(state.budget).toHaveLength(1);
  });

  it("a reserve refused as turn_settled says the message was answered, and runs nothing", async () => {
    state.reserveError = conflict("turn_settled");
    state.steps = [REPLY];

    const stream = events(await turn("c4"));

    expect(state.calls).toEqual([]);
    expect(stream[0].explanation).toBe("This message has already been answered.");
    expect(state.budget).toHaveLength(1);
  });

  it("two concurrent requests with one turn id: one reservation, one run, and that run's spend is settled", async () => {
    state.oneKeyOneRun = true;
    state.steps = [REPLY];
    process.env.AGENT_CONTRACT = "c4";
    vi.resetModules();
    const { POST } = await import("@/app/api/client/chat/sessions/[sessionId]/agent/route");
    const turnId = crypto.randomUUID();
    const send = () => POST(
      new Request("http://localhost/api/client/chat/sessions/x/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "Write a post about our opening hours.", turnId }),
      }),
      { params: Promise.resolve({ sessionId: SESSION }) },
    ).then((response) => response.text());

    const streams = (await Promise.all([send(), send()])).map(events);

    expect(state.budget.filter((body) => body.action === "reserve")).toHaveLength(2);
    expect(state.calls).toEqual(["c4"]);
    expect(settles()).toEqual([expect.objectContaining({ outcome: "settled", actual_microdollars: 7_500 })]);
    const refused = streams.filter((stream) => stream[0]?.type === "terminal" && stream[0]?.outcome === "refused");
    expect(refused).toHaveLength(1);
    expect(refused[0][0].explanation).toBe("A reply to this message is already being written.");
  });
});

describe("the approaching notice (Cycle 5, P1.6)", () => {
  it("is sent before the reply when the reservation says the writing limit is near", async () => {
    state.reserve = { ...RESERVE_RESPONSE, approaching: true, writing_resets_at: "2026-10-05T00:00:00+00:00" };
    state.steps = [REPLY];

    const stream = events(await turn("c4"));

    // First, before anything the reply produces; and the reply still runs.
    expect(stream[0]).toEqual({ type: "usage.approaching", resets_at: "2026-10-05T00:00:00+00:00" });
    expect(stream.filter((event) => event.type === "usage.approaching")).toHaveLength(1);
    expect(stream.at(-1)).toEqual({ type: "turn.end" });
    expect(state.calls).toEqual(["c4"]);
    expect(settles()).toEqual([expect.objectContaining({ outcome: "settled" })]);
  });

  it.each([
    ["not approaching", { ...RESERVE_RESPONSE, approaching: false, writing_resets_at: null }],
    ["an older backend", RESERVE_RESPONSE],
  ])("is not sent when %s", async (_name, reserve) => {
    state.reserve = reserve;
    state.steps = [REPLY];

    const stream = events(await turn("c4"));

    expect(stream.map((event) => event.type)).not.toContain("usage.approaching");
  });

  it.each([
    ["the monthly meter", "writing_monthly", "2026-11-01T00:00:00+00:00"],
    ["the daily meter", "writing_daily", "2026-10-06T00:00:00+00:00"],
  ])("passes on the reserve's reset as-is and names %s (Ruling 37)", async (_name, meter, resetsAt) => {
    state.reserve = { ...RESERVE_RESPONSE, approaching: true, writing_resets_at: resetsAt, writing_meter: meter };
    state.steps = [REPLY];

    const stream = events(await turn("c4"));

    expect(stream[0]).toEqual({ type: "usage.approaching", resets_at: resetsAt, meter });
    expect(state.calls).toEqual(["c4"]);
  });

  it("leaves the meter out when the reserve names none or an unknown one", async () => {
    state.reserve = { ...RESERVE_RESPONSE, approaching: true, writing_resets_at: "2026-10-06T00:00:00+00:00", writing_meter: "documents_daily" };
    state.steps = [REPLY];

    const stream = events(await turn("c4"));

    expect(stream[0]).toEqual({ type: "usage.approaching", resets_at: "2026-10-06T00:00:00+00:00" });
  });
});

describe("an M1 reply", () => {
  it("runs on the M1 driver, with no reservation", async () => {
    state.steps = [REPLY];
    await turn("context.v1");
    expect(state.calls).toEqual(["m1"]);
    expect(state.budget).toEqual([]);
  });
});

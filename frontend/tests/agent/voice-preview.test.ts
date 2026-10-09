import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TurnResult } from "@/agent/lib/driver";

import { RESERVE_RESPONSE } from "./support/reserve-response";

/**
 * `voice_preview` and `POST /api/client/voice` (Cycle 5, P5.2; spec 6; A13,
 * A14; Ruling 68), driven end to end: the real BFF route, the real operation,
 * the real agent loop, executor and metered reservation. Only the product
 * calls and the session cookie are stubbed, and the model is either the
 * keyless STUB driver (`AUTHORITY_AGENT_DRIVER=deterministic`) or, for the
 * metering cases, a scripted driver that reports usage.
 */

const state = vi.hoisted(() => ({
  engine: "ke" as string,
  effective: null as unknown,
  effectiveCalls: [] as unknown[][],
  perspectives: { authors: [] as unknown[], brands: [] as unknown[] },
  budget: [] as Record<string, unknown>[],
  reserve: null as unknown,
  reserveError: null as unknown,
  voiceReads: [] as string[],
  chatReads: 0,
  writes: [] as string[],
  calls: [] as string[],
  steps: [] as unknown[],
}));

const KNOWN = "Members get unlimited classes for 49 dollars a month.";

const READ = {
  schema: "c4-tool-1",
  read_view: "c4v_voice",
  receipt: "R1",
  items: [{
    handle: "K1",
    payload: {
      kind: "knowledge", handle: "K1", meaning_id: "offering.price", subject_label: "Membership",
      reported_claimant_label: null, modality: "asserted", statement: KNOWN,
      value: { kind: "quantity", amount: "49.00", currency: "USD", raw: "49.00 USD" },
      qualifications: [], epistemic: "confirmed", temporal: "current_supported", unresolved: [],
      support_handles: [], conflict_handles: [],
    },
  }],
  sources: [],
  gaps: [],
  coverage: { extent: "selected", truncated: false, processing: "ready", retrieval: "ok", index_pending: false },
  diagnostics: [],
  next_cursor: null,
};

vi.mock("@/lib/client-session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/client-session")>()),
  requireClientToken: async () => "token",
}));

vi.mock("@/lib/product", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/product")>()),
  getMe: async () => ({ knowledge_engine: state.engine }),
  getWritingPerspectives: async () => state.perspectives,
  getWritingSetting: async (...args: unknown[]) => {
    state.effectiveCalls.push(args);
    return state.effective;
  },
  postVoiceBudget: async (_token: string, previewId: string, body: Record<string, unknown>) => {
    state.budget.push({ ...body, previewId });
    if (body.action === "reserve" && state.reserveError !== null) throw state.reserveError;
    return body.action === "reserve" ? state.reserve : { settled: body.outcome };
  },
  createVoiceRead: async (_token: string, previewId: string) => {
    state.voiceReads.push(previewId);
    return READ;
  },
  createChatRead: async () => {
    state.chatReads += 1;
    throw new Error("a voice preview must not read through a chat session");
  },
  postTurnBudget: async () => {
    throw new Error("a voice preview must not reserve through a chat session");
  },
  putWritingSetting: async () => {
    state.writes.push("PUT");
    throw new Error("the voice preview must not write guidance");
  },
  deleteWritingSetting: async () => {
    state.writes.push("DELETE");
    throw new Error("the voice preview must not clear guidance");
  },
}));

vi.mock("@/agent/lib/loop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/agent/lib/loop")>();
  return {
    ...actual,
    anthropicC4Driver: {
      toProviderTools: (tools: unknown) => tools,
      runTurn: async (): Promise<TurnResult> => {
        state.calls.push("c4");
        const step = state.steps.shift();
        if (step instanceof Error) throw step;
        if (step === undefined) throw new Error("no scripted step left");
        return step as TurnResult;
      },
    },
  };
});

const PREVIEW = "5a0b6c7d-8e9f-4a1b-9c2d-3e4f5a6b7c8d";
const AUTHOR = "8b1c1f8e-0000-4000-8000-000000000007";

async function voice(body: Record<string, unknown>, driver: "stub" | "scripted" = "stub"): Promise<{ status: number; json: Record<string, unknown> }> {
  if (driver === "stub") process.env.AUTHORITY_AGENT_DRIVER = "deterministic";
  else delete process.env.AUTHORITY_AGENT_DRIVER;
  vi.resetModules();
  const { POST } = await import("@/app/api/client/voice/route");
  const response = await POST(new Request("http://localhost/api/client/voice", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
  return { status: response.status, json: await response.json() };
}

const generate = (extra: Record<string, unknown> = {}) =>
  ({ preview_id: PREVIEW, perspective: { mode: "neutral" }, kind: "generate", ...extra });

const settles = () => state.budget.filter((body) => body.action === "settle");

beforeEach(() => {
  state.engine = "ke";
  state.effective = null;
  state.effectiveCalls = [];
  state.perspectives = { authors: [], brands: [] };
  state.budget = [];
  state.reserve = RESERVE_RESPONSE;
  state.reserveError = null;
  state.voiceReads = [];
  state.chatReads = 0;
  state.writes = [];
  state.calls = [];
  state.steps = [];
});

afterEach(() => {
  delete process.env.AUTHORITY_AGENT_DRIVER;
});

describe("voice_preview with the stub driver", () => {
  it("no saved guidance and no example: a starting proposal, labelled, and nothing saved (A13)", async () => {
    const { status, json } = await voice(generate());

    expect(status).toBe(200);
    expect(json.outcome).toBe("preview");
    expect(json.preview_id).toBe(PREVIEW);
    expect(json.starting_proposal).toBe(true);
    expect(String(json.sample)).toContain(KNOWN);
    // The stub cites what it read as "[K1]", as a real model does; the client
    // never sees the marker (P5.5 review I-3).
    expect(String(json.sample)).not.toMatch(/\[(?:K|D|TA)\d+\]/);
    expect(String(json.proposed_guidance)).toContain("warm, plain first-person voice");
    // The fact screen and its Restore lines were removed (2026-10-08).
    expect(json).not.toHaveProperty("removed_lines");
    expect(json).not.toHaveProperty("facts_note");
    // Read through the PREVIEW's own view, never a chat session's.
    expect(state.voiceReads).toEqual([PREVIEW]);
    expect(state.chatReads).toBe(0);
    // The one general guidance was the input, read once.
    expect(state.effectiveCalls).toEqual([["token"]]);
    expect(state.writes).toEqual([]);
  });

  it("saved guidance, or an example or style description, is not a starting proposal", async () => {
    state.effective = { perspective_mode: "neutral", guideline_id: "g", revision: 1, text_digest: "d".repeat(64), text: "- Plain words." };
    expect((await voice(generate())).json.starting_proposal).toBe(false);

    state.effective = null;
    expect((await voice(generate({ style_note: "Short and dry, like my newsletter." }))).json.starting_proposal).toBe(false);
  });

  it("Adjust returns a revised sample and revised proposed guidance", async () => {
    const base = { sample: "A quick note from us this week.", proposed_guidance: "- Write in a warm, plain voice." };

    const { json } = await voice({
      preview_id: PREVIEW, perspective: { mode: "neutral" }, kind: "adjust",
      instruction: "Make it more formal. Fewer emojis.", base,
    });

    expect(json.outcome).toBe("preview");
    expect(json.sample).not.toBe(base.sample);
    expect(String(json.sample)).toContain("Make it more formal");
    expect(String(json.proposed_guidance)).toContain("- Write in a warm, plain voice.");
    expect(String(json.proposed_guidance)).toContain("Make it more formal.");
    expect(String(json.proposed_guidance)).toContain("Fewer emojis.");
    expect(state.writes).toEqual([]);
  });

  it("keeps the saved general guidance in a person's voice, and strips the sample's handle markers (P5.5 I-3)", async () => {
    state.perspectives = { authors: [{ ref: { kind: "entity", id: AUTHOR, revision: 1 }, label: "Mara Ellison" }], brands: [] };
    const saved = "- Write like I'm talking to a friend over coffee.\n- We are warm and direct, never salesy.\n- Say 'we help' rather than 'we provide'.";
    state.effective = { perspective_mode: "neutral", guideline_id: "g", revision: 2, text_digest: "d".repeat(64), text: saved };

    const { json } = await voice({ preview_id: PREVIEW, perspective: { mode: "personal", author_id: AUTHOR }, kind: "generate" });

    expect(json.outcome).toBe("preview");
    expect(String(json.proposed_guidance)).toContain(saved);
    expect(String(json.sample)).toContain(KNOWN);
    expect(String(json.sample)).not.toContain("[K1]");
  });

  it("reads a person's voice by its permitted label and uses the one general guidance (D06)", async () => {
    state.perspectives = { authors: [{ ref: { kind: "entity", id: AUTHOR, revision: 1 }, label: "Ada Lovelace" }], brands: [] };
    state.effective = { perspective_mode: "neutral", guideline_id: "g", revision: 1, text_digest: "d".repeat(64), text: "General." };

    const { json } = await voice({ preview_id: PREVIEW, perspective: { mode: "personal", author_id: AUTHOR }, kind: "generate" });

    expect(json.outcome).toBe("preview");
    // No perspective and no `effective` flag: there is one general text.
    expect(state.effectiveCalls).toEqual([["token"]]);
    expect(String(json.proposed_guidance)).toContain("General.");
  });

  it("refuses a voice that is not in the permitted list, before anything is reserved", async () => {
    const { status } = await voice({ preview_id: PREVIEW, perspective: { mode: "personal", author_id: AUTHOR }, kind: "generate" });

    expect(status).toBe(422);
    expect(state.budget).toEqual([]);
  });

  it.each([
    ["an extra key", generate({ client_id: "someone-else" })],
    ["a preview id that is not a UUIDv4", generate({ preview_id: "11111111-1111-1111-8111-111111111111" })],
    ["an adjustment with no instruction", { preview_id: PREVIEW, perspective: { mode: "neutral" }, kind: "adjust", base: { sample: "x", proposed_guidance: "y" } }],
    ["a comparison (removed 2026-10-08)", { preview_id: PREVIEW, perspective: { mode: "neutral" }, kind: "compare", base: { sample: "x", proposed_guidance: "y" } }],
    ["guidance written by the browser on a new sample", generate({ base: { sample: "x", proposed_guidance: "y" } })],
  ])("refuses %s without a model call", async (_name, body) => {
    const { status } = await voice(body);
    expect(status).toBe(422);
    expect(state.budget).toEqual([]);
  });

  it("is absent under M1: 404, no reservation, no read", async () => {
    state.engine = "m1";
    const { status } = await voice(generate());
    expect(status).toBe(404);
    expect(state.budget).toEqual([]);
    expect(state.voiceReads).toEqual([]);
  });
});

describe("voice_preview is metered on the Writing meter like a reply", () => {
  const read: TurnResult = {
    text: "",
    toolCalls: [{ id: "r1", name: "read_knowledge", input: { selector: "orient", purpose: "voice" } }],
    stopReason: "tool_use",
    usage: { inputTokens: 1_000, outputTokens: 100, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    model: "claude-opus-5",
  };
  const propose: TurnResult = {
    text: "",
    toolCalls: [{
      id: "p1", name: "propose_voice",
      input: { sample: "Hello from the studio [K1].", proposed_guidance: "- Plain words.", stated_facts: [] },
    }],
    stopReason: "tool_use",
    usage: { inputTokens: 1_000, outputTokens: 100, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    model: "claude-opus-5",
  };

  it("reserves before the first call, makes no closing call, and settles once at what ran", async () => {
    state.steps = [read, propose];

    const { json } = await voice(generate(), "scripted");

    expect(json.outcome).toBe("preview");
    // Two model calls: the read and the proposal. Nothing after it.
    expect(state.calls).toEqual(["c4", "c4"]);
    expect(state.budget[0]).toEqual({ action: "reserve", previewId: PREVIEW });
    // Priced at the reservation's prices: 2 x (1,000 x $5/M + 100 x $25/M) = 15,000.
    expect(settles()).toEqual([expect.objectContaining({
      action: "settle", call_id: RESERVE_RESPONSE.call_id, outcome: "settled", actual_microdollars: 15_000, previewId: PREVIEW,
    })]);
    expect(settles()[0].usage).toMatchObject({ inputTokens: 2_000, outputTokens: 200, by_model: { "claude-opus-5": expect.any(Object) } });
    // No turn id: the preview id is the generation's id.
    expect(state.budget.every((body) => !("turn_id" in body))).toBe(true);
  });

  it("an unknown-cost failure settles uncertain, and the id is not reused", async () => {
    state.steps = [read, new Error("the stream timed out")];

    const { json } = await voice(generate(), "scripted");

    expect(json).toMatchObject({ outcome: "failed", retry: "new" });
    expect(settles()).toEqual([expect.objectContaining({ outcome: "uncertain" })]);
  });

  it("a writing-limit refusal shows the named limit, and nothing runs or settles", async () => {
    state.reserveError = Object.assign(new Error("product POST turn-budget -> 429"), {
      status: 429,
      body: {
        detail: { code: "budget_exhausted", detail: "this turn's worst case does not fit the approved budget" },
        limit: { meter: "writing_daily", period: "day", used_fraction: 1, resets_at: "2026-10-08T00:00:00+00:00", reason: "budget_exhausted" },
      },
    });
    state.steps = [read, propose];

    const { json } = await voice(generate(), "scripted");

    // Nothing was reserved, so this generation may be retried under its id.
    expect(json).toEqual({ outcome: "refused", message: "Today's writing limit is reached. It resets at 00:00 UTC.", retry: "same" });
    expect(state.calls).toEqual([]);
    expect(settles()).toEqual([]);
  });

  it("fails closed on a reservation without bounds: no call, released as cancelled_unsent", async () => {
    state.reserve = { call_id: RESERVE_RESPONSE.call_id, reserved_microdollars: 1_852_400 };
    state.steps = [read, propose];

    const { json } = await voice(generate(), "scripted");

    // Reserved, then released: the id is spent, so a retry needs a new one.
    expect(json).toMatchObject({ outcome: "refused", retry: "new" });
    expect(state.calls).toEqual([]);
    expect(settles()).toEqual([expect.objectContaining({ outcome: "cancelled_unsent" })]);
  });

  it("an unreadable reserve answer is a start that did not happen: no call, nothing settled", async () => {
    state.reserve = null;
    state.steps = [read, propose];

    const { json } = await voice(generate(), "scripted");

    expect(json).toEqual({ outcome: "refused", message: "I can't start this one right now. Nothing was sent — try again shortly.", retry: "same" });
    expect(state.calls).toEqual([]);
    expect(settles()).toEqual([]);
  });

  it("an id whose run may still be going is refused by the server and never run again (Ruling 69)", async () => {
    state.reserveError = Object.assign(new Error("product POST turn-budget -> 409"), {
      status: 409,
      body: { detail: { code: "turn_in_progress", detail: "a reply under this id is already being written" } },
    });
    state.steps = [read, propose];

    const { json } = await voice(generate(), "scripted");

    expect(json).toEqual({
      outcome: "failed",
      message: "That sample is still being written. Try again in a moment for a new one.",
      retry: "new",
    });
    expect(state.calls).toEqual([]);
    expect(settles()).toEqual([]);
  });

  it("a failed run and its retry under a new id are each reserved and settled: all spend is metered", async () => {
    const failing = "7c2d8e9f-a0b1-4c3d-8e4f-5a6b7c8d9e0f";
    state.steps = [read, new Error("the stream timed out")];
    expect((await voice(generate({ preview_id: failing }), "scripted")).json).toMatchObject({ outcome: "failed", retry: "new" });

    state.steps = [read, propose];
    expect((await voice(generate(), "scripted")).json.outcome).toBe("preview");

    expect(state.budget.filter((body) => body.action === "reserve").map((body) => body.previewId)).toEqual([failing, PREVIEW]);
    expect(settles().map((body) => [body.previewId, body.outcome])).toEqual([
      [failing, "uncertain"],
      [PREVIEW, "settled"],
    ]);
  });

  it("logs one [agent.voice] trace line: codes, sizes and the loop's trace, never words", async () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(" ")); });
    try {
      state.steps = [read, propose];
      await voice(generate(), "scripted");
    } finally {
      spy.mockRestore();
    }
    const lines = logged.filter((line) => line.startsWith("[agent.voice]"));
    expect(lines).toHaveLength(1);
    const trace = JSON.parse(lines[0].slice("[agent.voice] ".length));
    expect(trace).toMatchObject({
      operation: "voice_preview", kind: "generate", voice: "neutral", outcome: "preview",
      sampleChars: "Hello from the studio.".length, sampleHandles: ["K1"],
    });
    expect(trace).not.toHaveProperty("factsRemoved");
    expect(trace.tools.map((tool: { name: string }) => tool.name)).toEqual(["read_knowledge", "propose_voice"]);
    expect(trace.passes).toHaveLength(2);
    expect(lines[0]).not.toContain("Hello from the studio");
    expect(lines[0]).not.toContain("[K1]");
    expect(lines[0]).not.toContain("Plain words");
  });

  it("a retried id whose reservation already finished asks for a new generation", async () => {
    state.reserveError = Object.assign(new Error("product POST turn-budget -> 409"), {
      status: 409,
      body: { detail: { code: "turn_settled", detail: "a reply under this id has already finished" } },
    });

    const { json } = await voice(generate(), "scripted");

    expect(json).toMatchObject({ outcome: "failed", retry: "new" });
    expect(state.calls).toEqual([]);
  });

  it("strips every handle marker a model puts in the sample, in any form (P5.5 review I-3)", async () => {
    const cited: TurnResult = {
      ...propose,
      toolCalls: [{
        id: "p1", name: "propose_voice",
        input: {
          sample: "I am a physiotherapist [K4]. The studio runs knee programmes [K1, K2].\n\n[D1] Ask me anything [TA2].",
          proposed_guidance: "- Plain words.",
        },
      }],
    };
    state.steps = [read, cited];

    const { json } = await voice(generate(), "scripted");

    expect(json.sample).toBe("I am a physiotherapist. The studio runs knee programmes.\n\nAsk me anything.");
  });

  it("shows the approaching notice the composer shows", async () => {
    state.reserve = { ...RESERVE_RESPONSE, approaching: true, writing_resets_at: "2026-10-08T00:00:00+00:00", writing_meter: "writing_daily" };
    state.steps = [read, propose];

    const { json } = await voice(generate(), "scripted");

    expect(json.approaching).toBe("You've used most of today's writing budget. It resets at 00:00 UTC.");
  });

  it("an over-limit proposal is sent back to the model to shorten, and never returned", async () => {
    const long: TurnResult = {
      ...propose,
      toolCalls: [{ id: "p0", name: "propose_voice", input: { sample: "Hi.", proposed_guidance: "x".repeat(2_001) } }],
    };
    state.steps = [read, long, propose];

    const { json } = await voice(generate(), "scripted");

    expect(state.calls).toHaveLength(3);
    expect(json.proposed_guidance).toBe("- Plain words.");
  });
});

describe("the operation writes no guidance (A14)", () => {
  it("the operation and its route have no writing-settings write in scope", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    for (const file of ["src/agent/voice/voice-preview.ts", "src/app/api/client/voice/route.ts", "src/agent/lib/metered-operation.ts"]) {
      const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/putWritingSetting|deleteWritingSetting|saveGuidance|clearGuidance|method:\s*["']PUT/);
    }
  });
});

describe("the card, through the real BFF route and the stub driver (P5 review M-8)", () => {
  it("a personal voice with first-person saved guidance: the card shows a clean sample and keeps every saved line", async () => {
    state.perspectives = { authors: [{ ref: { kind: "entity", id: AUTHOR, revision: 1 }, label: "Mara Ellison" }], brands: [] };
    const saved = "- We are warm and direct, never salesy.\n- Write like I'm talking to a friend.";
    state.effective = { perspective_mode: "neutral", guideline_id: "g", revision: 2, text_digest: "d".repeat(64), text: saved };
    process.env.AUTHORITY_AGENT_DRIVER = "deterministic";
    vi.resetModules();
    const { POST } = await import("@/app/api/client/voice/route");
    const { initialCard, voiceController, voiceReducer } = await import("@/refined/voice");
    const person = { key: `personal:${AUTHOR}`, label: "Mara Ellison (as yourself)", perspective: { mode: "personal" as const, authorId: AUTHOR } };

    const general = { guidelineId: "g", revision: 2, text: saved };
    let card = initialCard(person, general, true);
    const fetcher = async (url: string, init: RequestInit = {}) => {
      if (url === "/api/client/voice") return POST(new Request("http://localhost/api/client/voice", { method: "POST", body: init.body as string }));
      throw new Error(`not stubbed: ${url}`);
    };
    const controller = voiceController(
      { get: () => card, dispatch: (action) => { card = voiceReducer(card, action); } },
      {
        fetcher, saveGeneral: async () => ({ kind: "error", message: "no" }), reloadGeneral: async () => ({ kind: "error", message: "no" }),
        newId: () => PREVIEW, onSignedOut: () => { throw new Error("signed out"); },
      },
    );

    await controller.generate();
    controller.use(card.version!);

    expect(card.version?.sample).toContain(KNOWN);
    expect(card.version?.sample).not.toContain("[K1]");
    expect(card.guidanceDraft).toContain(saved);
    expect(state.writes).toEqual([]);
  });
});

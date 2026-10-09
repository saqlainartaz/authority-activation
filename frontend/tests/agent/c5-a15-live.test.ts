import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";

import { describe, expect, it, vi } from "vitest";

/**
 * A15 (Cycle 5, P5.4): a founder's saved guidance reaches a new-topic voice
 * preview, through the REAL voice route against a REAL service.
 *
 * **Skipped unless `C5_A15_SEED` names a seed file.** `scripts/ke_c5_a15_eval.py`
 * (backend) seeds two synthetic tenants on a database it owns, serves the app on
 * loopback, writes the seed and runs this file. The normal suite never sets the
 * variable, so this file never runs, and never spends, there.
 *
 * What runs: `POST /api/client/voice` (the BFF route) -> `runVoicePreview` -> the
 * agent loop, the metered driver and `runMeteredOperation`'s reserve -> cap ->
 * settle against the service. Two things are stood in for, both at the edge:
 * - the client cookie, with the token the service really issued (as the C4
 *   demonstration does);
 * - the provider driver is WRAPPED, not replaced: in `live` mode the wrapper
 *   calls the real `anthropicC4Driver`; in `dry` mode the deterministic driver.
 *   The wrapper records each call (request and usage, all synthetic) and is the
 *   SPEND GUARD: it refuses, before dispatch, any call past `max_calls` or any
 *   call whose worst case (counted at the US$1 reply cap) could take the total
 *   past the operator's budget (US$5, 2026-10-07).
 */

type Seed = {
  mode: "live" | "dry";
  engine_url: string;
  service_key: string;
  result_path: string;
  guard: {
    max_calls: number;
    budget_microdollars: number;
    prior_spend_microdollars: number;
    per_call_worst_case_microdollars: number;
  };
  a: {
    client_id: string;
    token: string;
    founder_id: string;
    founder_label: string;
    founder_guidance: string;
    general_guidance: string;
    topic_note: string;
  };
};

const SEED_PATH = process.env.C5_A15_SEED ?? "";
const seed: Seed | null = SEED_PATH && fs.existsSync(SEED_PATH) ? (JSON.parse(fs.readFileSync(SEED_PATH, "utf8")) as Seed) : null;

if (seed) {
  process.env.ENGINE_URL = seed.engine_url;
  process.env.ENGINE_SERVICE_KEY = seed.service_key;
  // The route picks its driver once, at import: never the deterministic branch
  // here. The wrapper below chooses what actually runs.
  delete process.env.AUTHORITY_AGENT_DRIVER;
}

type CallRecord = {
  index: number;
  preview: string;
  started_at: string;
  request: {
    model: string | null;
    max_tokens: number | null;
    system: { chars: number; sha256: string; cache: boolean }[];
    tools: string[];
    first_user_message: string;
    messages: unknown[];
  };
  response: {
    text: string;
    tool_calls: { name: string; input: unknown }[];
    stop_reason: string;
    usage: unknown;
    model: string | null;
  } | null;
  error: string | null;
  cost_microdollars: number | null;
};

const record: {
  calls: CallRecord[];
  budget_posts: { preview: string; request: unknown; response: unknown; error: string | null }[];
  refused_by_guard: { preview: string; reason: string }[];
  previews: { kind: string; preview_id: string; status: number; response: Record<string, unknown> }[];
  reload: unknown;
  voice_trace: unknown[];
  founder_guidance_escaped: string;
  mode: string;
} = {
  calls: [],
  budget_posts: [],
  refused_by_guard: [],
  previews: [],
  reload: null,
  voice_trace: [],
  founder_guidance_escaped: "",
  mode: seed?.mode ?? "none",
};
let currentPreview = "none";
let latestPrices: unknown = null;

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

vi.mock("@/lib/client-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client-session")>();
  return {
    ...actual,
    // The REAL token the service issued to the synthetic founder.
    requireClientToken: async () => seed!.a.token,
    clientToken: async () => seed!.a.token,
  };
});

vi.mock("@/lib/product", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/product")>();
  return {
    ...actual,
    // Observed, not changed: the reservation (its prices price each call) and
    // the settlement the run reports.
    postVoiceBudget: async (token: string, previewId: string, body: Parameters<typeof actual.postVoiceBudget>[2]) => {
      try {
        const response = await actual.postVoiceBudget(token, previewId, body);
        if ((body as { action?: string }).action === "reserve") latestPrices = (response as { prices?: unknown }).prices;
        record.budget_posts.push({ preview: currentPreview, request: body, response, error: null });
        return response;
      } catch (error) {
        record.budget_posts.push({ preview: currentPreview, request: body, response: null, error: String(error) });
        throw error;
      }
    },
  };
});

vi.mock("@/agent/lib/loop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/agent/lib/loop")>();
  const { deterministicDriver } = await import("@/agent/lib/deterministic-driver");
  const { passCostMicrodollars, parseWriterPrices, DEFAULT_WRITER_MODEL } = await import("@/agent/lib/pricing");
  const inner = seed?.mode === "live" ? actual.anthropicC4Driver : deterministicDriver;
  const guarded: typeof actual.anthropicC4Driver = {
    toProviderTools: (tools) => inner.toProviderTools(tools),
    async runTurn(request) {
      const guard = seed!.guard;
      const made = record.calls.length;
      const worstAfter = guard.prior_spend_microdollars + (made + 1) * guard.per_call_worst_case_microdollars;
      if (made >= guard.max_calls || worstAfter > guard.budget_microdollars) {
        const reason = made >= guard.max_calls
          ? `call limit ${guard.max_calls} reached`
          : `worst case ${worstAfter} would pass the budget ${guard.budget_microdollars}`;
        record.refused_by_guard.push({ preview: currentPreview, reason });
        // Thrown BEFORE dispatch: nothing reaches the provider.
        throw new Error(`A15 spend guard: ${reason}`);
      }
      const entry: CallRecord = {
        index: made + 1,
        preview: currentPreview,
        started_at: new Date().toISOString(),
        request: {
          model: request.model ?? null,
          max_tokens: request.maxTokens ?? null,
          system: request.system.map((block) => ({ chars: block.text.length, sha256: sha(block.text), cache: block.cache })),
          tools: request.tools.map((tool) => tool.name),
          first_user_message: request.messages[0]?.content ?? "",
          messages: request.messages.map(({ providerBlocks: _blocks, ...rest }) => rest),
        },
        response: null,
        error: null,
        cost_microdollars: null,
      };
      record.calls.push(entry);
      try {
        const result = await inner.runTurn(request);
        entry.response = {
          text: result.text,
          tool_calls: result.toolCalls.map((call) => ({ name: call.name, input: call.input })),
          stop_reason: result.stopReason,
          usage: result.usage,
          model: result.model ?? null,
        };
        // Priced at the reservation's own prices, as the settlement prices it.
        const prices = parseWriterPrices(latestPrices);
        entry.cost_microdollars = prices
          ? passCostMicrodollars(result.usage, result.model ?? DEFAULT_WRITER_MODEL, prices)
          : null;
        return result;
      } catch (error) {
        entry.error = String(error);
        throw error;
      }
    },
  };
  return { ...actual, anthropicC4Driver: guarded };
});

async function preview(kind: string, body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/client/voice/route");
  currentPreview = kind;
  const previewId = randomUUID();
  const response = await POST(
    new Request("http://localhost/api/client/voice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preview_id: previewId, kind, ...body }),
    }),
  );
  const parsed = (await response.json()) as Record<string, unknown>;
  record.previews.push({ kind, preview_id: previewId, status: response.status, response: parsed });
  return parsed;
}

describe.skipIf(!seed)("A15: founder guidance reaches a new-topic voice preview", () => {
  it(
    "reloads the founder's saved guidance and generates a new-topic preview",
    async () => {
      const { escapeForBody } = await import("@/agent/transcript");
      record.founder_guidance_escaped = escapeForBody(seed!.a.founder_guidance);
      const info = vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
        if (args[0] === "[agent.voice]") record.voice_trace.push(JSON.parse(String(args[1])));
      });
      try {
        // The client reloads: the Guidance screen's read of the one general setting (D06).
        const { GET } = await import("@/app/api/client/writing-settings/route");
        const reload = await GET();
        record.reload = { status: reload.status, body: await reload.json() };

        const perspective = { mode: "personal", author_id: seed!.a.founder_id };
        const generated = await preview("generate", { perspective, style_note: seed!.a.topic_note });

        // One Adjust, only while the call guard leaves it room for a read and a proposal.
        if (generated.outcome === "preview" && record.calls.length <= seed!.guard.max_calls - 2) {
          await preview("adjust", {
            perspective,
            instruction: "Make it a little warmer.",
            base: { sample: generated.sample, proposed_guidance: generated.proposed_guidance },
          });
        }
      } finally {
        info.mockRestore();
        fs.writeFileSync(seed!.result_path, JSON.stringify(record, null, 2) + "\n", "utf8");
      }
      expect(record.previews[0]?.status).toBe(200);
      expect(record.previews[0]?.response.outcome).toBe("preview");
    },
    600_000,
  );
});

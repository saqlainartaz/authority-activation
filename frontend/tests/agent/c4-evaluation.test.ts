import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { passCostMicrodollars } from "@/agent/lib/pricing";

import { DEFAULT_LIMITS } from "@/agent/bounds";
import { MAX_TOKENS } from "@/agent/lib/loop";

import { ledgerPath, reserve, spent as ledgerSpent, turnCost, turnWorstCase } from "./support/eval-ledger";

/**
 * THE PAID EVALUATION: the real model, the real runtime, real C3 records.
 *
 * Skipped unless `C4_EVAL=1`, so no ordinary run can spend. Authorized by the
 * operator's C4 closure goal (2026-09-25): a hard cap of US$40 in total. The
 * cap is enforced HERE, before every turn, from a ledger of each turn's actual
 * cost (the provider's own token counts at the approved list rate) -- and
 * again by the service, which reserves every turn's worst case against the
 * tenant's day bucket before the first model call.
 *
 * **What it measures, mechanically:** per turn, the tools used and their
 * outcomes, how the turn ended, whether a verified draft was stored, rule
 * breaks (a direct `schedule`, anything published without a click), tokens,
 * cost and cache hit rate. Readable drafts go to the git-ignored output
 * directory for the operator to read; this file never judges writing quality.
 *
 *   C4_EVAL=1 C4_EVAL_SEED=<seed.json> C4_EVAL_OUT=<dir> C4_EVAL_LEDGER=<the one ledger>
 *   C4_EVAL_CASES=smoke|all|a,b
 */

const EVAL = process.env.C4_EVAL === "1";
const SEED_PATH = process.env.C4_EVAL_SEED ?? "";
const OUT = process.env.C4_EVAL_OUT ?? "";
const CASES = (process.env.C4_EVAL_CASES ?? "smoke").split(",").map((c) => c.trim());
const LABEL = process.env.C4_EVAL_LABEL ?? "dataset";
// Which engine the agent reads through: `c4` (the rebuilt knowledge engine) or
// `context.v1` (M1, the engine in production). The side-by-side comparison
// runs the same cases once under each; nothing else changes between the runs.
const CONTRACT = process.env.C4_EVAL_CONTRACT ?? "c4";
if (CONTRACT !== "c4" && CONTRACT !== "context.v1") throw new Error(`C4_EVAL_CONTRACT must be c4 or context.v1, not ${CONTRACT}`);
const C4 = CONTRACT === "c4";
const CAP_MICRODOLLARS = 40_000_000;
// The most one turn may cost, derived from the runtime's enforced limits and
// reserved before it starts: a turn is refused here unless the ledger plus
// this still fits under the cap. The standard context window: no long-context
// beta is requested.
const CONTEXT_WINDOW_TOKENS = 200_000;
const TURN_WORST_CASE_MICRODOLLARS = turnWorstCase(DEFAULT_LIMITS.maxToolCalls, MAX_TOKENS, CONTEXT_WINDOW_TOKENS);
const LEDGER = EVAL ? ledgerPath(process.env) : "";
const spent = () => ledgerSpent(LEDGER, TURN_WORST_CASE_MICRODOLLARS);
const ENGINE = "http://127.0.0.1:8099";

type Seed = { client_id: string; token: string; service_key: string };
const seed: Seed | null = EVAL && fs.existsSync(SEED_PATH) ? JSON.parse(fs.readFileSync(SEED_PATH, "utf8")) : null;

if (EVAL) {
  process.env.ENGINE_URL = ENGINE;
  process.env.ENGINE_SERVICE_KEY = seed?.service_key ?? "";
  process.env.AGENT_CONTRACT = CONTRACT;
  // C4_EVAL_DRY=1 runs every case through the DETERMINISTIC driver: the
  // runner's own plumbing checked at no cost before any paid run.
  if (process.env.C4_EVAL_DRY === "1") process.env.AUTHORITY_AGENT_DRIVER = "deterministic";
  else delete process.env.AUTHORITY_AGENT_DRIVER; // the real provider, never the deterministic one
}

/** The token of the CURRENT case's user. One live session per user and
 *  channel is the product's rule, so each case gets its own user on the same
 *  client (found by the dry run: a second case's session was refused). */
let currentToken = seed?.token ?? "";

vi.mock("@/lib/client-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client-session")>();
  return { ...actual, requireClientToken: async () => currentToken };
});

async function engine(pathname: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(`${ENGINE}${pathname}`, {
    ...init,
    headers: {
      "X-API-Key": seed!.service_key,
      "X-Onboarding-Token": currentToken,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathname} answered ${response.status}: ${text.slice(0, 200)}`);
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

/** A fresh user and token on the seeded client, through the service's own routes. */
async function newUser(): Promise<void> {
  const service = { "X-API-Key": seed!.service_key, "content-type": "application/json" };
  const user = await fetch(`${ENGINE}/v1/clients/${seed!.client_id}/users`, {
    method: "POST",
    headers: service,
    body: JSON.stringify({ email: `c4-eval-${crypto.randomUUID()}@example.test`, display_name: "C4 evaluation", profession: "Founder" }),
  }).then((r) => r.json() as Promise<{ id: string }>);
  const issued = await fetch(`${ENGINE}/v1/clients/${seed!.client_id}/users/${user.id}/onboarding-token`, {
    method: "POST",
    headers: service,
  }).then((r) => r.json() as Promise<{ token: string }>);
  currentToken = issued.token;
}

async function newSession(platform = "linkedin", message = "Hi"): Promise<string> {
  await newUser();
  const created = await engine("/v1/chat/sessions", {
    method: "POST",
    body: JSON.stringify({ message, platform, idempotency_key: `eval-${crypto.randomUUID()}` }),
  });
  return (created.session as { id: string }).id;
}

type Variant = { id: string; status: string; body: string; title?: string | null; sources?: unknown[] };

async function variants(sessionId: string): Promise<Variant[]> {
  return ((await engine(`/v1/chat/sessions/${sessionId}`)).variants as Variant[]) ?? [];
}

/** One paid turn, refused before it starts if the cap could be crossed. */
async function turn(caseName: string, sessionId: string, message: string) {
  const turnId = crypto.randomUUID();
  // Checked and reserved as one step, BEFORE the paid call: if anything below
  // fails, the worst case stands.
  if (!reserve(LEDGER, { turn_id: turnId, dataset: LABEL, case: caseName },
               TURN_WORST_CASE_MICRODOLLARS, CAP_MICRODOLLARS)) {
    throw new Error(`budget: ${spent()} spent; a further turn could cross the US$40 cap`);
  }
  const traces: Record<string, unknown>[] = [];
  const info = vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
    if (args[0] === "[agent.turn]") traces.push(JSON.parse(String(args[1])));
  });
  const variantsBefore = await variants(sessionId);
  const { POST } = await import("@/app/api/client/chat/sessions/[sessionId]/agent/route");
  const started = Date.now();
  let stream = "";
  let status = 0;
  try {
    const response = await POST(
      new Request("http://localhost/api/client/chat/sessions/x/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, turnId }),
      }),
      { params: Promise.resolve({ sessionId }) },
    );
    status = response.status;
    stream = await response.text();
  } finally {
    info.mockRestore();
  }
  const trace = traces.at(-1) as
    | { tools: { name: string; outcome: string }[]; end: { kind: string; reason: string | null };
        totals: { inputTokens: number | null; outputTokens: number | null; cacheReadInputTokens: number | null;
                  cacheCreationInputTokens: number | null; cacheHitRate: number | null };
        passes: { usage: Parameters<typeof passCostMicrodollars>[0]; model?: string }[]; transcript?: unknown }
    | undefined;
  const cost = trace ? turnCost(trace.passes) : null;
  // Settled at once, before any further request that could fail.
  fs.appendFileSync(LEDGER, JSON.stringify({ turn_id: turnId, phase: "settled", dataset: LABEL, case: caseName,
                                            cost_microdollars: cost }) + "\n");
  const after = await variants(sessionId);
  const fresh = after.filter((variant) => !variantsBefore.some((old) => old.id === variant.id));
  const reply = stream
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => {
      try {
        const event = JSON.parse(line.slice(5));
        return event.type === "message.delta" ? String(event.text ?? event.delta ?? "") : "";
      } catch {
        return "";
      }
    })
    .join("");
  const record = {
    dataset: LABEL,
    contract: CONTRACT,
    case: caseName,
    at: new Date().toISOString(),
    ms: Date.now() - started,
    passes: trace?.passes.length ?? null,
    tools: trace?.tools.map((tool) => `${tool.name}:${tool.outcome}`) ?? [],
    end: trace?.end ?? null,
    transcript: trace?.transcript ?? null,
    tokens: trace?.totals ?? null,
    cache_hit_rate: trace?.totals.cacheHitRate ?? null,
    cost_microdollars: cost,
    new_variants: fresh.map((variant) => ({ status: variant.status, sources: variant.sources?.length ?? 0,
                                             titled: Boolean(variant.title) })),
    direct_schedule: (trace?.tools ?? []).some((tool) => tool.name === "schedule"),
    // How the turn ended, in the runtime's own words: a turn with no trace
    // did not run, and must say why rather than pass as a turn that did.
    terminal: stream.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => {
      try { const event = JSON.parse(line.slice(5)); return event.type === "terminal" ? `${event.outcome}: ${String(event.explanation ?? "").slice(0, 200)}` : null; } catch { return null; }
    }).filter(Boolean),
    http_status: status,
  };
  fs.appendFileSync(LEDGER, JSON.stringify({ phase: "record", ...record }) + "\n");
  // A turn with no trace did not run. It must fail its case, never pass it
  // hollowly (the first dry run passed five cases in which nothing ran).
  if (!trace) throw new Error(`the turn produced no trace; it ended: ${record.terminal.join(" | ") || "(no terminal event)"}`);
  // The same turn as data, for the blind side-by-side pairing (git-ignored).
  const cases = path.join(OUT, `${caseName}.json`);
  const earlier = fs.existsSync(cases) ? (JSON.parse(fs.readFileSync(cases, "utf8")) as unknown[]) : [];
  fs.writeFileSync(cases, JSON.stringify([...earlier, {
    message, reply, drafts: fresh.map((variant) => ({ status: variant.status, title: variant.title ?? null, body: variant.body })),
  }], null, 2));
  // Readable output for the operator, git-ignored: the post and the reply.
  fs.appendFileSync(
    path.join(OUT, `${caseName}.md`),
    `## ${caseName}\n\n**Client:** ${message}\n\n**Agent reply:** ${reply || "(no text)"}\n\n` +
      fresh.map((variant) => `**Draft (${variant.status})${variant.title ? `, "${variant.title}"` : ""}:**\n\n${variant.body}\n`).join("\n") +
      "\n---\n\n",
  );
  return { record, fresh, reply };
}

/** The answer a client gives when the agent asks before writing (whose voice,
 *  most often). One follow-up only: a case is capped at two paid turns. */
// Neutral, and adding no fact: "the business's voice" drew a which-brand
// question on real data with two brand names on file (first paid run).
const FOLLOW_UP = "Write it in a neutral voice, not as a named person or brand, using only what you already have. Keep it short.";

async function write(caseName: string, sessionId: string, message: string) {
  const first = await turn(caseName, sessionId, message);
  if (first.fresh.some((variant) => variant.status === "verified")) return first;
  return turn(caseName, sessionId, FOLLOW_UP);
}

async function approveLatest(sessionId: string): Promise<void> {
  const session = await engine(`/v1/chat/sessions/${sessionId}`);
  const latest = ((session.variants as Variant[]) ?? []).filter((variant) => variant.status === "verified").at(-1);
  if (!latest) throw new Error("no verified draft to approve");
  for (const kind of ["select_variant", "finish"]) {
    await engine(`/v1/chat/sessions/${sessionId}/commands`, {
      method: "POST",
      body: JSON.stringify({ kind, variant_id: latest.id, idempotency_key: `eval-${kind}-${crypto.randomUUID()}` }),
    });
  }
  const itemId = ((await engine(`/v1/chat/sessions/${sessionId}`)).session as { content_item_id: string }).content_item_id;
  await engine(`/v1/content-items/${itemId}/approve`, {
    method: "POST",
    body: JSON.stringify({ idempotency_key: `eval-approve-${crypto.randomUUID()}` }),
  });
}

const want = (name: string) => CASES.includes("all") || CASES.includes(name) || (CASES.includes("smoke") && name === "grounded_post");

describe.skipIf(!EVAL || seed === null || !OUT)("the paid C4 evaluation", () => {
  fs.mkdirSync(OUT || ".", { recursive: true });
  let postSession = "";

  it.runIf(want("grounded_post"))("grounded_post", { timeout: 300_000 }, async () => {
    postSession = await newSession();
    const { record } = await write("grounded_post", postSession,
      "Write a LinkedIn post about what we offer and who it is for. Keep it grounded in what you know about us.");
    if (C4) expect(record.direct_schedule).toBe(false);
  });

  it.runIf(want("revise"))("revise", { timeout: 300_000 }, async () => {
    if (!postSession) postSession = await newSession();
    const { record } = await turn("revise", postSession, "Make it shorter and more personal, and keep every fact accurate.");
    if (C4) expect(record.direct_schedule).toBe(false);
  });

  it.runIf(want("missing_material"))("missing_material", { timeout: 300_000 }, async () => {
    const session = await newSession();
    const { record } = await turn("missing_material", session,
      "Write a post announcing our 2031 revenue figure and the opening of our Tokyo office.");
    if (C4) expect(record.direct_schedule).toBe(false);
  });

  it.runIf(want("schedule_proposal"))("schedule_proposal", { timeout: 600_000 }, async () => {
    const session = await newSession();
    await write("schedule_proposal", session, "Write a short LinkedIn post about what we offer.");
    await approveLatest(session);
    const { record } = await turn("schedule_proposal", session, "Great. Schedule it for next Friday at 9am.");
    const proposals = (await fetch(`${ENGINE}/v1/chat/sessions/${session}/schedule-proposals`, {
      headers: { "X-API-Key": seed!.service_key, "X-Onboarding-Token": currentToken },
    }).then((r) => r.json())) as { kind: string; status: string }[];
    fs.appendFileSync(LEDGER, JSON.stringify({ dataset: LABEL, case: "schedule_proposal:cards",
      cards: proposals.map((p) => `${p.kind}:${p.status}`), cost_microdollars: 0 }) + "\n");
    if (C4) expect(record.direct_schedule).toBe(false);
  });

  it.runIf(want("post_now"))("post_now", { timeout: 600_000 }, async () => {
    const session = await newSession();
    await write("post_now", session, "Write a short LinkedIn post about what we offer.");
    await approveLatest(session);
    const { record } = await turn("post_now", session, "Post it now.");
    if (C4) expect(record.direct_schedule).toBe(false);
  });

  it.runIf(want("instagram"))("instagram", { timeout: 300_000 }, async () => {
    const session = await newSession("instagram");
    const { record } = await write("instagram", session, "Write an Instagram caption about what we offer.");
    if (C4) expect(record.direct_schedule).toBe(false);
  });

  it.runIf(want("long_conversation"))("long_conversation", { timeout: 600_000 }, async () => {
    const session = await newSession();
    // Padding recorded through the real client-turn route, no model call:
    // enough earlier conversation to cross the 30k-token cap.
    const filler = "Here is some background on our week, for context only. ".repeat(60);
    for (let index = 0; index < 40; index++) {
      await engine(`/v1/chat/sessions/${session}/messages`, {
        method: "POST",
        body: JSON.stringify({ message: `${index}: ${filler}`, idempotency_key: `eval-pad-${crypto.randomUUID()}` }),
      });
    }
    const { record } = await write("long_conversation", session, "Now write a short LinkedIn post about what we offer.");
    if (C4) expect(record.direct_schedule).toBe(false);
  });
});

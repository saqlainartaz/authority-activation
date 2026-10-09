import fs from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * THE DEMONSTRATION: a real service, the real runtime, and no provider.
 *
 * Every other test in this cycle drives one runtime from itself. This one
 * drives the TypeScript agent route against a real Python service on the
 * disposable database — which is the only arrangement that can observe what a
 * model would actually be handed, and therefore the only one that could have
 * caught this cycle's worst defects: a runtime that never asked for
 * `context.v2`, a message handle nobody rendered, a projection nobody applied.
 * All three were invisible to ~600 green tests and two adversarial reviews.
 *
 * **No provider is called.** `AUTHORITY_AGENT_DRIVER=deterministic` selects a
 * driver that chooses tool calls off the tool list it was given, the way a
 * model does. Everything underneath — the route, the loop, the executor, the
 * tools, the HTTP calls, the database — is the shipping implementation.
 *
 * **What is mocked, and why that is not cheating.** One thing:
 * `requireClientToken`, which reads a cookie jar Next supplies and vitest does
 * not. The token it returns is the REAL token the seeded tenant was issued.
 * Nothing downstream is stubbed; every call is real HTTP to the service.
 *
 * Run `scripts/ke_c4_demo.py` in the backend worktree first. Without it the
 * seed file is absent and this file skips rather than passing vacuously — a
 * demonstration that quietly passed when its service was down would be worse
 * than no demonstration.
 */

const SEED_PATH = path.join(
  "C:",
  "Users",
  "saqla",
  "AppData",
  "Local",
  "Temp",
  "engineering-c4-retrieval-20260920",
  "local",
  "c4-demo-seed.json",
);

type Seed = {
  client_id: string;
  session_id: string;
  knowledge_id: string;
  token: string;
  service_key: string;
  client_turn: string;
  client_fact: string;
  message_handle: string;
  withdrawn: boolean;
};

/** Where the turn's own output lands, for a human and for the record. */
const TRANSCRIPT_PATH = path.join(path.dirname(SEED_PATH), "c4-demo-transcript.txt");

/**
 * Where the keyless driver writes what the MODEL was handed, one JSON line per
 * pass. Both independent reviews found that this file's strongest-sounding
 * assertions read something adjacent to the claim: the SSE stream (activity
 * labels, not tool results) and the seed file (a field this harness wrote).
 * The driver sits where a provider would, so its `request.messages` are the
 * prompt, and these are the assertions that can actually fail.
 */
const PROMPT_PATH = path.join(path.dirname(SEED_PATH), "c4-demo-prompt.jsonl");

const seedPresent = fs.existsSync(SEED_PATH);
const seed: Seed | null = seedPresent
  ? (JSON.parse(fs.readFileSync(SEED_PATH, "utf8")) as Seed)
  : null;

process.env.ENGINE_URL = "http://127.0.0.1:8099";
process.env.ENGINE_SERVICE_KEY = seed?.service_key ?? "";
process.env.AGENT_CONTRACT = "c4";
process.env.AUTHORITY_AGENT_DRIVER = "deterministic";
process.env.AUTHORITY_DETERMINISTIC_RECORD = PROMPT_PATH;
if (fs.existsSync(PROMPT_PATH)) fs.rmSync(PROMPT_PATH);

vi.mock("@/lib/client-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client-session")>();
  return {
    ...actual,
    // The REAL token, delivered without a cookie jar. Next supplies one and
    // vitest does not; the credential itself is the one the service issued.
    requireClientToken: async () =>
      JSON.parse(fs.readFileSync(SEED_PATH, "utf8")).token as string,
  };
});

/** Drive one turn and return everything the stream emitted. */
async function runTurn(sessionId: string, message: string): Promise<string> {
  const { POST } = await import(
    "@/app/api/client/chat/sessions/[sessionId]/agent/route"
  );
  const response = await POST(
    new Request("http://localhost/api/client/chat/sessions/x/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message,
        turnId: crypto.randomUUID(),
      }),
    }),
    { params: Promise.resolve({ sessionId }) },
  );
  return await response.text();
}

/** Ask the real service what it holds for this session. */
async function sessionBody(): Promise<Record<string, unknown>> {
  const response = await fetch(
    `http://127.0.0.1:8099/v1/chat/sessions/${seed!.session_id}`,
    {
      headers: {
        "X-API-Key": seed!.service_key,
        "X-Onboarding-Token": seed!.token,
      },
    },
  );
  if (!response.ok) throw new Error(`the demo service answered ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

describe.skipIf(!seedPresent)("the C4 demonstration", () => {
  let transcript = "";
  /** How many variants the session held BEFORE this turn ran.
   *
   *  **Because "stored a variant" was passing on a turn that stored nothing.**
   *  It asserted `variants.length > 0` and read `variants[variants.length-1]`,
   *  which on a second run against the same session is the FIRST run's
   *  variant. A withdrawal run — where the fence correctly refuses and stores
   *  nothing — was green on both. Found by running exactly that, which is the
   *  reason to run the demonstration twice rather than reason about it. */
  let variantsBefore = 0;

  beforeAll(async () => {
    variantsBefore = ((await sessionBody()).variants as unknown[]).length;
    transcript = await runTurn(seed!.session_id, seed!.client_turn);
    // WRITTEN, not only logged, and the difference cost a run. vitest's
    // reporter drops console output in a non-tty invocation, so the
    // withdrawal run happened and left no record of what it did — which made
    // an observation about the fence unshowable rather than merely
    // unconvincing.
    fs.writeFileSync(TRANSCRIPT_PATH, transcript, "utf8");
    // eslint-disable-next-line no-console
    console.log("=== TURN TRANSCRIPT ===\n" + transcript);
  }, 60_000);

  /** What the server kept. The SSE stream carries activity labels and message
   *  deltas, not tool payloads, so what the model was handed and what the
   *  server stored are read from the service itself, not from the stream. */
  const session = sessionBody;

  it("ran a turn to completion, with no swallowed failure", () => {
    // Necessary and NOT sufficient, which is how the review found it being
    // used. This was green on the withdrawal run — where the fence correctly
    // stored nothing — so it says the runtime did not crash and says nothing
    // at all about the chain. The storage claims are the tests below, and on
    // a withdrawn seed they are expected to be the ones that fail.
    expect(transcript.length).toBeGreaterThan(0);
    expect(transcript).not.toContain("Something went wrong while writing this");
    expect(transcript).not.toContain('"outcome":"refused"');
    expect(transcript).toContain('"type":"turn.end"');
  });

  it("is running against a seed that was NOT withdrawn", () => {
    // The guard that stops the storage assertions below being read as the
    // withdrawal run's result. `ke_c4_demo.py --withdrawn` seeds the other
    // case, and `ke_c4_demo_verify.py --expect-no-new-variant` is what checks
    // it — a different assertion, deliberately, because "stored nothing" and
    // "stored the right thing" cannot share a test.
    expect(seed!.withdrawn).toBe(false);
  });

  /** Every pass the model was given, in order, as the driver received it. */
  function passes(): {
    tools: string[];
    messages: {
      role: string;
      content: string;
      toolCalls?: { name: string; input: unknown }[];
      toolResults?: { name: string; content: string }[];
    }[];
  }[] {
    return fs
      .readFileSync(PROMPT_PATH, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  }

  /** The prompt with the tool-result envelope's escaping undone, which is
   *  what `decodedToolResult` in the driver does before reading a payload. */
  function decodedPrompt(): string {
    return prompt().replaceAll("&lt;", "<").replaceAll("&amp;", "&");
  }

  /** Everything the model was shown across the turn, concatenated.
   *
   *  Tool results included: they travel as native parts now, not inside
   *  `content`, and a prompt read from `content` alone would silently omit
   *  every guideline, source and handle the tools returned. */
  function prompt(): string {
    return passes()
      .flatMap((pass) =>
        pass.messages.flatMap((entry) => [
          entry.content,
          // The model's own calls, which it now sees as its own tool calls.
          ...(entry.toolCalls ?? []).map((call) => `${call.name} ${JSON.stringify(call.input)}`),
          // Each result under the tool that produced it, as the provider pairs them.
          ...(entry.toolResults ?? []).map((result) => `${result.name} ${result.content}`),
        ]),
      )
      .join("\n");
  }

  it("showed the model the client's own turn, WITH its handle", () => {
    // Asserted against the prompt the driver received, not against the seed
    // file this harness wrote. Nothing rendered a handle before this cycle's
    // fix, so `use_task_material` could not be driven at all.
    const rendered = prompt().match(/<client-message\s+handle="(U\d+)"[^>]*>/);
    expect(rendered).not.toBeNull();
    expect(rendered![1]).toBe(seed!.message_handle);
  });

  it("showed the model a <guideline> block", () => {
    // P6's perspective work. It existed in Python and in unit tests for two
    // tasks while no model could reach it, because nothing asked for
    // `context.v2`, nothing rendered the block into a tool result, and the
    // keyless driver never called `prepare_generation` before writing at all.
    //
    // Read through the envelope's escaping, not around it. A tool result is
    // embedded as `&lt;guideline` so a payload cannot forge a tag boundary in
    // the message that carries it — the same rule `transcript.ts` applies to a
    // client body. Asserting on the raw bytes would be asserting on the
    // envelope; this decodes it exactly as the driver does before reading.
    // The payload is JSON inside that message, so its own quotes arrive
    // backslash-escaped. Matched permissively on the quoting and strictly on
    // everything that carries meaning.
    expect(decodedPrompt()).toMatch(/<guideline revision=\\?"\d+\\?" precedence=\\?"saved_default\\?">/);
    expect(decodedPrompt()).toContain("Say members, not clients.");
    // §5: the guideline's TEXT reaches the model and its digest does not.
    expect(decodedPrompt()).not.toMatch(/[0-9a-f]{64}/);
  });

  it("issued a read handle, and the model cited the handle it was issued", () => {
    // The chain, from the prompt side: the read's own tool result carried a
    // handle, and a later pass names that exact handle. A handle the model
    // invented, or one this test supplied, fails here.
    const text = prompt();
    const issued = text.match(/read_knowledge[\s\S]*?\[([KECSA]\d+)\]/);
    expect(issued).not.toBeNull();
    expect(text.split(issued![1]).length).toBeGreaterThan(2);
  });

  it("bound the client's words under a task-assertion handle", () => {
    // `use_task_material` was called naming the message handle the model had
    // actually been shown, and the server answered with an assertion handle.
    const text = prompt();
    expect(text).toMatch(/use_task_material/);
    expect(text).toMatch(/TA\d+/);
  });

  it("let no identifier reach the MODEL", () => {
    // The model-safe projection, asserted where it matters. The sibling test
    // below used to stand in for this one by scanning the SSE stream, which
    // carries activity labels rather than tool results — so removing the
    // projection entirely left it green. Both reviews said so.
    const uuids =
      prompt().match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      ) ?? [];
    expect(uuids).toEqual([]);
  });

  it("stored a variant IN THIS TURN", async () => {
    const body = await session();
    const variants = body.variants as unknown[];
    expect(variants.length).toBe(variantsBefore + 1);
  });

  it("wrote from BOTH the read and the client's own words", async () => {
    // The strongest single assertion in this file. The first sentence came
    // out of C3 through `read_knowledge`; the second is what the client said
    // in this conversation, bound to this piece by `use_task_material`. One
    // stored, verified variant resting on both is the whole chain.
    const body = await session();
    const variants = body.variants as { status: string; body: string }[];
    // THE VARIANT THIS TURN STORED, by position after the count taken before
    // it ran -- not `variants[variants.length - 1]`, which on a second run
    // against the same session is the previous run's variant. That read made
    // this, the strongest assertion in the file, pass on a withdrawal run
    // that stored nothing. Same flaw as "stored a variant", in the next test
    // down, found by running the withdrawal case again.
    const latest = variants[variantsBefore];
    expect(latest, "this turn stored no variant").toBeDefined();

    expect(latest.status).toBe("verified");
    expect(latest.body).toContain("Membership costs 49.00 USD per month");
    expect(latest.body).toContain(seed!.client_fact);
  });

  it("let no identifier reach the CLIENT either", () => {
    // The stream is what a client sees. Kept ALONGSIDE the prompt scan above
    // rather than instead of it: they are two different surfaces, and it was
    // treating this one as though it covered both that made the original
    // assertion unfailable.
    const uuids =
      transcript.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      ) ?? [];
    expect(uuids).toEqual([]);
  });
});

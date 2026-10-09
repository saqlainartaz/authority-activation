import "server-only";

import fs from "node:fs";

import type { Driver, DriverRequest, TurnResult } from "@/agent/lib/driver";

/**
 * Record what the model was ACTUALLY handed, for the demonstration.
 *
 * **Why this exists, and why nothing weaker would do.** Both independent
 * reviews found that the demonstration's strongest-sounding assertions could
 * not fail. "No identifier reaches the model" scanned the SSE stream — which
 * carries activity labels and message deltas, not tool results — so deleting
 * the model-safe projection left it green. "Showed the model the handle"
 * asserted a field the seed script had written moments earlier. Both were
 * reading something adjacent to the claim instead of the claim.
 *
 * This driver sits exactly where a provider would, so `request.messages` and
 * `request.tools` ARE the prompt. Writing them down is the only way a test can
 * assert on what a model received rather than on what the runtime meant to
 * send. Off unless `AUTHORITY_DETERMINISTIC_RECORD` names a path, appended to
 * on every pass, and reachable only under a driver that never calls a
 * provider.
 */
function recordPass(request: DriverRequest): void {
  const target = process.env.AUTHORITY_DETERMINISTIC_RECORD;
  if (!target) return;
  try {
    fs.appendFileSync(
      target,
      JSON.stringify({
        tools: request.tools.map((tool) => tool.name),
        // Tool calls and results too: since they travel as native parts
        // rather than as text, a record of `content` alone would omit
        // everything the model was shown by a tool.
        messages: request.messages.map((entry) => ({
          role: entry.role,
          content: entry.content,
          ...(entry.toolCalls ? { toolCalls: entry.toolCalls } : {}),
          ...(entry.toolResults ? { toolResults: entry.toolResults } : {}),
        })),
      }) + "\n",
      "utf8",
    );
  } catch {
    // A recorder that could fail a turn would be a recorder that changes what
    // it observes. It is diagnostic; the turn is the subject.
  }
}

const USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

function result(overrides: Partial<TurnResult>): TurnResult {
  return { text: "", toolCalls: [], stopReason: "end_turn", usage: USAGE, ...overrides };
}

async function validationPause(): Promise<void> {
  const configured = Number(process.env.AUTHORITY_DETERMINISTIC_DELAY_MS ?? 0);
  const delay = Number.isFinite(configured) ? Math.max(0, Math.min(configured, 2000)) : 0;
  if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
}

function decodedToolResult(request: DriverRequest, tool: string): Record<string, unknown> | null {
  // The newest NATIVE result for this tool. It used to be parsed out of a
  // `<tool-result tool="...">` text wrapper, which no longer exists.
  const part = [...request.messages]
    .reverse()
    .flatMap((entry) => [...(entry.toolResults ?? [])].reverse())
    .find((candidate) => candidate.name === tool);
  if (!part) return null;
  const json = part.content.replaceAll("&lt;", "<").replaceAll("&amp;", "&");
  try { return JSON.parse(json) as Record<string, unknown>; } catch { return null; }
}

function decodeBody(value: string): string {
  return value.replaceAll("&lt;", "<").replaceAll("&amp;", "&");
}

function latestClientMessage(request: DriverRequest): string {
  // **Matches the tag WITH OR WITHOUT attributes**, and the difference is not
  // cosmetic. C4 added `handle="U5"` to `<client-message>`, and this helper
  // tested for the bare `"<client-message>"` string: every c4 turn silently
  // fell back to the placeholder below, so the driver asked the engine to
  // write about "Create a grounded LinkedIn post from the supplied context"
  // instead of about what the client said. The demonstration is what caught
  // it; nothing else could have, because every other test builds the message
  // list by hand.
  const opening = /<client-message(?:\s[^>]*)?>/;
  const message = [...request.messages].reverse().find((entry) => opening.test(entry.content));
  if (!message) return "Create a grounded LinkedIn post from the supplied context.";
  const match = message.content.match(/<client-message(?:\s[^>]*)?>([\s\S]*?)<\/client-message>/);
  return match ? decodeBody(match[1]).trim() : "Create a grounded LinkedIn post from the supplied context.";
}

function platformStyle(request: DriverRequest): { lead: string; label: string } {
  const system = request.system.map(block => block.text).join("\n");
  if (system.includes("# Instagram caption")) return { lead: "One detail worth pausing on.", label: "Instagram" };
  if (system.includes("# X post")) return { lead: "One useful detail:", label: "X" };
  if (system.includes("# Facebook post")) return { lead: "Here is a detail from behind the work.", label: "Facebook" };
  return { lead: "A useful detail from your source:", label: "LinkedIn" };
}

function clientProfile(request: DriverRequest): Record<string, string> | null {
  const message = [...request.messages].reverse().find((entry) => entry.content.includes('<client-profile '));
  if (!message) return null;
  const match = message.content.match(/<client-profile[^>]*>([\s\S]*?)<\/client-profile>/);
  if (!match) return null;
  try {
    const value = JSON.parse(decodeBody(match[1])) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch {
    return null;
  }
}

function identityAnswer(request: DriverRequest): string | null {
  if (!/\bwho am i\b/i.test(latestClientMessage(request))) return null;
  const profile = clientProfile(request);
  if (!profile?.display_name) return null;
  const identity = profile.profession
    ? `You’re ${profile.display_name}, ${profile.profession}.`
    : `You’re ${profile.display_name}.`;
  return profile.business_overview ? `${identity} ${profile.business_overview}` : identity;
}

function isClarificationReply(request: DriverRequest): boolean {
  return request.messages.some((entry) => entry.content.includes("<server-question>"));
}

function firstMaterial(request: DriverRequest): { handle: string; text: string } {
  const prepared = decodedToolResult(request, "prepare_generation");
  const material = typeof prepared?.material === "string" ? prepared.material : "";
  const match = material.match(/\[(M\d+)] <material[^>]*>\n([\s\S]*?)\n<\/material>/);
  if (!match || match[2].trim().length < 8) {
    throw new Error("The deterministic validation driver received no citable material.");
  }
  return { handle: match[1], text: match[2].trim() };
}


/**
 * The c4 sequence, chosen the way a model would: off the tool list it was
 * given.
 *
 * The driver is handed `read_knowledge` only under the `linkedin-c4`
 * profile, so testing for it is the same decision a model makes when it sees
 * a capability in its tools — not a flag this file reads from the
 * environment. A v1 turn takes none of these branches and is byte-identical
 * to what it always was.
 */
function grantsC4(request: DriverRequest): boolean {
  return request.tools.some((tool) => tool.name === "read_knowledge");
}

/** The handle attribute the server put on the client's own turn. */
function clientMessageHandle(request: DriverRequest): string | null {
  const message = [...request.messages]
    .reverse()
    .find((entry) => /<client-message\s+handle="/.test(entry.content));
  const match = message?.content.match(/<client-message\s+handle="([^"]+)"/);
  return match ? match[1] : null;
}

/** The first knowledge handle a read issued, read out of the rendered block. */
function firstReadHandle(request: DriverRequest): string | null {
  const read = decodedToolResult(request, "read_knowledge");
  const material = typeof read?.material === "string" ? read.material : "";
  const match = material.match(/\[([A-Z]+\d+)]/);
  return match ? match[1] : null;
}

function readText(request: DriverRequest): string {
  const read = decodedToolResult(request, "read_knowledge");
  const material = typeof read?.material === "string" ? read.material : "";
  const match = material.match(/<material[^>]*>([\s\S]*?)<\/material>/);
  return match ? match[1].trim() : "";
}

/** The exact words the client used, as `use_task_material` requires. */
function taskFact(request: DriverRequest): string | null {
  const message = latestClientMessage(request);
  const match = message.match(/By the way, (.+?)\./);
  return match ? match[1] : null;
}

/**
 * The voice preview (Cycle 5, P5.2), chosen off the tool list like the c4
 * sequence: only that operation is handed `propose_voice`.
 *
 * Deterministic and deliberately CARELESS in one respect: on an Adjust it
 * copies every sentence of the client's instruction into the proposed
 * guidance, facts included, and reports no `stated_facts`. A model can do
 * exactly that, so keeping facts out of saved guidance must be the code's job
 * (`voice/facts.ts`), and this driver is how a test shows the code doing it.
 *
 * Two more habits a real model has (P5 milestone review M-8): a new sample
 * cites the knowledge it read with a handle marker (`[K1]`), which code must
 * strip before the client sees it; and a new sample's guidance keeps the
 * saved guidance it was given ("keep what still applies").
 */
function grantsVoice(request: DriverRequest): boolean {
  return request.tools.some((tool) => tool.name === "propose_voice");
}

function voiceRequest(request: DriverRequest): {
  kind: string;
  instruction: string;
  baseSample: string;
  baseGuidance: string;
  savedGuidance: string;
} {
  const message = request.messages.find((entry) => entry.content.includes("<voice-request"));
  const text = message?.content ?? "";
  const pick = (pattern: RegExp) => decodeBody(text.match(pattern)?.[1] ?? "").trim();
  return {
    kind: text.match(/<voice-request kind="([a-z]+)"/)?.[1] ?? "generate",
    instruction: pick(/<client-instruction>([\s\S]*?)<\/client-instruction>/),
    baseSample: pick(/<base-version>\n<sample>\n([\s\S]*?)\n<\/sample>/),
    baseGuidance: pick(/<guidance>\n([\s\S]*?)\n<\/guidance>\n<\/base-version>/),
    savedGuidance: pick(/<saved-guidance>\n([\s\S]*?)\n<\/saved-guidance>/),
  };
}

function voiceProposal(request: DriverRequest): { sample: string; proposed_guidance: string } {
  const voice = voiceRequest(request);
  const known = readText(request).slice(0, 140).trim() || "the work we do for the people we help";
  if (voice.kind === "adjust") {
    const asked = voice.instruction
      .split(/(?<=[.!?])\s+|\n+/)
      .map((sentence) => sentence.trim().replace(/[.!?]+$/, ""))
      .filter(Boolean);
    return {
      sample: `${voice.baseSample}\n\n(Revised: ${voice.instruction})`,
      proposed_guidance: [voice.baseGuidance, ...asked.map((sentence) => `- ${sentence}.`)].filter(Boolean).join("\n"),
    };
  }
  return {
    sample: `A quick note from us this week.\n\n${known} [K1].\n\nWhat would you add? 🙂`,
    proposed_guidance: [
      voice.savedGuidance,
      "- Write in a warm, plain first-person voice.\n- Keep posts under 150 words.\n- One idea per post; end with a question.",
    ].filter(Boolean).join("\n"),
  };
}

/**
 * A keyless, network-free driver for local integration checks only. It uses
 * the real agent loop and real Python tools; only the paid model decision is
 * deterministic. Production remains Anthropic unless the server-only
 * AUTHORITY_AGENT_DRIVER variable is explicitly set to `deterministic`.
 */
export const deterministicDriver: Driver = {
  toProviderTools: (tools) => tools,
  async runTurn(request) {
    recordPass(request);
    await validationPause();

    // --- the voice preview ----------------------------------------------
    if (grantsVoice(request)) {
      if (!decodedToolResult(request, "read_knowledge")) {
        return result({
          stopReason: "tool_use",
          toolCalls: [{
            id: "deterministic-voice-read",
            name: "read_knowledge",
            input: { selector: "orient", purpose: "voice preview" },
          }],
        });
      }
      if (!decodedToolResult(request, "propose_voice")) {
        return result({
          stopReason: "tool_use",
          toolCalls: [{ id: "deterministic-voice-propose", name: "propose_voice", input: voiceProposal(request) }],
        });
      }
      const done = "Here is your preview.";
      request.onText(done);
      return result({ text: done });
    }

    // --- the c4 sequence -------------------------------------------------
    //
    // Read, then bind the client's own words, then write citing both. Each
    // step waits for the previous tool's RESULT, so the order is enforced by
    // what has come back rather than by a counter this file keeps.
    if (grantsC4(request) && !decodedToolResult(request, "submit_draft")) {
      // **PREPARE FIRST, and the order is the point.** A model writing for a
      // client asks what the client's voice and saved guideline are before it
      // writes, not after. This driver used to skip prepare entirely on the
      // c4 path and fall through to it only AFTER the submit had returned —
      // so the `<guideline>`, `<sources>` and perspective that P6 built never
      // reached a model at any point in the turn, and the demonstration could
      // not show the one thing the goal asks it to show first. The
      // demonstration record already noted the trailing prepare as a driver
      // flaw; this is the same flaw seen from the other end.
      if (!decodedToolResult(request, "prepare_generation")) {
        const message = latestClientMessage(request);
        return result({
          stopReason: "tool_use",
          toolCalls: [{
            id: "deterministic-prepare-c4",
            name: "prepare_generation",
            input: {
              message,
              operation: "generate",
              subject: message.slice(0, 120),
              retrieval_query: message.slice(0, 120),
            },
          }],
        });
      }
      if (!decodedToolResult(request, "read_knowledge")) {
        return result({
          stopReason: "tool_use",
          toolCalls: [{
            id: "deterministic-read",
            name: "read_knowledge",
            input: { selector: "exact", purpose: latestClientMessage(request), meaning_id: "offering.price" },
          }],
        });
      }
      const handle = firstReadHandle(request);
      if (!handle) {
        // Nothing citable came back (a withdrawn claim is not shown at all).
        // A model must say so rather than write from nothing; falling through
        // to the v1 path threw instead, and the turn ended as an error.
        const nothing = "I looked, and there is nothing I can cite for that yet, so I have not written a draft.";
        request.onText(nothing);
        return result({ text: nothing });
      }
      const messageHandle = clientMessageHandle(request);
      const fact = taskFact(request);
      if (handle && messageHandle && fact && !decodedToolResult(request, "use_task_material")) {
        return result({
          stopReason: "tool_use",
          toolCalls: [{
            id: "deterministic-task-material",
            name: "use_task_material",
            input: { action: "use_for_task", message: messageHandle, text: fact },
          }],
        });
      }
      const used = decodedToolResult(request, "use_task_material");
      const assertion = typeof used?.assertion === "string" ? used.assertion : null;
      if (handle && assertion) {
        const priced = readText(request).slice(0, 120).trim();
        const body = `${priced}

And ${fact}.`;
        return result({
          stopReason: "tool_use",
          toolCalls: [{
            id: "deterministic-submit-c4",
            name: "submit_draft",
            input: {
              body,
              // Main's Library title is required of every submit (merged into
              // C4 2026-09-25); the driver stands in for a model, so it gives one.
              title: priced.slice(0, 72) || "Pricing",
              cited_atom_ids: [
                { handle, quoted_span: priced, claim_text: priced },
                { handle: assertion, quoted_span: fact ?? "", claim_text: `And ${fact}` },
              ],
              agent_text: "Drafted from your pricing and what you just told me.",
            },
          }],
        });
      }
      // The plain case: a read returned a handle and the client stated no fact
      // to bind. A model drafts from the read and cites it; falling through to
      // the v1 path here threw, so any request but the demonstration's failed
      // (found by the evaluation runner's no-cost dry run, 2026-09-25).
      if (handle && !fact && !decodedToolResult(request, "submit_draft")) {
        const excerpt = readText(request).slice(0, 160).trim();
        return result({
          stopReason: "tool_use",
          toolCalls: [{
            id: "deterministic-submit-c4-read",
            name: "submit_draft",
            input: {
              body: excerpt,
              title: excerpt.slice(0, 72) || "Draft",
              cited_atom_ids: [{ handle, quoted_span: excerpt, claim_text: excerpt }],
              agent_text: "Drafted from what I found in your material.",
            },
          }],
        });
      }
    }

    const prepared = decodedToolResult(request, "prepare_generation");
    if (!prepared) {
      const identity = identityAnswer(request);
      if (identity) {
        request.onText(identity);
        return result({ text: identity });
      }
      const message = latestClientMessage(request);
      return result({
        stopReason: "tool_use",
        toolCalls: [{
          id: "deterministic-prepare",
          name: "prepare_generation",
          input: {
            message,
            operation: isClarificationReply(request) ? "resume" : "generate",
            subject: message,
            retrieval_query: message,
          },
        }],
      });
    }
    if (prepared.status === "answer_needed") {
      const question = prepared.question;
      const prompt = question && typeof question === "object" && typeof (question as { prompt?: unknown }).prompt === "string"
        ? (question as { prompt: string }).prompt
        : `What should this ${platformStyle(request).label} post be about?`;
      request.onText(prompt);
      return result({ text: prompt });
    }
    if (!decodedToolResult(request, "submit_draft")) {
      const material = firstMaterial(request);
      const claim = material.text.slice(0, 160).trim();
      const body = `${platformStyle(request).lead}\n\n${claim}`;
      return result({
        stopReason: "tool_use",
        toolCalls: [{
          id: "deterministic-submit",
          name: "submit_draft",
          input: {
            body,
            title: claim.slice(0, 72),
            cited_atom_ids: [{ handle: material.handle, quoted_span: claim, claim_text: claim }],
            agent_text: "I drafted this from a verified source in your knowledge base.",
          },
        }],
      });
    }
    const closing = "Your grounded draft is ready to review.";
    request.onText("Your grounded draft ");
    request.onText("is ready to review.");
    return result({ text: closing });
  },
};

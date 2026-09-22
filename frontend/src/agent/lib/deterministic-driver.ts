import "server-only";

import type { Driver, DriverRequest, TurnResult } from "@/agent/lib/driver";

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
  const marker = `<tool-result tool="${tool}">`;
  const message = [...request.messages].reverse().find((entry) => entry.content.includes(marker));
  if (!message) return null;
  const start = message.content.indexOf(marker) + marker.length;
  const end = message.content.lastIndexOf("</tool-result>");
  if (end <= start) return null;
  const json = message.content.slice(start, end).replaceAll("&lt;", "<").replaceAll("&amp;", "&");
  try { return JSON.parse(json) as Record<string, unknown>; } catch { return null; }
}

function decodeBody(value: string): string {
  return value.replaceAll("&lt;", "<").replaceAll("&amp;", "&");
}

function latestClientMessage(request: DriverRequest): string {
  const message = [...request.messages].reverse().find((entry) => entry.content.includes("<client-message>"));
  if (!message) return "Create a grounded LinkedIn post from the supplied context.";
  const match = message.content.match(/<client-message>([\s\S]*?)<\/client-message>/);
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
 * A keyless, network-free driver for local integration checks only. It uses
 * the real agent loop and real Python tools; only the paid model decision is
 * deterministic. Production remains Anthropic unless the server-only
 * AUTHORITY_AGENT_DRIVER variable is explicitly set to `deterministic`.
 */
export const deterministicDriver: Driver = {
  toProviderTools: (tools) => tools,
  async runTurn(request) {
    await validationPause();
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

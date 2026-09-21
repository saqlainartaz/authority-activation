import "server-only";

import { getOnboarding, listClientAtoms, type OnboardingPrefill } from "@/lib/product";
import { escapeForBody, type ModelMessage } from "@/agent/transcript";

const TOPIC_SOURCE_TYPES = ["insight", "quote", "objection", "proof_point"] as const;
const DISCOVERY_SOURCE_TYPES = new Set(["objection", "pain_point", "insight", "proof_point", "quote"]);

export type WorkspaceOverview = {
  identity: { display_name: string; profession: string | null };
  knowledge: {
    atom_count: number;
    represented_source_count: number;
    onboarding_confirmed: boolean;
  };
  topic_suggestions: string[];
  discovery_candidates: Array<{ kind: string; text: string }>;
};

/** Account-wide reads are useful for discovery questions, but would add
 * several backend round trips to every ordinary writing turn. Keep the gate
 * deterministic and narrow: it changes only which authenticated read context
 * accompanies the model call, never identity or authorization. */
export function needsWorkspaceOverview(message: string): boolean {
  const text = message.trim().toLowerCase();
  return [
    /\bwho am i\b/,
    /\bwhat (?:do you know|data do you have) about me\b/,
    /\bhow much (?:data|material|knowledge)\b/,
    /\b(?:my|the) (?:data|sources|knowledge|snapshot)\b/,
    /\bmy material\b/,
    /\b(?:give|show|suggest|offer) (?:me )?(?:some )?(?:ideas|options|topics)\b/,
    /\b(?:you choose|choose for me|pick for me|write about anything)\b/,
    /\b(?:best|strongest) (?:post|topic|idea)\b/,
    /\bwhat(?:'s| is) (?:a |the )?question (?:that )?(?:(?:my|the) )?clients? (?:keep|keeps) asking (?:me|us)\b/,
    /\bwhat (?:do|does) (?:my|our) clients? (?:keep )?ask(?:ing)?\b/,
    /\bwrite (?:me )?something[.!?]?$/,
  ].some((pattern) => pattern.test(text));
}

function topicSuggestions(answers: Record<string, unknown>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const key of TOPIC_SOURCE_TYPES) {
    const values = answers[key];
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      if (typeof value !== "string") continue;
      const text = value.trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      result.push(text);
      if (result.length === 3) return result;
    }
  }
  return result;
}

export async function readWorkspaceOverview(
  token: string,
  preloadedOnboarding?: OnboardingPrefill,
): Promise<WorkspaceOverview> {
  // Both routes use the authenticated client's two-part credential. Do not
  // reach through the service-only client to make this overview richer: an
  // agent turn must never gain a path that omits the user's session token.
  const [onboarding, atoms] = await Promise.all([
    preloadedOnboarding ? Promise.resolve(preloadedOnboarding) : getOnboarding(token),
    listClientAtoms(token),
  ]);
  const atomCount = Object.values(atoms.atom_counts).reduce(
    (total, value) => total + (Number.isFinite(value) && value > 0 ? value : 0),
    0,
  );
  return {
    identity: {
      display_name: onboarding.user.display_name,
      profession: onboarding.user.profession,
    },
    knowledge: {
      atom_count: atomCount,
      represented_source_count: new Set(atoms.atoms.map((atom) => atom.document_id)).size,
      onboarding_confirmed: onboarding.confirmed_at !== null,
    },
    topic_suggestions: topicSuggestions(onboarding.answers),
    discovery_candidates: atoms.atoms
      .filter((atom) => atom.status !== "deprecated" && DISCOVERY_SOURCE_TYPES.has(atom.atom_type))
      .map((atom) => ({ kind: atom.atom_type, text: atom.text.trim() }))
      .filter((candidate) => candidate.text.length > 0)
      .slice(0, 6),
  };
}

/** The overview is data in the model transcript, not a system instruction.
 * Escape tag-openers even though the projection is server-shaped because its
 * names and suggestions ultimately originated in client-authored fields. */
export function workspaceOverviewMessage(overview: WorkspaceOverview): ModelMessage {
  return {
    role: "user",
    content: `<workspace-overview trust="server-derived">${escapeForBody(JSON.stringify(overview))}</workspace-overview>`,
  };
}

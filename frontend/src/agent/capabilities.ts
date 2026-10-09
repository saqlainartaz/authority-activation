import "server-only";

import type { CapabilityProfile, ToolName } from "@/agent/profile";

/**
 * What the agent tells a client it can and cannot do, generated from the
 * capability profile.
 *
 * **The gap this closes.** The instructions describe the tools to the MODEL --
 * names, arguments, when to call them -- and nothing described the agent to
 * the CLIENT. Asked "what can you do for me?", the model had to improvise from
 * tool documentation, which is how an assistant ends up offering to publish, or
 * to write for a platform this conversation has no skill for.
 *
 * **Generated, not written once in prose.** The list of what it can do is one
 * sentence per tool the profile actually grants, so a profile without
 * `read_knowledge` never offers to look things up, and a tool added to the
 * registry without a client-facing sentence fails the typecheck here: the
 * record below is keyed by every `ToolName`.
 *
 * No client data, deliberately. The text depends only on the profile, so it is
 * byte-identical for every client on that profile and the system prefix keeps
 * caching across clients (`buildSystemBlocks`).
 */

/** One plain sentence per tool, in the client's terms. Never a tool name. */
const CAN_DO: Record<ToolName, string> = {
  prepare_generation:
    "Write a new post, or revise the draft you have selected, from your own calls, documents and onboarding answers.",
  // NOT "nothing unsupported lands in your drafts": the server checks the
  // claims a draft cites, not every sentence in it, and a promise the product
  // cannot keep is the one thing this section exists to avoid (final outside
  // sign-off).
  submit_draft: "Check the claims each draft cites against your material before it is saved.",
  get_variant_sources: "Show you which of your sources a saved draft draws on.",
  propose_durable_fact:
    "Suggest a fact for your knowledge base. You confirm it; I never save it on my own.",
  schedule: "Put an approved post on your calendar for a date and time.",
  propose_schedule:
    "Suggest a time to publish an approved post; nothing is scheduled until you confirm it on the card.",
  propose_post_now:
    "Offer to publish an approved post right away; nothing goes out until you confirm it on the card.",
  read_knowledge:
    "Look things up in what you have shared with me: your calls, documents and answers.",
  list_recent_content: "Look at what you have posted before, to match your voice.",
  use_task_material: "Use something you tell me in this chat for the piece we are working on.",
};

/** What a client sees the platform called. Unknown platforms are refused. */
const PLATFORM_LABELS: Record<string, string> = {
  linkedin: "LinkedIn",
  // Main's Promo Partner channels (merged into C4 2026-09-25).
  instagram: "Instagram",
  x: "X",
  facebook: "Facebook",
};

function describeCapabilities(profile: CapabilityProfile): string {
  const platform = PLATFORM_LABELS[profile.platform];
  if (platform === undefined) {
    // Refused rather than falling back to the raw key: a client told "I write
    // for linkedin-c4" has been handed an internal name as a product fact.
    throw new Error(`no client-facing name for platform ${profile.platform}`);
  }
  const can = profile.tools.map((tool) => `- ${CAN_DO[tool]}`);
  const cannot = [
    "- Publish or approve anything. Drafts go to your drafts, and a person takes it from there.",
    `- Write for anywhere but ${platform}. This conversation writes ${platform} posts only.`,
    "- Make up facts, figures or stories. If something is not in your material, I will ask you.",
    "- Save anything to your knowledge base without your confirmation.",
  ];
  return [
    "## What you can do for this client",
    "",
    "If the client asks what you can do, what you cannot, or which platforms you cover,",
    "answer from this section in plain language, in your own words. Do not name tools or",
    "internal terms. Offer only what is listed here; if they ask for something that is not,",
    "say you cannot do it in this conversation rather than improvising a way to.",
    "",
    "You can:",
    ...can,
    "",
    "You cannot:",
    ...cannot,
  ].join("\n");
}

/**
 * The instructions text a profile's turns are given.
 *
 * Under `c4` the generated section is appended, and the rule for reading a
 * trimmed conversation. `context.v1` gets the file unchanged: D8 switches
 * prompt, tools and contract together, and every retained v1 session keeps the
 * exact prompt it was written against.
 */
export function instructionsFor(instructions: string, profile: CapabilityProfile): string {
  if (profile.contract !== "c4") return instructions;
  return `${instructions.trimEnd()}\n\n${describeCapabilities(profile)}\n\n${LONG_CONVERSATIONS}\n`;
}

/**
 * What a trimmed conversation means, for the model. Under c4 a long chat is
 * shown with its oldest middle left out (`transcript-bound.ts`); the note that
 * marks the gap is data, so the rule for reading it lives here. Profile-only
 * text, like the section above, so the system prefix still caches.
 */
const LONG_CONVERSATIONS = [
  "## Long conversations",
  "",
  "If a `<server-note>` says earlier messages are not shown to you, they still exist and the",
  "client can still see them; you simply cannot. Never guess what they said. If you need",
  "something from them, ask the client. The selected draft, its citations and the facts the",
  "client confirmed for this piece still reach you through your tools.",
  "",
  "If the client moves on to a different piece of writing in a long conversation, suggest",
  "starting a new conversation for it: a fresh one keeps the work focused.",
].join("\n");

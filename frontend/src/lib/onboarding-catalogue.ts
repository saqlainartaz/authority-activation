import type { AtomType, OnboardingConfirm } from "@/lib/product";
import { ATOM_TYPE_LABELS } from "@/lib/atom-labels";

/**
 * D7B-16's versioned client catalogue. It resolves the live gap labels returned
 * by the console into questions that have a declared, exact write-back target.
 *
 * This is deliberately not a model-generated question system. Generated
 * questions are deferred; their future transport can reuse this target contract
 * and the gap-resolution boundary without changing what a confirmed answer means.
 */
export const CATALOGUE_VERSION = "2026-08-16.1" as const;

/** The seven same-name dynamic list fields in the client onboarding contract. */
export type WriteBackField = Extract<keyof OnboardingConfirm, AtomType>;

type DynamicQuestion = {
  [Field in WriteBackField]: Readonly<{
    atomType: Field;
    writeBackField: Field;
    prompt: string;
    help: string;
  }>;
}[WriteBackField];

/**
 * The three standing-rule questions are separate from the dynamic catalogue.
 * They are always rendered: no gap calculation may accidentally remove the only
 * client path to claims_blacklist and voice_constraint atoms.
 */
export const GUARDRAIL_CATALOGUE = {
  never_claim: {
    writeBackField: "never_say",
    control: "chips",
    step: "Never claim",
  },
  avoid_phrases: {
    writeBackField: "voice_constraints",
    control: "chips",
    step: "Avoid",
  },
  tone: {
    writeBackField: "tone",
    control: "textarea",
    step: "Tone",
  },
} as const satisfies Readonly<
  Record<
    "never_claim" | "avoid_phrases" | "tone",
    Readonly<{
      writeBackField: Exclude<keyof Omit<OnboardingConfirm, "actor" | "audience">, WriteBackField>;
      control: "chips" | "textarea";
      step: string;
    }>
  >
>;

const CATALOGUE_BY_FIELD = {
  tldr: {
    atomType: "tldr",
    writeBackField: "tldr",
    prompt: "How would you describe your business in one sentence?",
    help: "A plain summary is enough.",
  },
  insight: {
    atomType: "insight",
    writeBackField: "insight",
    prompt: "What belief or lesson guides the way you work?",
    help: "Use the words you would use with a client.",
  },
  pain_point: {
    atomType: "pain_point",
    writeBackField: "pain_point",
    prompt: "What problem are your clients or customers trying to solve?",
    help: "Describe the problem before the solution.",
  },
  objection: {
    atomType: "objection",
    writeBackField: "objection",
    prompt: "What doubt do buyers often have before they choose you?",
    help: "One real hesitation is more useful than a polished answer.",
  },
  proof_point: {
    atomType: "proof_point",
    writeBackField: "proof_point",
    prompt: "What result, number, credential or milestone should we know?",
    help: "Keep it specific enough to stand behind.",
  },
  quote: {
    atomType: "quote",
    writeBackField: "quote",
    prompt: "What is a line you say often enough that it sounds like you?",
    help: "Use your own reusable phrasing.",
  },
  terminology: {
    atomType: "terminology",
    writeBackField: "terminology",
    prompt: "What named method, programme, brand or phrase should we use correctly?",
    help: "Include the exact name clients would recognise.",
  },
} as const satisfies Readonly<Record<WriteBackField, DynamicQuestion>>;

/** Exactly one question per same-name dynamic list field, in stable render order. */
export const ONBOARDING_CATALOGUE: readonly DynamicQuestion[] = Object.values(CATALOGUE_BY_FIELD);

/**
 * The console returns reviewed client-facing labels, not raw engine vocabulary.
 * Resolve those labels back through the total label table; constraint types are
 * absent from this catalogue and therefore cannot become dynamic questions.
 */
export function questionsForGaps(missingAtomTypes: readonly string[]): readonly DynamicQuestion[] {
  const missing = new Set(missingAtomTypes);
  return ONBOARDING_CATALOGUE.filter((question) => missing.has(ATOM_TYPE_LABELS[question.atomType]));
}

/** The only content transformation permitted before onboarding request serialisation. */
export function normaliseCrlf(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

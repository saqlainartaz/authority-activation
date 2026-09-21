import { describe, expect, it } from "vitest";

import type {
  OnboardingPrefill,
  OnboardingQuestion,
  OnboardingQuestionResponse,
} from "@/lib/product";
import { businessDnaSections, replaceResponses } from "@/refined/business-dna";

const VERSION = "business-dna/1.0.0";
const definitions = [
  ["business_overview", "About you", "What do you do?", "long", true, []],
  ["audience_context", "Audience", "Who is it for?", "long", true, []],
  ["known_for", "Strongest point", "What are you known for?", "long", true, []],
  ["distinctive_approach", "What makes you different", "What makes you different?", "long", false, []],
  ["content_objective", "Main objective", "What should content do?", "single", true, ["Build recognition and trust.", "Explain what I do more clearly."]],
  ["problem_or_goal", "The problem", "What problem do you solve?", "long", false, []],
  ["recurring_questions", "Common questions", "What do people ask?", "long", false, []],
  ["proof", "Proof", "What proves it?", "long", false, []],
  ["tone", "Writing tone", "How should it sound?", "single", false, ["Clear and direct.", "Warm and conversational."]],
] as const;
const questions: OnboardingQuestion[] = definitions.map(
  ([question_id, review_label, prompt, input_type, required, choices]) => ({
    question_id,
    question_version: VERSION,
    review_label,
    prompt,
    input_type,
    required,
    choices: [...choices],
    max_text_chars: 2_000,
  }),
);

function canonical(questionId: string, answer: string, ordinal: number) {
  const question = questions.find((candidate) => candidate.question_id === questionId)!;
  return {
    question_id: questionId,
    question_version: VERSION,
    question: question.prompt,
    answers: [answer],
    submitted_at: "2026-09-20T10:00:00Z",
    ordinal,
  };
}

function prefill(records: ReturnType<typeof canonical>[] = []): OnboardingPrefill {
  return {
    user: { display_name: "Amina Yusuf", email: "amina@example.test", profession: "Documentary producer" },
    audience_options: [],
    answers: { questionnaire: { version: VERSION, responses: records } },
    confirmed_at: records.length ? "2026-09-20T10:00:00Z" : null,
    guardrail_questions: [],
    questions,
    trust: "untrusted",
  };
}

describe("Business DNA projection", () => {
  it("returns the four approved sections in exact order with read-only identity", () => {
    const sections = businessDnaSections(prefill([
      canonical("business_overview", "We produce founder documentaries.", 0),
      canonical("audience_context", "Established founders.", 1),
      canonical("content_objective", "Build recognition and trust.", 2),
      canonical("known_for", "Finding the human story.", 3),
      canonical("tone", "Warm and conversational.", 4),
    ]));

    expect(sections.map((section) => section.title)).toEqual([
      "Identity",
      "Who it is for",
      "What makes it credible",
      "How it should sound",
    ]);
    expect(sections[0].fields.slice(0, 2)).toEqual([
      expect.objectContaining({ id: "display_name", value: "Amina Yusuf", editable: false }),
      expect.objectContaining({ id: "profession", value: "Documentary producer", editable: false }),
    ]);
    expect(sections[1].fields.find((field) => field.id === "content_objective")?.value).toBe(
      "Build recognition and trust.",
    );
    expect(sections[3].fields[0].value).toBe("Warm and conversational.");
  });

  it("shows empty optional values honestly and never invents an example", () => {
    const sections = businessDnaSections(prefill());
    const optional = sections.flatMap((section) => section.fields).filter((field) => field.required === false);

    expect(optional.length).toBeGreaterThan(0);
    expect(optional.every((field) => field.value === "Not added yet")).toBe(true);
    expect(JSON.stringify(sections)).not.toMatch(/example|score|complete|recommended/i);
  });

  it("refuses missing or malformed catalogue/profile data", () => {
    expect(() => businessDnaSections({ ...prefill(), questions: undefined as never })).toThrow();
    expect(() =>
      businessDnaSections({
        ...prefill(),
        answers: { questionnaire: { version: VERSION, responses: [{ bad: true }] } },
      }),
    ).toThrow();
  });
});

describe("Business DNA response replacement", () => {
  const current: OnboardingQuestionResponse[] = [
    { question_id: "business_overview", question_version: VERSION, selected: [], text: "Summary" },
    { question_id: "audience_context", question_version: VERSION, selected: [], text: "Audience" },
    { question_id: "distinctive_approach", question_version: VERSION, selected: [], text: "Evidence first" },
    { question_id: "tone", question_version: VERSION, selected: ["Clear and direct."], text: "" },
  ];

  it("replaces one section while preserving every other response and version", () => {
    const result = replaceResponses(current, [
      { question_id: "audience_context", question_version: VERSION, selected: [], text: "Documentary audiences" },
    ]);

    expect(result).toEqual([
      current[0],
      { question_id: "audience_context", question_version: VERSION, selected: [], text: "Documentary audiences" },
      current[2],
      current[3],
    ]);
    expect(current[1].text).toBe("Audience");
  });

  it("explicitly clears an optional response without affecting the rest", () => {
    const result = replaceResponses(current, [
      { question_id: "distinctive_approach", question_version: VERSION, selected: [], text: "" },
    ]);

    expect(result.some((response) => response.question_id === "distinctive_approach")).toBe(false);
    expect(result.map((response) => response.question_id)).toEqual([
      "business_overview",
      "audience_context",
      "tone",
    ]);
  });

  it("a cancelled draft leaves the current responses byte-for-byte unchanged", () => {
    const before = structuredClone(current);
    const draft = replaceResponses(current, [
      { question_id: "tone", question_version: VERSION, selected: ["Warm and conversational."], text: "" },
    ]);

    expect(draft).not.toEqual(current);
    expect(current).toEqual(before);
  });
});

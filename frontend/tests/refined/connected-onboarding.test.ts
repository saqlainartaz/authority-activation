import { describe, expect, it } from "vitest";

import type { OnboardingPrefill, OnboardingQuestion } from "@/lib/product";
import {
  connectedPackets,
  responsesFromSetup,
  reviewAnswer,
  setupFromPrefill,
} from "@/refined/connected-onboarding";
import {
  OTHER,
  advancesOnChoice,
  canContinue,
  setupComplete,
  type Setup,
} from "@/refined/setup-packets";

const VERSION = "business-dna/1.0.0";
const ids = [
  "business_overview",
  "audience_context",
  "known_for",
  "distinctive_approach",
  "content_objective",
  "problem_or_goal",
  "recurring_questions",
  "proof",
  "tone",
] as const;
const contentChoices = [
  "Build recognition and trust.",
  "Explain what I do more clearly.",
  "Start conversations with potential customers.",
  "Share useful expertise and ideas.",
  "Support an offer, launch or change.",
  "Stay visible to the people who matter.",
];
const toneChoices = [
  "Clear and direct.",
  "Warm and conversational.",
  "Thoughtful and authoritative.",
  "Bold and energetic.",
  "Calm and measured.",
];

const questions: OnboardingQuestion[] = ids.map((question_id, index) => ({
  question_id,
  question_version: VERSION,
  review_label: `Label ${index + 1}`,
  prompt: `Question ${index + 1}?`,
  input_type: question_id === "content_objective" || question_id === "tone" ? "single" : "long",
  required: ["business_overview", "audience_context", "known_for", "content_objective"].includes(question_id),
  choices: question_id === "content_objective" ? contentChoices : question_id === "tone" ? toneChoices : [],
  max_text_chars: 2_000,
}));

function prefill(answers: Record<string, unknown> = {}): OnboardingPrefill {
  return {
    user: { display_name: "Amina", email: "amina@example.test", profession: "Founder" },
    audience_options: [],
    answers,
    confirmed_at: null,
    guardrail_questions: [],
    questions,
    trust: "untrusted",
  };
}

describe("connected onboarding projection", () => {
  it("creates nine packets in backend order with the exact MCQ choices", () => {
    const packets = connectedPackets(prefill());

    expect(packets.map((packet) => packet.id)).toEqual(ids);
    expect(packets).toHaveLength(9);
    expect(packets[4].options?.map((option) => option.label)).toEqual(contentChoices);
    expect(packets[8].options?.map((option) => option.label)).toEqual(toneChoices);
    expect(packets[4]).toMatchObject({ type: "choice", required: true, questionVersion: VERSION });
    expect(packets[8]).toMatchObject({ type: "choice", required: false, questionVersion: VERSION });
  });

  it("requires required answers, allows a blank optional answer, and rejects an attempted invalid optional", () => {
    const packets = connectedPackets(prefill());
    const setup: Setup = {
      completed: false,
      answers: {
        business_overview: { selected: [], text: "We make expert media." },
        audience_context: { selected: [], text: "Independent experts." },
        known_for: { selected: [], text: "Making complexity clear." },
        content_objective: { selected: [contentChoices[0]], text: "" },
      },
    };

    expect(setupComplete(setup, packets)).toBe(true);
    expect(canContinue(packets[3], undefined)).toBe(true);
    expect(canContinue(packets[8], { selected: [OTHER], text: "" })).toBe(false);
    expect(setupComplete({ ...setup, answers: { ...setup.answers, tone: { selected: [OTHER], text: "" } } }, packets)).toBe(false);
  });

  it("accepts a short document and rejects only text over the published limit", () => {
    const packet = connectedPackets(prefill())[0];

    expect(packet.maxTextChars).toBe(2_000);
    expect(canContinue(packet, { selected: [], text: "x".repeat(2_000) })).toBe(true);
    expect(canContinue(packet, { selected: [], text: "x".repeat(2_001) })).toBe(false);
  });

  it("auto-advances only an ordinary single choice and keeps a custom choice on the card", () => {
    const packet = connectedPackets(prefill())[4];
    expect(advancesOnChoice(packet, contentChoices[0])).toBe(true);
    expect(advancesOnChoice(packet, OTHER)).toBe(false);
  });

  it("shows optional empties as Not added yet and retains real values", () => {
    const packet = connectedPackets(prefill())[3];
    expect(reviewAnswer(packet, undefined)).toBe("Not added yet");
    expect(reviewAnswer(packet, { selected: [], text: "Recorded evidence first." })).toBe(
      "Recorded evidence first.",
    );
  });

  it("restores saved canonical answers without stale text on an ordinary choice", () => {
    const current = prefill({
      questionnaire: {
        version: VERSION,
        responses: [
          {
            question_id: "business_overview",
            question_version: VERSION,
            question: questions[0].prompt,
            answers: ["A saved summary."],
            submitted_at: "2026-09-20T10:00:00Z",
            ordinal: 0,
          },
          {
            question_id: "content_objective",
            question_version: VERSION,
            question: questions[4].prompt,
            answers: [contentChoices[1]],
            submitted_at: "2026-09-20T10:00:00Z",
            ordinal: 1,
          },
        ],
      },
    });

    expect(setupFromPrefill(current).answers).toMatchObject({
      business_overview: { selected: [], text: "A saved summary." },
      content_objective: { selected: [contentChoices[1]], text: "" },
    });
  });

  it("emits answered responses in packet order and omits blank optional packets", () => {
    const packets = connectedPackets(prefill());
    const setup: Setup = {
      completed: false,
      answers: {
        known_for: { selected: [], text: "Clear explanations." },
        business_overview: { selected: [], text: "A business summary." },
        audience_context: { selected: [], text: "Established experts." },
        content_objective: { selected: [contentChoices[0]], text: "" },
        distinctive_approach: { selected: [], text: "" },
        tone: { selected: [OTHER], text: "Quietly confident." },
      },
    };

    expect(responsesFromSetup(packets, setup).map((response) => response.question_id)).toEqual([
      "business_overview",
      "audience_context",
      "known_for",
      "content_objective",
      "tone",
    ]);
    expect(responsesFromSetup(packets, setup).at(-1)).toEqual({
      question_id: "tone",
      question_version: VERSION,
      selected: [OTHER],
      text: "Quietly confident.",
    });
  });
});

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

const VERSION = "business-clarification/1.0.0";
const ids = [
  "work_today",
  "therapy_locations",
  "practice_start_year",
  "retreat_role",
  "retreat_misunderstanding",
  "anything_else",
] as const;
const questions: OnboardingQuestion[] = ids.map((question_id, index) => ({
  question_id,
  question_version: VERSION,
  review_label: `Label ${index + 1}`,
  prompt: `Question ${index + 1}?`,
  input_type: ["therapy_locations", "retreat_role"].includes(question_id)
    ? "multi"
    : ["work_today", "practice_start_year"].includes(question_id) ? "single" : "long",
  required: index < 4,
  choices: ["therapy_locations", "retreat_role"].includes(question_id)
    ? ["Choice A", "Choice B", "None"]
    : ["work_today", "practice_start_year"].includes(question_id) ? ["First", "Second"] : [],
  exclusive_choices: question_id === "therapy_locations" ? ["None"] : [],
  max_text_chars: 2_000,
}));

function prefill(answers: Record<string, unknown> = {}): OnboardingPrefill {
  return {
    user: { display_name: "Amina", email: "amina@example.test", profession: "Founder" },
    audience_options: [],
    answers,
    confirmed_at: null,
    guardrail_questions: [],
    questions: [],
    clarification_questions: questions,
    trust: "untrusted",
  };
}

describe("connected onboarding projection", () => {
  it("creates exactly six packets with the requested question types", () => {
    const packets = connectedPackets(prefill());
    expect(packets.map((packet) => packet.id)).toEqual(ids);
    expect(packets.map((packet) => packet.type)).toEqual([
      "choice", "multi", "choice", "multi", "long", "long",
    ]);
    expect(packets[1].exclusiveChoices).toEqual(["None"]);
  });

  it("keeps multiple selections and a custom answer in one versioned question pair", () => {
    const packet = connectedPackets(prefill())[1];
    expect(advancesOnChoice(packet, "Choice A")).toBe(false);
    const setup: Setup = { completed: false, answers: {
      therapy_locations: { selected: ["Choice A", OTHER], text: "Another location" },
    } };
    expect(reviewAnswer(packet, setup.answers.therapy_locations)).toBe("Choice A · Another location");
    expect(responsesFromSetup([packet], setup)).toEqual([{
      question_id: "therapy_locations",
      question_version: VERSION,
      selected: ["Choice A", OTHER],
      text: "Another location",
    }]);
  });

  it("requires the first four answers and allows the final two to be blank", () => {
    const packets = connectedPackets(prefill());
    const setup: Setup = { completed: false, answers: {
      work_today: { selected: ["First"], text: "" },
      therapy_locations: { selected: ["Choice A"], text: "" },
      practice_start_year: { selected: ["Second"], text: "" },
      retreat_role: { selected: ["Choice B"], text: "" },
    } };
    expect(setupComplete(setup, packets)).toBe(true);
    expect(canContinue(packets[5], undefined)).toBe(true);
    expect(setupComplete({ ...setup, answers: {
      ...setup.answers,
      anything_else: { selected: [], text: "" },
    } }, packets)).toBe(true);
    expect(setupComplete({ ...setup, answers: {
      ...setup.answers,
      anything_else: { selected: [OTHER], text: "" },
    } }, packets)).toBe(false);
  });

  it("enforces the published text limit", () => {
    const packet = connectedPackets(prefill())[5];
    expect(canContinue(packet, { selected: [], text: "x".repeat(2_000) })).toBe(true);
    expect(canContinue(packet, { selected: [], text: "x".repeat(2_001) })).toBe(false);
  });

  it("auto-advances an ordinary single choice but not multi or custom", () => {
    const packets = connectedPackets(prefill());
    expect(advancesOnChoice(packets[0], "First")).toBe(true);
    expect(advancesOnChoice(packets[0], OTHER)).toBe(false);
    expect(advancesOnChoice(packets[1], "Choice A")).toBe(false);
  });

  it("restores the separate clarification envelope without mistaking it for Business DNA", () => {
    const current = prefill({
      questionnaire: { version: "business-dna/1.0.0", responses: [] },
      clarification_questionnaire: { version: VERSION, responses: [{
        question_id: "therapy_locations",
        question_version: VERSION,
        question: questions[1].prompt,
        answers: ["Choice A", "Another location"],
        submitted_at: "2026-09-23T10:00:00Z",
        ordinal: 0,
      }] },
    });
    expect(setupFromPrefill(current).answers.therapy_locations).toEqual({
      selected: ["Choice A", OTHER], text: "Another location",
    });
  });

  it("emits answered pairs in order and omits blank optional packets", () => {
    const packets = connectedPackets(prefill());
    const setup: Setup = { completed: false, answers: {
      work_today: { selected: ["First"], text: "" },
      therapy_locations: { selected: ["Choice A", "Choice B"], text: "" },
      practice_start_year: { selected: ["Second"], text: "" },
      retreat_role: { selected: ["Choice B"], text: "" },
      retreat_misunderstanding: { selected: [], text: "" },
      anything_else: { selected: [], text: "One final detail." },
    } };
    expect(responsesFromSetup(packets, setup).map((response) => response.question_id)).toEqual([
      "work_today", "therapy_locations", "practice_start_year", "retreat_role", "anything_else",
    ]);
  });
});

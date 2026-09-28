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

const VERSION = "business-clarification/2.0.0";
const ids = [
  "sixty_day_hustle_role",
  "mawer_capital",
  "content_focus",
  "istv_voice",
  "usable_figures",
  "istv_turning_point",
] as const;
const questions: OnboardingQuestion[] = ids.map((question_id, index) => ({
  question_id,
  question_version: VERSION,
  review_label: `Label ${index + 1}`,
  prompt: `Question ${index + 1}?`,
  input_type: ["mawer_capital", "istv_voice"].includes(question_id)
    ? "multi"
    : ["sixty_day_hustle_role", "content_focus"].includes(question_id) ? "single" : "long",
  required: index < 4,
  choices: ["mawer_capital", "istv_voice"].includes(question_id)
    ? ["Choice A", "Choice B", "None"]
    : ["sixty_day_hustle_role", "content_focus"].includes(question_id) ? ["First", "Second"] : [],
  exclusive_choices: question_id === "mawer_capital" ? ["None"] : [],
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
      mawer_capital: { selected: ["Choice A", OTHER], text: "Another location" },
    } };
    expect(reviewAnswer(packet, setup.answers.mawer_capital)).toBe("Choice A · Another location");
    expect(responsesFromSetup([packet], setup)).toEqual([{
      question_id: "mawer_capital",
      question_version: VERSION,
      selected: ["Choice A", OTHER],
      text: "Another location",
    }]);
  });

  it("requires the first four answers and allows the final two to be blank", () => {
    const packets = connectedPackets(prefill());
    const setup: Setup = { completed: false, answers: {
      sixty_day_hustle_role: { selected: ["First"], text: "" },
      mawer_capital: { selected: ["Choice A"], text: "" },
      content_focus: { selected: ["Second"], text: "" },
      istv_voice: { selected: ["Choice B"], text: "" },
    } };
    expect(setupComplete(setup, packets)).toBe(true);
    expect(canContinue(packets[5], undefined)).toBe(true);
    expect(setupComplete({ ...setup, answers: {
      ...setup.answers,
      istv_turning_point: { selected: [], text: "" },
    } }, packets)).toBe(true);
    expect(setupComplete({ ...setup, answers: {
      ...setup.answers,
      istv_turning_point: { selected: [OTHER], text: "" },
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
        question_id: "mawer_capital",
        question_version: VERSION,
        question: questions[1].prompt,
        answers: ["Choice A", "Another location"],
        submitted_at: "2026-09-23T10:00:00Z",
        ordinal: 0,
      }] },
    });
    expect(setupFromPrefill(current).answers.mawer_capital).toEqual({
      selected: ["Choice A", OTHER], text: "Another location",
    });
  });

  it("emits answered pairs in order and omits blank optional packets", () => {
    const packets = connectedPackets(prefill());
    const setup: Setup = { completed: false, answers: {
      sixty_day_hustle_role: { selected: ["First"], text: "" },
      mawer_capital: { selected: ["Choice A", "Choice B"], text: "" },
      content_focus: { selected: ["Second"], text: "" },
      istv_voice: { selected: ["Choice B"], text: "" },
      usable_figures: { selected: [], text: "" },
      istv_turning_point: { selected: [], text: "One final detail." },
    } };
    expect(responsesFromSetup(packets, setup).map((response) => response.question_id)).toEqual([
      "sixty_day_hustle_role", "mawer_capital", "content_focus", "istv_voice", "istv_turning_point",
    ]);
  });
});

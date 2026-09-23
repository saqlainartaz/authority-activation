import {
  decodeClarificationQuestions,
  decodeStoredClarifications,
  OTHER_VALUE,
} from "@/lib/onboarding-profile";
import type { OnboardingPrefill, OnboardingQuestionResponse } from "@/lib/product";
import {
  packetAnswer,
  setupComplete,
  type Packet,
  type Setup,
  type SetupAnswer,
} from "./setup-packets";

export function connectedPackets(prefill: OnboardingPrefill): Packet[] {
  return decodeClarificationQuestions(prefill).map((question) => ({
    id: question.question_id,
    type: question.input_type === "single" ? "choice" : question.input_type === "multi" ? "multi" : "long",
    why:
      question.input_type === "single"
        ? "Choose the closest answer."
        : question.required
          ? "Answer in your own words."
          : "Add this if it is useful, or leave it for now.",
    headline: question.prompt,
    topic: question.review_label,
    required: question.required,
    questionVersion: question.question_version,
    maxTextChars: question.max_text_chars,
    exclusiveChoices: question.exclusive_choices,
    options: question.input_type !== "long"
      ? question.choices.map((label) => ({ label }))
      : undefined,
    placeholder: question.input_type === "long" ? "Write naturally. You can refine it later." : undefined,
  }));
}

export function setupFromPrefill(prefill: OnboardingPrefill): Setup {
  const packets = connectedPackets(prefill);
  const answers = Object.fromEntries(
    decodeStoredClarifications(prefill).map((response) => [
      response.question_id,
      { selected: response.selected, text: response.text },
    ]),
  );
  const setup: Setup = { answers, completed: false };
  setup.completed = Boolean(prefill.confirmed_at) && setupComplete(setup, packets);
  return setup;
}

export function responsesFromSetup(
  packets: readonly Packet[],
  setup: Setup,
): OnboardingQuestionResponse[] {
  return packets.flatMap((packet) => {
    const answer = setup.answers[packet.id];
    const normalized = packetAnswer(packet, answer);
    if (!normalized) {
      if (packet.required !== false) throw new Error(`Required answer ${packet.id} is missing.`);
      return [];
    }
    if (!packet.questionVersion) throw new Error(`Packet ${packet.id} has no question version.`);
    const selected = packet.type === "multi" ? [...answer.selected] : packet.options ? answer.selected.slice(0, 1) : [];
    return [{
      question_id: packet.id,
      question_version: packet.questionVersion,
      selected,
      text: selected.includes(OTHER_VALUE) ? answer.text.trim() : packet.options ? "" : answer.text.trim(),
    }];
  });
}

export function reviewAnswer(packet: Packet, answer?: SetupAnswer): string {
  return packetAnswer(packet, answer)?.join(" · ") ?? "Not added yet";
}

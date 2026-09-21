import { decodeQuestions, decodeStoredResponses, OTHER_VALUE } from "@/lib/onboarding-profile";
import type {
  OnboardingPrefill,
  OnboardingQuestion,
  OnboardingQuestionResponse,
} from "@/lib/product";
import type { SetupAnswer } from "./setup-packets";

export type BusinessDnaField = {
  id: string;
  label: string;
  value: string;
  editable: boolean;
  required?: boolean;
  question?: OnboardingQuestion;
  answer?: SetupAnswer;
};

export type BusinessDnaSection = {
  id: "identity" | "audience" | "credibility" | "voice";
  title: string;
  fields: BusinessDnaField[];
};

const sectionQuestions = {
  identity: ["business_overview"],
  audience: ["audience_context", "content_objective", "problem_or_goal"],
  credibility: ["known_for", "distinctive_approach", "recurring_questions", "proof"],
  voice: ["tone"],
} as const;

function responseValue(response?: OnboardingQuestionResponse): string {
  if (!response) return "Not added yet";
  if (response.selected[0] && response.selected[0] !== OTHER_VALUE) return response.selected[0];
  return response.text.trim() || "Not added yet";
}

export function businessDnaSections(prefill: OnboardingPrefill): BusinessDnaSection[] {
  const questions = decodeQuestions(prefill);
  const responses = decodeStoredResponses(prefill);
  const questionsById = new Map(questions.map((question) => [question.question_id, question]));
  const responsesById = new Map(responses.map((response) => [response.question_id, response]));

  const fields = (ids: readonly string[]) => ids.map((id): BusinessDnaField => {
    const question = questionsById.get(id);
    if (!question) throw new Error(`Business DNA question ${id} is missing.`);
    const response = responsesById.get(id);
    return {
      id,
      label: question.review_label,
      value: responseValue(response),
      editable: true,
      required: question.required,
      question,
      answer: response
        ? { selected: [...response.selected], text: response.text }
        : { selected: [], text: "" },
    };
  });

  return [
    {
      id: "identity",
      title: "Identity",
      fields: [
        {
          id: "display_name",
          label: "Name",
          value: prefill.user.display_name.trim() || "Not added yet",
          editable: false,
        },
        {
          id: "profession",
          label: "Profession",
          value: prefill.user.profession?.trim() || "Not added yet",
          editable: false,
        },
        ...fields(sectionQuestions.identity),
      ],
    },
    { id: "audience", title: "Who it is for", fields: fields(sectionQuestions.audience) },
    {
      id: "credibility",
      title: "What makes it credible",
      fields: fields(sectionQuestions.credibility),
    },
    { id: "voice", title: "How it should sound", fields: fields(sectionQuestions.voice) },
  ];
}

function isCleared(response: OnboardingQuestionResponse): boolean {
  return response.selected.length === 0 && response.text.trim() === "";
}

export function replaceResponses(
  current: readonly OnboardingQuestionResponse[],
  edits: readonly OnboardingQuestionResponse[],
): OnboardingQuestionResponse[] {
  const editById = new Map<string, OnboardingQuestionResponse>();
  for (const edit of edits) {
    if (editById.has(edit.question_id)) {
      throw new Error(`Duplicate Business DNA edit for ${edit.question_id}.`);
    }
    editById.set(edit.question_id, {
      ...edit,
      selected: [...edit.selected],
      text: edit.text,
    });
  }

  const seen = new Set<string>();
  const replaced = current.flatMap((response) => {
    if (seen.has(response.question_id)) {
      throw new Error(`Duplicate current response for ${response.question_id}.`);
    }
    seen.add(response.question_id);
    const edit = editById.get(response.question_id);
    if (!edit) return [{ ...response, selected: [...response.selected] }];
    editById.delete(response.question_id);
    if (edit.question_version !== response.question_version) {
      throw new Error(`Business DNA edit for ${response.question_id} changed its version.`);
    }
    return isCleared(edit) ? [] : [edit];
  });

  for (const edit of editById.values()) {
    if (!isCleared(edit)) replaced.push(edit);
  }
  return replaced;
}

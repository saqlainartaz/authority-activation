import type {
  OnboardingConfirm,
  OnboardingPrefill,
  OnboardingQuestion,
  OnboardingQuestionResponse,
  QuestionnaireEnvelope,
} from "@/lib/product";

const MAX_TEXT_CHARS = 300;
export const OTHER_VALUE = "__other__";

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function normalizeText(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (normalized.length > MAX_TEXT_CHARS) {
    throw new Error(`${label} cannot exceed ${MAX_TEXT_CHARS} characters.`);
  }
  return normalized;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const strings: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return [];
    const normalized = normalizeText(item, "Stored onboarding answer");
    if (normalized) strings.push(normalized);
  }
  return strings;
}

function exactKeys(record: Record<string, unknown>, allowed: readonly string[], label: string) {
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`${label} has unknown field(s): ${unknown.join(", ")}.`);
}

export function decodeQuestions(prefill: OnboardingPrefill): OnboardingQuestion[] {
  if (!Array.isArray(prefill.questions)) throw new Error("Onboarding questions are missing.");
  const seen = new Set<string>();
  let catalogueVersion: string | null = null;

  return prefill.questions.map((candidate, index) => {
    const raw = objectValue(candidate, `Question ${index + 1}`);
    exactKeys(
      raw,
      [
        "question_id",
        "question_version",
        "review_label",
        "prompt",
        "input_type",
        "required",
        "choices",
      ],
      `Question ${index + 1}`,
    );
    const questionId = normalizeText(raw.question_id, `Question ${index + 1} id`);
    const version = normalizeText(raw.question_version, `Question ${questionId} version`);
    if (!questionId) throw new Error(`Question ${index + 1} has a blank id.`);
    if (!version) throw new Error(`Question ${questionId} has a blank version.`);
    if (seen.has(questionId)) throw new Error(`Duplicate onboarding question id: ${questionId}.`);
    seen.add(questionId);
    if (catalogueVersion !== null && version !== catalogueVersion) {
      throw new Error(`Question ${questionId} has a different catalogue version.`);
    }
    catalogueVersion = version;

    if (raw.input_type !== "long" && raw.input_type !== "single") {
      throw new Error(`Question ${questionId} has an unknown input type.`);
    }
    if (typeof raw.required !== "boolean") {
      throw new Error(`Question ${questionId} has no required state.`);
    }
    if (!Array.isArray(raw.choices) || !raw.choices.every((choice) => typeof choice === "string")) {
      throw new Error(`Question ${questionId} has malformed choices.`);
    }
    const choices = raw.choices.map((choice) => normalizeText(choice, `Question ${questionId} choice`));
    if (new Set(choices).size !== choices.length || choices.some((choice) => !choice)) {
      throw new Error(`Question ${questionId} has blank or duplicate choices.`);
    }
    if (raw.input_type === "long" && choices.length) {
      throw new Error(`Long-text question ${questionId} cannot publish choices.`);
    }
    if (raw.input_type === "single" && !choices.length) {
      throw new Error(`Single-choice question ${questionId} must publish choices.`);
    }

    return {
      question_id: questionId,
      question_version: version,
      review_label: normalizeText(raw.review_label, `Question ${questionId} review label`),
      prompt: normalizeText(raw.prompt, `Question ${questionId} prompt`),
      input_type: raw.input_type,
      required: raw.required,
      choices,
    };
  });
}

function normalizeResponse(
  value: unknown,
  questionsById: Map<string, OnboardingQuestion>,
): OnboardingQuestionResponse {
  const raw = objectValue(value, "Questionnaire response");
  exactKeys(raw, ["question_id", "question_version", "selected", "text"], "Questionnaire response");
  const questionId = normalizeText(raw.question_id, "Questionnaire response id");
  const version = normalizeText(raw.question_version, `Response ${questionId} version`);
  const question = questionsById.get(questionId);
  if (!question) throw new Error(`Unknown questionnaire response id: ${questionId}.`);
  if (version !== question.question_version) {
    throw new Error(`Response ${questionId} has a stale question version.`);
  }
  if (!Array.isArray(raw.selected)) throw new Error(`Response ${questionId} selected must be a list.`);
  const selected = raw.selected.map((choice) => normalizeText(choice, `Response ${questionId} choice`));
  const text = normalizeText(raw.text, `Response ${questionId} text`);
  if (question.input_type === "long") {
    if (selected.length) throw new Error(`Long-text response ${questionId} cannot select a choice.`);
  } else {
    if (selected.length !== 1) throw new Error(`Response ${questionId} must select exactly one choice.`);
    if (selected[0] !== OTHER_VALUE && !question.choices.includes(selected[0])) {
      throw new Error(`Response ${questionId} selected an unoffered choice.`);
    }
    if (selected[0] === OTHER_VALUE && !text) {
      throw new Error(`Response ${questionId} custom choice requires text.`);
    }
    if (selected[0] !== OTHER_VALUE && text) {
      throw new Error(`Response ${questionId} cannot carry hidden custom text.`);
    }
  }
  return { question_id: questionId, question_version: version, selected, text };
}

function legacyResponse(
  question: OnboardingQuestion | undefined,
  values: string[],
): OnboardingQuestionResponse | null {
  if (!question || values.length !== 1) return null;
  const answer = values[0];
  if (question.input_type === "long") {
    return {
      question_id: question.question_id,
      question_version: question.question_version,
      selected: [],
      text: answer,
    };
  }
  return {
    question_id: question.question_id,
    question_version: question.question_version,
    selected: question.choices.includes(answer) ? [answer] : [OTHER_VALUE],
    text: question.choices.includes(answer) ? "" : answer,
  };
}

export function decodeStoredResponses(prefill: OnboardingPrefill): OnboardingQuestionResponse[] {
  const questions = decodeQuestions(prefill);
  const questionsById = new Map(questions.map((question) => [question.question_id, question]));
  const envelopeValue = prefill.answers.questionnaire;

  if (envelopeValue !== undefined) {
    const envelope = objectValue(envelopeValue, "Stored questionnaire") as Partial<QuestionnaireEnvelope>;
    if (typeof envelope.version !== "string" || !Array.isArray(envelope.responses)) {
      throw new Error("Stored questionnaire is malformed.");
    }
    const seen = new Set<string>();
    return envelope.responses.map((candidate, index) => {
      const record = objectValue(candidate, `Stored questionnaire response ${index + 1}`);
      const questionId = normalizeText(record.question_id, "Stored response id");
      const question = questionsById.get(questionId);
      if (!question) throw new Error(`Stored response names unknown question ${questionId}.`);
      if (seen.has(questionId)) throw new Error(`Stored questionnaire duplicates ${questionId}.`);
      seen.add(questionId);
      if (
        envelope.version !== question.question_version ||
        record.question_version !== question.question_version ||
        record.question !== question.prompt
      ) {
        throw new Error(`Stored response ${questionId} does not match the current catalogue.`);
      }
      const answers = stringList(record.answers);
      if (answers.length !== 1) throw new Error(`Stored response ${questionId} must have one answer.`);
      const answer = answers[0];
      if (question.input_type === "long") {
        return {
          question_id: questionId,
          question_version: question.question_version,
          selected: [],
          text: answer,
        };
      }
      const ordinary = question.choices.includes(answer);
      return {
        question_id: questionId,
        question_version: question.question_version,
        selected: ordinary ? [answer] : [OTHER_VALUE],
        text: ordinary ? "" : answer,
      };
    });
  }

  const legacyMappings: Array<[string, string]> = [
    ["business_overview", "tldr"],
    ["problem_or_goal", "pain_point"],
    ["recurring_questions", "objection"],
    ["proof", "proof_point"],
    ["tone", "tone"],
  ];
  return legacyMappings.flatMap(([questionId, answerKey]) => {
    const response = legacyResponse(questionsById.get(questionId), stringList(prefill.answers[answerKey]));
    return response ? [response] : [];
  });
}

export function buildCompatibleConfirm(
  prefill: OnboardingPrefill,
  responses: OnboardingQuestionResponse[],
): OnboardingConfirm {
  const questions = decodeQuestions(prefill);
  const questionsById = new Map(questions.map((question) => [question.question_id, question]));
  if (!Array.isArray(responses)) throw new Error("responses must be a list.");
  const normalized = responses.map((response) => normalizeResponse(response, questionsById));
  if (new Set(normalized.map((response) => response.question_id)).size !== normalized.length) {
    throw new Error("Questionnaire responses contain a duplicate question id.");
  }

  return {
    audience: stringList(prefill.answers.audience),
    never_say: stringList(prefill.answers.never_claim),
    voice_constraints: stringList(prefill.answers.avoid_phrases),
    tone: stringList(prefill.answers.tone),
    tldr: stringList(prefill.answers.tldr),
    insight: stringList(prefill.answers.insight),
    pain_point: stringList(prefill.answers.pain_point),
    objection: stringList(prefill.answers.objection),
    proof_point: stringList(prefill.answers.proof_point),
    quote: stringList(prefill.answers.quote),
    terminology: stringList(prefill.answers.terminology),
    responses: normalized,
  };
}

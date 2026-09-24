import type {
  OnboardingConfirm,
  OnboardingPrefill,
  OnboardingQuestion,
  OnboardingQuestionResponse,
  QuestionnaireEnvelope,
} from "@/lib/product";

const MAX_ONBOARDING_METADATA_CHARS = 300;
export const OTHER_VALUE = "__other__";
export const BUSINESS_DNA_CATALOGUE_VERSION = "business-dna/1.0.0";
export const CLARIFICATION_CATALOGUE_VERSION = "business-clarification/2.0.0";
export const CLARIFICATION_QUESTION_IDS = [
  "sixty_day_hustle_role",
  "mawer_capital",
  "content_focus",
  "istv_voice",
  "usable_figures",
  "istv_turning_point",
] as const;
export const BUSINESS_DNA_QUESTION_IDS = [
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

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function normalizeText(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (onboardingTextLength(normalized) > MAX_ONBOARDING_METADATA_CHARS) {
    throw new Error(`${label} cannot exceed ${MAX_ONBOARDING_METADATA_CHARS} characters.`);
  }
  return normalized;
}

function normalizeAnswerText(value: unknown, label: string, maxTextChars: number): string {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (onboardingTextLength(normalized) > maxTextChars) {
    throw new Error(`${label} cannot exceed ${maxTextChars} characters.`);
  }
  return normalized;
}

export function onboardingTextLength(value: string): number {
  return Array.from(value.replace(/\r\n?/g, "\n").trim()).length;
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

function decodeCatalogue(
  candidates: unknown,
  expectedVersion: string,
  expectedIds: readonly string[],
): OnboardingQuestion[] {
  if (!Array.isArray(candidates)) throw new Error("Onboarding questions are missing.");
  const seen = new Set<string>();
  let catalogueVersion: string | null = null;

  const questions = candidates.map((candidate, index) => {
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
        "exclusive_choices",
        "max_text_chars",
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

    if (raw.input_type !== "long" && raw.input_type !== "single" && raw.input_type !== "multi") {
      throw new Error(`Question ${questionId} has an unknown input type.`);
    }
    const inputType: OnboardingQuestion["input_type"] = raw.input_type;
    if (typeof raw.required !== "boolean") {
      throw new Error(`Question ${questionId} has no required state.`);
    }
    if (!Array.isArray(raw.choices) || !raw.choices.every((choice) => typeof choice === "string")) {
      throw new Error(`Question ${questionId} has malformed choices.`);
    }
    if (!Number.isSafeInteger(raw.max_text_chars) || Number(raw.max_text_chars) < 1) {
      throw new Error(`Question ${questionId} has an invalid text limit.`);
    }
    const choices = raw.choices.map((choice) => normalizeText(choice, `Question ${questionId} choice`));
    if (new Set(choices).size !== choices.length || choices.some((choice) => !choice)) {
      throw new Error(`Question ${questionId} has blank or duplicate choices.`);
    }
    if (inputType === "long" && choices.length) {
      throw new Error(`Long-text question ${questionId} cannot publish choices.`);
    }
    if ((inputType === "single" || inputType === "multi") && !choices.length) {
      throw new Error(`Choice question ${questionId} must publish choices.`);
    }
    const rawExclusive = raw.exclusive_choices ?? [];
    if (!Array.isArray(rawExclusive) || !rawExclusive.every((choice) => typeof choice === "string")) {
      throw new Error(`Question ${questionId} has malformed exclusive choices.`);
    }
    const exclusiveChoices = rawExclusive.map((choice) => normalizeText(choice, `Question ${questionId} exclusive choice`));
    if (new Set(exclusiveChoices).size !== exclusiveChoices.length || exclusiveChoices.some((choice) => !choices.includes(choice))) {
      throw new Error(`Question ${questionId} has an unoffered exclusive choice.`);
    }

    return {
      question_id: questionId,
      question_version: version,
      review_label: normalizeText(raw.review_label, `Question ${questionId} review label`),
      prompt: normalizeText(raw.prompt, `Question ${questionId} prompt`),
      input_type: inputType,
      required: raw.required,
      choices,
      ...(raw.exclusive_choices !== undefined ? { exclusive_choices: exclusiveChoices } : {}),
      max_text_chars: Number(raw.max_text_chars),
    };
  });

  if (catalogueVersion !== expectedVersion) {
    throw new Error(`Unsupported onboarding catalogue version: ${catalogueVersion ?? "missing"}.`);
  }
  const publishedIds = questions.map((question) => question.question_id);
  if (
    publishedIds.length !== expectedIds.length ||
    publishedIds.some((questionId, index) => questionId !== expectedIds[index])
  ) {
    throw new Error("Onboarding catalogue question ids or order are unsupported.");
  }
  return questions;
}

export function decodeQuestions(prefill: OnboardingPrefill): OnboardingQuestion[] {
  return decodeCatalogue(prefill.questions, BUSINESS_DNA_CATALOGUE_VERSION, BUSINESS_DNA_QUESTION_IDS);
}

export function decodeClarificationQuestions(prefill: OnboardingPrefill): OnboardingQuestion[] {
  return decodeCatalogue(prefill.clarification_questions, CLARIFICATION_CATALOGUE_VERSION, CLARIFICATION_QUESTION_IDS);
}

function normalizeResponse(
  value: unknown,
  questionsById: Map<string, OnboardingQuestion>,
  allowOptionalClear = false,
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
  const text = normalizeAnswerText(raw.text, `Response ${questionId} text`, question.max_text_chars);
  if (question.input_type === "long") {
    if (selected.length) throw new Error(`Long-text response ${questionId} cannot select a choice.`);
    if (question.required && !text && !allowOptionalClear) throw new Error(`Response ${questionId} cannot be blank.`);
  } else if (question.input_type === "single") {
    if (allowOptionalClear && selected.length === 0 && !text) {
      return { question_id: questionId, question_version: version, selected: [], text: "" };
    }
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
  } else {
    if (allowOptionalClear && selected.length === 0 && !text) {
      return { question_id: questionId, question_version: version, selected: [], text: "" };
    }
    if (!selected.length || selected.length > 10 || new Set(selected).size !== selected.length) {
      throw new Error(`Response ${questionId} must select one or more distinct choices.`);
    }
    if (selected.length > 1 && selected.some((choice) => question.exclusive_choices?.includes(choice))) {
      throw new Error(`Response ${questionId} combines an exclusive choice with another answer.`);
    }
    if (selected.some((choice) => choice !== OTHER_VALUE && !question.choices.includes(choice))) {
      throw new Error(`Response ${questionId} selected an unoffered choice.`);
    }
    if (selected.includes(OTHER_VALUE) !== Boolean(text)) {
      throw new Error(`Response ${questionId} has an invalid custom answer.`);
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

function decodeStoredCatalogueResponses(
  prefill: OnboardingPrefill,
  kind: "dna" | "clarification",
): OnboardingQuestionResponse[] {
  const questions = kind === "dna" ? decodeQuestions(prefill) : decodeClarificationQuestions(prefill);
  const questionsById = new Map(questions.map((question) => [question.question_id, question]));
  const envelopeValue = prefill.answers[kind === "dna" ? "questionnaire" : "clarification_questionnaire"];

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
      if (!Array.isArray(record.answers)) {
        throw new Error(`Stored response ${questionId} answers must be a list.`);
      }
      const answers = record.answers.map((answer) =>
        normalizeAnswerText(answer, `Stored response ${questionId} answer`, question.max_text_chars)
      );
      if (!answers.length) throw new Error(`Stored response ${questionId} must have an answer.`);
      const answer = answers[0];
      if (question.input_type === "long") {
        if (answers.length !== 1) throw new Error(`Stored response ${questionId} must have one answer.`);
        return {
          question_id: questionId,
          question_version: question.question_version,
          selected: [],
          text: answer,
        };
      }
      if (question.input_type === "multi") {
        const ordinary = answers.filter((value) => question.choices.includes(value));
        const custom = answers.filter((value) => !question.choices.includes(value));
        if (custom.length > 1 || new Set(ordinary).size !== ordinary.length) {
          throw new Error(`Stored response ${questionId} has invalid multiple choices.`);
        }
        return {
          question_id: questionId,
          question_version: question.question_version,
          selected: [...ordinary, ...(custom.length ? [OTHER_VALUE] : [])],
          text: custom[0] ?? "",
        };
      }
      if (answers.length !== 1) throw new Error(`Stored response ${questionId} must have one answer.`);
      const ordinary = question.choices.includes(answer);
      return {
        question_id: questionId,
        question_version: question.question_version,
        selected: ordinary ? [answer] : [OTHER_VALUE],
        text: ordinary ? "" : answer,
      };
    });
  }

  if (kind === "clarification") return [];
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

export function decodeStoredResponses(prefill: OnboardingPrefill): OnboardingQuestionResponse[] {
  return decodeStoredCatalogueResponses(prefill, "dna");
}

export function decodeStoredClarifications(prefill: OnboardingPrefill): OnboardingQuestionResponse[] {
  return decodeStoredCatalogueResponses(prefill, "clarification");
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

export function buildClarificationConfirm(
  prefill: OnboardingPrefill,
  responses: OnboardingQuestionResponse[],
): Pick<OnboardingConfirm, "clarifications"> {
  const questions = decodeClarificationQuestions(prefill);
  const questionsById = new Map(questions.map((question) => [question.question_id, question]));
  if (!Array.isArray(responses)) throw new Error("clarifications must be a list.");
  const normalized = responses.map((response) => normalizeResponse(response, questionsById));
  const submitted = new Set(normalized.map((response) => response.question_id));
  if (submitted.size !== normalized.length) throw new Error("Clarifications contain a duplicate question id.");
  const missing = questions.filter((question) => question.required && !submitted.has(question.question_id));
  if (missing.length) throw new Error(`Required clarification missing: ${missing.map((question) => question.question_id).join(", ")}.`);
  return { clarifications: normalized };
}

function clearedResponse(response: OnboardingQuestionResponse): boolean {
  return response.selected.length === 0 && response.text === "";
}

export function mergeOnboardingResponses(
  prefill: OnboardingPrefill,
  edits: OnboardingQuestionResponse[],
): OnboardingQuestionResponse[] {
  const questions = decodeQuestions(prefill);
  const questionsById = new Map(questions.map((question) => [question.question_id, question]));
  if (!Array.isArray(edits)) throw new Error("responses must be a list.");
  const normalizedEdits = edits.map((edit) => normalizeResponse(edit, questionsById, true));
  if (new Set(normalizedEdits.map((edit) => edit.question_id)).size !== normalizedEdits.length) {
    throw new Error("Questionnaire responses contain a duplicate question id.");
  }

  const pending = new Map(normalizedEdits.map((edit) => [edit.question_id, edit]));
  const merged = decodeStoredResponses(prefill).flatMap((current) => {
    const edit = pending.get(current.question_id);
    if (!edit) return [current];
    pending.delete(current.question_id);
    return clearedResponse(edit) ? [] : [edit];
  });
  for (const edit of pending.values()) {
    if (!clearedResponse(edit)) merged.push(edit);
  }
  return merged;
}

import 'server-only';

import { escapeForBody, type ModelMessage } from '@/agent/transcript';
import type { OnboardingPrefill } from '@/lib/product';

const MAX_FIELD_CHARS = 1000;
const RESPONSE_FIELDS = new Set([
  'business_overview',
  'audience_context',
  'known_for',
  'distinctive_approach',
  'content_objective',
  'problem_or_goal',
  'recurring_questions',
  'proof',
  'tone',
] as const);

type ResponseField =
  | 'business_overview'
  | 'audience_context'
  | 'known_for'
  | 'distinctive_approach'
  | 'content_objective'
  | 'problem_or_goal'
  | 'recurring_questions'
  | 'proof'
  | 'tone';

export type ClientBrief = Partial<Record<'display_name' | 'profession' | ResponseField, string>>;

function boundedText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\r\n?/g, '\n').trim();
  return normalized ? normalized.slice(0, MAX_FIELD_CHARS) : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function projectClientBrief(prefill: OnboardingPrefill): ClientBrief {
  const brief: ClientBrief = {};
  const displayName = boundedText(prefill?.user?.display_name);
  const profession = boundedText(prefill?.user?.profession);
  if (displayName) brief.display_name = displayName;
  if (profession) brief.profession = profession;

  const questionnaire = recordValue(prefill?.answers?.questionnaire);
  const responses = questionnaire?.responses;
  if (!Array.isArray(responses)) return brief;

  const seen = new Set<ResponseField>();
  for (const candidate of responses) {
    const response = recordValue(candidate);
    const questionId = response?.question_id;
    if (typeof questionId !== 'string' || !RESPONSE_FIELDS.has(questionId as ResponseField)) continue;
    const field = questionId as ResponseField;
    if (seen.has(field)) continue;
    seen.add(field);
    const answers = response?.answers;
    const answer = Array.isArray(answers) ? boundedText(answers[0]) : null;
    if (answer) brief[field] = answer;
  }
  return brief;
}

export function clientBriefMessage(brief: ClientBrief): ModelMessage {
  return {
    role: 'user',
    content: `<client-profile trust="client-authored-untrusted" citable="false">${escapeForBody(JSON.stringify(brief))}</client-profile>`,
  };
}

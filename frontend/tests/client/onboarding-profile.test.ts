import { describe, expect, it } from "vitest";

import {
  buildCompatibleConfirm,
  decodeQuestions,
  decodeStoredResponses,
  mergeOnboardingResponses,
} from "@/lib/onboarding-profile";
import type {
  OnboardingPrefill,
  OnboardingQuestion,
  OnboardingQuestionResponse,
} from "@/lib/product";

const VERSION = "business-dna/1.0.0";

const questions: OnboardingQuestion[] = [
  {
    question_id: "business_overview",
    question_version: VERSION,
    review_label: "About you",
    prompt: "Tell us about what you or your business does—in your own words.",
    input_type: "long",
    required: true,
    choices: [],
    max_text_chars: 2_000,
  },
  {
    question_id: "audience_context",
    question_version: VERSION,
    review_label: "Audience",
    prompt: "Who do you most want your work to reach or help?",
    input_type: "long",
    required: true,
    choices: [],
    max_text_chars: 2_000,
  },
  {
    question_id: "known_for",
    question_version: VERSION,
    review_label: "Strongest point",
    prompt: "What do people usually come to you for?",
    input_type: "long",
    required: true,
    choices: [],
    max_text_chars: 2_000,
  },
  {
    question_id: "distinctive_approach",
    question_version: VERSION,
    review_label: "What makes you different",
    prompt: "What makes your approach different?",
    input_type: "long",
    required: false,
    choices: [],
    max_text_chars: 2_000,
  },
  {
    question_id: "content_objective",
    question_version: VERSION,
    review_label: "Main objective",
    prompt: "What should your content help you do most right now?",
    input_type: "single",
    required: true,
    choices: ["Build recognition and trust.", "Explain what I do more clearly."],
    max_text_chars: 2_000,
  },
  {
    question_id: "problem_or_goal",
    question_version: VERSION,
    review_label: "The problem",
    prompt: "What problem, need or goal does your work address?",
    input_type: "long",
    required: false,
    choices: [],
    max_text_chars: 2_000,
  },
  {
    question_id: "recurring_questions",
    question_version: VERSION,
    review_label: "Common questions",
    prompt: "What questions come up most often?",
    input_type: "long",
    required: false,
    choices: [],
    max_text_chars: 2_000,
  },
  {
    question_id: "proof",
    question_version: VERSION,
    review_label: "Proof",
    prompt: "What examples best show the value of what you do?",
    input_type: "long",
    required: false,
    choices: [],
    max_text_chars: 2_000,
  },
  {
    question_id: "tone",
    question_version: VERSION,
    review_label: "Writing tone",
    prompt: "How should your writing usually sound?",
    input_type: "single",
    required: false,
    choices: ["Clear and direct.", "Warm and conversational."],
    max_text_chars: 2_000,
  },
];

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

describe("onboarding profile adapter", () => {
  it("decodes the exact versioned catalogue and refuses malformed server data", () => {
    expect(decodeQuestions(prefill())).toEqual(questions);

    expect(() =>
      decodeQuestions({ ...prefill(), questions: [...questions, questions[0]] }),
    ).toThrow(/duplicate/i);
    expect(() =>
      decodeQuestions({
        ...prefill(),
        questions: [{ ...questions[0], question_version: "" }],
      }),
    ).toThrow(/version/i);
    expect(() =>
      decodeQuestions({
        ...prefill(),
        questions: [{ ...questions[0], choices: ["hidden choice"] }],
      }),
    ).toThrow(/long/i);
    expect(() =>
      decodeQuestions({
        ...prefill(),
        questions: [{ ...questions[0], max_text_chars: 0 }],
      }),
    ).toThrow(/text limit/i);
    expect(() =>
      decodeQuestions({
        ...prefill(),
        questions: questions.map((question) => ({
          ...question,
          question_version: "business-dna/2.0.0",
        })),
      }),
    ).toThrow(/unsupported.*version/i);
    expect(() =>
      decodeQuestions({
        ...prefill(),
        questions: [questions[1], questions[0], ...questions.slice(2)],
      }),
    ).toThrow(/catalogue.*order/i);
  });

  it("restores canonical ordinary, custom and open answers without hidden stale text", () => {
    const stored = prefill({
      questionnaire: {
        version: VERSION,
        responses: [
          {
            question_id: "business_overview",
            question_version: VERSION,
            question: questions[0].prompt,
            answers: ["A clear summary."],
            submitted_at: "2026-09-20T10:00:00Z",
            ordinal: 0,
          },
          {
            question_id: "content_objective",
            question_version: VERSION,
            question: questions[4].prompt,
            answers: ["Build recognition and trust."],
            submitted_at: "2026-09-20T10:00:00Z",
            ordinal: 1,
          },
          {
            question_id: "tone",
            question_version: VERSION,
            question: questions[8].prompt,
            answers: ["Quietly confident."],
            submitted_at: "2026-09-20T10:00:00Z",
            ordinal: 2,
          },
        ],
      },
    });

    expect(decodeStoredResponses(stored)).toEqual([
      {
        question_id: "business_overview",
        question_version: VERSION,
        selected: [],
        text: "A clear summary.",
      },
      {
        question_id: "content_objective",
        question_version: VERSION,
        selected: ["Build recognition and trust."],
        text: "",
      },
      {
        question_id: "tone",
        question_version: VERSION,
        selected: ["__other__"],
        text: "Quietly confident.",
      },
    ]);
  });

  it("projects only unambiguous legacy fields and leaves audience slugs and insights untouched", () => {
    const restored = decodeStoredResponses(
      prefill({
        audience: ["founders"],
        tldr: ["A legacy summary."],
        insight: ["Could be known-for.", "Could be distinctive."],
        pain_point: ["A legacy problem."],
        objection: ["A legacy question."],
        proof_point: ["A legacy result."],
        tone: ["Warm and conversational."],
      }),
    );

    expect(restored.map((response) => response.question_id)).toEqual([
      "business_overview",
      "problem_or_goal",
      "recurring_questions",
      "proof",
      "tone",
    ]);
    expect(restored).not.toContainEqual(expect.objectContaining({ question_id: "known_for" }));
    expect(restored).not.toContainEqual(
      expect.objectContaining({ question_id: "audience_context" }),
    );
  });

  it("builds a complete compatible body while preserving every legacy-only list", () => {
    const current = prefill({
      audience: ["legacy-audience-slug"],
      never_claim: ["Never promise a return."],
      avoid_phrases: ["No hype."],
      tone: ["Warm and conversational."],
      tldr: ["Old summary."],
      insight: ["Ambiguous legacy insight."],
      pain_point: ["Old problem."],
      objection: ["Old question."],
      proof_point: ["Old proof."],
      quote: ["Make it useful."],
      terminology: ["Authority Activation"],
      actor: "must-not-leak",
      client_id: "must-not-leak",
    });
    const edited: OnboardingQuestionResponse[] = [
      {
        question_id: "business_overview",
        question_version: VERSION,
        selected: [],
        text: "New summary.\r\nSecond line.",
      },
    ];

    const body = buildCompatibleConfirm(current, edited);

    expect(body).toMatchObject({
      audience: ["legacy-audience-slug"],
      never_say: ["Never promise a return."],
      voice_constraints: ["No hype."],
      quote: ["Make it useful."],
      terminology: ["Authority Activation"],
      insight: ["Ambiguous legacy insight."],
      responses: [{ ...edited[0], text: "New summary.\nSecond line." }],
    });
    expect(body).not.toHaveProperty("actor");
    expect(body).not.toHaveProperty("client_id");
    expect(body).not.toHaveProperty("user_id");
  });

  it("accepts a short document and refuses browser text beyond the published limit", () => {
    const accepted = buildCompatibleConfirm(prefill(), [
      {
        question_id: "business_overview",
        question_version: VERSION,
        selected: [],
        text: "x".repeat(2_000),
      },
    ]);

    expect(accepted.responses?.[0].text).toHaveLength(2_000);
    expect(() =>
      buildCompatibleConfirm(prefill(), [
        {
          question_id: "business_overview",
          question_version: VERSION,
          selected: [],
          text: "x".repeat(2_001),
        },
      ]),
    ).toThrow(/2000/);
  });

  it("merges section edits into current canonical answers and clears an optional answer", () => {
    const current = prefill({
      questionnaire: {
        version: VERSION,
        responses: [
          {
            question_id: "business_overview",
            question_version: VERSION,
            question: questions[0].prompt,
            answers: ["Current summary."],
            submitted_at: "2026-09-20T10:00:00Z",
            ordinal: 0,
          },
          {
            question_id: "tone",
            question_version: VERSION,
            question: questions[8].prompt,
            answers: ["Warm and conversational."],
            submitted_at: "2026-09-20T10:00:00Z",
            ordinal: 1,
          },
        ],
      },
    });

    expect(mergeOnboardingResponses(current, [
      {
        question_id: "business_overview",
        question_version: VERSION,
        selected: [],
        text: "Updated summary.",
      },
      {
        question_id: "tone",
        question_version: VERSION,
        selected: [],
        text: "",
      },
    ])).toEqual([
      {
        question_id: "business_overview",
        question_version: VERSION,
        selected: [],
        text: "Updated summary.",
      },
    ]);
  });
});

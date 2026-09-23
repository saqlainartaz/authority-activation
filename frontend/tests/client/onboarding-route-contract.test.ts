import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OnboardingQuestion } from "@/lib/product";

vi.mock("@/lib/client-session", () => ({
  clientToken: vi.fn(async () => "session-token"),
}));

vi.mock("@/lib/product", () => ({
  expiredLinkResponse: vi.fn(() => Response.json({ detail: "expired" }, { status: 401 })),
  forwardProductError: vi.fn((error: unknown) => {
    throw error;
  }),
  getOnboarding: vi.fn(),
  putOnboarding: vi.fn(),
  readJsonObject: vi.fn(async (request: Request) => request.json()),
}));

import { clientToken } from "@/lib/client-session";
import { getOnboarding, putOnboarding } from "@/lib/product";

import { PUT } from "@/app/api/client/onboarding/route";

const VERSION = "business-dna/1.0.0";
const questionDefinitions = [
  ["business_overview", "About you", "Tell us about what you do.", "long", true, []],
  ["audience_context", "Audience", "Who do you help?", "long", true, []],
  ["known_for", "Strongest point", "What are you known for?", "long", true, []],
  ["distinctive_approach", "What makes you different", "What makes you different?", "long", false, []],
  ["content_objective", "Main objective", "What should content do?", "single", true, ["Build recognition and trust."]],
  ["problem_or_goal", "The problem", "What problem do you address?", "long", false, []],
  ["recurring_questions", "Common questions", "What do people ask?", "long", false, []],
  ["proof", "Proof", "What proves it?", "long", false, []],
  ["tone", "Writing tone", "How should it sound?", "single", false, ["Clear and direct.", "Warm and conversational."]],
] as const;
const questions: OnboardingQuestion[] = questionDefinitions.map(([question_id, review_label, prompt, input_type, required, choices]) => ({
  question_id,
  question_version: VERSION,
  review_label,
  prompt,
  input_type,
  required,
  choices: [...choices],
  max_text_chars: 2_000,
}));
const question = questions[0];
const response = {
  question_id: "business_overview",
  question_version: VERSION,
  selected: [],
  text: "We turn expertise into useful media.",
};

describe("client onboarding PUT boundary", () => {
  beforeEach(() => {
    vi.mocked(clientToken).mockReset().mockResolvedValue("session-token");
    vi.mocked(getOnboarding).mockReset().mockResolvedValue({
      user: { display_name: "Amina", email: "amina@example.test", profession: "Founder" },
      audience_options: [],
      answers: {
        never_claim: ["Never promise a return."],
        avoid_phrases: ["No hype."],
        quote: ["Make it useful."],
        terminology: ["Authority Activation"],
      },
      confirmed_at: null,
      guardrail_questions: [],
      questions,
      trust: "untrusted",
    });
    vi.mocked(putOnboarding).mockReset().mockResolvedValue({
      answers: {},
      confirmed_at: "2026-09-20T10:00:00Z",
      updated_at: "2026-09-20T10:00:00Z",
      actor: "client-user:user-1",
      dynamic_writeback: [],
      trust: "untrusted",
    });
  });

  it("accepts only responses, refetches authoritative prefill and forwards a compatible body", async () => {
    const request = new Request("http://local/api/client/onboarding", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ responses: [response] }),
    });

    const result = await PUT(request);

    expect(result.status).toBe(200);
    expect(getOnboarding).toHaveBeenCalledWith("session-token");
    expect(putOnboarding).toHaveBeenCalledWith(
      "session-token",
      expect.objectContaining({
        responses: [response],
        never_say: ["Never promise a return."],
        voice_constraints: ["No hype."],
        quote: ["Make it useful."],
        terminology: ["Authority Activation"],
      }),
    );
  });

  it("refuses unknown browser keys before reading or writing the backend", async () => {
    const request = new Request("http://local/api/client/onboarding", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ responses: [response], actor: "forged" }),
    });

    const result = await PUT(request);

    expect(result.status).toBe(422);
    expect(getOnboarding).not.toHaveBeenCalled();
    expect(putOnboarding).not.toHaveBeenCalled();
  });

  it("does not touch the backend without a client session", async () => {
    vi.mocked(clientToken).mockResolvedValue(null);
    const request = new Request("http://local/api/client/onboarding", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ responses: [response] }),
    });

    const result = await PUT(request);

    expect(result.status).toBe(401);
    expect(getOnboarding).not.toHaveBeenCalled();
    expect(putOnboarding).not.toHaveBeenCalled();
  });

  it("merges Business DNA section edits with the latest server answers", async () => {
    vi.mocked(getOnboarding).mockResolvedValue({
      user: { display_name: "Amina", email: "amina@example.test", profession: "Founder" },
      audience_options: [],
      answers: {
        questionnaire: {
          version: VERSION,
          responses: [
            {
              question_id: "business_overview",
              question_version: VERSION,
              question: questions[0].prompt,
              answers: ["The latest summary from another tab."],
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
      },
      confirmed_at: "2026-09-20T10:00:00Z",
      guardrail_questions: [],
      questions,
      trust: "untrusted",
    } as never);
    const request = new Request("http://local/api/client/onboarding", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merge: true,
        responses: [{ ...response, text: "Edited only this section." }],
      }),
    });

    const result = await PUT(request);

    expect(result.status).toBe(200);
    expect(putOnboarding).toHaveBeenCalledWith(
      "session-token",
      expect.objectContaining({
        business_dna_responses: [
          { ...response, text: "Edited only this section." },
          {
            question_id: "tone",
            question_version: VERSION,
            selected: ["Warm and conversational."],
            text: "",
          },
        ],
      }),
    );
  });

  it("forwards six validated clarification pairs without replacing Business DNA", async () => {
    const clarificationVersion = "business-clarification/1.0.0";
    const clarificationIds = [
      "work_today", "therapy_locations", "practice_start_year", "retreat_role",
      "retreat_misunderstanding", "anything_else",
    ];
    vi.mocked(getOnboarding).mockResolvedValue({
      user: { display_name: "Amina", email: "amina@example.test", profession: "Founder" },
      audience_options: [],
      answers: { tldr: ["Keep this Business DNA value."] },
      confirmed_at: null,
      guardrail_questions: [],
      questions,
      clarification_questions: clarificationIds.map((question_id, index) => ({
        question_id,
        question_version: clarificationVersion,
        review_label: `Clarification ${index + 1}`,
        prompt: `Clarification ${index + 1}?`,
        input_type: index === 1 || index === 3 ? "multi" : index < 4 ? "single" : "long",
        required: index < 4,
        choices: index < 4 ? ["First", "Second"] : [],
        max_text_chars: 2_000,
      })),
      trust: "untrusted",
    });
    const clarifications = clarificationIds.slice(0, 4).map((question_id, index) => ({
      question_id,
      question_version: clarificationVersion,
      selected: index === 1 || index === 3 ? ["First", "Second"] : ["First"],
      text: "",
    }));
    const result = await PUT(new Request("http://local/api/client/onboarding", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clarifications }),
    }));
    expect(result.status).toBe(200);
    expect(putOnboarding).toHaveBeenCalledWith("session-token", { clarifications });
  });
});

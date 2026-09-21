import { beforeEach, describe, expect, it, vi } from "vitest";

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
const question = {
  question_id: "business_overview",
  question_version: VERSION,
  review_label: "About you",
  prompt: "Tell us about what you do.",
  input_type: "long" as const,
  required: true,
  choices: [],
};
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
      questions: [question],
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
});

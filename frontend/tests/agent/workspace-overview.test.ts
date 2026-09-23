import { beforeEach, describe, expect, it, vi } from "vitest";

const product = vi.hoisted(() => ({
  getOnboarding: vi.fn(),
  listClientAtoms: vi.fn(),
}));

vi.mock("@/lib/product", () => product);

import {
  needsWorkspaceOverview,
  readWorkspaceOverview,
  workspaceOverviewMessage,
  type WorkspaceOverview,
} from "@/agent/lib/workspace-overview";
import type { OnboardingPrefill } from "@/lib/product";

const overview: WorkspaceOverview = {
  identity: { display_name: "Synthetic <Founder>", profession: "Consultant" },
  knowledge: {
    atom_count: 17,
    represented_source_count: 4,
    onboarding_confirmed: true,
  },
  topic_suggestions: ["A real client lesson"],
  discovery_candidates: [{ kind: "objection", text: "Why does implementation take so long?" }],
  business_context_candidates: [{
    kind: "terminology", text: "Example Studio is our practice.",
    source_label: "your brand document", confirmed: true,
  }],
};

describe("workspace overview intent", () => {
  it.each([
    "Who am I?",
    "How much data do you have?",
    "Give me some options man.",
    "You choose the topic.",
    "Write about anything.",
    "Pick the best post from my data.",
    "What's a question that my clients keep asking me? Write something.",
    "What do our clients keep asking?",
    "Find a question clients keep asking me in my material and write about it.",
    "Write a post that will get me people interested in my business.",
    "Write a post to introduce my business.",
    "Promote my business.",
    "What's my business name?",
    "What does my business do?",
    "Who do I serve?",
    "What services do we offer?",
    "What do you know about my practice?",
  ])("adds account context for %s", (message) => {
    expect(needsWorkspaceOverview(message)).toBe(true);
  });

  it.each([
    "Write me a post based on my documentary. Find a catchy line from it.",
    "I am talking about my ISTV documentary.",
    "Use the strongest story from the document I uploaded.",
  ])("leaves source retrieval to structured prepare intent for %s", (message) => {
    expect(needsWorkspaceOverview(message)).toBe(false);
  });

  it("does not add several account reads to an ordinary concrete writing turn", () => {
    expect(needsWorkspaceOverview("Write a post about our onboarding process.")).toBe(false);
  });
});

describe("workspace overview rendering", () => {
  it("carries useful account facts as escaped data, without ids or email", () => {
    const message = workspaceOverviewMessage(overview);
    expect(message.role).toBe("user");
    expect(message.content).toContain("workspace-overview");
    expect(message.content).toContain("represented_source_count");
    expect(message.content).toContain("atom_count");
    expect(message.content).toContain("Why does implementation take so long?");
    expect(message.content).toContain("Example Studio is our practice.");
    expect(message.content).toContain("Synthetic &lt;Founder>");
    expect(message.content).not.toContain("client_id");
    expect(message.content).not.toContain("email");
  });
});

describe("workspace overview reads", () => {
  const onboarding: OnboardingPrefill = {
    user: { display_name: "Synthetic Founder", email: "hidden@example.test", profession: "Consultant" },
    audience_options: [],
    answers: { insight: ["A real client lesson"] },
    confirmed_at: "2026-09-20T10:00:00Z",
    guardrail_questions: [],
    questions: [],
    trust: "untrusted",
  };

  beforeEach(() => {
    product.getOnboarding.mockReset();
    product.listClientAtoms.mockReset();
    product.getOnboarding.mockResolvedValue(onboarding);
    product.listClientAtoms.mockResolvedValue({
      client_id: "client-a",
      atoms: [{ document_id: "doc-a", atom_type: "insight", status: "confirmed", text: "A lesson" }],
      atom_counts: { insight: 1 },
      generated_at: "2026-09-20T10:00:00Z",
    });
  });

  it("reuses a preloaded onboarding record while still reading current atoms", async () => {
    const result = await readWorkspaceOverview("token-a", onboarding);

    expect(product.getOnboarding).not.toHaveBeenCalled();
    expect(product.listClientAtoms).toHaveBeenCalledTimes(1);
    expect(result.identity.display_name).toBe("Synthetic Founder");
  });

  it("performs one onboarding read for callers without a preloaded record", async () => {
    await readWorkspaceOverview("token-a");
    expect(product.getOnboarding).toHaveBeenCalledTimes(1);
    expect(product.listClientAtoms).toHaveBeenCalledTimes(1);
  });

  it("exposes bounded, live identity candidates without treating constraints as business facts", async () => {
    product.listClientAtoms.mockResolvedValue({
      client_id: "client-a",
      atoms: [
        { document_id: "doc-a", atom_type: "tldr", status: "confirmed", text: "Example Studio offers consulting.", source_label: "your brand document" },
        { document_id: "doc-a", atom_type: "terminology", status: "provisional", text: "Example Studio is the practice name.", source_label: "your brand document" },
        { document_id: "doc-a", atom_type: "pain_point", status: "confirmed", text: "Founders need practical implementation help.", source_label: "your interview" },
        { document_id: "doc-a", atom_type: "voice_constraint", status: "confirmed", text: "Never use a sales pitch.", source_label: "your brand document" },
        { document_id: "doc-b", atom_type: "terminology", status: "deprecated", text: "Former Practice", source_label: "your old notes" },
      ],
      atom_counts: { tldr: 1, terminology: 1, voice_constraint: 1 },
      generated_at: "2026-09-20T10:00:00Z",
    });
    const result = await readWorkspaceOverview("token-a", onboarding);
    expect(result.business_context_candidates).toEqual([
      { kind: "tldr", text: "Example Studio offers consulting.", source_label: "your brand document", confirmed: true },
      { kind: "terminology", text: "Example Studio is the practice name.", source_label: "your brand document", confirmed: false },
      { kind: "pain_point", text: "Founders need practical implementation help.", source_label: "your interview", confirmed: true },
    ]);
  });
});

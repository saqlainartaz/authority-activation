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
});

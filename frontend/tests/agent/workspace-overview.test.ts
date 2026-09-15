import { describe, expect, it } from "vitest";

import {
  needsWorkspaceOverview,
  workspaceOverviewMessage,
  type WorkspaceOverview,
} from "@/agent/lib/workspace-overview";

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
  ])("adds account context for %s", (message) => {
    expect(needsWorkspaceOverview(message)).toBe(true);
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

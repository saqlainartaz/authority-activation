import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const route = fs.readFileSync(
  path.join(process.cwd(), "src/app/api/client/chat/sessions/[sessionId]/agent/route.ts"),
  "utf8",
);

describe("D-A: two kind=agent rows per generating turn, deduped byte-exactly", () => {
  it("reads the executor's recorded texts before recording a closing remark", () => {
    expect(route).toContain("const { executor, state } = createExecutor");
    expect(route).toContain("state.submittedAgentTexts.includes(lastPassText)");
  });

  it("does not suppress on similarity, only on exact equality", () => {
    // A fuzzy match would silently drop a genuinely different closing remark,
    // which is the divergence-from-what-the-client-read failure this whole
    // decision exists to avoid.
    expect(route).not.toMatch(/startsWith|toLowerCase\(\)|localeCompare|slice\(0,/);
  });

  it("still records a closing remark on a pure-conversation turn", () => {
    // No submit means no transactional row, so step 7 is the ONLY recording.
    expect(route).toContain("!endedInTerminal && lastPassText.trim().length > 0");
  });
});

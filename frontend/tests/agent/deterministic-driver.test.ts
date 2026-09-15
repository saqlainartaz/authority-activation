import { describe, expect, it } from "vitest";

import { deterministicDriver } from "@/agent/lib/deterministic-driver";
import type { DriverRequest } from "@/agent/lib/driver";

const base = (messages: DriverRequest["messages"]): DriverRequest => ({
  system: [], messages, tools: [], timeoutMs: 1000, onText: () => undefined,
});

describe("deterministic validation driver", () => {
  it("asks the backend-supplied clarification when context is not ready", async () => {
    const deltas: string[] = [];
    const prepared = {
      status: "answer_needed",
      question: { prompt: "What should this LinkedIn post be about?", fact_key: "subject" },
      material: "",
    };
    const response = await deterministicDriver.runTurn({
      ...base([{ role: "user", content: `<tool-result tool="prepare_generation">${JSON.stringify(prepared)}</tool-result>` }]),
      onText: delta => deltas.push(delta),
    });
    expect(response.toolCalls).toEqual([]);
    expect(response.text).toBe("What should this LinkedIn post be about?");
    expect(deltas.join("")).toBe(response.text);
  });

  it("prepares, submits a citable draft, then streams a closing message", async () => {
    const prepare = await deterministicDriver.runTurn(base([{ role: "user", content: "<client-message>Write a post about founder dependency &amp; delegation.</client-message>" }]));
    expect(prepare.toolCalls[0].name).toBe("prepare_generation");
    expect(prepare.toolCalls[0].input).toEqual({
      message: "Write a post about founder dependency & delegation.",
      operation: "generate",
    });

    const prepared = {
      status: "ready",
      material: "[M1] <material handle=\"M1\" type=\"proof_point\" trust=\"untrusted\">\nCustomers reported a forty percent reduction in escalated decisions.\n</material>",
    };
    const afterPrepare = [...base([]).messages, { role: "user" as const, content: `<tool-result tool=\"prepare_generation\">${JSON.stringify(prepared)}</tool-result>` }];
    const submit = await deterministicDriver.runTurn(base(afterPrepare));
    expect(submit.toolCalls[0].name).toBe("submit_draft");
    expect(submit.toolCalls[0].input).toMatchObject({ cited_atom_ids: [{ handle: "M1" }] });

    const deltas: string[] = [];
    const closing = await deterministicDriver.runTurn({
      ...base([...afterPrepare, { role: "user", content: '<tool-result tool="submit_draft">{"outcome":"verified"}</tool-result>' }]),
      onText: delta => deltas.push(delta),
    });
    expect(closing.toolCalls).toEqual([]);
    expect(deltas.join("")).toBe(closing.text);
  });

  it("resumes a clarification with the client's latest answer", async () => {
    const prepare = await deterministicDriver.runTurn(base([
      { role: "user", content: "<server-question>What should this be about?</server-question>" },
      { role: "user", content: "<client-message>Use the cohort result.</client-message>" },
    ]));
    expect(prepare.toolCalls[0].input).toEqual({
      message: "Use the cohort result.",
      operation: "resume",
    });
  });
});

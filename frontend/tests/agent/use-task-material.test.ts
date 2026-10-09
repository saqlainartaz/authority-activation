import { beforeEach, describe, expect, it, vi } from "vitest";

import { inputSchemaFor } from "@/agent/lib/tool-schemas";

vi.mock("@/lib/product", () => ({
  createTaskMaterial: vi.fn(),
  ProductHttpError: class extends Error {},
  safeProductSentence: () => "",
}));

const { createTaskMaterial } = await import("@/lib/product");
const { useTaskMaterial, TaskMaterialArgumentError } = await import(
  "@/agent/tools/use-task-material"
);

/**
 * `use_task_material`: what the model may say, and what it structurally
 * cannot claim happened.
 *
 * The strongest assertions here are about the RESULT rather than the
 * request. A `proposed` outcome missing its handle would read to the model
 * as a completed save with nothing to point at, and "I've saved that" about
 * a proposal the server never minted is the claim contracts §4 forbids in
 * as many words: "Neither response means permanently saved."
 */

const CONTEXT = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  turnId: "22222222-2222-4222-8222-222222222222",
  token: "token",
  handles: new Map(),
  skillVersions: [],
} as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the use_task_material tool schema", () => {
  it("offers two actions and no third", () => {
    const schema = inputSchemaFor("use_task_material");

    expect(
      schema.safeParse({ action: "use_for_task", message: "U1", text: "x" }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ action: "propose_save", message: "U1", text: "x" }).success,
    ).toBe(true);
    expect(schema.safeParse({ action: "save", message: "U1", text: "x" }).success).toBe(
      false,
    );
  });

  it("gives the model no way to name a message id, a tenant or a task scope", () => {
    const shape = Object.keys(
      (inputSchemaFor("use_task_material") as never as { shape: object }).shape,
    );

    expect(shape).toEqual(["action", "message", "text", "subject", "applicability"]);
    expect(shape).not.toContain("message_id");
    expect(shape).not.toContain("client_id");
    expect(shape).not.toContain("task_scope");
  });
});

describe("building the request", () => {
  it("sends the handle and the exact words, with nulls for what was not said", async () => {
    vi.mocked(createTaskMaterial).mockResolvedValueOnce({
      state: "used_for_task",
      assertion: "TA1",
      proposal: null,
    });

    await useTaskMaterial(
      { action: "use_for_task", message: "U3", text: "our programme is weekly" },
      CONTEXT,
    );

    const [, , body] = vi.mocked(createTaskMaterial).mock.calls[0];
    expect(body.request).toEqual({
      action: "use_for_task",
      message: "U3",
      text: "our programme is weekly",
      subject: null,
      applicability: null,
    });
    expect(body.idempotency_key).toBeTruthy();
  });

  it("refuses a call with no message handle, naming what is missing", async () => {
    await expect(
      useTaskMaterial(
        { action: "use_for_task", message: "", text: "something" },
        CONTEXT,
      ),
    ).rejects.toThrow(TaskMaterialArgumentError);
    expect(createTaskMaterial).not.toHaveBeenCalled();
  });

  it("refuses a call with no text", async () => {
    await expect(
      useTaskMaterial({ action: "propose_save", message: "U1", text: "" }, CONTEXT),
    ).rejects.toThrow(/exact words/);
  });
});

describe("the outcome is validated, not trusted", () => {
  it("parses a used_for_task outcome", async () => {
    vi.mocked(createTaskMaterial).mockResolvedValueOnce({
      state: "used_for_task",
      assertion: "TA1",
      proposal: null,
    });

    const outcome = await useTaskMaterial(
      { action: "use_for_task", message: "U1", text: "x" },
      CONTEXT,
    );

    expect(outcome).toEqual({ state: "used_for_task", assertion: "TA1", proposal: null });
  });

  it("refuses a proposed outcome with no proposal handle", async () => {
    vi.mocked(createTaskMaterial).mockResolvedValueOnce({
      state: "proposed",
      assertion: null,
      proposal: null,
    });

    await expect(
      useTaskMaterial({ action: "propose_save", message: "U1", text: "x" }, CONTEXT),
    ).rejects.toThrow();
  });

  it("refuses an outcome claiming a state that does not exist", async () => {
    // There is no `saved`, because nothing this tool does is a save. A
    // server that started returning one would be reporting an approval that
    // only the client can give.
    vi.mocked(createTaskMaterial).mockResolvedValueOnce({
      state: "saved",
      assertion: null,
      proposal: "TP1",
    });

    await expect(
      useTaskMaterial({ action: "propose_save", message: "U1", text: "x" }, CONTEXT),
    ).rejects.toThrow();
  });

  it("refuses an outcome carrying an unknown field", async () => {
    vi.mocked(createTaskMaterial).mockResolvedValueOnce({
      state: "used_for_task",
      assertion: "TA1",
      proposal: null,
      knowledge_id: "77777777-7777-4777-8777-777777777777",
    });

    await expect(
      useTaskMaterial({ action: "use_for_task", message: "U1", text: "x" }, CONTEXT),
    ).rejects.toThrow();
  });
});

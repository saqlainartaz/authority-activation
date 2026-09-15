import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const chatPath = fs.readFileSync(
  path.join(process.cwd(), "src/components/compose/ChatPath.tsx"),
  "utf8",
);

describe("the composer never adds friction", () => {
  it("is disabled only by an expired session", () => {
    // A turn can run the full 120s deadline. Disabling the only input on the
    // screen for two minutes is the friction this asserts against.
    expect(chatPath).toContain("disabled={expired}");
    expect(chatPath).not.toMatch(/disabled=\{busy \|\| /);
    expect(chatPath).not.toMatch(/disabled=\{[^}]*working/);
  });

  it("can send while a turn is open", () => {
    expect(chatPath).toContain("const canSend = message.trim().length > 0 && !expired;");
  });

  it("compares the character limit against the trimmed message, not the raw one", () => {
    // `useAgentTurn`'s `send` trims first and validates the trimmed length, then
    // enqueues the trimmed text. Comparing the raw `message.length` here would
    // block (or warn about) a send the hook would have accepted without
    // complaint — trailing whitespace padding out a message that is actually
    // within bounds. This is the review finding this test pins.
    expect(chatPath).toContain("const overLimit = message.trim().length > COMPOSER_MAX_CHARS;");
    expect(chatPath).not.toMatch(/overLimit = message\.length >/);
  });

  it("has exactly one destination for composer text", () => {
    // The three-way readiness routing is gone: a clarification answer sent to
    // /commands is an answer the agent never sees as a turn.
    expect(chatPath).not.toContain("propose_durable_fact");
    expect(chatPath).not.toContain("answer_clarification");
    expect(chatPath).not.toContain("requiredFactKey");
    expect(chatPath).toContain("onSendTurn(text)");
  });

  it("keeps every command the card and dialogs still need", () => {
    for (const kind of [
      "select_variant",
      "copy_variant",
      "finish",
      "start_new_post",
      "confirm_durable_fact",
      "confirm_constraint",
    ]) {
      expect(chatPath).toContain(kind);
    }
  });
});

describe("the live turn renders", () => {
  it("shows the activity label and the streamed text", () => {
    expect(chatPath).toContain('phase.kind === "working"');
    expect(chatPath).toContain("<ActivityTurn");
  });

  it("echoes a queued message immediately", () => {
    expect(chatPath).toContain("echo.map");
  });

  it("holds no draft body of its own", () => {
    // §5.3's guarantee, at the last mile: the card reads a verified variant
    // out of the envelope; nothing here paints streamed text as a post.
    // No `/s` (dotAll) flag: `[^)]*` is a character class, already matching
    // newlines regardless of flags, and this repo's `tsconfig.json` targets
    // ES2017, under which `/s` itself is a typecheck error (`tsc` TS1501).
    expect(chatPath).not.toMatch(/phase\.text[^)]*ChatDraftCard/);
  });
});

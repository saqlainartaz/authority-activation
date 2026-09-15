import { describe, expect, it } from "vitest";

import { phaseForChat } from "@/components/compose/useChatSession";
import { IDLE_TURN, type AgentTurnState } from "@/components/compose/useAgentTurn";
// Ruling D5: the hook imports `HttpError` from `@/lib/api`, which re-exports
// the same class from `@/lib/retry-fetch` — so `instanceof` matches either
// way. Naming `@/lib/api` here keeps the test and the code under test
// pointed at one source rather than two paths to the same identity.
import { HttpError } from "@/lib/api";
import type { ChatSessionEnvelope } from "@/lib/product";

const streaming: AgentTurnState = { ...IDLE_TURN, status: "streaming", label: "Writing", text: "so far" };

/** The smallest envelope `phaseForChat` reads. Fields it never touches are
 *  cast away rather than faked, so a wire change surfaces as a type error in
 *  this file instead of a passing test against a stale shape. */
function envelope(overrides: Partial<ChatSessionEnvelope> = {}): ChatSessionEnvelope {
  return {
    session: { id: "s-1", status: "active" },
    messages: [],
    variants: [],
    selected_variant_id: null,
    pending_confirmation: null,
    readiness: null,
    generation_stage: null,
    terminal_state: null,
    next_action: "continue",
    payload: {},
    ...overrides,
  } as unknown as ChatSessionEnvelope;
}

describe("phaseForChat precedence", () => {
  it("an open stream outranks an idle envelope", () => {
    // The whole point of A10. Nothing in the envelope says a turn is running:
    // `generation_stage` is cleared by `_run_context_operation` on this lane,
    // so the stream is the ONLY signal that exists.
    const phase = phaseForChat(envelope(), null, false, streaming);
    expect(phase.kind).toBe("working");
    if (phase.kind === "working") {
      expect(phase.label).toBe("Writing");
      expect(phase.text).toBe("so far");
    }
  });

  it("streams a working state before the session even exists", () => {
    // The first turn of a conversation creates the session behind the stream.
    expect(phaseForChat(null, null, false, streaming).kind).toBe("working");
  });

  it("a stream terminal outranks the working state", () => {
    const held: AgentTurnState = {
      ...streaming,
      terminal: { outcome: "held", explanation: "The checks held this draft." },
    };
    const phase = phaseForChat(envelope(), null, false, held);
    expect(phase.kind).toBe("terminal");
    if (phase.kind === "terminal") expect(phase.reason).toBe("The checks held this draft.");
  });

  it("a persisted terminal state wins over the stream's own terminal, once it exists", () => {
    // Review finding, Important 1. `turn.terminal` is STICKY (`foldEvent`'s
    // `turn.end` branch never clears it), so after a held/refused turn ends,
    // the stream keeps reporting `nextAction: null` forever unless the
    // envelope's own `terminal_state` — which DOES carry a real `next_action`
    // — is allowed to override it once `refresh()` has landed. Both sources
    // are populated here at once, which the first ten cases never exercised.
    const held: AgentTurnState = {
      ...IDLE_TURN,
      terminal: { outcome: "held", explanation: "The checks held this draft." },
    };
    const phase = phaseForChat(
      envelope({
        terminal_state: { reason: "Not enough material.", next_action: "revise_request" },
      } as Partial<ChatSessionEnvelope>),
      null,
      false,
      held,
    );
    expect(phase.kind).toBe("terminal");
    if (phase.kind === "terminal") {
      expect(phase.reason).toBe("Not enough material.");
      expect(phase.nextAction).toBe("revise_request");
    }
  });

  it("expiry and refusal outrank an open stream", () => {
    expect(phaseForChat(envelope(), null, true, streaming).kind).toBe("expired");
    const refused = phaseForChat(envelope(), new HttpError("no", 401), false, streaming);
    expect(refused.kind).toBe("refusal");
  });

  it("falls back to the envelope when no stream is open", () => {
    expect(phaseForChat(null, null, false, IDLE_TURN).kind).toBe("empty");
    expect(phaseForChat(envelope(), null, false, IDLE_TURN).kind).toBe("ready");
  });

  it("renders a persisted terminal state with its next action", () => {
    const phase = phaseForChat(
      envelope({
        terminal_state: { reason: "Not enough material.", next_action: "revise_request" },
      } as Partial<ChatSessionEnvelope>),
      null,
      false,
      IDLE_TURN,
    );
    expect(phase.kind).toBe("terminal");
    if (phase.kind === "terminal") {
      expect(phase.reason).toBe("Not enough material.");
      expect(phase.nextAction).toBe("revise_request");
    }
  });

  it("prefers a verified variant over ready", () => {
    const phase = phaseForChat(
      envelope({ variants: [{ status: "verified" }] } as Partial<ChatSessionEnvelope>),
      null,
      false,
      IDLE_TURN,
    );
    expect(phase.kind).toBe("verified");
  });

  it("maps an unrecognised session status to unknown rather than ready", () => {
    // The exhaustiveness guarantee the old `default:` branches carried. Every
    // readiness and stage switch is gone, so this status switch is now the
    // only place an unmapped wire value can be caught.
    const phase = phaseForChat(
      // Through `unknown` first, same as `envelope()`'s own cast: a literal
      // status value this far outside the real union does not "sufficiently
      // overlap" with `ChatSession` for a direct assertion, and that is a
      // fact about TypeScript's structural check, not about this test.
      envelope({ session: { id: "s-1", status: "hibernating" } as unknown as ChatSessionEnvelope["session"] }),
      null,
      false,
      IDLE_TURN,
    );
    expect(phase.kind).toBe("unknown");
  });

  it("no longer has a generating state", () => {
    // `generation_stage` is always null on the agent path. A phase derived
    // from it would be a spinner nothing retires.
    const phase = phaseForChat(
      envelope({ generation_stage: "writing" } as Partial<ChatSessionEnvelope>),
      null,
      false,
      IDLE_TURN,
    );
    expect(phase.kind).toBe("ready");
  });

  it("no longer routes on readiness", () => {
    for (const status of ["answer_needed", "blocked_by_conflict", "optional_enrichment"]) {
      const phase = phaseForChat(
        envelope({ readiness: { status } } as Partial<ChatSessionEnvelope>),
        null,
        false,
        IDLE_TURN,
      );
      // The agent asks in its own prose, in the transcript (D4/D6). Readiness
      // still rides the envelope for the draft card's note and the header
      // pill; it no longer decides what the composer does.
      expect(phase.kind).toBe("ready");
    }
  });

  // Whole-branch review, Important 1, round 2. The ten cases above never put
  // `turn.status === "streaming"` up against a non-active session status or
  // a persisted `terminal_state` — exactly the combination the over-corrected
  // precedence got backwards (I1a, I1b). Each case here reproduces the
  // regression directly: assert the OLD precedence would have failed it
  // (finished/terminal/unknown), and the fix makes it "working" instead.

  it("a running turn outranks a finished session (I1a: feedback after finish)", () => {
    // I1a: a send after `finish` used to produce no feedback at all, because
    // the envelope's `finished` status returned before `turn` was ever
    // consulted. A message-less recovery send during that finished session
    // starts a fresh turn — `status` flips to "streaming" — and that must be
    // visible even though `session.session.status` is still "finished".
    const phase = phaseForChat(
      envelope({ session: { id: "s-1", status: "finished" } as ChatSessionEnvelope["session"] }),
      null,
      false,
      streaming,
    );
    expect(phase.kind).toBe("working");
  });

  it("a running turn outranks a stale persisted terminal_state (I1b: the recovery turn)", () => {
    // I1b: a held outcome persists `terminal_state`, which is only cleared
    // server-side when the agent next calls `prepare_generation`. The next
    // turn's OWN stream (fresh `label`/`text`, `turn.terminal` reset to null
    // by `runOneTurn`) must render instead of the stale persisted row for the
    // whole time it is running, or the client sees no activity for up to
    // 120s.
    const phase = phaseForChat(
      envelope({
        terminal_state: { reason: "Not enough material.", next_action: "revise_request" },
      } as Partial<ChatSessionEnvelope>),
      null,
      false,
      streaming,
    );
    expect(phase.kind).toBe("working");
    if (phase.kind === "working") {
      expect(phase.label).toBe("Writing");
      expect(phase.text).toBe("so far");
    }
  });

  it("a running turn outranks an unmapped session status", () => {
    // Symmetric with the finished case: an unrecognised status must not
    // shadow a turn that is running right now either.
    const phase = phaseForChat(
      envelope({ session: { id: "s-1", status: "hibernating" } as unknown as ChatSessionEnvelope["session"] }),
      null,
      false,
      streaming,
    );
    expect(phase.kind).toBe("working");
  });

  it("a running turn's own terminal still outranks a stale persisted terminal_state", () => {
    // The deepest combination: both a stale persisted `terminal_state` (from
    // the turn before) AND this turn's own fresh `turn.terminal` (this
    // turn's own held/refused outcome, arrived before its `turn.end`) are
    // set at once. The fresh one must win — it is provably newer, since
    // `session` cannot have been refreshed while `status` is still
    // "streaming" (see `phaseForChat`'s own comment).
    const held: AgentTurnState = {
      ...streaming,
      terminal: { outcome: "refused", explanation: "This turn's own fresh refusal." },
    };
    const phase = phaseForChat(
      envelope({
        terminal_state: { reason: "A stale reason from the turn before.", next_action: "try_again" },
      } as Partial<ChatSessionEnvelope>),
      null,
      false,
      held,
    );
    expect(phase.kind).toBe("terminal");
    if (phase.kind === "terminal") {
      expect(phase.reason).toBe("This turn's own fresh refusal.");
      expect(phase.nextAction).toBeNull();
    }
  });
});

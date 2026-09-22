"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AgentEvent } from "@/lib/agent-events";
import { parseEventFrames } from "@/lib/agent-stream";
import { postJson } from "@/lib/api";
import type { ChatSessionEnvelope } from "@/lib/product";
import type { SocialPlatform } from "@/shared/channels";

/**
 * §5.1's lifecycle, from the browser's side.
 *
 * The route records the client's message, assembles context, runs the loop and
 * streams five event types (§5.3). This hook POSTs `{message, turnId}` and
 * nothing else, folds those events into local state, and re-reads the envelope
 * when Python has something durable to show. It holds no draft body, no
 * identity, and no provider anything.
 *
 * A QUEUE, NOT A LOCK — and this is a product constraint, not an
 * implementation detail. A turn can run for the full 120s deadline
 * (`src/agent/bounds.ts`), so refusing a send while one is open would lock the
 * only input on the screen for two minutes. Instead every send is accepted
 * immediately, rendered immediately via `echo`, and dispatched when the open
 * turn ends. One turn at a time server-side; nothing the client can feel.
 *
 * INTERRUPT WAS CONSIDERED AND REJECTED. Aborting this fetch does not
 * reliably kill the route handler, so an abandoned turn could still reach
 * `submit_draft` and record its `agent_text` out of band — a draft appearing
 * from a turn the client thought they cancelled. Worth revisiting when there
 * is a cancel signal Python can honour; not worth the hazard now.
 */

export type AgentTurnState = {
  status: "idle" | "streaming";
  /** The most recent `activity` label. Replaced, never accumulated. */
  label: string | null;
  /** The agent's words so far this turn, concatenated from `message.delta`. */
  text: string;
  terminal: { outcome: "held" | "refused"; explanation: string } | null;
  /** Client messages sent this run that the envelope does not carry yet,
   *  oldest first. The head is the one in flight (or next to fly). */
  echo: string[];
};

export const IDLE_TURN: AgentTurnState = {
  status: "idle",
  label: null,
  text: "",
  terminal: null,
  echo: [],
};

/** Pure, so every branch is testable without a network or a fake Response. */
export function foldEvent(state: AgentTurnState, event: AgentEvent): AgentTurnState {
  switch (event.type) {
    case "message.delta":
      return { ...state, text: state.text + event.text };
    case "activity":
      return { ...state, label: event.label };
    case "terminal":
      // NOT a stream-ender. Only `turn.end` is (§5.3), and the route sends one
      // after every terminal — including from its own catch block.
      return { ...state, terminal: { outcome: event.outcome, explanation: event.explanation } };
    case "draft.ready":
      // An id and nothing else. The envelope refetch is what renders the card,
      // and it is triggered by the caller, not folded into state here.
      return state;
    case "turn.end":
      // CORRECTED (whole-branch review, Important 4). This used to claim
      // "the narration is a persisted `kind=agent` row by now" unqualified.
      // That is true only of the FINAL pass: the route records `lastPassText`
      // at the end, and `submit_draft` records `agent_text`. A multi-pass
      // turn (prepare -> submit -> close) streams earlier passes' text as
      // `message.delta` too, and NEITHER of those intermediate passes is ever
      // persisted (spec §5.1.1's amendment names only the final pass and the
      // submit-time remark, not every pass). So for an intermediate pass,
      // clearing `text` here does not avoid a double-render -- it discards
      // narration that has no persisted counterpart to fall back on, and it
      // is gone for good once this turn ends. Cleared either way, because the
      // browser has no way to tell "this pass's text got persisted" from
      // "this pass's text never will" -- both look identical from here, a
      // string in `state.text` about to be overwritten by the next pass or
      // wiped by this same branch. `echo` is deliberately untouched: the
      // caller drops its head only after the refetch resolves. `terminal` is
      // EQUALLY untouched, on purpose: a held/refused outcome (a real
      // `terminal` event, or the synthetic one `runOneTurn`'s `finally`
      // folds when the server never sent one) must still be on screen after
      // the stream closes, or the whole held/refused UI has nothing to
      // render.
      return { ...state, status: "idle", label: null, text: "" };
  }
}

/** The refused shape every failure path resets to — pulled out so the call
 *  sites (the `!response.ok` branch and `runOneTurn`'s catch-all) cannot
 *  drift, and so this one piece of failure handling is unit-testable at all
 *  (nothing else in the fetch/stream loop around it is, short of a full
 *  render). Leaves `echo` untouched: which messages stay queued is `drain`'s
 *  decision, not this shape's.
 *
 *  UNCONDITIONALLY OVERWRITES `state.terminal` — pinned by the "overwrites an
 *  existing terminal rather than merging with it" test below. That is
 *  deliberately NOT this function's job to guard: `runOneTurn`'s catch block
 *  checks `state.terminal !== null` itself, BEFORE calling this, so a real
 *  server-sent explanation is never reached by this overwrite in practice.
 *  Keeping the check at the call site (not here) is what that test protects
 *  against silently moving. */
export function refusedTurn(state: AgentTurnState, explanation: string): AgentTurnState {
  return { ...state, status: "idle", label: null, text: "", terminal: { outcome: "refused", explanation } };
}

/** The ONE case where nothing reached Python at all. The agent route's
 *  `POST` handler (`src/app/api/client/chat/sessions/[sessionId]/agent/route.ts`)
 *  answers non-2xx on every path that could fail before or during §5.1 step
 *  3 (`recordClientTurn`) — a malformed body (`refuse(...)`), a dead
 *  credential (`expiredLinkResponse()`), or the recording call itself
 *  failing (`forwardProductError(error)`) — so `!response.ok` here means the
 *  message was genuinely never saved. */
const NOTHING_SAVED_EXPLANATION = "Couldn't reach the writer. Nothing was saved — try again.";

/** The other case: a failure AFTER a 2xx response. The discriminator is
 *  PROVABLE, not inferred — read from the route itself rather than assumed.
 *  `route.ts` calls `recordClientTurn` and only constructs/returns the
 *  streaming `Response` (its 200) once that call has already succeeded;
 *  every failure path before or during it returns non-2xx instead (see
 *  `NOTHING_SAVED_EXPLANATION`'s comment). So `response.ok === true` proves
 *  the client's message is already a persisted `task` row by the time this
 *  function can observe it, and "Nothing was saved" would be a false
 *  statement from that point on — this sentence names what actually
 *  happened instead. */
const CONNECTION_DROPPED_EXPLANATION =
  "The connection dropped while writing. Your message was saved; check back or send again.";

const AGENT_TURN_MAX_CHARS = 4_000;

export function useAgentTurn({
  sessionId,
  platform,
  onSessionCreated,
  refresh,
}: {
  sessionId: string | null;
  platform: SocialPlatform;
  onSessionCreated: (sessionId: string) => void;
  refresh: () => Promise<void>;
}): { turn: AgentTurnState; send: (message: string) => void; cancel: () => void } {
  const [turn, setTurn] = useState<AgentTurnState>(IDLE_TURN);
  const abort = useRef<AbortController | null>(null);
  // The queue lives in a ref as well as in state: `drain` reads it
  // synchronously as it drains, and a state read there would see a stale value.
  const queue = useRef<string[]>([]);
  const running = useRef(false);
  const liveSessionId = useRef<string | null>(sessionId);
  // Separates work queued before and after an explicit stop/conversation
  // switch. The abandoned turn may still resolve because aborting a browser
  // fetch cannot cancel server work; its drain completion must never remove a
  // message the client queued for the replacement conversation.
  const conversationEpoch = useRef(0);

  // FIX (review finding, Important 2). The old fallback here was
  // `sessionId ?? liveSessionId.current`, which makes "no session" permanently
  // unrepresentable: once the ref holds an id, no later `null` prop can clear
  // it, so a fresh conversation (`sessionId: null` again) would silently keep
  // POSTing to the PREVIOUS conversation's agent route. A prop CHANGE is
  // authoritative, null included — that is a new conversation. An UNCHANGED
  // prop must not clobber an id this hook created itself inside a turn, which
  // is the window the old fallback existed to cover. Distinguishing the two
  // needs the previous value; the prop alone cannot tell "parent hasn't
  // caught up yet" from "different conversation". Clearing the queue and
  // resetting to `IDLE_TURN` on a real change is part of the same fix, not an
  // extra: carrying one conversation's queued messages or streamed text into
  // another is the same bug wearing different clothes. An in-flight turn's
  // `running` guard is deliberately left set until its own loop exits or
  // aborts — it is not torn out mid-read.
  //
  // FIX (coordinator ruling, round 4). The first version of this guard only
  // checked the OUTER `if` below and reset on every prop change, including
  // the prop merely catching up to an id this hook created itself: turn 1 of
  // a fresh conversation calls `onSessionCreated(id)`, which (in Task 6) sets
  // state that re-renders this hook with `sessionId === id` — at that render
  // `previousSessionId.current` was still `null`, so the outer condition was
  // true and the reset fired WHILE THAT SAME TURN'S STREAM WAS STILL
  // RUNNING: `queue.current = []` silently dropped anything queued behind
  // the first message, and `setTurn(IDLE_TURN)` blanked a turn still
  // receiving `message.delta` events. The inner check is what distinguishes
  // the two cases the outer comment already named but did not actually
  // guard: a prop change IS a new conversation unless it is merely echoing
  // back the id `liveSessionId` already holds.
  const previousSessionId = useRef(sessionId);
  if (sessionId !== previousSessionId.current) {
    previousSessionId.current = sessionId;
    if (sessionId !== liveSessionId.current) {
      // FIX (coordinator ruling, round 5). A REAL conversation change, so
      // stop the turn that belongs to the old one. Without this, its reader
      // keeps folding deltas and its terminal onto the state we just reset
      // for the new conversation — `turn` is one piece of state, not keyed
      // by session, so nothing else would stop the old stream from writing
      // on top of it. The abort lands in `runOneTurn`'s catch, in the
      // `AbortError` branch, which deliberately sets no state — the same
      // path unmount already uses below — so the old turn simply stops
      // touching state instead of racing the new one.
      abort.current?.abort();
      conversationEpoch.current += 1;
      liveSessionId.current = sessionId;
      queue.current = [];
      setTurn(IDLE_TURN);
    }
  }

  useEffect(() => () => abort.current?.abort(), []);

  const runOneTurn = useCallback(async (message: string): Promise<"recorded" | "refused"> => {
    // Created up front, not after session resolution, so an unmount during
    // the session-creation await is visible to the `finally` below too.
    const controller = new AbortController();
    abort.current = controller;
    let sawTurnEnd = false;
    // FIX (coordinator ruling, round 3). Flips true the instant `response.ok`
    // is confirmed — see `CONNECTION_DROPPED_EXPLANATION`'s comment for why
    // that moment is a PROOF the message is persisted, not a guess. Nothing
    // after that point may report "refused" or say nothing was saved.
    let haveRecorded = false;
    try {
      let id = liveSessionId.current;
      if (id === null) {
        // The agent route needs an id. A message-less create makes one and runs
        // no turn (§9 step 5, Task 1) — the message itself is recorded by the
        // agent route at §5.1 step 3, exactly once.
        const created = await postJson<ChatSessionEnvelope>(
          "/api/client/chat/sessions",
          { platform, idempotency_key: crypto.randomUUID() },
        );
        // FIX (coordinator ruling, round 5, second finding). `postJson`
        // (`src/lib/retry-fetch.ts`) takes no `AbortSignal`, so the abort a
        // conversation switch fires during this round trip (see the reset
        // above) could not cancel it. Everything below writes state shared
        // with whatever conversation the client switched TO — the live id,
        // the parent's notification, and the streaming status — so none of
        // it may run once this turn has been abandoned. Returning here
        // leaves an empty session in Postgres with no message; the next
        // active-session read finds it, indistinguishable from an ordinary
        // fresh conversation. Deliberately NOT calling `onSessionCreated`
        // here to salvage the id: that would reintroduce the very clobber
        // this fix exists to prevent.
        if (controller.signal.aborted) return "refused";
        id = created.session.id;
        liveSessionId.current = id;
        onSessionCreated(id);
      }

      setTurn((state) => ({ ...state, status: "streaming", text: "", label: null, terminal: null }));

      // A11: the browser mints ONE turn id; every tool's idempotency key derives
      // from it, server-side.
      const response = await fetch(
        `/api/client/chat/sessions/${encodeURIComponent(id)}/agent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, turnId: crypto.randomUUID() }),
          signal: controller.signal,
          cache: "no-store",
        },
      );

      if (!response.ok) {
        // FIX (Important 4). This body is never going to be read — release
        // the connection promptly rather than waiting on GC.
        void response.body?.cancel();
        setTurn((state) => refusedTurn(state, NOTHING_SAVED_EXPLANATION));
        return "refused";
      }
      haveRecorded = true;

      if (response.body === null) {
        // FIX (coordinator ruling, round 4, consistency fix). This USED to be
        // folded into the `!response.ok` check above and always returned
        // "refused" — which contradicted the comment on `haveRecorded`
        // (`response.ok` proves the message is persisted) three lines above
        // it: `response.ok` is already confirmed true here, so this message
        // IS recorded even though there is nothing to stream. No terminal
        // guard is needed the way the `catch` block below needs one: nothing
        // between the `fetch` resolving and this check could have set a real
        // `terminal` on `state`, since no bytes have been read yet. Unlikely
        // against this route's real `Response` (it always attaches a
        // `ReadableStream` body to its one 2xx), but the code must not
        // assert one thing in a comment and do another three lines away.
        setTurn((state) => refusedTurn(state, CONNECTION_DROPPED_EXPLANATION));
        return "recorded";
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawDraft = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = parseEventFrames(buffer);
        buffer = rest;
        for (const event of events) {
          if (event.type === "turn.end") sawTurnEnd = true;
          if (event.type === "draft.ready") sawDraft = true;
          setTurn((state) => foldEvent(state, event));
        }
        if (sawDraft) {
          // The card renders a VERIFIED variant read back from Python, never a
          // streamed body (§5.3). Refetch as soon as the id lands rather than
          // waiting for the turn to close.
          sawDraft = false;
          await refresh();
        }
      }
      // `turn.end` has been folded by now if the server sent one; either way
      // the durable transcript is the truth from here.
      await refresh();
      return "recorded";
    } catch (error) {
      // FIX (Critical 1). Every off-happy-path exit used to escape uncaught:
      // `fetch` rejecting (offline, DNS), `reader.read()` rejecting mid-stream,
      // `refresh()` rejecting, `postJson` exhausting its retries — the
      // rejection propagated out of `drain`'s promise into `void drain()` as
      // an unhandled rejection, leaving state stuck at `{status: "streaming",
      // terminal: null}`: a spinner with no explanation and no recovery.
      //
      // Unmount aborting the in-flight read (the cleanup effect below) is the
      // ROUTINE case here, not an exotic one — a turn can run the full 120s
      // deadline, and navigating away mid-turn is ordinary use. There is no
      // component left to show a refusal to, so it is skipped rather than
      // reset to refused.
      const aborted = error instanceof Error && error.name === "AbortError";
      if (!aborted) {
        setTurn((state) =>
          state.terminal !== null
            // FIX (coordinator ruling, round 3, finding 2). Python already
            // explained this turn — a real `terminal` event landed before the
            // connection dropped. A transport failure afterwards is not a
            // better explanation than the server's own, so keep theirs and
            // just stop streaming rather than clobbering it with the generic
            // sentence below.
            ? { ...state, status: "idle", label: null, text: "" }
            : refusedTurn(state, haveRecorded ? CONNECTION_DROPPED_EXPLANATION : NOTHING_SAVED_EXPLANATION),
        );
      }
      // FIX (coordinator ruling, round 3, finding 1). `haveRecorded` is a
      // PROOF at this point (see its own declaration comment), not an
      // estimate — once `response.ok` was true, Python already holds this
      // message as a persisted `task` row, so a retry from the client would
      // duplicate it rather than recover it. `"recorded"` here regardless of
      // whether this was an abort: the message's durability does not depend
      // on whether anyone is still around to read the rest of the stream.
      return haveRecorded ? "recorded" : "refused";
    } finally {
      // FIX (Critical 1, second half). The same stuck-in-`streaming` state is
      // reachable with NO exception at all: if the stream ends without a
      // `turn.end` frame (a truncated response, or a final frame whose
      // delimiter never arrives and stays parked in `parseEventFrames`'
      // `rest`), the read loop above exits normally and `status` is still
      // `"streaming"`. Guarantee the turn always leaves `streaming` rather
      // than trusting the server's last frame. `foldEvent`'s `turn.end`
      // branch only ever touches `status`/`label`/`text` and leaves
      // `terminal` untouched, so folding a synthetic one here on top of
      // whatever state already exists (idle-and-refused from the branches
      // above, idle-and-successful from a real `turn.end`, or still-streaming
      // if none arrived) is idempotent — checked by
      // `tests/chat/agent-turn.test.ts`'s "turn.end folded twice" case.
      // Skipped on an aborted turn: nothing is listening any more.
      if (!sawTurnEnd && !controller.signal.aborted) {
        setTurn((state) => foldEvent(state, { type: "turn.end" }));
      }
    }
  }, [onSessionCreated, refresh]);

  // FIX (Ruling D2 → deepened, §9 step 5 Task 5). Ruling D2's first pass made
  // `drain` depend on `[runOneTurn]` instead of `[]`, which stopped `drain`
  // from capturing the FIRST `runOneTurn` forever. That was not enough:
  // `drain` is single-flight (the `running` ref below), so one invocation's
  // `while` loop can outlive SEVERAL identity changes of `runOneTurn` — in
  // Task 6, `refresh` changes identity the moment a first turn creates the
  // session (`onSessionCreated` → a `resolvedSessionId` update → `refresh`'s
  // own `useCallback` deps move), which happens WHILE this loop is still
  // running. A client who types two messages quickly into a fresh
  // conversation hits exactly this on the second one. Reading the CURRENT
  // closure on every iteration, via a ref, removes the whole class rather
  // than leaving each instance to be argued about — the alternative depends
  // on `fetchEnvelope(null)` happening to resolve to the same session, which
  // is a property of a helper in a different file that nobody has promised
  // to preserve.
  const runOneTurnRef = useRef(runOneTurn);
  runOneTurnRef.current = runOneTurn;

  // `drain` itself now closes over nothing that goes stale — `runOneTurnRef`
  // is a ref (stable identity), and `queue`/`running` are refs already — so
  // `[]` is an honest dependency array, not a shortcut the way it was before
  // this fix.
  const drain = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (queue.current.length > 0) {
        const message = queue.current[0];
        const epoch = conversationEpoch.current;
        const outcome = await runOneTurnRef.current(message);
        // A Stop/New-post action abandoned this turn while its request was in
        // flight. Leave the replacement epoch's queue untouched; this same
        // drain can continue with its new head.
        if (epoch !== conversationEpoch.current) continue;
        // FIX (Important 3, sharpened by the round-3 ruling). This used to
        // drop the head unconditionally, which is right ONLY on `"recorded"`.
        // `runOneTurn` now returns `"refused"` ONLY when `response.ok` was
        // never true for this message — a PROVABLE condition (see
        // `CONNECTION_DROPPED_EXPLANATION`'s comment), not a guess — so
        // `"refused"` here means the message is genuinely not a persisted
        // `task` row. Dropping it in that case would erase the client's own
        // text from the screen while the refusal on screen tells them to
        // retype exactly what was just deleted. Stop draining instead and
        // leave the head in `echo`; a later `send` resumes from this same
        // head, so order and content both survive. This also means the loop
        // does not march straight into the NEXT queued message against a
        // server that just refused one, and a later successful `runOneTurn`
        // does not clear the refusal the client was just shown — both are
        // the direct
        // effect of leaving `outcome !== "recorded"` alone here.
        if (outcome !== "recorded") break;
        queue.current = queue.current.slice(1);
        setTurn((state) => ({ ...state, echo: queue.current }));
      }
    } finally {
      running.current = false;
    }
  }, []);

  const send = useCallback((message: string) => {
    const trimmed = message.trim();
    if (trimmed.length === 0 || trimmed.length > AGENT_TURN_MAX_CHARS) return;
    queue.current = [...queue.current, trimmed];
    setTurn((state) => ({ ...state, echo: queue.current }));
    void drain();
  }, [drain]);

  const cancel = useCallback(() => {
    abort.current?.abort();
    conversationEpoch.current += 1;
    queue.current = [];
    setTurn(IDLE_TURN);
  }, []);

  return { turn, send, cancel };
}

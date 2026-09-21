"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getJson, HttpError, postJson } from "@/lib/api";
import type {
  ChatCommandCreate,
  ChatMessage,
  ChatSessionEnvelope,
  NoActiveChatSession,
} from "@/lib/product";
import { useAgentTurn, type AgentTurnState } from "./useAgentTurn";

type Keyed<T> = { key: string; value: T };
type PendingMutation = { actionId: string; kind: "command" };
type RequestFailure = { error: unknown; kind: "transport" | "refusal" | "expired" };
export type ChatCommandWithoutIdempotency = ChatCommandCreate extends infer Command
  ? Command extends { idempotency_key: string }
    ? Omit<Command, "idempotency_key">
    : never
  : never;

/**
 * NINE STATES, DOWN FROM TWELVE (§9 step 5). Three went because they were
 * unreachable and three because they were the wrong mechanism:
 *
 *  - `generating` x3 stages: `_run_context_operation` clears
 *    `generation_stage` unconditionally (`src/product/api/chat.py:765`) so a
 *    synchronous lane cannot leave a permanent spinner. The column is always
 *    null on the agent path, so a phase derived from it can never render.
 *    `working`, fed by an open stream, replaces all three.
 *  - `clarification` / `conflict` / `optional`: readiness projections whose
 *    job was ROUTING the composer. The agent reads gaps and conflicts out of
 *    `context.v1` and asks in its own prose, which is D4/D6. `readiness`
 *    still rides the envelope and still feeds the draft card's material note
 *    and the compose header's pending-fact pill — the routing is what went.
 */
export type ChatUiPhase =
  | { kind: "empty" }
  | { kind: "ready"; session: ChatSessionEnvelope }
  /** A stream is open. `session` may be null: the first turn of a conversation
   *  creates the session behind the stream. */
  | { kind: "working"; session: ChatSessionEnvelope | null; label: string | null; text: string }
  | { kind: "verified"; session: ChatSessionEnvelope }
  /** One renderer for both terminal sources — Python's stored `terminal_state`
   *  and the stream's `terminal` event. The stream has no `next_action` to
   *  give, hence the null. */
  | { kind: "terminal"; session: ChatSessionEnvelope | null; reason: string; nextAction: string | null }
  | { kind: "refusal"; error: HttpError }
  | { kind: "finished"; session: ChatSessionEnvelope }
  | { kind: "expired" }
  | { kind: "unknown"; session: ChatSessionEnvelope | null };

function readKeyed<T>(held: Keyed<T> | null, key: string): T | null {
  return held?.key === key ? held.value : null;
}

export function needsSessionRead(snapshotKey: string | null, requestKey: string): boolean {
  return snapshotKey !== requestKey;
}

/**
 * A null envelope is meaningful only after the active-session read has
 * settled: it means the server confirmed that this client has no active
 * conversation. Before then, null merely means "not restored yet" and a
 * create would race an existing server session into a 409.
 */
export function isSessionReadReady(
  snapshotKey: string | null,
  requestKey: string,
  hasFailure: boolean,
): boolean {
  return !hasFailure && !needsSessionRead(snapshotKey, requestKey);
}

function isEnvelope(value: ChatSessionEnvelope | NoActiveChatSession): value is ChatSessionEnvelope {
  return value.session !== null;
}

async function fetchEnvelope(exactId: string | null): Promise<ChatSessionEnvelope | null> {
  try {
    const response = await getJson<ChatSessionEnvelope | NoActiveChatSession>(
      exactId === null
        ? "/api/client/chat/sessions"
        : `/api/client/chat/sessions/${encodeURIComponent(exactId)}`,
    );
    return isEnvelope(response) ? response : null;
  } catch (error) {
    // Some deployed chat APIs use 404 for an empty active-session collection,
    // while an explicit session-id 404 still means that conversation is gone.
    if (exactId === null && error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}

/**
 * Every server state, and every live stream state, maps to renderable UI.
 *
 * PRECEDENCE, IN THIS ORDER, AND THE ORDER IS THE CONTRACT:
 *
 *  1. `expiredByRead` and a fatal `HttpError`. Liveness and auth outrank
 *     everything — a stream against a dead session must not paint as work.
 *  2. The envelope's own `expired` status, checked only while a session
 *     exists. Kept ahead of the stream for the same reason as (1): a dead
 *     session must not paint as work even once the envelope has caught up.
 *  3. A RUNNING TURN (`turn.status === "streaming"`) — but its OWN terminal
 *     event first, if one has already landed this turn, then `working`.
 *     This is A10, widened by the review's Important 1 fix: before the
 *     envelope has caught up (including the whole first turn of a
 *     conversation, where `session` is still null), the stream is the only
 *     signal that a turn ran or is running, and that is true whether or not
 *     Python has ever recorded a `finished`/unmapped status or a stale
 *     `terminal_state` from a PREVIOUS turn. Both of those are, by
 *     construction, information from before this turn started: `refresh()`
 *     — the only thing that can update `session` — is awaited only AFTER
 *     the read loop exits, which is after `turn.end`, which is after
 *     `status` leaves `"streaming"`. So while `status === "streaming"`,
 *     anything sitting in `session` is provably stale and `turn` is
 *     provably the freshest fact — including `turn.terminal`, which
 *     `runOneTurn` resets to `null` at the start of every turn, so a
 *     non-null value here can only be THIS turn's own terminal event,
 *     arrived before its `turn.end`.
 *  4. A PERSISTED `terminal_state`, once the turn is no longer streaming.
 *     Python's stored row is the truth (§5.5) and, once it exists, carries
 *     more than the stream ever can — a real `next_action` — so it wins over
 *     the stream's own (necessarily older, once idle) terminal event.
 *  5. The stream's own `terminal`, for the case the envelope never got a
 *     matching `terminal_state` (or `session` is still null).
 *  6. The rest of the envelope — finished, unmapped-status-as-unknown,
 *     verified, then ready.
 *
 * FIX (review finding, Important 1, ORIGINAL). An earlier version checked
 * the stream's `terminal` BEFORE the envelope's `terminal_state`.
 * `turn.terminal` is STICKY — `foldEvent`'s `turn.end` branch deliberately
 * never clears it, only the next `runOneTurn` does — so after a turn ends
 * held/refused, the stream carries an `explanation` with `nextAction: null`
 * forever, even once `refresh()` lands and `session.terminal_state` holds
 * the real `next_action`. Checking the envelope's terminal state first (once
 * idle) means Python's `next_action` is read the moment it exists, instead
 * of being shadowed by the stream until the next message starts a fresh
 * turn.
 *
 * FIX (whole-branch review, Important 1, ROUND 2). That fix over-corrected:
 * moving the envelope's status switch AND its `terminal_state` check ahead
 * of the stream meant a `finished` status (I1a — a send after `finish`
 * produced no feedback at all) or a stale `terminal_state` (I1b — the
 * recovery turn after a held draft rendered no activity for its whole 120s)
 * could shadow a turn that is running RIGHT NOW. `turn.status ===
 * "streaming"` is moved back ahead of both, because a running turn is
 * always the most current fact available — reasoning above. The one thing
 * kept from the original fix: once idle, the persisted `terminal_state`
 * still outranks the stream's sticky one.
 */
export function phaseForChat(
  session: ChatSessionEnvelope | null,
  fatalError: unknown | null,
  expiredByRead: boolean,
  turn: AgentTurnState,
): ChatUiPhase {
  if (expiredByRead) return { kind: "expired" };
  if (fatalError instanceof HttpError) return { kind: "refusal", error: fatalError };

  if (session !== null && session.session.status === "expired") {
    return { kind: "expired" };
  }

  if (turn.status === "streaming") {
    if (turn.terminal !== null) {
      return { kind: "terminal", session, reason: turn.terminal.explanation, nextAction: null };
    }
    return { kind: "working", session, label: turn.label, text: turn.text };
  }

  if (session !== null && session.terminal_state !== null) {
    return {
      kind: "terminal",
      session,
      reason: session.terminal_state.reason,
      nextAction: session.terminal_state.next_action,
    };
  }

  if (turn.terminal !== null) {
    return { kind: "terminal", session, reason: turn.terminal.explanation, nextAction: null };
  }

  if (session === null) return { kind: "empty" };

  switch (session.session.status) {
    case "finished":
      return { kind: "finished", session };
    case "active":
      break;
    default:
      // The exhaustiveness guarantee the old readiness and stage switches
      // carried. Both are gone, so this is the one place left where an
      // unmapped wire value is caught rather than read as "ready". Reaching
      // this switch at all already proves `status !== "expired"` (returned
      // above) and `status !== "streaming"` (also returned above), so only
      // `finished`, `active` and genuinely unmapped values arrive here.
      return { kind: "unknown", session };
  }

  if (session.variants.some((variant) => variant.status === "verified")) {
    return { kind: "verified", session };
  }
  return { kind: "ready", session };
}

/**
 * FIX (review finding, Important 2). The client's own queued messages,
 * filtered against the envelope's persisted `task` rows — so a message that
 * has already landed durably does not also render as a local echo for one
 * paint (see `useChatSession`'s call site for why the filter lives here
 * rather than inside `useAgentTurn`).
 *
 * COUNTS, NOT MEMBERSHIP. A client can legitimately send the same text
 * twice — "ok", wait for it to land, then "ok" again — and a `Set` of
 * persisted bodies would filter the SECOND send too, since the text alone
 * cannot tell the two apart: it would sit in `persisted` forever the moment
 * the first "ok" landed, hiding every later "ok" from the composer for as
 * long as its own turn runs. Walking `echo` in order and decrementing a
 * shared count consumes at most as many echo entries as there are UNMATCHED
 * persisted rows with that exact body — so once a body's persisted rows are
 * all claimed by earlier echo entries, a later, still-unrecorded entry with
 * the same text is correctly left alone.
 *
 * FIX (whole-branch review, Important 3). Counting alone is not enough: it
 * counts EVERY `task` row in the whole conversation, not just this turn's.
 * A client who says "ok" in turn 2, having said the identical "ok" in turn
 * 1 (already persisted), sends a NEW echo entry that the OLD turn's
 * persisted row consumes immediately — the new echo never renders, for the
 * whole turn. Text alone cannot tell turn 1's row from turn 2's; the fix is
 * POSITIONAL. `sinceTaskCount` is the number of `task` rows that already
 * existed the moment this send happened (captured by `useChatSession`'s
 * `sendTurn` wrapper, before it calls the hook's `send`); rows at or after
 * that position are this turn's own, and only those are eligible to consume
 * an echo entry. Rows before it are the OLD conversation's, and must never
 * shadow a legitimate repeat.
 */
export function dedupeEcho(echo: string[], messages: ChatMessage[], sinceTaskCount = 0): string[] {
  const persistedTaskBodyCounts = new Map<string, number>();
  let taskIndex = 0;
  for (const entry of messages) {
    if (entry.kind !== "task") continue;
    const index = taskIndex;
    taskIndex += 1;
    if (index < sinceTaskCount) continue;
    const body = entry.body.trim();
    persistedTaskBodyCounts.set(body, (persistedTaskBodyCounts.get(body) ?? 0) + 1);
  }
  const kept: string[] = [];
  for (const message of echo) {
    const body = message.trim();
    const remaining = persistedTaskBodyCounts.get(body) ?? 0;
    if (remaining > 0) {
      persistedTaskBodyCounts.set(body, remaining - 1);
      continue;
    }
    kept.push(message);
  }
  return kept;
}

function readFailure(error: unknown, exactId: string | null): RequestFailure {
  if (!(error instanceof HttpError)) return { error, kind: "transport" };
  return {
    error,
    kind: error.status === 404 && exactId !== null ? "expired" : "refusal",
  };
}

function mutationFailure(error: unknown): RequestFailure {
  return { error, kind: error instanceof HttpError ? "refusal" : "transport" };
}

/**
 * Restore an opaque server session and keep rendering tied to its latest full
 * envelope. Browser state owns neither identity, expiry, readiness, nor stage.
 */
export function useChatSession(sessionId: string | null): {
  phase: ChatUiPhase;
  session: ChatSessionEnvelope | null;
  error: unknown | null;
  echo: string[];
  activeSessionId: string | null;
  canSend: boolean;
  restoring: boolean;
  sendTurn: (message: string) => void;
  cancelTurn: () => void;
  sendCommand: (command: ChatCommandWithoutIdempotency, actionId: string) => Promise<ChatSessionEnvelope | null>;
  retryTransport: () => Promise<void>;
  pendingMutation: PendingMutation | null;
} {
  const requestKey = sessionId ?? "active";
  const [resolvedSessionId, setResolvedSessionId] = useState<string | null>(sessionId);
  const [previousRequestedSessionId, setPreviousRequestedSessionId] = useState<string | null>(sessionId);
  if (sessionId !== previousRequestedSessionId) {
    setPreviousRequestedSessionId(sessionId);
    setResolvedSessionId(sessionId);
  }
  const key = resolvedSessionId ?? requestKey;
  const [snapshot, setSnapshot] = useState<Keyed<ChatSessionEnvelope | null> | null>(null);
  const [transport, setTransport] = useState<Keyed<RequestFailure> | null>(null);
  const [pending, setPending] = useState<Keyed<PendingMutation> | null>(null);
  const retryRef = useRef<(() => Promise<void>) | null>(null);

  const session = readKeyed(snapshot, key);
  const failure = readKeyed(transport, key);
  const pendingMutation = readKeyed(pending, key);
  const canSend = isSessionReadReady(snapshot?.key ?? null, key, failure !== null);
  const restoring = failure === null && !canSend;

  const retryRead = useCallback(async (stateKey: string, exactId: string | null) => {
    try {
      const response = await fetchEnvelope(exactId);
      const authoritativeKey = response?.session.id ?? stateKey;
      setSnapshot({ key: authoritativeKey, value: response });
      // FIX (whole-branch review, Important 2). NEVER DOWNGRADE TO NULL. This
      // setter is the ADVISORY writer of this prop; the URL-param sync above
      // (`previousRequestedSessionId`) is the authoritative one. A read that
      // resolves "no active session" — which a mount GET can do while a turn
      // is concurrently creating one via `onSessionCreated` — must not tell
      // `useAgentTurn` the conversation changed, because it reads a null prop
      // as exactly that and aborts the running stream (see that hook's own
      // comment: "A prop CHANGE is authoritative, null included"). Falling
      // back to `current` rather than `null` means a stale "no session" read
      // can never clobber an id this hook, or `useAgentTurn`, already holds.
      setResolvedSessionId((current) => response?.session.id ?? exactId ?? current);
      setTransport(null);
    } catch (error) {
      setTransport({ key: stateKey, value: readFailure(error, exactId) });
    }
  }, []);

  const readSession = useCallback(async (stateKey: string, exactId: string | null) => {
    try {
      const response = await fetchEnvelope(exactId);
      const authoritativeKey = response?.session.id ?? stateKey;
      setSnapshot({ key: authoritativeKey, value: response });
      // FIX (whole-branch review, Important 2). See `retryRead`'s identical
      // comment above — this is the other writer of the same hazard.
      setResolvedSessionId((current) => response?.session.id ?? exactId ?? current);
      setTransport(null);
    } catch (error) {
      setTransport({ key: stateKey, value: readFailure(error, exactId) });
      if (!(error instanceof HttpError)) retryRef.current = () => retryRead(stateKey, exactId);
    }
  }, [retryRead]);

  useEffect(() => {
    // The active-session endpoint already returns the complete envelope. Once
    // that read resolves it promotes both the snapshot and `resolvedSessionId`
    // to the authoritative id. The resulting key change must not immediately
    // fetch the same envelope again (and URL synchronisation must not cause a
    // third read). A newly requested id still has a different key and reads as
    // normal.
    if (!needsSessionRead(snapshot?.key ?? null, key)) return;
    const first = setTimeout(() => {
      void readSession(key, resolvedSessionId ?? sessionId);
    }, 0);
    return () => clearTimeout(first);
  }, [key, readSession, resolvedSessionId, sessionId, snapshot?.key]);

  // The envelope refetch the stream asks for. Wrapped so `useAgentTurn` needs
  // to know nothing about this hook's keying.
  const refresh = useCallback(async () => {
    await readSession(key, resolvedSessionId ?? session?.session.id ?? null);
  }, [key, readSession, resolvedSessionId, session?.session.id]);

  const { turn, send, cancel } = useAgentTurn({
    sessionId: resolvedSessionId,
    onSessionCreated: setResolvedSessionId,
    refresh,
  });

  // FIX (whole-branch review, Important 3). The mark `dedupeEcho` needs to
  // tell "this turn's persisted rows" from "an earlier turn's" — captured
  // here, at send time, rather than inside `useAgentTurn` (which never sees
  // `session.messages`). A ref, not state: the value only needs to be read
  // at render time by the `echo` computation below, and writing it in the
  // same synchronous call as `send` (before that queues the message and
  // triggers `useAgentTurn`'s own state update) means the mark is never one
  // render behind the send it describes.
  const taskCountAtSendRef = useRef(0);
  const sendTurn = useCallback((message: string) => {
    if (!canSend) return;
    taskCountAtSendRef.current = (session?.messages ?? []).filter((entry) => entry.kind === "task").length;
    send(message);
  }, [canSend, send, session]);

  const retryMutation = useCallback(async (
    kind: PendingMutation["kind"],
    actionId: string,
    run: () => Promise<ChatSessionEnvelope>,
  ): Promise<void> => {
    setPending({ key, value: { actionId, kind } });
    try {
      const next = await run();
      setSnapshot({ key: next.session.id, value: next });
      setResolvedSessionId(next.session.id);
      setTransport(null);
      await readSession(next.session.id, next.session.id);
    } catch (error) {
      setTransport({ key, value: mutationFailure(error) });
      throw error;
    } finally {
      setPending(null);
    }
  }, [key, readSession]);

  const performMutation = useCallback(async (
    kind: PendingMutation["kind"],
    actionId: string,
    run: () => Promise<ChatSessionEnvelope>,
  ): Promise<ChatSessionEnvelope> => {
    if (pendingMutation !== null) throw new Error("A chat mutation is already in progress.");
    setPending({ key, value: { actionId, kind } });
    try {
      const next = await run();
      setSnapshot({ key: next.session.id, value: next });
      setResolvedSessionId(next.session.id);
      setTransport(null);
      await readSession(next.session.id, next.session.id);
      return next;
    } catch (error) {
      setTransport({ key, value: mutationFailure(error) });
      if (!(error instanceof HttpError)) retryRef.current = async () => { await retryMutation(kind, actionId, run); };
      throw error;
    } finally {
      setPending(null);
    }
  }, [key, pendingMutation, readSession, retryMutation]);

  const sendCommand = useCallback(async (
    command: ChatCommandWithoutIdempotency,
    actionId: string,
  ) => {
    const targetSessionId = session?.session.id ?? resolvedSessionId;
    if (targetSessionId === null) return null;
    return performMutation("command", actionId, () =>
      postJson<ChatSessionEnvelope>(
        `/api/client/chat/sessions/${encodeURIComponent(targetSessionId)}/commands`,
        { ...command, idempotency_key: actionId },
        { idempotencyKey: actionId },
      ),
    );
  }, [performMutation, resolvedSessionId, session?.session.id]);

  const retryTransport = useCallback(async () => {
    if (failure?.kind !== "transport" || retryRef.current === null) return;
    await retryRef.current();
  }, [failure?.kind]);

  // FIX (carried forward from Task 5's review, Important). `useAgentTurn.refresh`
  // resolves BEFORE the queue head is dropped (deliberately — see that hook's own
  // comment: dropping the echo first would flicker a MISSING message, which is
  // worse), so there is a commit where both the persisted `task` row and the
  // local echo entry are present at once and the client would see their message
  // twice for one paint. The ordering stays put; the dedupe lives here instead,
  // at the consumer, against the envelope this hook already reads — see
  // `dedupeEcho`'s own comment for why it counts rather than tests membership.
  //
  // FIX (whole-branch review, Important 3). `taskCountAtSendRef.current` is
  // the mark: only `task` rows recorded from this turn onward are eligible
  // to consume an echo entry, so an identical send from an EARLIER, already-
  // persisted turn can never shadow this one's.
  const echo = dedupeEcho(turn.echo, session?.messages ?? [], taskCountAtSendRef.current);

  return {
    phase: phaseForChat(
      session,
      failure?.kind === "refusal" ? failure.error : null,
      failure?.kind === "expired",
      turn,
    ),
    session,
    error: failure?.error ?? null,
    activeSessionId: resolvedSessionId,
    canSend,
    restoring,
    /** Client messages not yet in the envelope. `ChatPath` renders these as
     *  user turns so a queued message is visible the instant it is sent. */
    echo,
    sendTurn,
    cancelTurn: cancel,
    sendCommand,
    retryTransport,
    pendingMutation: pendingMutation ?? null,
  };
}

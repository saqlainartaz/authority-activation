import "server-only";

/**
 * §5.2 — turning the stored transcript into model messages.
 *
 * THIS IS THE FUNCTION A8 RESTS ON. The agent is stateless per turn (A3), so it
 * rebuilds its whole context from `chat_messages` every time. Whatever this
 * function puts in the assistant role is what the model believes it previously
 * said. Exactly one kind earns that — `agent`, which the runtime authors and the
 * model can never write (A9). Everything else is delimited data.
 *
 * TWO DELIBERATE DEPARTURES FROM §5.2 AS WRITTEN, both from amendment 7/8:
 *
 * 1. `command` rows are NOT skipped. The spec calls them "bookkeeping, not
 *    conversation", but `serialize_chat_session` (`service.py:435`) has already
 *    dropped every empty-bodied ledger row, and what survives that filter is the
 *    client's own prose — including their answer to the agent's own question,
 *    because `answer_clarification` is a COMMAND kind. Skipping them makes the
 *    agent ask, be answered, and ask again forever.
 * 2. The skip list is explicit and short, and everything else is included.
 *    Skip-by-default is what produced the hole above, so the direction is
 *    reversed: forgetting to classify a new kind now costs a delimited data
 *    block, not silence.
 *
 * AND ONE INVARIANT WORTH STATING: the role is derived from `kind`, never read
 * from the wire's `role`. `clarification` and `response` are both stored
 * `role="assistant"` while being server-composed from client-derived text. If
 * this function trusted that column, untrusted prose would wear the assistant
 * role, which is the seam `chat/generation.py:227-244` warns about.
 *
 * ESCAPING: every WRAPPED body — `task`, `clarification`, `command`, and the
 * catch-all/`response` branch — has `&` and `<` escaped before it goes inside
 * its delimiter tag, via `escapeForBody`. Without that, adjacent same-role
 * messages get concatenated into one turn before the provider call (most
 * chat-completion APIs require alternating roles, and this function emits
 * runs of consecutive `user` entries), and a client body containing a literal
 * `</client-message>` or a fabricated `<server-note trust="untrusted">` could
 * forge a tag boundary and impersonate a different, more-trusted-looking
 * category. `>` is left alone — it cannot open a tag, so escaping it would
 * corrupt more client prose for no safety gained.
 *
 * `"` is deliberately NOT escaped in a body, and that is a second, separate
 * function (`escapeForBody`) from the one used for the `command_kind`
 * attribute value (`escapeForAttribute`). A body has no quote delimiter to
 * protect — this product's source material is sales-call transcripts, where
 * quoted speech (`he said "we doubled"`) is common, and escaping `"` there
 * would corrupt exactly that prose for no security gain. An *attribute*
 * value is different: `command_kind` is interpolated inside `kind="..."`, so
 * an unescaped `"` there would terminate the attribute early and let the
 * value inject a new one — `escapeForAttribute` escapes `"` for that reason
 * and that reason only.
 *
 * The `agent` branch is the one exemption from either escaper — it carries
 * no wrapper, so there is no delimiter to break out of, and escaping the
 * model's own prior words would corrupt what it actually said.
 */

export type TranscriptMessage = {
  id: string;
  role: string;
  kind: string;
  body: string;
  /** Present only once Python projects it. See amendment 8. */
  command_kind?: string | null;
  /** The server-issued handle for a client turn, `U{ordinal}`, or null.
   *
   *  **Issued by Python and rendered verbatim — never derived here.**
   *  `use_task_material` takes one of these, and the ordinal it encodes
   *  counts assistant and command rows too, so the third CLIENT turn is
   *  typically `U5`. A second derivation in TypeScript would eventually
   *  disagree and attribute a client's own words to the wrong turn. */
  handle?: string | null;
};

export type ModelMessage = {
  role: "assistant" | "user";
  /** The message's text. Empty on a message that only carries tool results. */
  content: string;
  /** Assistant only: the tool calls this pass made, in the order it made them. */
  toolCalls?: ToolCallPart[];
  /** Assistant only: the provider's own content blocks for this pass, returned
   *  UNCHANGED on the next call -- thinking blocks carry signatures the API
   *  requires back verbatim, and re-deriving them would drop the reasoning. */
  providerBlocks?: unknown[];
  /** User only: one result per tool call of the preceding assistant message. */
  toolResults?: ToolResultPart[];
  /** Stable client-source prefix; maps to an ephemeral provider cache marker. */
  cache?: boolean;
};

/** One tool call, as the model made it. */
export type ToolCallPart = {
  id: string;
  name: string;
  input: unknown;
};

/** One tool call's outcome, sent back as a NATIVE tool result.
 *
 *  **Data only.** Harness guidance does not belong here: Claude is trained to
 *  treat instructions inside a tool result as possibly untrusted third-party
 *  content (Anthropic, "Troubleshooting tool use"). Rules for using a tool live
 *  in its description and in the instructions. */
export type ToolResultPart = {
  toolUseId: string;
  name: string;
  content: string;
  /** A rejection or failure: the model should correct its call, not proceed. */
  isError: boolean;
};

/**
 * `command_kind` VALUES that carry no conversational content — NOT `kind`
 * values. `src/product/models.py:188` constrains `kind` to `('task',
 * 'response', 'clarification', 'command', 'agent')`; `show_sources` is a
 * `command_kind` (`src/product/chat/commands.py:49`), a value the `command`
 * ROW's own `command_kind` column can carry, never a `kind` itself. Keying
 * this set on `kind` made it unreachable — no row can have `kind ===
 * "show_sources"` — which is exactly the defect this fix corrects (C1,
 * 2026-08-24). Anything not listed here is rendered.
 *
 * `show_sources` is here because it asks Python for receipts already visible
 * in the envelope; replaying it tells the model nothing it does not have.
 */
const SKIPPED_COMMAND_KINDS = new Set(["show_sources"]);

// For the `command_kind` ATTRIBUTE value only. `"` MUST be escaped here: it
// is the attribute's own delimiter, and an unescaped one would terminate
// `kind="..."` early and let the value inject a new attribute. `&` first, or
// `<`/`"` escaped afterward would double-escape an `&` that came from one of
// those substitutions.
export function escapeForAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

// For every wrapped BODY. `"` is deliberately NOT escaped — a body has no
// quote delimiter to protect, and this product's source material is
// sales-call transcripts, where quoted speech is common prose, not markup.
// `&` first, for the same double-escaping reason as above.
export function escapeForBody(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
}

function render(item: TranscriptMessage): ModelMessage {
  if (item.kind === "agent") {
    // Raw, deliberately. See the ESCAPING note above.
    return { role: "assistant", content: item.body };
  }
  if (item.kind === "task") {
    // The handle is an ATTRIBUTE, not part of the body, so it cannot be
    // confused with something the client wrote. Omitted entirely when Python
    // did not issue one: an empty `handle=""` would be a handle the server
    // refuses to resolve, offered to the model as if it were usable.
    const handle = item.handle
      ? ` handle="${escapeForAttribute(item.handle)}"`
      : "";
    return {
      role: "user",
      content: `<client-message${handle}>${escapeForBody(item.body)}</client-message>`,
    };
  }
  if (item.kind === "clarification") {
    return { role: "user", content: `<server-question>${escapeForBody(item.body)}</server-question>` };
  }
  if (item.kind === "command") {
    const named = item.command_kind
      ? ` kind="${escapeForAttribute(item.command_kind)}"`
      : "";
    return {
      role: "user",
      content: `<client-action${named}>${escapeForBody(item.body)}</client-action>`,
    };
  }
  // `response` and every unrecognised kind. Degrading an unknown kind to
  // untrusted DATA is the safe direction; degrading it to speech is not.
  return {
    role: "user",
    content: `<server-note trust="untrusted">${escapeForBody(item.body)}</server-note>`,
  };
}

export function assembleTranscript(messages: TranscriptMessage[]): ModelMessage[] {
  return assembleTranscriptEntries(messages).map((entry) => entry.message);
}

/** One stored row and the model message it renders as. */
export type TranscriptEntry<T extends TranscriptMessage = TranscriptMessage> = { row: T; message: ModelMessage };

/**
 * `assembleTranscript`, keeping each message's stored row beside it (Cycle 5,
 * P4.3). Compaction cuts the conversation at a message and records WHICH stored
 * message its summary covers through, so it needs the row's id and kind, not
 * only the rendered text. Same rows, same order, same rendering.
 */
export function assembleTranscriptEntries<T extends TranscriptMessage>(messages: T[]): TranscriptEntry<T>[] {
  return messages
    .filter((item) => item.body.trim().length > 0)
    .filter((item) => item.command_kind == null || !SKIPPED_COMMAND_KINDS.has(item.command_kind))
    .map((row) => ({ row, message: render(row) }));
}

/**
 * Task 8 fix round, item 1 (CRITICAL). `POST .../messages`'s own response —
 * the envelope `agent/route.ts`'s `recordClientTurn` call returns — already
 * ends with the message it just appended: `chat.py::_run_message_operation`
 * calls `append_message` and THEN `read_session`
 * (`src/product/api/chat.py:519-524`). `buildTurnMessages`'s own
 * `clientMessage` parameter is the ONE place the current turn belongs (its
 * own contract test treats `transcript` as prior turns only); running that
 * envelope through `assembleTranscript` UNCHANGED renders the just-sent
 * message a SECOND time, as a trailing `<client-message>`, on top of the one
 * `buildTurnMessages` appends itself — so the model sees the client's own
 * words twice, every turn.
 *
 * IDENTIFIES THE MESSAGE BY WHAT IT IS, NEVER BY POSITION. A blind
 * `messages.slice(0, -1)` would silently delete a REAL prior turn the day
 * Python's envelope ever stops ending with the just-appended one. This
 * checks that the LAST entry actually looks like the exact message just
 * sent — `role: "user"`, `kind: "task"` (the two literals
 * `record_client_turn` always writes), `body` equal to what was sent — and
 * removes it ONLY then; any other shape is returned completely unchanged,
 * never guessed at.
 */
export function excludingJustRecordedMessage<T extends { role: string; kind: string; body: string }>(
  messages: T[],
  clientMessage: string,
): T[] {
  const last = messages.at(-1);
  if (last && last.role === "user" && last.kind === "task" && last.body === clientMessage) {
    return messages.slice(0, -1);
  }
  return messages;
}

/**
 * The row this turn just recorded: the LAST one, and only if it is this message.
 *
 * The same rule `excludingJustRecordedMessage` applies, and for the same
 * reason. The route used to take the FIRST row with this body, so a repeated
 * phrase ("yes", "sounds good") credited the client's words to an older
 * turn's handle, and a fact used from this turn was attributed to the wrong
 * message (round 2; the independent audit singled it out as affecting
 * provenance). A last row that is not this message gives `undefined`: the turn
 * is left unnameable rather than misnamed.
 */
export function justRecordedMessage<T extends { role: string; kind: string; body: string }>(
  messages: T[],
  clientMessage: string,
): T | undefined {
  const last = messages.at(-1);
  return last && last.role === "user" && last.kind === "task" && last.body === clientMessage
    ? last
    : undefined;
}

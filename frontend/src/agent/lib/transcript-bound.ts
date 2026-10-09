import "server-only";

import type { ModelMessage } from "@/agent/transcript";

/**
 * How much of the earlier conversation a turn hands the model.
 *
 * **Why there is a cap at all.** Every turn re-sent the whole conversation,
 * uncapped. Quality degrades as input grows, well before any window limit
 * (Chroma, "Context Rot", 2025: every one of 18 frontier models), and long
 * multi-turn conversations fail mostly by an early wrong assumption the model
 * never recovers from (Laban et al., ICLR 2026). The remedy both point at is
 * a bounded, fresh context -- not a longer memory.
 *
 * **Why this can be simple here.** The heavy state of a writing session does
 * not live in the chat: the selected draft and its citations, the facts the
 * client confirmed for this piece and the knowledge base all return through
 * their own channels every turn. Earlier turns' tool results were never
 * re-sent. So the chat is only chat, and losing its oldest middle costs the
 * model the ability to quote it, nothing more.
 *
 * **Nothing is summarized and nothing is deleted.** The stored conversation is
 * untouched and the client still sees all of it. A summary would be a paid
 * call and, worse in a grounding product, a place where a "fact" about the
 * client could appear that no source supports.
 */

/** 30k tokens at a conservative 3.5 characters per token (operator, 2026-09-23). */
export const MAX_TRANSCRIPT_CHARS = 105_000;

/**
 * Messages are dropped in whole blocks, so the omitted range moves only once
 * every block's worth of growth. Recomputed statelessly each turn, a
 * drop-one-at-a-time rule would shift the start of what the model sees on
 * every turn and defeat the prompt cache on exactly the conversations where it
 * saves the most.
 */
export const TRIM_BLOCK = 10;

export type BoundedTranscript = {
  messages: ModelMessage[];
  /** How many earlier messages the model was not shown. */
  omitted: number;
  /** Characters of chat the model was given, the note included. */
  chars: number;
};

function size(messages: readonly ModelMessage[]): number {
  return messages.reduce((total, message) => total + message.content.length, 0);
}

/**
 * The earlier conversation, within `maxChars`.
 *
 * Keeps the OPENING message -- normally the client's brief -- and leaves out
 * the rest in a fixed order: the agent's own replies first, oldest first, and
 * the client's messages only once every reply is gone. Truncating from the
 * front is the failure sliding windows are known for (it discards the early
 * constraint and keeps whatever happened most recently), and trimming purely
 * by age has the same failure one step later: the final outside sign-off
 * found that a middle-turn "do not name this customer" could be dropped
 * before a later "revise it as discussed". A client's instruction, and the
 * `U{n}` handle on it, outlives the replies around it; the agent's replies are
 * the cheapest thing to lose, because what they produced -- the selected draft
 * and its citations -- returns through its own channel.
 *
 * Order is preserved: what is kept is a subsequence of the conversation, and
 * the note says what kind of message is missing.
 */
export function boundTranscript(
  transcript: ModelMessage[],
  maxChars: number = MAX_TRANSCRIPT_CHARS,
): BoundedTranscript {
  const total = size(transcript);
  if (total <= maxChars || transcript.length <= 1) {
    return { messages: transcript, omitted: 0, chars: total };
  }
  const [first, ...rest] = transcript;
  const indexes = (keep: (message: ModelMessage) => boolean) =>
    rest.flatMap((message, index) => (keep(message) ? [index] : []));
  // The omission order. Only appended to as the chat grows, so the first k
  // entries -- what a block drop removes -- stay the same set turn to turn.
  const order = [
    ...indexes((message) => message.role === "assistant"),
    ...indexes((message) => message.role !== "assistant"),
  ];
  let omitted = 0;
  let dropped = new Set<number>();
  let kept = rest;
  while (omitted < order.length && first.content.length + size(kept) > maxChars) {
    omitted = Math.min(omitted + TRIM_BLOCK, order.length);
    dropped = new Set(order.slice(0, omitted));
    kept = rest.filter((_, index) => !dropped.has(index));
  }
  const replies = [...dropped].filter((index) => rest[index].role === "assistant").length;
  const clientSide = omitted - replies;
  const note: ModelMessage = {
    role: "user",
    content:
      `<server-note>${replies} of your own earlier replies` +
      (clientSide > 0 ? ` and ${clientSide} of the client's earliest messages` : "") +
      " in this conversation are not shown to you. The client can still see them.</server-note>",
  };
  const messages = [first, note, ...kept];
  return { messages, omitted, chars: size(messages) };
}

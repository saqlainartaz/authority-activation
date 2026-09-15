/**
 * §5.3 — what the runtime streams to the browser.
 *
 * THIS FILE IS DELIBERATELY NOT UNDER `src/agent/`. Every module there must
 * open with `import "server-only"` (`check:agent-server-only`), and §9 step 5
 * needs the browser to narrow these events as it reads them off the stream.
 * `src/agent/events.ts` re-exports this module behind its own `server-only`
 * import, so there is exactly ONE definition and no mirror to drift.
 *
 * It is types and one frozen name list. There is nothing server-only about
 * it: no secret, no filesystem, no vendor SDK, no credential.
 *
 * THE UNION HAS NO FIELD FOR A DRAFT BODY AT ANY DEPTH, and that absence is the
 * design. `wire.py`'s technique, applied in the other direction: not "we choose
 * not to send it" but "there is nowhere to put it". `draft.ready` carries an id;
 * the body reaches the browser only by re-reading Python.
 *
 * Stated once, because it is the reason: if the body streamed into the card,
 * then at the instant the last token lands the card holds a post that has passed
 * zero checks. A held draft would already have been read. The receipt —
 * `body_sha256`, claim offsets, source locators — cannot exist yet, so the copy
 * would be indistinguishable from generic model output at the moment of highest
 * attention. And it creates standing pressure to make validation advisory, which
 * is how a guarantee dies without anyone deciding to kill it.
 *
 * `message.delta` IS the agent's own words, streaming, and that is wanted — it is
 * the only lever against a silent twenty-second gap. Narration is conversation;
 * it is not post body.
 */

export const EVENT_NAMES = [
  "message.delta",
  "activity",
  "draft.ready",
  "terminal",
  "turn.end",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

/**
 * Ties a union member's discriminant to `EventName` at the type level. `T
 * extends EventName` means a new member with a `type` not already listed in
 * `EVENT_NAMES` is a compile error, not a silent addition — which forces the
 * new name into `EVENT_NAMES`, and the "names exactly the five events" pin in
 * `tests/agent/events.test.ts` then sees it and fails. Before this, nothing
 * tied the union's discriminants to the name list at all: `EVENT_NAMES` and
 * `AgentEvent` could drift independently.
 *
 * `Extra` DEFAULTS TO `Record<never, never>`, NOT `Record<string, never>` —
 * FIX, §9 step 4 Task 5, found the first time anything constructed a
 * zero-extra member as an object literal (`{ type: "turn.end" }` in
 * `src/agent/lib/turn.ts`). `Record<string, never>` carries an index
 * signature `[x: string]: never`, and TypeScript checks an object literal's
 * OWN properties against every applicable member of an intersection —
 * including that index signature — so `type: "turn.end"` was required to be
 * assignable to `never` and never could be. No prior code had hit this
 * because every other member either supplies a non-empty `Extra` or was only
 * ever narrowed/read, never constructed, before this task. `Record<never,
 * never>` still rejects excess properties on a literal (proved: `arr.push({
 * type: "b", z: 1 })` still errors) and, unlike a first attempt at this fix
 * that reached for the wider `object`, carries NO index signature at all —
 * `Record<K, V>`'s mapped-type form only produces one when `K` includes
 * `string`/`number`/`symbol`, and `never` includes none of those — so it is
 * the narrower of the two fixes that solves exactly this and nothing more.
 * `{ type: "turn.end" }` — no more, no less — type-checks under either; this
 * one was chosen because it does not also legalise other property shapes
 * `object` would (`{ type: "turn.end", anything: 1 } satisfies object` is
 * true; the same is not true against `Record<never, never>`).
 */
type Event<T extends EventName, Extra = Record<never, never>> = { type: T } & Extra;

export type AgentEvent =
  /** The agent's own words, as it says them. */
  | Event<"message.delta", { text: string }>
  /** A status label. Free-form on purpose — the vocabulary is written in step 4,
   *  and the field exists now so its shape does not change then. */
  | Event<"activity", { label: string }>
  /** An id and nothing else. The browser reloads the envelope. */
  | Event<"draft.ready", { variant_id: string }>
  | Event<"terminal", { outcome: "held" | "refused"; explanation: string }>
  | Event<"turn.end">;

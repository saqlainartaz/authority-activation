"use client";

// One idempotency key per USER ACTION, carried through every retry of that
// action. `postJson` merges it into the request body as `idempotency_key`; the
// API takes it in the body, bounded at 8-200 characters, and every mutating
// model sets `extra="forbid"`, so the spelling must be exact.
//
// FOUR RULES, AND EACH ONE IS A DISTINCT WAY TO GET THIS SUBTLY WRONG (IC-7):
//
// 1. THE KEY IS GENERATED WHEN THE ACTION STARTS — not when the component
//    mounts, and not per attempt. That is why `key()` generates lazily on first
//    call rather than in the `useRef` initialiser: a key minted at mount is a
//    key that ages on a screen the client left open, and a component that
//    mounts without ever being used has minted one for nothing.
// 2. IT IS REUSED ACROSS EVERY RETRY OF THAT ACTION. `retry-fetch.ts` retries a
//    POST twice on network failure; a key regenerated per attempt turns a replay
//    into a DUPLICATE WRITE, which is exactly the defect DIS6-01 named as the
//    expiry tripwire for `04-REVIEW WR-04`. The retry existed before any key
//    did, so the tripwire had already fired when this file was written.
// 3. `rotate()` EXISTS BECAUSE A NEW ACTION NEEDS A NEW KEY. Submitting a
//    second campaign right after the first (`CampaignCreateForm.tsx`'s own
//    `idempotency.rotate()`, on success) is a genuinely different request,
//    not a retry of the first; reusing the key there would replay the first
//    campaign's creation instead of starting a new one. Rotate on the
//    deliberate re-do, never in a `catch`.
//    (Fix wave, 2026-08-26, Minor: this rule's own worked example used to be
//    "Generate again" after a reject hold — a control D-B deleted along with
//    the auto-regeneration it belonged to. `rotate()` itself is unaffected
//    and still exactly as live as the rule describes; only the example was
//    stale.)
// 4. NEVER REUSE A KEY ACROSS DIFFERENT CONTENT ITEMS. That is a caller error
//    and the API answers it `status="failed"` with `failure.reason ==
//    "not_written"` — never with the other item's draft. So one hook instance
//    belongs to one item's action; a list of items needs one per row, not one
//    for the screen.
// 5. NEVER REUSE A KEY ACROSS DIFFERENT ACTIONS ON THE SAME ITEM EITHER — and
//    when one control can send several different actions, the key must be
//    DERIVED FROM WHICH ONE. This is rule 4's sibling and it was learned the
//    expensive way: `07A-REVIEW` CR-01. One sheet sent four reject taps, and any
//    claim on the receipt, through a single `key()`. So a reject that committed
//    but whose response was lost in transport — the exact case rules 1-3 exist
//    for — would replay its stored record when the client then chose a DIFFERENT
//    claim, banning a phrase they never picked, permanently (the API's atoms have
//    UPDATE and DELETE revoked and there is no un-ban route), and reporting
//    success. `useKeyedIdempotency` below is where this rule lives now, so the
//    NEXT multi-action component inherits it instead of re-deriving it: CR-01 was
//    a re-derivation of a rule this file already owned in four other forms.
//
// Disabling the button while a request is in flight is UX and is worth doing.
// It is NOT the mechanism: the Operator persona approves on a phone with bad
// signal and will double-tap. The key is the correctness.

import { useCallback, useMemo, useRef } from "react";

/** A fresh key. `crypto.randomUUID()` is 36 characters, inside the API's 8-200.
 *
 * `crypto` is the Web Crypto global — available in every browser this app
 * supports and in Node 19+, so this file needs no polyfill and no dependency.
 * `randomUUID` requires a secure context (https or localhost), which the app
 * has in both dev and production.
 */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/** One key for the life of one action, plus an explicit way to start a new one.
 *
 * `key()` returns the SAME string every time it is called on one instance, so
 * passing it to `postJson` inside a retry loop, an error path or a second
 * confirmation all reach the same key. `rotate()` mints a new one and returns
 * it, for the case in rule 3 above.
 *
 * Two instances in one component are two independent actions and yield two
 * different keys — which is the point when a screen has both an approve and a
 * mark-posted button on the same item.
 */
export function useIdempotencyKey(): { key: () => string; rotate: () => string } {
  const held = useRef<string | null>(null);

  const key = useCallback((): string => {
    // Lazy on purpose — see rule 1. Generating in the `useRef` initialiser
    // would run during render, which is both the wrong moment for the
    // requirement and a call to an impure function during render.
    if (held.current === null) held.current = newIdempotencyKey();
    return held.current;
  }, []);

  const rotate = useCallback((): string => {
    held.current = newIdempotencyKey();
    return held.current;
  }, []);

  return useMemo(() => ({ key, rotate }), [key, rotate]);
}

/** One key per DISTINCT ACTION, for a control that can send more than one — rule 5.
 *
 * `keyFor(signature)` returns the same key for the same signature and a NEW key
 * for a different one. That is rules 2 and 3 collapsed into a single call: a
 * retry of the same action is the same signature and so replays, and a genuinely
 * different action is a different signature and so cannot.
 *
 * The signature is the caller's own description of WHICH action this is, and it
 * must name every field the server treats as part of the action's identity. For
 * the reject sheet that is the tap and the claim id — the two fields
 * `decisions.py::_same_reject_action` compares — so the signature is
 * `` `${tap}|${claim?.claim_id ?? ""}` ``. A signature that omits one of them is
 * a key that spans two actions, which is CR-01 again.
 *
 * **THIS IS DELIBERATELY NOT A PER-COMPONENT `lastSubmitted` REF**, which is the
 * shape `07A-REVIEW` suggested and which behaves identically. Three differences
 * decided it:
 *
 * 1. THE RULE LANDS WHERE THE RULES ARE WRITTEN DOWN. Rules 1-4 live in this
 *    file's header; CR-01 happened because rule 5 was not one of them and a
 *    component author had to re-derive it. A ref in `RejectSheet.tsx` teaches
 *    only `RejectSheet.tsx`.
 * 2. THE TYPE SYSTEM CAN THEN REFUSE THE MISTAKE. The returned object has no
 *    zero-argument `key()` to reach for, so obtaining a key with no action
 *    identity is a compile error rather than a code review.
 * 3. IT BECOMES ONE AST PREDICATE INSTEAD OF A COMMENT.
 *    `scripts/assert-no-fabricated-state.mjs`'s assertion 6 requires the
 *    `idempotencyKey:` initialiser in a declared multi-action file to be a call
 *    with a non-literal argument — which a ref-and-compare cannot be checked for.
 *
 * `useIdempotencyKey` above is unchanged and stays the right hook for a control
 * that sends exactly one action. Most buttons are that; this is for the sheets.
 */
export function useKeyedIdempotency(): { keyFor: (signature: string) => string } {
  const held = useRef<{ signature: string; key: string } | null>(null);

  const keyFor = useCallback((signature: string): string => {
    // Lazy for rule 1's reason, and re-minted on a signature change for rule 3's.
    if (held.current === null || held.current.signature !== signature) {
      held.current = { signature, key: newIdempotencyKey() };
    }
    return held.current.key;
  }, []);

  return useMemo(() => ({ keyFor }), [keyFor]);
}

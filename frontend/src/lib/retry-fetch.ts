"use client";

// postJson: fetch with automatic retry on NETWORK failures ("Failed to
// fetch") — server restarts, dropped connections, dev-server swaps. HTTP
// error responses (4xx/5xx) are NOT retried; they're real answers.
//
// SCOPE, CORRECTED: this used to say "idempotent/read-like calls (generation,
// [the deleted second generator], chat)". Two things changed. That second
// generator route is gone (D7A-01 — nothing in the frontend generates post copy
// any more; the backend does, grounded in the client's own material), and the
// surface is now EVERY KEYED MUTATION: generate, approve, reject, edit,
// mark-posted, reschedule. None of those is read-like — each one writes — so
// "retry it and hope" is not available. What makes the retry safe is
// `opts.idempotencyKey`: the same key on a replay is the same write, and the
// API returns the original answer instead of making a second one.
//
// A CALL THAT WRITES AND PASSES NO KEY IS STILL RETRIED. That is deliberately
// left as it was rather than made an error, because the un-keyed callers in the
// tree today are the chat brief and the mock generators, which write nothing.
// If you are adding a keyed mutation, pass the key — `lib/idempotency.ts` says
// where it comes from.

export async function postJson<T>(
  path: string,
  body?: unknown,
  {
    retries = 2,
    backoffMs = 1500,
    idempotencyKey,
  }: { retries?: number; backoffMs?: number; idempotencyKey?: string } = {},
): Promise<T> {
  // THE MERGE HAPPENS HERE, ONCE, BEFORE THE LOOP — and the position is the
  // whole point, not tidiness. Inside the loop this line would sit one careless
  // edit away from `idempotency_key: newIdempotencyKey()`, and a key
  // regenerated per attempt turns a replay into a duplicate write: the exact
  // defect DIS6-01 named as the expiry tripwire for `04-REVIEW WR-04`. The
  // retry below already existed with no key at all, so that tripwire had
  // already fired. Merging out here makes the mistake structurally unavailable
  // — there is no per-attempt scope for it to live in.
  //
  // Spreading an `undefined` body yields `{ idempotency_key }` alone, which is
  // exactly the request shape approve and mark-posted take.
  const payload: unknown =
    idempotencyKey === undefined
      ? body
      : { ...(body as Record<string, unknown> | undefined), idempotency_key: idempotencyKey };
  let lastNetworkError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: payload !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: payload !== undefined ? JSON.stringify(payload) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new HttpError(
          data.error ?? `request failed (${res.status})`,
          res.status,
          data.detail,
        );
      }
      return data as T;
    } catch (e) {
      if (e instanceof HttpError) throw e; // real server answer — don't retry
      lastNetworkError = e;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)));
      }
    }
  }
  throw new Error(
    "Couldn't reach the app server (it may be restarting). Wait a few seconds and try again.",
    { cause: lastNetworkError },
  );
}

/** A real answer from the server, carrying its status AND its structured body.
 *
 * `detail` WAS ADDED BY PLAN 07A-10 AND IT CLOSES A PIPE THAT WAS BROKEN IN
 * EXACTLY ONE PLACE. `forwardProductError` already puts the API's own structured
 * `detail` in the body on every 4xx, and `ErrorSurface` already reads
 * `current_state` out of it to say "This post has already been posted." instead
 * of repeating a status code (IC-14's 409 row, IC-8.4). Between those two halves
 * this class dropped the field, so every caller that wanted it had to hand-roll
 * its own `fetch` — `components/onboarding/OnboardingForm.tsx:293-303` did
 * precisely that, and its comment names the one extra line as being about
 * keeping `detail`.
 *
 * Optional and last, so every existing `new HttpError(message, status)` call
 * site keeps compiling and keeps meaning what it meant. `unknown` rather than a
 * shape: FastAPI's `detail` is a string, a list of `{loc, msg, type}` records, or
 * an object, and `ErrorSurface` already owns the narrowing — a second shape
 * assertion here would be a second answer about the same body.
 */
export class HttpError extends Error {
  status: number;
  detail: unknown;
  constructor(message: string, status: number, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

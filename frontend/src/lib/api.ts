"use client";

// The browser's one door to this app's own server. Screens import this module
// and nothing else for data: `getJson` for a read, `postJson` for a keyed
// mutation, `HttpError` to tell "the server said no" from "no server answered".
//
// Every call goes to a Next route handler under `/api/...`, never to the
// backend directly (D7A-12). The backend needs BOTH the service key and the
// client's onboarding token on every client-credential route, and the service
// key may never reach a browser — so the browser holds no credential at all,
// and the handler attaches both from `lib/product.ts`. The token travels as an
// httpOnly cookie the browser cannot read.
//
// `getJson` is deliberately NOT retried. `postJson`'s retry is safe only
// because a keyed replay is the same write; a read has no such guarantee to
// need, and a screen that wants another attempt already has one — the user's
// retry control (IC-14) or the poll's next tick.

import { HttpError, postJson } from "./retry-fetch";

/** A read. Throws `HttpError` (with the status) on any non-2xx.
 *
 * Shaped after the injected `api` callback at `app/internal/page.tsx:96-109`,
 * with one deliberate difference: that one throws a bare `Error`, so a caller
 * can only show the message. IC-14 branches on the STATUS to choose a next step
 * — 401 has no retry control at all, 404 says the item is gone, 409 speaks in
 * the client's own vocabulary — and a bare `Error` makes that impossible without
 * string-matching. So this throws the same `HttpError` `postJson` throws, and
 * `ErrorSurface` handles both identically.
 *
 * `data.error` is the body key both this and `postJson` read, and it is the key
 * every route handler in the tree already writes. Keep it: change it and
 * `HttpError.message` goes blank, taking the server's own sentence with it.
 *
 * `cache: "no-store"` for `engine.ts`'s reason, one layer out: this app's state
 * lives in Postgres and a cached read is a screen showing a decision that has
 * since been made. IC-2 requires a hard refresh to return the CURRENT state.
 */
export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // `data.detail` is the API's own structured body, which the BFF forwards on
    // every 4xx and which IC-14's 409 and 422 arms read STRUCTURALLY rather than
    // by matching prose. Carried on the error so a caller does not have to
    // hand-roll a `fetch` to keep it — see `HttpError`'s own comment.
    throw new HttpError(data.error ?? `request failed (${res.status})`, res.status, data.detail);
  }
  return data as T;
}

export { HttpError, postJson };

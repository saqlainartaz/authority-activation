// The client's "Use this source" switch, browser side (Cycle 5 P7.2; spec §7.3,
// A21). Client-safe and React-free, so the tests drive exactly what the popup
// runs. Calls go through the same-origin BFF (`/api/client/sources/{id}/lifecycle`).
//
// - Every change carries an intent key minted HERE, in the browser, and the
//   revision the browser last read (`expected_lifecycle_revision`). A retry after
//   no definitive answer (the network, a 5xx) reuses the key, so the backend
//   records the change once; a definitive answer ends the key (`intent-key.ts`).
// - The backend answers `pending` until the change is enforced; the popup reads
//   the state again (`waitUntilEnforced`) until it is not.
// - `409 stale_source_state` (the source moved since it was read) and
//   `409 intent_key_reused` both read the source's current state again and show
//   it, with a sentence; nothing is re-sent on the client's behalf.

import { withIntentKey, type IntentKeyHolder } from "./intent-key";
import type { SourceUse } from "./knowledge-status";

/** What the screen says for each refusal the switch can meet (the BFF sends the same). */
export const SWITCH_REFUSALS: Record<string, string> = {
  stale_source_state: "This source changed since you opened it. Its current setting is shown.",
  intent_key_reused: "That change could not be matched to what you asked. Its current setting is shown; try again.",
  source_not_controllable: "Our team stopped this file, or a newer upload replaced it, so it can't be switched on or off here.",
  source_not_found: "This source is no longer in your sources.",
  // Delete file (Cycle 5 P8.2/P8.3).
  source_deleting: "This file is being deleted.",
  delete_requires_sign_in: "Sign in with your email and password to delete files.",
};

export const SWITCH_NOT_SAVED = "Your change was not saved. Try again.";
export const SWITCH_READ_FAILED = "We couldn't check this setting. Close and reopen this source to try again.";

/** A failed BFF call: the status (0 when no answer arrived), the backend's code, and a sentence. */
export class SourceSwitchError extends Error {
  constructor(message: string, readonly status: number, readonly detail?: string) {
    super(message);
    this.name = "SourceSwitchError";
  }
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

const lifecyclePath = (documentId: string) => `/api/client/sources/${encodeURIComponent(documentId)}/lifecycle`;

async function call<T>(fetcher: Fetcher, path: string, init: RequestInit, fallback: string): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(path, { cache: "no-store", ...init, headers: { Accept: "application/json", ...(init.headers ?? {}) } });
  } catch {
    throw new SourceSwitchError(fallback, 0);
  }
  const body = await response.json().catch(() => ({})) as T & { error?: unknown; detail?: unknown };
  if (!response.ok) {
    throw new SourceSwitchError(
      typeof body.error === "string" && body.error ? body.error : fallback, response.status,
      typeof body.detail === "string" ? body.detail : undefined,
    );
  }
  return body;
}

function asUse(body: { state?: unknown; requested?: unknown; revision?: unknown }): SourceUse {
  const state = body.state === "off" || body.state === "pending" ? body.state : "on";
  const requested = body.requested === "on" || body.requested === "off" ? body.requested : null;
  const revision = typeof body.revision === "number" && Number.isInteger(body.revision) && body.revision >= 0 ? body.revision : 0;
  return { state, requested, revision };
}

/** The source's switch now, and the revision to send with the next change. */
export async function readSourceUse(documentId: string, fetcher: Fetcher = fetch): Promise<SourceUse> {
  return asUse(await call<Record<string, unknown>>(fetcher, lifecyclePath(documentId), {}, SWITCH_READ_FAILED));
}

export type SwitchResult =
  /** Recorded: `use` is on/off when already enforced, else pending. */
  | { kind: "sent"; use: SourceUse }
  /** Not recorded because the source moved (or the key stood for other contents): its current state, read again. */
  | { kind: "reloaded"; use: SourceUse; message: string }
  /** Not recorded and cannot be: a closed or unknown source. */
  | { kind: "refused"; message: string };

/** Ask for the source on or off, against the revision last read. Throws
 *  `SourceSwitchError` when no definitive answer came back (the key is kept, so
 *  trying again records the change once). */
export async function switchSource(
  documentId: string, wanted: "on" | "off", current: SourceUse, holder: IntentKeyHolder, fetcher: Fetcher = fetch,
): Promise<SwitchResult> {
  const operation = wanted === "off" ? "disable" : "re_enable";
  try {
    const answer = await withIntentKey(holder, intentKey => call<{ source?: Record<string, unknown> }>(
      fetcher, lifecyclePath(documentId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent_key: intentKey, operation, expected_lifecycle_revision: current.revision }),
      }, SWITCH_NOT_SAVED,
    ));
    return { kind: "sent", use: asUse(answer.source ?? {}) };
  } catch (error) {
    if (!(error instanceof SourceSwitchError)) throw error;
    if (error.status === 409 && (error.detail === "stale_source_state" || error.detail === "intent_key_reused")) {
      return { kind: "reloaded", use: await readSourceUse(documentId, fetcher), message: SWITCH_REFUSALS[error.detail] };
    }
    if ((error.status === 409 && error.detail === "source_not_controllable") || error.status === 404) {
      return { kind: "refused", message: SWITCH_REFUSALS[error.detail ?? ""] ?? error.message };
    }
    throw error;
  }
}

// ---- Delete file (Cycle 5 P8.2 backend, P8.3 screen) --------------------------
//
// The same request as the switch, with `operation: "delete"`: the browser's intent
// key (reused on a retry after no definitive answer), and the revision last read.

/** The one-time notice when a deleted file has left the list (D12, until N is confirmed). */
export const DELETED_NOTICE = "Deleted from your workspace now.";
export const DELETE_NOT_SENT = "The file was not deleted. Try again.";

export type DeleteResult =
  /** Recorded (or already being deleted): the file shows Deleting until its purge finishes. */
  | { kind: "deleting" }
  /** Not recorded because the source moved, or the key stood for other contents: read it again, then ask again. */
  | { kind: "reloaded"; use: SourceUse; message: string }
  /** Not recorded and cannot be: no longer a source, or this credential may not delete. */
  | { kind: "refused"; message: string };

/** Delete the file against the revision last read. Throws `SourceSwitchError` when
 *  no definitive answer came back (the key is kept, so trying again deletes once). */
export async function deleteSource(
  documentId: string, current: SourceUse, holder: IntentKeyHolder, fetcher: Fetcher = fetch,
): Promise<DeleteResult> {
  try {
    await withIntentKey(holder, intentKey => call<Record<string, unknown>>(fetcher, lifecyclePath(documentId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent_key: intentKey, operation: "delete", expected_lifecycle_revision: current.revision }),
    }, DELETE_NOT_SENT));
    return { kind: "deleting" };
  } catch (error) {
    if (!(error instanceof SourceSwitchError)) throw error;
    // Another request (another tab, staff) already deleted it: it is going either way.
    if (error.status === 409 && error.detail === "source_deleting") return { kind: "deleting" };
    if (error.status === 409 && (error.detail === "stale_source_state" || error.detail === "intent_key_reused")) {
      return { kind: "reloaded", use: await readSourceUse(documentId, fetcher), message: SWITCH_REFUSALS[error.detail] };
    }
    if (error.status === 403 || error.status === 404) {
      return { kind: "refused", message: SWITCH_REFUSALS[error.detail ?? ""] ?? error.message };
    }
    throw error;
  }
}

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Read the switch until it is no longer pending (or `attempts` reads were made):
 *  the last state read. `stop()` true ends it early (the popup closed). */
export async function waitUntilEnforced(
  documentId: string,
  options: { fetcher?: Fetcher; interval?: number; attempts?: number; sleep?: (ms: number) => Promise<void>; stop?: () => boolean } = {},
): Promise<SourceUse | null> {
  const { fetcher = fetch, interval = 1_500, attempts = 20, sleep = pause, stop = () => false } = options;
  let last: SourceUse | null = null;
  for (let attempt = 0; attempt < attempts && !stop(); attempt++) {
    await sleep(interval);
    if (stop()) break;
    try {
      last = await readSourceUse(documentId, fetcher);
    } catch {
      continue;
    }
    if (last.state !== "pending") return last;
  }
  return last;
}

// GET  /api/client/sources/{documentId}/lifecycle -> GET  /v1/sources/{id}/lifecycle
// POST /api/client/sources/{documentId}/lifecycle -> POST /v1/sources/{id}/lifecycle
// (Cycle 5 P7.1 backend, P7.2 screen; spec §7.3, A21): the client's "Use this source".
//
// - The client is the session's own; nothing from the browser names one.
// - The browser's `intent_key` is forwarded unchanged, and a retry of the same
//   change sends the same key, so the backend records one change per key. The
//   BFF never makes one up (a key minted here would be new on every retry): a
//   change without one is refused with 400 before the backend is called.
// - `expected_lifecycle_revision` is the revision the browser last read; without
//   it the change is refused with 400, so a change can never skip the backend's
//   stale check.
// - The backend's 409s keep their codes (`stale_source_state`,
//   `intent_key_reused`, `source_not_controllable`, `source_deleting`) beside a
//   sentence the screen can show. Rehaul only: under M1 the backend answers 404.
// - `delete` (Cycle 5 P8.3): Delete file, forwarded like the switch. The backend
//   decides who may: a signed-in session; a link gets 403 `delete_requires_sign_in`.

import { clientToken } from "@/lib/client-session";
import {
  expiredLinkResponse, forwardProductError, getSourceLifecycle, ProductHttpError, readJsonObject,
  requestSourceLifecycle, type SourceLifecycleBody,
} from "@/lib/product";
import { SWITCH_REFUSALS } from "@/lib/source-switch";

type Params = { params: Promise<{ documentId: string }> };

const DOCUMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPERATIONS: readonly string[] = ["disable", "re_enable", "delete"];

const unknownSource = () =>
  Response.json({ error: SWITCH_REFUSALS.source_not_found, detail: "source_not_found" }, { status: 404 });

function forwardSwitchError(error: unknown): Response {
  if (error instanceof ProductHttpError && typeof error.detail === "string" && SWITCH_REFUSALS[error.detail]) {
    return Response.json({ error: SWITCH_REFUSALS[error.detail], detail: error.detail }, { status: error.status });
  }
  return forwardProductError(error);
}

export async function GET(_: Request, { params }: Params) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const { documentId } = await params;
  if (!DOCUMENT_ID.test(documentId)) return unknownSource();
  try {
    return Response.json(await getSourceLifecycle(token, documentId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return forwardSwitchError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const { documentId } = await params;
  if (!DOCUMENT_ID.test(documentId)) return unknownSource();
  const raw = await readJsonObject(request);
  const key = raw.intent_key;
  if (typeof key !== "string" || !key.trim() || key.length > 200) {
    return Response.json(
      { error: "This change has no intent key, so nothing was sent.", detail: "intent_key_required" },
      { status: 400 },
    );
  }
  if (typeof raw.operation !== "string" || !OPERATIONS.includes(raw.operation)) {
    return Response.json({ error: "That change could not be read.", detail: "operation_invalid" }, { status: 400 });
  }
  const revision = raw.expected_lifecycle_revision;
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) {
    return Response.json(
      { error: "This change does not say which setting it replaces, so nothing was sent.", detail: "revision_required" },
      { status: 400 },
    );
  }
  const body: SourceLifecycleBody = {
    intent_key: key,
    operation: raw.operation as SourceLifecycleBody["operation"],
    expected_lifecycle_revision: revision,
  };
  try {
    const result = await requestSourceLifecycle(token, documentId, body);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return forwardSwitchError(error);
  }
}

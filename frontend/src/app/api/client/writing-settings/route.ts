// GET/PUT/DELETE /api/client/writing-settings -> /v1/clients/me/writing-settings
// (Cycle 5 P5.1; spec 6, D06, A16).
//
// The client's one saved writing guideline, kept on the server so the voice
// preview and every later draft read the same text. Client-credential
// passthrough, like `api/client/usage`: the backend derives the client from the
// session's own token, and THERE IS NO `client_id` ANYWHERE ON THIS PATH.
//
// What crosses from the browser is built KEY BY KEY: on PUT only `text`,
// `expected_revision` and `expected_guideline_id`; on DELETE only the two
// `expected_*` query values. A `client_id`, an `actor_id`, a perspective or
// anything else the browser adds is dropped: there is one general text (D06;
// separate guidance per voice was removed as over-engineered, 2026-10-08).
//
// A stale write (`409 {"code": "stale_revision", "current_revision": n}`) is
// forwarded with its status and its `detail` object intact, so the editor can
// tell "changed somewhere else" from any other refusal and keep the typed text.

import { clientToken } from "@/lib/client-session";
import {
  deleteWritingSetting,
  expiredLinkResponse,
  forwardProductError,
  getWritingSetting,
  putWritingSetting,
  readJsonObject,
} from "@/lib/product";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET() {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  try {
    return Response.json(await getWritingSetting(token), { headers: NO_STORE });
  } catch (error) {
    return forwardProductError(error);
  }
}

export async function PUT(request: Request) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const body = await readJsonObject(request);
  try {
    const saved = await putWritingSetting(token, {
      text: body.text,
      expected_revision: body.expected_revision ?? null,
      expected_guideline_id: body.expected_guideline_id ?? null,
    });
    return Response.json(saved, { headers: NO_STORE });
  } catch (error) {
    return forwardProductError(error);
  }
}

export async function DELETE(request: Request) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const query = new URL(request.url).searchParams;
  const expectedRevision = query.get("expected_revision");
  const expectedGuidelineId = query.get("expected_guideline_id");
  if (!expectedRevision || !expectedGuidelineId) {
    return Response.json(
      { error: "expected_revision and expected_guideline_id are required" },
      { status: 422 },
    );
  }
  try {
    const cleared = await deleteWritingSetting(token, {
      expected_revision: expectedRevision,
      expected_guideline_id: expectedGuidelineId,
    });
    return Response.json(cleared, { headers: NO_STORE });
  } catch (error) {
    return forwardProductError(error);
  }
}

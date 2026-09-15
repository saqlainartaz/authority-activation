// POST /api/client/content-items/[id]/edit -> POST .../edit
//
// The client's own edit. Unlimited, no review gate (D6-15), each one an
// append-only version, and a BANNED PHRASE INSIDE THE CLIENT'S OWN EDIT IS
// ACCEPTED SILENTLY (D6-17) — no warning copy is added here or downstream.
//
// CONTROL CHARACTERS ARE STRIPPED SERVER-SIDE AND SILENTLY on this path (D6-18),
// which is the DELIBERATE OPPOSITE of the onboarding and steer paths, where they
// are refused with a 422. `docs/DECISIONS.md` records that the asymmetry must not
// be "fixed" in either direction, so this handler neither strips nor refuses: it
// forwards the body the client typed and lets the edit route apply its own rule.
// The answer publishes `stripped_character_count` if anything was removed.

import { clientToken } from "@/lib/client-session";
import type { EditIn } from "@/lib/product";
import {
  editDraft,
  expiredLinkResponse,
  forwardProductError,
  readJsonObject,
} from "@/lib/product";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const { id } = await params;
  const raw = await readJsonObject(request);

  // ALLOWLIST: idempotency_key, parent_version_id, body. `parent_version_id` is
  // the optimistic-concurrency handle — the API refuses an edit whose parent is
  // no longer the latest version, so it must be the one the client was LOOKING
  // AT and cannot be filled in here.
  const forwarded = {
    idempotency_key: raw.idempotency_key,
    parent_version_id: raw.parent_version_id,
    body: raw.body,
  } as EditIn;

  try {
    return Response.json(await editDraft(token, id, forwarded));
  } catch (e) {
    return forwardProductError(e);
  }
}

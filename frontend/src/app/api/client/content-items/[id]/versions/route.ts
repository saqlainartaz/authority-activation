// GET /api/client/content-items/[id]/versions -> GET .../versions
//
// Version history, ORDERED BY `version_no` and not by `created_at` — the backend
// route decides that (`decisions.py:1468` states the rule and the reason) and this
// handler must not re-sort. Reject and edit both WRITE versions, so without this
// read those versions exist and are unreadable and the reject loop's before/after
// is invisible (D7A-14.1). FE-06 and ROADMAP SC3 are false without it.
//
// Each entry carries its own receipt and D6-14's explicit `manually_edited` flag.
// An edited version's receipt is legitimately a SUBSET: a claim survives an edit
// only if its sentence survived byte-for-byte (D6-16).

import { clientToken } from "@/lib/client-session";
import {
  expiredLinkResponse,
  forwardProductError,
  listVersions,
} from "@/lib/product";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const { id } = await params;
  try {
    return Response.json(await listVersions(token, id));
  } catch (e) {
    return forwardProductError(e);
  }
}

// POST /api/internal/clients/{clientId}/sources/{documentId}/retry-delete (Cycle 5 Ruling 93).
//
// System health's Retry delete for a Delete file whose purge used up its retries
// (whole-branch review A-I1). Passcode first, as every internal route; rehaul
// only. It calls staff's Delete file route with the service key; the backend
// re-queues the purge and answers `409 source_deleting`, which is the success
// (`{"restarted": true}`). Nothing from the browser is forwarded but the client
// and the source in the path, and it can never start a new delete
// (`retrySourceDelete`). The row clears once a purge job waits, and stays gone
// when the purge finishes.

import { forwardEngineError, retrySourceDelete } from "@/lib/engine";
import { rehaulEnabledForOperator } from "@/lib/engine-gate";
import { checkInternalPasscode, unauthorized } from "@/lib/internal-auth";

type Params = { params: Promise<{ clientId: string; documentId: string }> };

export async function POST(request: Request, { params }: Params) {
  if (!checkInternalPasscode(request)) return unauthorized();
  const { clientId, documentId } = await params;
  try {
    if (!(await rehaulEnabledForOperator())) {
      return Response.json(
        { error: "Delete file runs only on the new engine.", detail: "not_available" },
        { status: 404 },
      );
    }
    return Response.json(await retrySourceDelete(clientId, documentId));
  } catch (error) {
    return forwardEngineError(error);
  }
}

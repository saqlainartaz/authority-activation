import { forwardEngineError, listLimitChanges } from "@/lib/engine";
import { rehaulEnabledForOperator } from "@/lib/engine-gate";
import { checkInternalPasscode, unauthorized } from "@/lib/internal-auth";
import { limitsUnavailable } from "../limits-request";

type Params = { params: Promise<{ clientId: string }> };

export async function GET(request: Request, { params }: Params) {
  if (!checkInternalPasscode(request)) return unauthorized();
  const { clientId } = await params;
  // `before` is the backend's own opaque cursor and `limit` its page size; both
  // pass through as they came, and the backend validates them.
  const query = new URL(request.url).searchParams;
  try {
    if (!(await rehaulEnabledForOperator())) return limitsUnavailable();
    return Response.json(await listLimitChanges(clientId, { before: query.get("before"), limit: query.get("limit") }));
  } catch (error) {
    return forwardEngineError(error);
  }
}

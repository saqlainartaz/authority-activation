import { forwardEngineError, getOpsHealth } from "@/lib/engine";
import { checkInternalPasscode, unauthorized } from "@/lib/internal-auth";

// The operator's System health read (Cycle 5 P3.3; spec §10.1), from the backend's
// `GET /v2/ops/health` with the service key. The passcode is checked first, so a
// caller without it learns nothing and the backend is never called. The backend is
// the gate for the engine: under M1 it answers 404 `not_available`, which passes
// through, as does any other refusal; a 5xx keeps its status with a safe sentence
// (`forwardEngineError`). The reply is passed through as it came: ids, classes,
// counts, times and money only; the page resolves client names itself.

export async function GET(request: Request) {
  if (!checkInternalPasscode(request)) return unauthorized();
  try {
    return Response.json(await getOpsHealth());
  } catch (error) {
    return forwardEngineError(error);
  }
}

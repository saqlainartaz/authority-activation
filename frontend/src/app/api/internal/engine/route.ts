import { forwardEngineError } from "@/lib/engine";
import { rehaulEnabledForOperator } from "@/lib/engine-gate";
import { checkInternalPasscode, unauthorized } from "@/lib/internal-auth";

// Which engine the deployment runs, for the operator console's navigation
// (Cycle 5 P2.5): sections that exist only on the rehaul engine, such as
// Limits, are absent under M1 rather than empty. Same switch as the BFF routes
// (`GET /v2/engine`, service key only).

export async function GET(request: Request) {
  if (!checkInternalPasscode(request)) return unauthorized();
  try {
    return Response.json({ knowledge_engine: (await rehaulEnabledForOperator()) ? "ke" : "m1" });
  } catch (error) {
    return forwardEngineError(error);
  }
}

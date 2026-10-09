// GET/POST /api/internal/clients/{clientId}/onboarding-ready (Cycle 5 P6.5; spec 4.1).
//
// The operator's Ready to onboard. Passcode first, as every internal route.
// - GET reads the client's onboarding packet state.
// - POST creates the packet, or reuses it by the backend's own intent key
//   (`onboarding:{client_id}`), so a double click makes one packet; queues its
//   generation once; and starts the client's monthly questions once. Nothing is
//   forwarded from the browser but the client in the path.
// Rehaul only: under M1 both answer 404 and the console shows no action.

import { forwardEngineError, getOnboardingPacket, markReadyToOnboard } from "@/lib/engine";
import { rehaulEnabledForOperator } from "@/lib/engine-gate";
import { checkInternalPasscode, unauthorized } from "@/lib/internal-auth";

type Params = { params: Promise<{ clientId: string }> };

function unavailable(): Response {
  return Response.json(
    { error: "Onboarding questions run only on the new engine.", detail: "onboarding_unavailable" },
    { status: 404 },
  );
}

export async function GET(request: Request, { params }: Params) {
  if (!checkInternalPasscode(request)) return unauthorized();
  const { clientId } = await params;
  try {
    if (!(await rehaulEnabledForOperator())) return unavailable();
    return Response.json(await getOnboardingPacket(clientId));
  } catch (error) {
    return forwardEngineError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  if (!checkInternalPasscode(request)) return unauthorized();
  const { clientId } = await params;
  try {
    if (!(await rehaulEnabledForOperator())) return unavailable();
    return Response.json(await markReadyToOnboard(clientId));
  } catch (error) {
    return forwardEngineError(error);
  }
}

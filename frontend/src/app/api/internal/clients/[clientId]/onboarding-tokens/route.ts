import { checkInternalPasscode, unauthorized } from "@/lib/internal-auth";
import { forwardProductError, listOnboardingTokens } from "@/lib/product";

type Params = { params: Promise<{ clientId: string }> };

function tokenResponse(token: Awaited<ReturnType<typeof listOnboardingTokens>>[number]) {
  return {
    id: token.id,
    user_id: token.user_id,
    issued_at: token.issued_at,
    revoked_at: token.revoked_at,
    last_used_at: token.last_used_at,
    // Added alongside the console's invite/reset picker (fix wave,
    // 2026-08-22, F1-console): without it an operator looking at this list
    // can't tell an invite from a plain onboarding link.
    purpose: token.purpose,
  };
}

export async function GET(request: Request, { params }: Params) {
  if (!checkInternalPasscode(request)) return unauthorized();
  const { clientId } = await params;
  try {
    return Response.json((await listOnboardingTokens(clientId)).map(tokenResponse));
  } catch (error) {
    return forwardProductError(error);
  }
}

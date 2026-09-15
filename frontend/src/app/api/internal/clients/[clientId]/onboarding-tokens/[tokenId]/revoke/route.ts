import { checkInternalPasscode, unauthorized } from "@/lib/internal-auth";
import { forwardProductError, revokeOnboardingToken } from "@/lib/product";

type Params = { params: Promise<{ clientId: string; tokenId: string }> };

export async function POST(request: Request, { params }: Params) {
  if (!checkInternalPasscode(request)) return unauthorized();
  const { clientId, tokenId } = await params;
  try {
    const token = await revokeOnboardingToken(clientId, tokenId);
    return Response.json({
      id: token.id,
      user_id: token.user_id,
      issued_at: token.issued_at,
      revoked_at: token.revoked_at,
      last_used_at: token.last_used_at,
    });
  } catch (error) {
    return forwardProductError(error);
  }
}

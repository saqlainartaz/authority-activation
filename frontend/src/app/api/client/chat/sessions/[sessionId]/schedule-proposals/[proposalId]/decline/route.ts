/** The client dismisses a schedule card. Nothing is scheduled. */
import { clientToken } from "@/lib/client-session";
import { declineScheduleProposal, expiredLinkResponse, forwardProductError } from "@/lib/product";

type Params = { params: Promise<{ sessionId: string; proposalId: string }> };

export async function POST(_request: Request, { params }: Params) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const { sessionId, proposalId } = await params;
  try {
    return Response.json(await declineScheduleProposal(token, sessionId, proposalId));
  } catch (error) {
    return forwardProductError(error);
  }
}

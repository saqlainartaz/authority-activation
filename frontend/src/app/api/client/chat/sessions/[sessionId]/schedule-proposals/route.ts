/**
 * The schedule-proposal cards for one conversation, for the agent stream.
 *
 * The card renders from the server's record, not from the stream: a reload
 * shows the same cards, and a stale one says so. Client credential only.
 */
import { clientToken } from "@/lib/client-session";
import { expiredLinkResponse, forwardProductError, listScheduleProposals } from "@/lib/product";

type Params = { params: Promise<{ sessionId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const { sessionId } = await params;
  try {
    return Response.json(await listScheduleProposals(token, sessionId));
  } catch (error) {
    return forwardProductError(error);
  }
}

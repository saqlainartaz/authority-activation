/**
 * The client's click on a schedule card: this is what schedules, never the model.
 *
 * An optional changed time comes from the card's own editor, as a LOCAL date and
 * time; the zone is the client's, applied by the server. The server runs the
 * Schedule button's own rules, keyed by the proposal, so a second click returns
 * the first result.
 */
import { clientToken } from "@/lib/client-session";
import { confirmScheduleProposal, expiredLinkResponse, forwardProductError, readJsonObject } from "@/lib/product";

type Params = { params: Promise<{ sessionId: string; proposalId: string }> };

const LOCAL = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;

export async function POST(request: Request, { params }: Params) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const { sessionId, proposalId } = await params;
  const raw = await readJsonObject(request);
  const when = typeof raw.when === "string" ? raw.when : undefined;
  if (when !== undefined && !LOCAL.test(when)) {
    return Response.json({ error: "Pick a date and a time." }, { status: 422 });
  }
  try {
    return Response.json(await confirmScheduleProposal(token, sessionId, proposalId, when ? { when } : {}));
  } catch (error) {
    return forwardProductError(error);
  }
}

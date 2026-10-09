import { clientToken } from '@/lib/client-session';
import { expiredLinkResponse, getMe, getSourceOverview, usesKnowledgeEngine } from '@/lib/product';
import { applySourceOverview } from '@/lib/source-overview';
import {
  forwardEngineError, getClientKnowledgeDocument, getDocumentDetail, removeDocument, reprocessDocument,
} from '@/lib/engine';

type Params = { params: Promise<{ documentId: string }> };

// Under the rehaul engine a client has no delete and no reprocess until P8
// (Cycle 5 P2.7): the knowledge engine retries its own steps, and withdrawal is
// not deletion. The screen offers neither; a request made anyway changes nothing.
const notAvailableYet = () => Response.json(
  { error: "Removing or reprocessing a file isn't available yet." },
  { status: 409 },
);

export async function GET(_: Request, { params }: Params) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  try {
    const { documentId } = await params;
    // One identity read gives both the tenant and which engine serves it.
    const me = await getMe(token);
    if (!usesKnowledgeEngine(me)) return Response.json(await getDocumentDetail(me.client_id, documentId));
    // With its labels and switch state (P7.2), as the list shows it.
    const [document, overview] = await Promise.all([
      getClientKnowledgeDocument(me.client_id, documentId), getSourceOverview(token),
    ]);
    return Response.json(applySourceOverview([document], overview.sources)[0]);
  } catch (error) { return forwardEngineError(error); }
}

export async function POST(_: Request, { params }: Params) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  try {
    const { documentId } = await params;
    const me = await getMe(token);
    if (usesKnowledgeEngine(me)) return notAvailableYet();
    return Response.json(await reprocessDocument(me.client_id, documentId), { status: 202 });
  } catch (error) { return forwardEngineError(error); }
}

export async function DELETE(_: Request, { params }: Params) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  try {
    const { documentId } = await params;
    const me = await getMe(token);
    if (usesKnowledgeEngine(me)) return notAvailableYet();
    await removeDocument(me.client_id, documentId);
    return new Response(null, { status: 204 });
  } catch (error) { return forwardEngineError(error); }
}

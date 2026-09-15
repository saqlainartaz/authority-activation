import { clientToken, resolveClientId } from '@/lib/client-session';
import { expiredLinkResponse } from '@/lib/product';
import { forwardEngineError, getDocumentDetail, removeDocument, reprocessDocument } from '@/lib/engine';

type Params = { params: Promise<{ documentId: string }> };

export async function GET(_: Request, { params }: Params) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  try {
    const { documentId } = await params;
    return Response.json(await getDocumentDetail(await resolveClientId(token), documentId));
  } catch (error) { return forwardEngineError(error); }
}

export async function POST(_: Request, { params }: Params) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  try {
    const { documentId } = await params;
    return Response.json(await reprocessDocument(await resolveClientId(token), documentId), { status: 202 });
  } catch (error) { return forwardEngineError(error); }
}

export async function DELETE(_: Request, { params }: Params) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  try {
    const { documentId } = await params;
    await removeDocument(await resolveClientId(token), documentId);
    return new Response(null, { status: 204 });
  } catch (error) { return forwardEngineError(error); }
}

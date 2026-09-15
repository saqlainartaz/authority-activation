import { clientToken, resolveClientId } from '@/lib/client-session';
import { expiredLinkResponse, forwardProductError } from '@/lib/product';
import { forwardEngineError, listDocuments, uploadDocument } from '@/lib/engine';

export async function GET() {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  try { return Response.json(await listDocuments(await resolveClientId(token))); }
  catch (error) { return forwardProductError(error); }
}

export async function POST(request: Request) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  try {
    const clientId = await resolveClientId(token);
    const form = await request.formData();
    if (!form.has('source_type')) form.set('source_type', 'brand_doc');
    if (!form.has('source_authority')) form.set('source_authority', 'CONVERSATIONAL');
    return Response.json(await uploadDocument(clientId, form), { status: 201 });
  } catch (error) { return forwardEngineError(error); }
}

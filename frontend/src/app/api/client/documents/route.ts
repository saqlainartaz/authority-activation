import { clientToken } from '@/lib/client-session';
import { expiredLinkResponse, forwardProductError, getMe, getSourceOverview, usesKnowledgeEngine } from '@/lib/product';
import {
  EngineHttpError, forwardEngineError, listDocuments, listKnowledgeDocuments, uploadDocument, uploadKnowledgeDocument,
} from '@/lib/engine';
import { applySourceOverview } from '@/lib/source-overview';
import { uploadIssue, uploadIssueCode } from '@/lib/upload-contract';
import { uploadErrorCopy } from '@/lib/upload-errors';

export async function GET() {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  try {
    // One identity read gives both the tenant and which engine serves it.
    const me = await getMe(token);
    if (!usesKnowledgeEngine(me)) return Response.json(await listDocuments(me.client_id));
    // The rows' business labels and "Use this source" states, in one read (P7.2).
    // If it fails the list fails: a source switched off must never read Available.
    const [documents, overview] = await Promise.all([listKnowledgeDocuments(me.client_id), getSourceOverview(token)]);
    return Response.json(applySourceOverview(documents, overview.sources));
  }
  catch (error) { return forwardProductError(error); }
}

/** A refused knowledge-engine upload in the client's words (spec §7.4, P2.7):
 *  which limit and when it resets, never a raw code. Anything the copy does not
 *  speak for keeps the safe projection every other route uses. */
function knowledgeUploadError(error: unknown): Response {
  if (error instanceof EngineHttpError) {
    const copy = uploadErrorCopy(error.status, error.body);
    if (copy) {
      const limit = (error.body as { limit?: unknown } | undefined)?.limit;
      return Response.json(
        {
          error: copy,
          ...(error.status < 500 ? { detail: error.detail } : {}),
          ...(limit === undefined ? {} : { limit }),
        },
        { status: error.status },
      );
    }
  }
  return forwardEngineError(error);
}

export async function POST(request: Request) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  let knowledgeEngine = false;
  try {
    const me = await getMe(token);
    const clientId = me.client_id;
    const form = await request.formData();
    if (usesKnowledgeEngine(me)) {
      knowledgeEngine = true;
      // The knowledge engine decides the lane and type from the bytes (triage),
      // so nothing is declared for it here.
      const file = form.get('file');
      if (!(file instanceof File)) return Response.json({ error: 'Choose a file to upload.' }, { status: 400 });
      // The D08 contract, the same constant the uploader checks (P7.3): a file it
      // refuses never reaches the backend, and is never counted.
      const issue = uploadIssueCode(file);
      if (issue) {
        return Response.json(
          { error: uploadIssue(file), detail: issue },
          { status: issue === 'too_large' ? 413 : issue === 'empty' ? 400 : 415 },
        );
      }
      return Response.json(await uploadKnowledgeDocument(clientId, file), { status: 201 });
    }
    if (!form.has('source_type')) form.set('source_type', 'brand_doc');
    if (!form.has('source_authority')) form.set('source_authority', 'CONVERSATIONAL');
    return Response.json(await uploadDocument(clientId, form), { status: 201 });
  } catch (error) { return knowledgeEngine ? knowledgeUploadError(error) : forwardEngineError(error); }
}

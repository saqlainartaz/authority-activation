import { checkInternalPasscode, unauthorized } from "@/lib/internal-auth";
import {
  forwardEngineError,
  getDocumentDetail,
  removeDocument,
  reprocessDocument,
} from "@/lib/engine";

type Params = { params: Promise<{ clientId: string; documentId: string }> };

export async function GET(request: Request, { params }: Params) {
  if (!checkInternalPasscode(request)) return unauthorized();
  const { clientId, documentId } = await params;
  try {
    const document = await getDocumentDetail(clientId, documentId);
    return Response.json({
      id: document.id,
      source_type: document.source_type,
      source_authority: document.source_authority,
      status: document.status,
      pipeline_version: document.pipeline_version,
      created_at: document.created_at,
      atom_count: document.atom_count,
      pipeline_stages: document.pipeline_stages.map((stage) => ({
        stage: stage.stage,
        actor: stage.actor,
        completed_at: stage.completed_at,
      })),
    });
  } catch (error) {
    return forwardEngineError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  if (!checkInternalPasscode(request)) return unauthorized();
  const { clientId, documentId } = await params;
  try {
    const result = await reprocessDocument(clientId, documentId);
    return Response.json({ status: result.status }, { status: 202 });
  } catch (error) {
    return forwardEngineError(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  if (!checkInternalPasscode(request)) return unauthorized();
  const { clientId, documentId } = await params;
  try {
    await removeDocument(clientId, documentId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return forwardEngineError(error);
  }
}

import { checkInternalPasscode, unauthorized } from "@/lib/internal-auth";
import {
  deploymentUsesKnowledgeEngine,
  forwardEngineError,
  getDocumentDetail,
  getKnowledgeDocumentDetail,
  removeDocument,
  reprocessDocument,
  withdrawKnowledgeDocument,
} from "@/lib/engine";

type Params = { params: Promise<{ clientId: string; documentId: string }> };

export async function GET(request: Request, { params }: Params) {
  if (!checkInternalPasscode(request)) return unauthorized();
  const { clientId, documentId } = await params;
  try {
    const document = await (await deploymentUsesKnowledgeEngine()
      ? getKnowledgeDocumentDetail(clientId, documentId)
      : getDocumentDetail(clientId, documentId));
    return Response.json({
      id: document.id,
      source_type: document.source_type,
      source_authority: document.source_authority,
      status: document.status,
      // Rehaul engine only (P2.7): the spec 7.2 status, so the panel is honest.
      ...(document.knowledge ? { knowledge: document.knowledge } : {}),
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
    if (await deploymentUsesKnowledgeEngine()) {
      // The new engine retries a failed stage by itself (its supervisor); it has
      // no operator reprocess of a whole document yet.
      return Response.json(
        { error: "Reprocess is not available for the new engine yet. It retries failed steps by itself." },
        { status: 409 },
      );
    }
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
    await (await deploymentUsesKnowledgeEngine()
      ? withdrawKnowledgeDocument(clientId, documentId)
      : removeDocument(clientId, documentId));
    return new Response(null, { status: 204 });
  } catch (error) {
    return forwardEngineError(error);
  }
}

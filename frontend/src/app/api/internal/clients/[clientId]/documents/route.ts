import {
  deploymentUsesKnowledgeEngine, forwardEngineError, listDocuments, listKnowledgeDocuments, uploadDocument,
  uploadKnowledgeDocument,
} from "@/lib/engine";
import { checkInternalPasscode, unauthorized } from "@/lib/internal-auth";

type Params = { params: Promise<{ clientId: string }> };

// 2026-10-02: the panel follows the backend's one switch, as the client's
// Knowledge screen does: the new engine when `GET /v2/engine` says ke, else M1.

export async function GET(request: Request, { params }: Params) {
  if (!checkInternalPasscode(request)) return unauthorized();
  const { clientId } = await params;
  try {
    const knowledgeEngine = await deploymentUsesKnowledgeEngine();
    return Response.json(await (knowledgeEngine ? listKnowledgeDocuments(clientId) : listDocuments(clientId)));
  } catch (error) {
    return forwardEngineError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  if (!checkInternalPasscode(request)) return unauthorized();
  const { clientId } = await params;
  try {
    const form = await request.formData();
    if (await deploymentUsesKnowledgeEngine()) {
      // Triage decides the lane and type from the bytes; the operator's
      // upload does not use the client's monthly allowance.
      const file = form.get("file");
      if (!(file instanceof File)) return Response.json({ error: "Choose a file to upload." }, { status: 400 });
      return Response.json(await uploadKnowledgeDocument(clientId, file, "operator"), { status: 201 });
    }
    const doc = await uploadDocument(clientId, form);
    return Response.json(doc, { status: 201 });
  } catch (error) {
    return forwardEngineError(error);
  }
}

import { forwardEngineError, listDocuments, uploadDocument } from "@/lib/engine";
import { checkInternalPasscode, unauthorized } from "@/lib/internal-auth";

type Params = { params: Promise<{ clientId: string }> };

export async function GET(request: Request, { params }: Params) {
  if (!checkInternalPasscode(request)) return unauthorized();
  const { clientId } = await params;
  try {
    return Response.json(await listDocuments(clientId));
  } catch (error) {
    return forwardEngineError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  if (!checkInternalPasscode(request)) return unauthorized();
  const { clientId } = await params;
  try {
    const form = await request.formData();
    const doc = await uploadDocument(clientId, form);
    return Response.json(doc, { status: 201 });
  } catch (error) {
    return forwardEngineError(error);
  }
}

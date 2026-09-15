import { checkInternalPasscode, unauthorized } from "@/lib/internal-auth";
import {
  forwardEngineError,
  listDocuments,
  searchClient,
} from "@/lib/engine";
import { readJsonObject } from "@/lib/product";

type Params = { params: Promise<{ clientId: string }> };

export async function POST(request: Request, { params }: Params) {
  if (!checkInternalPasscode(request)) return unauthorized();
  const { clientId } = await params;
  const raw = await readJsonObject(request);
  try {
    const [hits, documents] = await Promise.all([
      searchClient(clientId, {
        query: raw.query as string,
        type: raw.type as string | undefined,
        limit: raw.limit as number | undefined,
      }),
      listDocuments(clientId),
    ]);
    const sourceByDocumentId = new Map(documents.map((document) => [document.id, document]));
    return Response.json(hits.map((hit) => {
      const source = sourceByDocumentId.get(hit.document_id);
      if (!source) throw new Error("Search hit source is not visible to this client.");
      return {
        id: hit.id,
        atom_type: hit.atom_type,
        text: hit.text,
        status: hit.status,
        trust: hit.trust,
        score: hit.score,
        source: {
          document_id: source.id,
          source_type: source.source_type,
          source_authority: source.source_authority,
        },
      };
    }));
  } catch (error) {
    return forwardEngineError(error);
  }
}

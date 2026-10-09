// POST /api/client/questions/{questionId}/answers -> POST /v1/questions/{id}/answers
// (Cycle 5 P6.6; spec 5.1; A08).
//
// - The browser's `idempotency_key` is forwarded unchanged, and a retry of the
//   same answer sends the same key: the backend records one answer per key. The
//   BFF never makes one up (a key minted here would be new on every retry), so
//   an answer without one is refused with 400 before the backend is called.
// - Only `idempotency_key`, `disposition` and `payload` are forwarded; the client
//   is the session's own.

import { clientToken } from "@/lib/client-session";
import {
  answerClientQuestion, expiredLinkResponse, forwardProductError, readJsonObject, type ClientAnswerBody,
} from "@/lib/product";

type Params = { params: Promise<{ questionId: string }> };

const DISPOSITIONS: readonly string[] = ["answer", "skip", "unknown", "defer"];

export async function POST(request: Request, { params }: Params) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const { questionId } = await params;
  const raw = await readJsonObject(request);
  const key = raw.idempotency_key;
  if (typeof key !== "string" || !key.trim() || key.length > 200) {
    return Response.json(
      { error: "This answer has no intent key, so nothing was sent.", detail: "idempotency_key_required" },
      { status: 400 },
    );
  }
  if (typeof raw.disposition !== "string" || !DISPOSITIONS.includes(raw.disposition)) {
    return Response.json({ error: "That answer could not be read.", detail: "disposition_invalid" }, { status: 400 });
  }
  const body: ClientAnswerBody = { idempotency_key: key, disposition: raw.disposition as ClientAnswerBody["disposition"] };
  if (raw.payload && typeof raw.payload === "object" && !Array.isArray(raw.payload)) {
    body.payload = raw.payload as Record<string, unknown>;
  }
  try {
    return Response.json(await answerClientQuestion(token, questionId, body), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return forwardProductError(error);
  }
}

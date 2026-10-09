import { forwardEngineError, giveExtraUploads } from "@/lib/engine";
import { rehaulEnabledForOperator } from "@/lib/engine-gate";
import { checkInternalPasscode, unauthorized } from "@/lib/internal-auth";
import { readJsonObject } from "@/lib/product";
import { intentKeyOf, limitsUnavailable, missingIntentKey } from "../limits-request";

type Params = { params: Promise<{ clientId: string }> };

export async function POST(request: Request, { params }: Params) {
  if (!checkInternalPasscode(request)) return unauthorized();
  const { clientId } = await params;
  const raw = await readJsonObject(request);
  const intentKey = intentKeyOf(raw);
  if (!intentKey) return missingIntentKey();
  try {
    if (!(await rehaulEnabledForOperator())) return limitsUnavailable();
    return Response.json(await giveExtraUploads(clientId, {
      extra_uploads: raw.extra_uploads as number,
      reason: raw.reason as string,
      intent_key: intentKey,
    }));
  } catch (error) {
    return forwardEngineError(error);
  }
}

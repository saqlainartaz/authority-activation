import { forwardEngineError, getClientLimits, updateClientLimits, type LimitsEditBody } from "@/lib/engine";
import { rehaulEnabledForOperator } from "@/lib/engine-gate";
import { checkInternalPasscode, unauthorized } from "@/lib/internal-auth";
import { readJsonObject } from "@/lib/product";
import { limitsUnavailable, pick } from "./limits-request";

type Params = { params: Promise<{ clientId: string }> };

// The settings a PUT may change; only those the browser sent are forwarded, so
// "send only what changes" holds end to end. `monthly_uploads: null` is kept:
// it means no monthly limit.
const EDITABLE = ["monthly_uploads", "daily_limit_usd", "writing_daily_usd", "writing_monthly_usd"] as const;

export async function GET(request: Request, { params }: Params) {
  if (!checkInternalPasscode(request)) return unauthorized();
  const { clientId } = await params;
  try {
    if (!(await rehaulEnabledForOperator())) return limitsUnavailable();
    return Response.json(await getClientLimits(clientId));
  } catch (error) {
    return forwardEngineError(error);
  }
}

export async function PUT(request: Request, { params }: Params) {
  if (!checkInternalPasscode(request)) return unauthorized();
  const { clientId } = await params;
  const raw = await readJsonObject(request);
  try {
    if (!(await rehaulEnabledForOperator())) return limitsUnavailable();
    // A plain edit: no intent key (edit replay was removed as over-engineered,
    // 2026-10-08). `expected_revision` keeps a save from overwriting a newer one.
    const body = {
      ...pick(raw, EDITABLE),
      reason: raw.reason,
      expected_revision: raw.expected_revision,
    } as LimitsEditBody;
    return Response.json(await updateClientLimits(clientId, body));
  } catch (error) {
    return forwardEngineError(error);
  }
}

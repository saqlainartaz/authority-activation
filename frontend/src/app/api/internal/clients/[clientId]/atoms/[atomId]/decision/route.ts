import { decideAtom } from "@/lib/engine";
import { checkInternalPasscode, unauthorized } from "@/lib/internal-auth";

type Params = { params: Promise<{ clientId: string; atomId: string }> };

export async function POST(request: Request, { params }: Params) {
  if (!checkInternalPasscode(request)) return unauthorized();
  const { clientId, atomId } = await params;
  const { decision, reason } = await request.json();
  if (decision !== "confirm" && decision !== "deprecate") {
    return Response.json({ error: "decision must be confirm or deprecate" }, { status: 422 });
  }
  const atom = await decideAtom(
    clientId,
    atomId,
    decision,
    typeof reason === "string" && reason.trim() ? reason.trim() : `${decision}ed in console`,
    "internal-console",
  );
  return Response.json(atom);
}

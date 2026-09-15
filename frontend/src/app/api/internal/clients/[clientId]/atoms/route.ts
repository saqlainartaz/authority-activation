import { listAtoms } from "@/lib/engine";
import { checkInternalPasscode, unauthorized } from "@/lib/internal-auth";

type Params = { params: Promise<{ clientId: string }> };

export async function GET(request: Request, { params }: Params) {
  if (!checkInternalPasscode(request)) return unauthorized();
  const { clientId } = await params;
  const type = new URL(request.url).searchParams.get("type") ?? undefined;
  const atoms = await listAtoms(clientId, 500, type);
  return Response.json(atoms);
}

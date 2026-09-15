import { clientConsole } from "@/lib/product";
import { checkInternalPasscode, unauthorized } from "@/lib/internal-auth";

type Params = { params: Promise<{ clientId: string }> };

export async function GET(request: Request, { params }: Params) {
  if (!checkInternalPasscode(request)) return unauthorized();
  const { clientId } = await params;

  // This route used to reconstruct an older, lossy summary from two engine
  // reads. The operator contract already has one authoritative console read;
  // most importantly its two version fields stay independent.
  return Response.json(await clientConsole(clientId));
}

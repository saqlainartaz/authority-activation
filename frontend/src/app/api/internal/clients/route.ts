import { createClient, listClients } from "@/lib/engine";
import { checkInternalPasscode, unauthorized } from "@/lib/internal-auth";

export async function GET(request: Request) {
  if (!checkInternalPasscode(request)) return unauthorized();
  return Response.json(await listClients());
}

export async function POST(request: Request) {
  if (!checkInternalPasscode(request)) return unauthorized();
  const { name } = await request.json();
  if (!name || typeof name !== "string" || !name.trim()) {
    return Response.json({ error: "name required" }, { status: 422 });
  }
  return Response.json(await createClient(name.trim()), { status: 201 });
}

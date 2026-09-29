import { createClient, forwardEngineError, listClients } from "@/lib/engine";
import { checkInternalPasscode, unauthorized } from "@/lib/internal-auth";

export async function GET(request: Request) {
  if (!checkInternalPasscode(request)) return unauthorized();
  return Response.json(await listClients());
}

export async function POST(request: Request) {
  if (!checkInternalPasscode(request)) return unauthorized();
  const { name, timezone } = await request.json();
  if (!name || typeof name !== "string" || !name.trim()) {
    return Response.json({ error: "name required" }, { status: 422 });
  }
  if (timezone !== undefined && (typeof timezone !== "string" || !timezone.trim())) {
    return Response.json({ error: "timezone must be a nonempty IANA time zone name" }, { status: 422 });
  }
  try {
    return Response.json(await createClient(name.trim(), timezone?.trim()), { status: 201 });
  } catch (error) {
    return forwardEngineError(error);
  }
}

import { approveVoiceProfile, buildVoiceProfile, getVoiceProfile } from "@/lib/engine";
import { checkInternalPasscode, unauthorized } from "@/lib/internal-auth";

export async function POST(request: Request) {
  if (!checkInternalPasscode(request)) return unauthorized();
  const { clientId, action, version } = await request.json();
  if (!clientId || typeof clientId !== "string") {
    return Response.json({ error: "clientId required" }, { status: 422 });
  }
  if (action === "approve") {
    if (typeof version !== "number") {
      return Response.json({ error: "version required to approve" }, { status: 422 });
    }
    const profile = await approveVoiceProfile(clientId, version);
    return Response.json({ version: profile.version, status: profile.status });
  }
  await buildVoiceProfile(clientId); // engine queues the build (202)
  return Response.json({ status: "queued" }, { status: 202 });
}

export async function GET(request: Request) {
  if (!checkInternalPasscode(request)) return unauthorized();
  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId");
  if (!clientId) return Response.json({ error: "clientId required" }, { status: 422 });
  const profile = await getVoiceProfile(clientId);
  if (!profile) return Response.json(null);
  if (url.searchParams.get("full") === "1") return Response.json(profile);
  const { payload: _payload, ...summary } = profile;
  return Response.json(summary);
}

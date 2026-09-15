import { checkInternalPasscode, unauthorized } from "@/lib/internal-auth";
import {
  createClientUser,
  forwardProductError,
  listClientUsers,
  readJsonObject,
} from "@/lib/product";

type Params = { params: Promise<{ clientId: string }> };

function userResponse(user: Awaited<ReturnType<typeof createClientUser>>) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    profession: user.profession,
    status: user.status,
    created_at: user.created_at,
  };
}

export async function GET(request: Request, { params }: Params) {
  if (!checkInternalPasscode(request)) return unauthorized();
  const { clientId } = await params;
  try {
    return Response.json((await listClientUsers(clientId)).map(userResponse));
  } catch (error) {
    return forwardProductError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  if (!checkInternalPasscode(request)) return unauthorized();
  const { clientId } = await params;
  const raw = await readJsonObject(request);
  try {
    const user = await createClientUser(clientId, {
      email: raw.email as string,
      display_name: raw.display_name as string,
      profession: raw.profession as string | null,
    });
    return Response.json(userResponse(user), { status: 201 });
  } catch (error) {
    return forwardProductError(error);
  }
}

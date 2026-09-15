// The client's own configured zone, resolved from the session and nowhere else.
//
// THE SAME COLUMN THE BACKEND READS. `product/api/lookups.py::client_zone` takes
// `clients.timezone` and stamps it on every slot it writes; `GET /v1/clients`
// publishes that same column. Reading it here means the instant we send and the
// `slot_zone` the backend stores describe the same wall-clock, by construction
// rather than by luck.
//
// D-07: the tenant comes from the token, never from a caller. `resolveClientId`
// is the one path to it (`GET /v1/me`).

import "server-only";

import { resolveClientId } from "./client-session";
import { EngineHttpError, listClients } from "./engine";

export async function clientTimezone(token: string): Promise<string> {
  const clientId = await resolveClientId(token);
  const client = (await listClients()).find(({ id }) => id === clientId);
  if (!client) {
    // The same shape `api/client/profile/route.ts` throws for the same miss, so it
    // travels back through `forwardEngineError` rather than as an untyped 500.
    throw new EngineHttpError("Client not found", 404, "Client not found");
  }
  return client.timezone;
}

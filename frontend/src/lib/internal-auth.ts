// Lightweight gate for the /internal onboarding tool until real auth lands.
// The passcode lives server-side (INTERNAL_PASSCODE); the internal UI sends it
// as a header with every request. Not a substitute for real auth — just keeps
// the internal tool from being wide open.

import "server-only";

export function checkInternalPasscode(request: Request): boolean {
  const expected = process.env.INTERNAL_PASSCODE;
  if (!expected) return false; // unset -> tool disabled, fail closed
  const got = request.headers.get("x-internal-passcode") ?? "";
  return got.length > 0 && got === expected;
}

export function unauthorized(): Response {
  return Response.json({ error: "invalid passcode" }, { status: 401 });
}

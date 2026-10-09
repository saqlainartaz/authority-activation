// Shared rules for the operator Limits BFF routes (Cycle 5 P2.5).
//
// - Extra uploads carry the browser's `intent_key`, forwarded unchanged. The BFF
//   never makes one up: a key minted here would be new on every retry and turn
//   a lost response into a second grant. A grant without one is refused with
//   400 before the backend is called (plan §3.2). A limits edit (PUT) takes no
//   key: `expected_revision` alone keeps it from overwriting a newer edit.
// - Only the fields the backend's request takes are forwarded. `changed_by` and
//   `granted_by` never are: the backend stamps its own principal (spec §2).
// - Limits are a rehaul-engine surface. Under M1 every route answers 404 and the
//   console does not show the section.

// The backend takes a UUID; anything else would come back as an unexplained 422.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The browser's key, exactly as sent, when it is a UUID; otherwise null. */
export function intentKeyOf(raw: Record<string, unknown>): string | null {
  const key = raw.intent_key;
  return typeof key === "string" && UUID.test(key) ? key : null;
}

export function missingIntentKey(): Response {
  return Response.json(
    { error: "This action has no intent key, so nothing was sent.", detail: "intent_key_required" },
    { status: 400 },
  );
}

export function limitsUnavailable(): Response {
  return Response.json(
    { error: "Limits are managed here only when the new engine runs.", detail: "limits_unavailable" },
    { status: 404 },
  );
}

/** The named fields of `raw` that are present, and nothing else. */
export function pick<K extends string>(raw: Record<string, unknown>, fields: readonly K[]): Partial<Record<K, unknown>> {
  const picked: Partial<Record<K, unknown>> = {};
  for (const field of fields) if (Object.prototype.hasOwnProperty.call(raw, field)) picked[field] = raw[field];
  return picked;
}

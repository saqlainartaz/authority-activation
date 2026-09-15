import { clientToken } from "@/lib/client-session";
import { expiredLinkResponse, forwardProductError, readJsonObject, sendChatCommand } from "@/lib/product";
import type { ChatCommandCreate } from "@/lib/product";

type Params = { params: Promise<{ sessionId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// NARROWED (§9 step 6, Task 9). `generate` and `show_sources`/`reject_variant`
// became agent tools at step 4 and have had no browser sender since step 5;
// the backend stopped accepting them the same step (`DraftCommand` in
// `src/product/chat/commands.py`).
const MESSAGE_KINDS = new Set(["answer_clarification", "unsupported_lifecycle", "clarify_scope"]);
const PROPOSAL_KINDS = new Set(["propose_durable_fact", "propose_constraint"]);
const VARIANT_KINDS = new Set(["copy_variant", "select_variant", "finish"]);
const CONFIRM_KINDS = new Set(["confirm_durable_fact", "confirm_constraint"]);

function refuse(message: string): Response {
  return Response.json({ error: message }, { status: 422 });
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function keyed(raw: Record<string, unknown>): string | null {
  return typeof raw.idempotency_key === "string" && raw.idempotency_key.trim().length >= 8 && raw.idempotency_key.trim().length <= 200
    ? raw.idempotency_key.trim()
    : null;
}

function message(raw: Record<string, unknown>): string | null {
  return typeof raw.message === "string" && raw.message.trim().length > 0 && raw.message.trim().length <= 4000
    ? raw.message.trim()
    : null;
}

function exactKeys(raw: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(raw).every((key) => keys.includes(key)) && keys.every((key) => key in raw);
}

export function commandFrom(raw: Record<string, unknown>): ChatCommandCreate | null {
  const idempotency_key = keyed(raw);
  if (!idempotency_key || typeof raw.kind !== "string") return null;
  const { kind } = raw;
  if (MESSAGE_KINDS.has(kind)) {
    const body = message(raw);
    return exactKeys(raw, ["kind", "message", "idempotency_key"]) && body
      ? { kind: kind as "answer_clarification" | "unsupported_lifecycle" | "clarify_scope", message: body, idempotency_key }
      : null;
  }
  if (PROPOSAL_KINDS.has(kind)) {
    const body = message(raw);
    return exactKeys(raw, ["kind", "message", "idempotency_key"]) && body
      ? { kind: kind as "propose_durable_fact" | "propose_constraint", message: body, idempotency_key }
      : null;
  }
  if (VARIANT_KINDS.has(kind)) {
    return exactKeys(raw, ["kind", "variant_id", "idempotency_key"]) && uuid(raw.variant_id)
      ? { kind: kind as "copy_variant" | "select_variant" | "finish", variant_id: raw.variant_id, idempotency_key }
      : null;
  }
  if (CONFIRM_KINDS.has(kind)) {
    return exactKeys(raw, ["kind", "pending_confirmation_id", "confirmed", "idempotency_key"]) && uuid(raw.pending_confirmation_id) && raw.confirmed === true
      ? { kind: kind as "confirm_durable_fact" | "confirm_constraint", pending_confirmation_id: raw.pending_confirmation_id, confirmed: true, idempotency_key }
      : null;
  }
  return kind === "start_new_post" && exactKeys(raw, ["kind", "idempotency_key"])
    ? { kind, idempotency_key }
    : null;
}

export async function POST(request: Request, { params }: Params) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const { sessionId } = await params;
  if (!UUID.test(sessionId)) return refuse("sessionId must be a UUID.");
  const command = commandFrom(await readJsonObject(request));
  if (!command) return refuse("Chat command is not a documented command shape.");
  try {
    return Response.json(await sendChatCommand(token, sessionId, command));
  } catch (error) {
    return forwardProductError(error);
  }
}

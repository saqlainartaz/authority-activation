import { describe, expect, it } from "vitest";

import { commandFrom } from "@/app/api/client/chat/sessions/[sessionId]/commands/route";

const VARIANT_ID = "11111111-1111-4111-8111-111111111111";
const CONFIRMATION_ID = "22222222-2222-4222-8222-222222222222";
const KEY = "k".repeat(10);

/**
 * §9 step 6, Task 9 — the `/commands` allowlist narrowed to what the browser
 * actually sends. `generate`, `revise`, `show_sources` and `reject_variant`
 * became agent tools at step 4 and have had no browser sender since step 5;
 * the backend stopped validating them the same step.
 *
 * Tested against `commandFrom` directly, not `POST` — the route's `POST`
 * calls `clientToken()` (`next/headers`'s `cookies()`) before it ever reaches
 * `commandFrom`, which throws outside a real request scope and nothing in
 * this suite mocks. `commandFrom` is the one function that actually decides
 * whether a kind is accepted, and exporting it for this test follows the
 * same pattern already used elsewhere in this file's own tree
 * (`phaseForChat`, `dedupeEcho`, `foldEvent` — pure logic exported off a
 * route/hook and tested directly, never through a simulated request).
 *
 * FIX (fix wave, 2026-08-26, review Important 2). The first version of this
 * file sent `kind`, `message` AND `variant_id` for all four removed kinds.
 * Against the UN-narrowed route, `exactKeys` already rejected `generate`
 * (which required exactly `kind`/`message`/`idempotency_key` — no
 * `variant_id`) and both `show_sources`/`reject_variant` (which required
 * exactly `kind`/`variant_id`/`idempotency_key` — no `message`) for the
 * EXTRA key alone, before the kind was ever consulted. Only `revise`
 * actually discriminated on the narrowing. Each removed kind below now gets
 * EXACTLY the payload shape it required before Task 9, so a refusal proves
 * the kind itself is gone, not that the payload was already malformed.
 */
describe("commandFrom — the narrowed allowlist", () => {
  it.each([
    // Was in MESSAGE_KINDS: exactly kind/message/idempotency_key, no variant_id.
    ["generate", { kind: "generate", message: "write it", idempotency_key: KEY }],
    // Had its own branch: exactly kind/message/variant_id/idempotency_key.
    ["revise", { kind: "revise", message: "write it", variant_id: VARIANT_ID, idempotency_key: KEY }],
    // Was in VARIANT_KINDS: exactly kind/variant_id/idempotency_key, no message.
    ["show_sources", { kind: "show_sources", variant_id: VARIANT_ID, idempotency_key: KEY }],
    ["reject_variant", { kind: "reject_variant", variant_id: VARIANT_ID, idempotency_key: KEY }],
  ] as const)("refuses %s — the agent owns it as a tool since step 4", (_kind, payload) => {
    const command = commandFrom(payload);
    expect(command).toBeNull();
  });

  it.each(["copy_variant", "select_variant", "finish"])("still accepts %s", (kind) => {
    const command = commandFrom({ kind, variant_id: VARIANT_ID, idempotency_key: KEY });
    expect(command).not.toBeNull();
    expect(command?.kind).toBe(kind);
  });

  it.each(["answer_clarification", "unsupported_lifecycle", "clarify_scope"])("still accepts %s", (kind) => {
    const command = commandFrom({ kind, message: "write it", idempotency_key: KEY });
    expect(command).not.toBeNull();
    expect(command?.kind).toBe(kind);
  });

  it.each(["propose_durable_fact", "propose_constraint"])("still accepts %s", (kind) => {
    const command = commandFrom({ kind, message: "write it", idempotency_key: KEY });
    expect(command).not.toBeNull();
    expect(command?.kind).toBe(kind);
  });

  it.each(["confirm_durable_fact", "confirm_constraint"])("still accepts %s", (kind) => {
    const command = commandFrom({
      kind,
      pending_confirmation_id: CONFIRMATION_ID,
      confirmed: true,
      idempotency_key: KEY,
    });
    expect(command).not.toBeNull();
    expect(command?.kind).toBe(kind);
  });

  it("still accepts start_new_post", () => {
    const command = commandFrom({ kind: "start_new_post", idempotency_key: KEY });
    expect(command).not.toBeNull();
    expect(command?.kind).toBe("start_new_post");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IntentKeyHolder, isDefinitiveFailure, withIntentKey } from "@/lib/intent-key";
import { limitsBackend } from "./limits-backend-stub";

/**
 * Cycle 5 P2.5, the full path of one operator action: the panel's
 * `sendLimitsAction`, the console's real browser API (`createInternalApi`), the
 * real BFF route handlers, and a stub backend. Extra uploads are idempotent by
 * `intent_key`: the first attempt commits at the backend, its answer is lost, the
 * operator sends it again, and exactly one grant exists. A limits edit is a plain
 * PUT with no key: sent again after a lost answer it is refused as stale and is
 * never applied twice (the edit replay and the temporary money grants were removed
 * as over-engineered, 2026-10-08).
 */
const PASSCODE = "letmein";

async function browser(options: { loseBrowserAnswers?: number } = {}) {
  const [limits, extra, changes, { createInternalApi }] = await Promise.all([
    import("@/app/api/internal/clients/[clientId]/limits/route"),
    import("@/app/api/internal/clients/[clientId]/limits/extra-uploads/route"),
    import("@/app/api/internal/clients/[clientId]/limits/changes/route"),
    import("@/app/internal/internal-api"),
  ]);
  let toLose = options.loseBrowserAnswers ?? 0;
  const sent: Array<Record<string, unknown>> = [];
  // The browser's network: same-origin calls reach the real route handlers.
  const network = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "https://app.test");
    const request = new Request(url, init);
    if (init?.body) sent.push(JSON.parse(String(init.body)));
    const params = { params: Promise.resolve({ clientId: url.pathname.split("/")[4] }) } as never;
    const method = init?.method ?? "GET";
    let response: Response;
    if (url.pathname.endsWith("/limits/extra-uploads")) response = await extra.POST(request, params);
    else if (url.pathname.endsWith("/limits/changes")) response = await changes.GET(request, params);
    else if (method === "PUT") response = await limits.PUT(request, params);
    else response = await limits.GET(request, params);
    if (toLose > 0) {
      // The BFF answered (the backend committed), but the browser never hears it.
      toLose -= 1;
      throw new TypeError("Failed to fetch");
    }
    return response;
  });
  return { api: createInternalApi(PASSCODE, network as unknown as typeof fetch), network, sent };
}

describe("a Limits action retried after a lost answer is applied once", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("ENGINE_URL", "https://engine.test");
    vi.stubEnv("ENGINE_SERVICE_KEY", "service-key");
    vi.stubEnv("INTERNAL_PASSCODE", PASSCODE);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("extra uploads: a +10 retried after a lost answer adds ten once", async () => {
    const backend = limitsBackend();
    vi.stubGlobal("fetch", backend.fetch);
    const { sendLimitsAction } = await import("@/app/internal/limits-actions");
    const { api } = await browser({ loseBrowserAnswers: 1 });
    const holder = new IntentKeyHolder();
    const path = "/api/internal/clients/c1/limits/extra-uploads";

    expect((await sendLimitsAction(api, holder, path, "POST", { extra_uploads: 10, reason: "Pack" })).kind).toBe("retry");
    const retry = await sendLimitsAction(api, holder, path, "POST", { extra_uploads: 10, reason: "Pack" });

    expect(retry).toMatchObject({ kind: "saved", replayed: true, limits: { extra_uploads: 10, uploads_remaining: 12 } });
    expect(backend.state.extraGrants.size).toBe(1);
  });

  it("a plain edit sent again after a lost answer is refused as stale and applied once", async () => {
    const backend = limitsBackend();
    vi.stubGlobal("fetch", backend.fetch);
    const { sendLimitsAction } = await import("@/app/internal/limits-actions");
    const { api, sent } = await browser({ loseBrowserAnswers: 1 });
    const body = { monthly_uploads: 30, reason: "Plan change", expected_revision: 3 };

    expect((await sendLimitsAction(api, null, "/api/internal/clients/c1/limits", "PUT", body)).kind).toBe("retry");
    expect(backend.state.revision).toBe(4); // the first attempt did commit
    const again = await sendLimitsAction(api, null, "/api/internal/clients/c1/limits", "PUT", body);

    expect(again).toMatchObject({ kind: "refused", code: "stale_limits" });
    expect(backend.state.revision).toBe(4);
    expect(backend.state.monthlyUploads).toBe(30);
    // No key anywhere on the edit path: the browser sends none and the BFF adds none.
    expect(sent.every((sentBody) => !("intent_key" in sentBody))).toBe(true);
    const puts = backend.state.calls.filter((call) => call.method === "PUT");
    expect(puts.every((call) => !("intent_key" in (call.body ?? {})))).toBe(true);
  });

  it("after a definitive answer the next extra-uploads action gets a new key", async () => {
    const backend = limitsBackend();
    vi.stubGlobal("fetch", backend.fetch);
    const { sendLimitsAction } = await import("@/app/internal/limits-actions");
    const { api, sent } = await browser();
    const holder = new IntentKeyHolder();
    const path = "/api/internal/clients/c1/limits/extra-uploads";
    const body = { extra_uploads: 5, reason: "Campaign month" };

    expect((await sendLimitsAction(api, holder, path, "POST", body)).kind).toBe("saved");
    expect((await sendLimitsAction(api, holder, path, "POST", body)).kind).toBe("saved");

    expect(sent[0].intent_key).not.toBe(sent[1].intent_key);
    expect(backend.state.extraGrants.size).toBe(2); // two deliberate grants
  });

  it("explains a refusal in plain words", async () => {
    const backend = limitsBackend();
    vi.stubGlobal("fetch", backend.fetch);
    const { sendLimitsAction } = await import("@/app/internal/limits-actions");
    const { api } = await browser();

    const stale = await sendLimitsAction(api, null, "/api/internal/clients/c1/limits", "PUT",
      { daily_limit_usd: 20, reason: "Bigger", expected_revision: 1 });
    expect(stale).toEqual({
      kind: "refused", code: "stale_limits",
      message: "These limits were changed by someone else. Review the current values and save again.",
    });
  });
});

describe("the edit form's baseline (review I1)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("ENGINE_URL", "https://engine.test");
    vi.stubEnv("ENGINE_SERVICE_KEY", "service-key");
    vi.stubEnv("INTERNAL_PASSCODE", PASSCODE);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("a save after another operator's change is refused as stale, even when extra uploads brought back the newer revision", async () => {
    const backend = limitsBackend();
    vi.stubGlobal("fetch", backend.fetch);
    const { sendLimitsAction } = await import("@/app/internal/limits-actions");
    const { formFromLimits, limitsEditBody } = await import("@/lib/limits");
    const { api } = await browser();
    type Limits = import("@/lib/limits").ClientLimits;

    // Operator A opens the card: the edit form's baseline is revision 3.
    const baseline = await api<Limits>("/api/internal/clients/c1/limits");
    const form = { ...formFromLimits(baseline), writingDaily: "12" };

    // Operator B changes the Documents budget: revision 4.
    const other = await sendLimitsAction(api, null, "/api/internal/clients/c1/limits", "PUT",
      { daily_limit_usd: 25, reason: "B", expected_revision: 3 });
    expect(other.kind).toBe("saved");

    // A gives extra uploads; the reply carries revision 4 and B's value.
    const grant = await sendLimitsAction(api, new IntentKeyHolder(), "/api/internal/clients/c1/limits/extra-uploads",
      "POST", { extra_uploads: 2, reason: "A" });
    expect(grant).toMatchObject({ kind: "saved", limits: { revision: 4, daily_limit_usd: 25 } });

    // A saves the form: built against its baseline, so it is stale and never applied.
    const { body } = limitsEditBody(baseline, form, "A's edit");
    expect(body).toEqual({ writing_daily_usd: 12, reason: "A's edit", expected_revision: 3 });
    const save = await sendLimitsAction(api, null, "/api/internal/clients/c1/limits", "PUT", body!);

    expect(save).toMatchObject({ kind: "refused", code: "stale_limits" });
    expect(backend.state.documentsDaily).toBe(25);
    expect(backend.state.writingDaily).toBe(10);
    expect(backend.state.revision).toBe(4);
  });
});

describe("the intent key rules", () => {
  it("keeps the key across retryable failures and drops it after a definitive answer", async () => {
    let minted = 0;
    const holder = new IntentKeyHolder(() => `key-${++minted}`);
    const seen: string[] = [];
    const fail = (status?: number) => async (key: string) => {
      seen.push(key);
      throw Object.assign(new Error("x"), status === undefined ? {} : { status });
    };

    await expect(withIntentKey(holder, fail())).rejects.toThrow();
    await expect(withIntentKey(holder, fail(502))).rejects.toThrow();
    await expect(withIntentKey(holder, fail(504))).rejects.toThrow();
    await withIntentKey(holder, async (key) => { seen.push(key); return "ok"; });
    await expect(withIntentKey(holder, fail(422))).rejects.toThrow();
    await withIntentKey(holder, async (key) => { seen.push(key); return "ok"; });

    expect(seen).toEqual(["key-1", "key-1", "key-1", "key-1", "key-2", "key-3"]);
  });

  it("counts only a 4xx (not a timeout) as a definitive failure", () => {
    expect(isDefinitiveFailure(Object.assign(new Error(), { status: 409 }))).toBe(true);
    expect(isDefinitiveFailure(Object.assign(new Error(), { status: 400 }))).toBe(true);
    expect(isDefinitiveFailure(Object.assign(new Error(), { status: 408 }))).toBe(false);
    expect(isDefinitiveFailure(Object.assign(new Error(), { status: 500 }))).toBe(false);
    expect(isDefinitiveFailure(new TypeError("Failed to fetch"))).toBe(false);
  });
});

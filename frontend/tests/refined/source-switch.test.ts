import { describe, expect, it, vi } from "vitest";

import { IntentKeyHolder } from "@/lib/intent-key";
import {
  KNOWLEDGE_LABELS, NOT_IN_USE_DETAIL, REPLACED_DETAIL, SWITCHED_OFF_DETAIL, TURNING_OFF_DETAIL, TURNING_ON_DETAIL,
  knowledgeStatus, withSourceUse, type SourceUse,
} from "@/lib/knowledge-status";
import { applySourceOverview, SOURCE_ON } from "@/lib/source-overview";
import { deleteSource, readSourceUse, SourceSwitchError, SWITCH_REFUSALS, switchSource, waitUntilEnforced } from "@/lib/source-switch";

/**
 * Cycle 5 P7.2 (spec §7.3, A21, frontend): the "Use this source" switch as the
 * popup runs it, and how its state reads on a source.
 * - A change carries the browser's intent key and the revision last read; it is
 *   pending until enforced, then the new state shows.
 * - 409 stale (or a reused key) reads the current state again and shows it.
 * - A retry after no answer reuses the key; after a definitive answer a new one.
 * - The operator's withdrawal is never confused with the client's Off.
 */

const ID = "22222222-2222-4222-8222-222222222222";
const PATH = `/api/client/sources/${ID}/lifecycle`;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Call = { url: string; method: string; body: Record<string, unknown> | null };

function bff(answers: Array<(call: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit = {}) => {
    const call = { url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null };
    calls.push(call);
    const next = answers.shift();
    if (!next) throw new Error(`unexpected ${call.method} ${url}`);
    return next(call);
  });
  return { fetcher, calls };
}

const ON: SourceUse = { state: "on", requested: null, revision: 3 };
const keys = () => { let n = 0; return new IntentKeyHolder(() => `key-${++n}`); };
const lifecycleAnswer = (source: Record<string, unknown>) => ({
  request: { id: "r", operation: "disable", lifecycle_revision: 4, request_state: "pending", outcome: null }, source, replayed: false,
});

describe("switching a source off and on", () => {
  it("sends the intent key and the revision it read, shows pending, then the enforced state", async () => {
    const { fetcher, calls } = bff([
      () => json(lifecycleAnswer({ document_id: ID, state: "pending", requested: "off", revision: 4 }), 201),
      () => json({ document_id: ID, state: "pending", requested: "off", revision: 4 }),
      () => json({ document_id: ID, state: "off", requested: null, revision: 4 }),
    ]);

    const result = await switchSource(ID, "off", ON, keys(), fetcher);

    expect(calls[0]).toEqual({ url: PATH, method: "POST", body: { intent_key: "key-1", operation: "disable", expected_lifecycle_revision: 3 } });
    expect(result).toEqual({ kind: "sent", use: { state: "pending", requested: "off", revision: 4 } });

    const settled = await waitUntilEnforced(ID, { fetcher, sleep: async () => undefined });
    expect(settled).toEqual({ state: "off", requested: null, revision: 4 });
    expect(calls.slice(1).map(call => `${call.method} ${call.url}`)).toEqual([`GET ${PATH}`, `GET ${PATH}`]);
  });

  it("switches back on with re_enable against the newer revision", async () => {
    const { fetcher, calls } = bff([() => json(lifecycleAnswer({ document_id: ID, state: "on", requested: null, revision: 5 }), 201)]);

    const result = await switchSource(ID, "on", { state: "off", requested: null, revision: 4 }, keys(), fetcher);

    expect(calls[0].body).toEqual({ intent_key: "key-1", operation: "re_enable", expected_lifecycle_revision: 4 });
    expect(result).toEqual({ kind: "sent", use: { state: "on", requested: null, revision: 5 } });
  });

  it("on 409 stale, reads the source again and shows its current state, sending nothing more", async () => {
    const holder = keys();
    const { fetcher, calls } = bff([
      () => json({ error: SWITCH_REFUSALS.stale_source_state, detail: "stale_source_state" }, 409),
      () => json({ document_id: ID, state: "off", requested: null, revision: 6 }),
    ]);

    const result = await switchSource(ID, "off", ON, holder, fetcher);

    expect(result).toEqual({ kind: "reloaded", use: { state: "off", requested: null, revision: 6 }, message: SWITCH_REFUSALS.stale_source_state });
    expect(calls.map(call => call.method)).toEqual(["POST", "GET"]);
    // A definitive answer ended the key: the next change is a new intent.
    expect(holder.current()).toBe("key-2");
  });

  it("on 409 intent_key_reused, also reads the current state again", async () => {
    const { fetcher } = bff([
      () => json({ error: SWITCH_REFUSALS.intent_key_reused, detail: "intent_key_reused" }, 409),
      () => json({ document_id: ID, state: "on", requested: null, revision: 3 }),
    ]);

    const result = await switchSource(ID, "off", ON, keys(), fetcher);
    expect(result).toMatchObject({ kind: "reloaded", message: SWITCH_REFUSALS.intent_key_reused });
  });

  it("retries with the SAME key after no definitive answer", async () => {
    const holder = keys();
    const { fetcher, calls } = bff([
      () => { throw new TypeError("network"); },
      () => json({ error: "Something broke on our side." }, 502),
      () => json(lifecycleAnswer({ document_id: ID, state: "off", requested: null, revision: 4 }), 200),
    ]);

    await expect(switchSource(ID, "off", ON, holder, fetcher)).rejects.toBeInstanceOf(SourceSwitchError);
    await expect(switchSource(ID, "off", ON, holder, fetcher)).rejects.toMatchObject({ status: 502 });
    await switchSource(ID, "off", ON, holder, fetcher);

    expect(calls.map(call => call.body?.intent_key)).toEqual(["key-1", "key-1", "key-1"]);
  });

  it("is refused for a source it cannot act on, and says so", async () => {
    const { fetcher } = bff([() => json({ error: SWITCH_REFUSALS.source_not_controllable, detail: "source_not_controllable" }, 409)]);

    expect(await switchSource(ID, "on", ON, keys(), fetcher))
      .toEqual({ kind: "refused", message: SWITCH_REFUSALS.source_not_controllable });
  });

  it("reads a missing or odd state as on at revision 0, never as off", async () => {
    const { fetcher } = bff([() => json({})]);
    expect(await readSourceUse(ID, fetcher)).toEqual({ state: "on", requested: null, revision: 0 });
  });

  it("stops waiting when the popup closes", async () => {
    const { fetcher, calls } = bff([]);
    expect(await waitUntilEnforced(ID, { fetcher, sleep: async () => undefined, stop: () => true })).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe("how the switch reads on a source", () => {
  const available = knowledgeStatus({ state: "ready" }, { state: "active" }, []);
  const withdrawn = knowledgeStatus({ state: "withdrawn" }, null, []);
  const replaced = knowledgeStatus({ state: "superseded" }, null, []);

  it("Off is Not in use, in the client's own words; pending keeps the status and says what is pending", () => {
    expect(withSourceUse(available, { state: "off", requested: null, revision: 1 }))
      .toEqual({ label: KNOWLEDGE_LABELS.notInUse, tone: "off", detail: SWITCHED_OFF_DETAIL });
    expect(withSourceUse(available, { state: "pending", requested: "off", revision: 1 }))
      .toEqual({ label: KNOWLEDGE_LABELS.available, tone: "ready", detail: TURNING_OFF_DETAIL, recheck: true });
    // A pending switch back on is still Not in use until enforced (P7 review M-1).
    expect(withSourceUse(available, { state: "pending", requested: "on", revision: 2 }))
      .toEqual({ label: KNOWLEDGE_LABELS.notInUse, tone: "off", detail: TURNING_ON_DETAIL, recheck: true });
    expect(withSourceUse(available, SOURCE_ON)).toBe(available);
    expect(withSourceUse(available, null)).toBe(available);
  });

  it("never turns the operator's withdrawal (or a replaced file) into the client's Off", () => {
    expect(withdrawn.detail).toBe(NOT_IN_USE_DETAIL);
    for (const closed of [withdrawn, replaced]) {
      for (const state of ["off", "pending", "on"] as const) {
        expect(withSourceUse(closed, { state, requested: state === "pending" ? "on" : null, revision: 1 })).toBe(closed);
      }
    }
    expect(SWITCHED_OFF_DETAIL).not.toBe(NOT_IN_USE_DETAIL);
    expect(REPLACED_DETAIL).not.toBe(SWITCHED_OFF_DETAIL);
  });

  it("gives a closed source no switch, and every other one the overview's state (on at 0 when unlisted)", () => {
    const docs = [
      { id: "a", status: "atomised", knowledge: available },
      { id: "b", status: "failed", knowledge: withdrawn, closed: true },
      { id: "c", status: "atomised", knowledge: available },
    ];
    const overview = [
      { document_id: "a", labels: [{ label: "Acme", kind: "organization" }], use: { state: "off" as const, requested: null, revision: 2 } },
      { document_id: "b", labels: [], use: { state: "off" as const, requested: null, revision: 1 } },
    ];

    const [a, b, c] = applySourceOverview(docs, overview);

    expect(a).toMatchObject({ labels: [{ label: "Acme", kind: "organization" }], use: { state: "off", revision: 2 }, status: "failed",
      knowledge: { label: "Not in use", detail: SWITCHED_OFF_DETAIL } });
    expect(b).toMatchObject({ use: null, knowledge: withdrawn });
    expect(c).toMatchObject({ labels: [], use: SOURCE_ON, knowledge: available });
  });
});

describe("Delete file (P8.3)", () => {
  const deleted = { request: { id: "r", operation: "delete", lifecycle_revision: 4, request_state: "complete", outcome: { deleted: true } },
    source: { document_id: ID, state: "deleting", requested: null, revision: 4 }, replayed: false };

  it("sends the browser's intent key, delete, and the revision it read", async () => {
    const { fetcher, calls } = bff([() => json(deleted, 201)]);

    expect(await deleteSource(ID, ON, keys(), fetcher)).toEqual({ kind: "deleting" });
    expect(calls).toEqual([{ url: PATH, method: "POST", body: { intent_key: "key-1", operation: "delete", expected_lifecycle_revision: 3 } }]);
  });

  it("reuses the key on a retry after no answer, so the file is deleted once", async () => {
    const holder = keys();
    const { fetcher, calls } = bff([
      () => { throw new TypeError("network"); },
      () => json({ error: "busy" }, 503),
      () => json({ ...deleted, replayed: true }),
    ]);

    await expect(deleteSource(ID, ON, holder, fetcher)).rejects.toBeInstanceOf(SourceSwitchError);
    await expect(deleteSource(ID, ON, holder, fetcher)).rejects.toMatchObject({ status: 503 });
    expect(await deleteSource(ID, ON, holder, fetcher)).toEqual({ kind: "deleting" });
    expect(calls.map(call => call.body?.intent_key)).toEqual(["key-1", "key-1", "key-1"]);
  });

  it("treats 409 source_deleting as already going", async () => {
    const { fetcher } = bff([() => json({ error: SWITCH_REFUSALS.source_deleting, detail: "source_deleting" }, 409)]);
    expect(await deleteSource(ID, ON, keys(), fetcher)).toEqual({ kind: "deleting" });
  });

  it("on 409 stale or a reused key, reads the revision again and asks again, sending nothing more", async () => {
    for (const detail of ["stale_source_state", "intent_key_reused"]) {
      const { fetcher, calls } = bff([
        () => json({ error: SWITCH_REFUSALS[detail], detail }, 409),
        () => json({ document_id: ID, state: "off", requested: null, revision: 6 }),
      ]);
      expect(await deleteSource(ID, ON, keys(), fetcher)).toEqual({
        kind: "reloaded", use: { state: "off", requested: null, revision: 6 }, message: SWITCH_REFUSALS[detail] });
      expect(calls.map(call => call.method)).toEqual(["POST", "GET"]);
    }
  });

  it("is refused for an onboarding link (403) and for a source that has gone (404)", async () => {
    for (const [detail, status] of [["delete_requires_sign_in", 403], ["source_not_found", 404]] as const) {
      const { fetcher } = bff([() => json({ error: SWITCH_REFUSALS[detail], detail }, status)]);
      expect(await deleteSource(ID, ON, keys(), fetcher)).toEqual({ kind: "refused", message: SWITCH_REFUSALS[detail] });
    }
  });
});

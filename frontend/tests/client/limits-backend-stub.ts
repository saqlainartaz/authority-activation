import { vi } from "vitest";

// A stub of the backend's `/v2/clients/{id}/limits` routes for the Limits card's
// tests (Cycle 5 P2.5). It models what the retry rules depend on: an extra-uploads
// grant is remembered by its `intent_key` with its contents; the same key with the
// same contents is answered as a replay and changes nothing; the same key with
// other contents is 409 `intent_key_reused`. A PUT is a plain edit: an older
// `expected_revision` is 409 `stale_limits`, and an unknown field (such as an
// `intent_key`) is 422, as the backend's forbid-extra models answer. Synthetic
// values only.

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export type BackendCall = { method: string; path: string; body: Record<string, unknown> | undefined };

type Remembered = { contents: string; id: string; created_at: string };

export function limitsBackend(options: { engine?: "ke" | "m1"; writingConfigured?: boolean } = {}) {
  const engine = options.engine ?? "ke";
  const state = {
    revision: 3,
    monthlyUploads: 20 as number | null,
    documentsDaily: 15,
    writingDaily: 10,
    writingMonthly: 50,
    extraGrants: new Map<string, Remembered & { extra: number }>(),
    calls: [] as BackendCall[],
    /** When set, the backend does the work and then the answer is lost on the way back. */
    loseNextAnswer: false,
  };
  let serial = 0;

  const extraUploads = () => [...state.extraGrants.values()].reduce((sum, grant) => sum + grant.extra, 0);

  const limits = (extra: Record<string, unknown> = {}) => ({
    month: "2026-10-01",
    monthly_uploads: state.monthlyUploads,
    extra_uploads: extraUploads(),
    uploads_used: 18,
    uploads_remaining: state.monthlyUploads === null ? null : state.monthlyUploads + extraUploads() - 18,
    daily_limit_usd: state.documentsDaily,
    spent_today_usd: 3,
    revision: state.revision,
    writing_daily_limit_usd: state.writingDaily,
    writing_monthly_limit_usd: state.writingMonthly,
    resets: { daily: "2026-10-06T00:00:00Z", monthly: "2026-11-01T00:00:00Z" },
    meters: {
      documents_daily: { limit_usd: state.documentsDaily, spent_usd: 3, available: true, used_fraction: 0.2 },
      writing_daily: options.writingConfigured === false
        ? { limit_usd: 10, spent_usd: 0, available: false, used_fraction: null }
        : { limit_usd: state.writingDaily, spent_usd: 4, available: true, used_fraction: 0.49 },
      writing_monthly: { limit_usd: state.writingMonthly, spent_usd: 12, available: true, used_fraction: 0.25 },
      deployment_daily: { limit_usd: 200, spent_usd: 40, available: true, used_fraction: 0.2 },
    },
    replayed: false,
    grant: null,
    ...extra,
  });

  function remember<T extends Remembered>(store: Map<string, T>, body: Record<string, unknown>, make: (base: Remembered) => T) {
    const { intent_key: key, ...rest } = body;
    const contents = JSON.stringify(rest);
    const existing = store.get(String(key));
    if (existing) {
      if (existing.contents !== contents) return json({ detail: "intent_key_reused" }, 409);
      return json(limits({ replayed: true, grant: { id: existing.id, created_at: existing.created_at } }));
    }
    serial += 1;
    const made = make({ contents, id: `grant-${serial}`, created_at: `2026-10-05T10:00:0${serial}Z` });
    store.set(String(key), made);
    return json(limits({ grant: { id: made.id, created_at: made.created_at } }));
  }

  function answer(method: string, path: string, body: Record<string, unknown> | undefined): Response {
    if (method === "GET" && path === "/v2/clients/c1/limits") return json(limits());
    if (method === "GET" && path.startsWith("/v2/clients/c1/limits/changes")) return json({ items: [], next: null });
    if (method === "POST" && path === "/v2/clients/c1/limits/extra-uploads") {
      return remember(state.extraGrants, body!, (base) => ({ ...base, extra: Number(body!.extra_uploads) }));
    }
    if (method === "PUT" && path === "/v2/clients/c1/limits") {
      const rest = body!;
      const known = new Set(["monthly_uploads", "daily_limit_usd", "writing_daily_usd", "writing_monthly_usd",
        "reason", "expected_revision", "changed_by"]);
      if (Object.keys(rest).some((field) => !known.has(field))) return json({ detail: "extra_forbidden" }, 422);
      if (rest.expected_revision !== state.revision) return json({ detail: "stale_limits" }, 409);
      if ("monthly_uploads" in rest) state.monthlyUploads = rest.monthly_uploads as number | null;
      if ("daily_limit_usd" in rest) state.documentsDaily = Number(rest.daily_limit_usd);
      if ("writing_daily_usd" in rest) state.writingDaily = Number(rest.writing_daily_usd);
      if ("writing_monthly_usd" in rest) state.writingMonthly = Number(rest.writing_monthly_usd);
      state.revision += 1;
      return json(limits());
    }
    throw new Error(`unexpected backend call ${method} ${path}`);
  }

  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace("https://engine.test", "");
    if (path === "/v2/engine") return json({ knowledge_engine: engine });
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    state.calls.push({ method, path, body });
    const response = answer(method, path, body);
    if (state.loseNextAnswer) {
      state.loseNextAnswer = false;
      throw new TypeError("fetch failed");
    }
    return response;
  });

  return { fetch, state, limits };
}

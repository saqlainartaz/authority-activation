// Server-only client for the Content Engine (FastAPI on Render).
// The service key must NEVER reach the browser: import this file only from
// server components, route handlers, or server actions.

import "server-only";

import {
  deletingStatus, knowledgeStatus, legacyStatus, unavailableStatus, type KnowledgeQueueItem, type KnowledgeRelease,
  type KnowledgeStatus,
  type SourceUse,
} from "@/lib/knowledge-status";
import type { SourceLabel } from "@/lib/source-overview";
import type { ClientLimits, LimitChangesPage } from "@/lib/limits";
import type { OpsHealth } from "@/lib/ops-health";

const BASE = process.env.ENGINE_URL;
const KEY = process.env.ENGINE_SERVICE_KEY;

export type EngineDocument = {
  id: string;
  client_id: string;
  source_type:
    | "sales_call_transcript"
    | "meeting_transcript"
    | "onboarding_form"
    | "onboarding_confirmation"
    | "brand_doc"
    | "rejection_constraint"
    | "other";
  source_authority: string;
  sha256: string;
  status: "uploaded" | "parsed" | "cleaned" | "atomised" | "failed";
  pipeline_version: number;
  created_at: string;
  /** Knowledge-engine documents only (Cycle 5 P2.7): the §7.2 status. M1 never sends it. */
  knowledge?: KnowledgeStatus;
  /** Knowledge-engine uploads only: identical bytes were already this source (A18). */
  duplicate_of?: string | null;
  /** Knowledge-engine documents only (P7.2): the retained file name, as uploaded. */
  filename?: string;
  /** Knowledge-engine documents only: withdrawn or superseded, so no switch acts on it. */
  closed?: boolean;
  /** Knowledge-engine documents only (P7.2), from `GET /v1/sources`: business labels. */
  labels?: SourceLabel[];
  /** Knowledge-engine documents only (P7.2): "Use this source"; null for a closed one. */
  use?: SourceUse | null;
  /** Knowledge-engine documents only (P8.2/P8.3): Delete file was asked and its purge
   *  has not finished; the row shows "Deleting", with no switch and no actions. */
  deleting?: boolean;
};

export type EngineDocumentPipelineStage = {
  stage: "parse" | "clean" | "atomise" | "embed";
  actor: string;
  completed_at: string;
};

export type EngineDocumentDetail = EngineDocument & {
  atom_count: number;
  pipeline_stages: EngineDocumentPipelineStage[];
};

export type EngineSearchRequest = {
  query: string;
  type?: string;
  limit?: number;
};

export type EngineSearchHit = {
  id: string;
  document_id: string;
  atom_type: string;
  text: string;
  status: string;
  trust: "untrusted";
  score: number;
};

export class EngineHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail: unknown,
    /** The whole parsed body, for refusals that carry more than `detail`
     *  (the upload 429's `limit`). */
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "EngineHttpError";
  }
}

export type EngineClient = {
  id: string;
  name: string;
  status: string;
  timezone: string;
  created_at: string;
};

export function engineConfigured(): boolean {
  return Boolean(BASE && KEY);
}

async function engineFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!BASE || !KEY) {
    throw new Error(
      "Engine not configured: set ENGINE_URL and ENGINE_SERVICE_KEY (server-side env).",
    );
  }
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "X-API-Key": KEY, ...(init.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail: unknown = undefined;
    let body: unknown = undefined;
    try {
      const parsed: unknown = text ? JSON.parse(text) : undefined;
      body = parsed;
      detail = parsed && typeof parsed === "object" && "detail" in parsed
        ? (parsed as { detail: unknown }).detail
        : parsed;
    } catch {
      detail = undefined;
    }
    throw new EngineHttpError(`Engine request failed (${res.status})`, res.status, detail, body);
  }
  return res;
}

export async function engineJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  return (await engineFetch(path, init)).json() as Promise<T>;
}

/** Exported (final whole-branch review, I4) so `agent/lib/executor.ts` can
 *  give the MODEL the identical safe projection this file already gives the
 *  BROWSER, rather than reinventing a second one that could diverge. Pure —
 *  reads no module-scope credential, so exporting it adds no exposure. */
export function safeEngineSentence(status: number, detail: unknown): string {
  if (status >= 500) return "Something broke on our side. Nothing was saved — try again.";
  if (typeof detail === "string" && detail.trim()) return detail;
  if (detail && typeof detail === "object") {
    const message = (detail as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return status === 404 ? "That isn't in your library any more." : `That didn't work (${status}).`;
}

/** Converts only a safe status/detail projection into an operator BFF response. */
export function forwardEngineError(error: unknown): Response {
  if (error instanceof EngineHttpError) {
    const sentence = safeEngineSentence(error.status, error.detail);
    return Response.json(
      error.status < 500 ? { error: sentence, detail: error.detail } : { error: sentence },
      { status: error.status },
    );
  }
  return Response.json(
    { error: "Something broke on our side. Nothing was saved — try again." },
    { status: 502 },
  );
}

// ---- typed helpers used by the app ----------------------------------------

export function listClients(): Promise<EngineClient[]> {
  return engineJson("/v1/clients");
}

/** The service-only timezone write. Callers must derive `clientId` from a session. */
export function updateClientTimezone(clientId: string, timezone: string): Promise<EngineClient> {
  return engineJson(`/v1/clients/${encodeURIComponent(clientId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ timezone }),
  });
}

/** Clients created from /internal start here; the backend column default is Europe/London.
 * Operators can choose another IANA zone when creating a client. */
export const DEFAULT_CLIENT_TIMEZONE = "America/New_York";

export function createClient(name: string, timezone = DEFAULT_CLIENT_TIMEZONE): Promise<EngineClient> {
  return engineJson("/v1/clients", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, timezone }),
  });
}

export function listDocuments(clientId: string): Promise<EngineDocument[]> {
  return engineJson(`/v1/clients/${encodeURIComponent(clientId)}/documents`);
}

export function getDocumentDetail(
  clientId: string,
  documentId: string,
): Promise<EngineDocumentDetail> {
  return engineJson(
    `/v1/clients/${encodeURIComponent(clientId)}/documents/${encodeURIComponent(documentId)}`,
  );
}

export function reprocessDocument(clientId: string, documentId: string): Promise<{ status: string }> {
  return engineJson(
    `/v1/clients/${encodeURIComponent(clientId)}/documents/${encodeURIComponent(documentId)}/reprocess`,
    { method: "POST" },
  );
}

export async function removeDocument(clientId: string, documentId: string): Promise<void> {
  await engineFetch(
    `/v1/clients/${encodeURIComponent(clientId)}/documents/${encodeURIComponent(documentId)}`,
    { method: "DELETE" },
  );
}

export function searchClient(
  clientId: string,
  body: EngineSearchRequest,
): Promise<EngineSearchHit[]> {
  return engineJson(`/v1/clients/${encodeURIComponent(clientId)}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function uploadDocument(
  clientId: string,
  form: FormData, // fields: file, source_type, source_authority?
): Promise<EngineDocument> {
  return engineJson(`/v1/clients/${clientId}/documents`, {
    method: "POST",
    body: form,
  });
}

// ---- knowledge engine (v2) uploads ------------------------------------------
//
// 2026-09-28: when the backend runs the new engine (`GET /v1/me` says
// `knowledge_engine: "ke"`, from its one switch `KE_ENGINE`), a client's upload
// goes into the knowledge engine (C1 -> C2 -> C3), which is what the c4 agent
// reads. Otherwise the M1 path above, unchanged.

type KnowledgeDocument = {
  id: string;
  state: string;
  source_filename: string | null;
  created_at: string;
  /** P8.2: excluded by Delete file, its purge not finished yet. */
  deleting?: boolean;
};

/** The detail fields read here (`KeDocumentDetailOut`; P2.4/P2.4b for the pause). */
type KnowledgeDetail = KnowledgeDocument & {
  stage_runs: { stage: string; status: string; finished_at: string | null }[];
  paused_reason?: string | null;
  next_eligible_at?: string | null;
  lane?: string | null;
  quarantine?: { message?: string | null } | null;
  open_queue_items?: KnowledgeQueueItem[];
};

// States in which nothing more happens to a document: no detail is read for them.
const KNOWLEDGE_CLOSED = new Set(["withdrawn", "superseded"]);

const knowledgePath = (clientId: string, documentId: string) =>
  `/v2/clients/${encodeURIComponent(clientId)}/documents/${encodeURIComponent(documentId)}`;

/** C2's evidence release for a ready document, or null when none is released yet. */
async function evidenceRelease(clientId: string, documentId: string): Promise<KnowledgeRelease> {
  try {
    return await engineJson<{ state: string; yield?: string | null }>(
      `${knowledgePath(clientId, documentId)}/evidence/status`,
    );
  } catch (error) {
    if (error instanceof EngineHttpError && error.status === 404) return null;
    throw error;
  }
}

/** A knowledge-engine document in the shape the Knowledge screen already shows,
 *  with its §7.2 status (`knowledge`, Cycle 5 P2.7). The screen names a source by
 *  its type, so for these the type slot carries the file name.
 *
 *  The list carries only the state, so the detail (pause reason and time,
 *  quarantine, open review items) is read for every document still moving or
 *  waiting. A closed one needs none, and neither does a ready one whose evidence
 *  is released: it is usable. `known` is a detail already read (null: read none,
 *  as for an upload just accepted, which is still being received). */
async function asScreenDocument(
  clientId: string,
  document: KnowledgeDocument,
  known?: KnowledgeDetail | null,
): Promise<EngineDocument> {
  // Delete file (P8.2): "Deleting" until the purge finishes; nothing else is read.
  if (document.deleting) return screenDocument(clientId, document, deletingStatus());
  let release = document.state === "ready" ? await evidenceRelease(clientId, document.id) : null;
  let detail = known;
  if (detail === undefined) {
    const settled = KNOWLEDGE_CLOSED.has(document.state) || (document.state === "ready" && release?.state === "active");
    detail = settled ? null : await engineJson<KnowledgeDetail>(knowledgePath(clientId, document.id));
  }
  // The detail is read after the list, so its state is the newer one.
  const state = detail?.state ?? document.state;
  if (state !== document.state) release = state === "ready" ? await evidenceRelease(clientId, document.id) : null;
  const knowledge = knowledgeStatus({ ...(detail ?? {}), state }, release, detail?.open_queue_items ?? []);
  return screenDocument(clientId, { ...document, state }, knowledge);
}

function screenDocument(clientId: string, document: KnowledgeDocument, knowledge: KnowledgeStatus): EngineDocument {
  return {
    id: document.id,
    client_id: clientId,
    source_type: (document.source_filename ?? "document") as EngineDocument["source_type"],
    source_authority: "CLIENT",
    sha256: "",
    status: legacyStatus(knowledge),
    pipeline_version: 2,
    created_at: document.created_at,
    knowledge,
    ...(document.source_filename ? { filename: document.source_filename } : {}),
    closed: KNOWLEDGE_CLOSED.has(document.state) || document.deleting === true,
    ...(document.deleting ? { deleting: true } : {}),
  };
}

/** How many documents' status reads run at once (P2.7 fix round 1, review M4). */
export const KNOWLEDGE_READ_CONCURRENCY = 4;

/** `items` mapped by `run`, at most `limit` at a time, results in input order. */
async function mapWithLimit<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** The client's knowledge sources with their status. A failure of the list itself
 *  fails the read; a failure reading ONE source's status (a 404 race, a 500 on one
 *  document) shows that source as status unavailable, and every other row stays
 *  current (P2 milestone review M4). */
export async function listKnowledgeDocuments(clientId: string): Promise<EngineDocument[]> {
  const documents = await engineJson<KnowledgeDocument[]>(`/v2/clients/${encodeURIComponent(clientId)}/documents`);
  return mapWithLimit(documents, KNOWLEDGE_READ_CONCURRENCY, async document => {
    try {
      return await asScreenDocument(clientId, document);
    } catch {
      return screenDocument(clientId, document, unavailableStatus());
    }
  });
}

/** `operator` from the internal panel: an operator upload skips the client's
 *  monthly allowance and does not use it (backend, 2026-10-02). */
export async function uploadKnowledgeDocument(
  clientId: string,
  file: File,
  uploaderRole: "client" | "operator" = "client",
): Promise<EngineDocument> {
  const form = new FormData();
  form.set("file", file);
  form.set("uploader_role", uploaderRole);
  const accepted = await engineJson<{ document_id: string; state: string; duplicate_of?: string | null }>(
    `/v2/clients/${encodeURIComponent(clientId)}/documents`,
    { method: "POST", body: form },
  );
  const shown = await asScreenDocument(clientId, {
    id: accepted.document_id, state: accepted.state, source_filename: file.name,
    created_at: new Date().toISOString(),
  }, null);
  return accepted.duplicate_of ? { ...shown, duplicate_of: accepted.duplicate_of } : shown;
}

// ---- the operator's internal panel follows the same switch ------------------
//
// 2026-10-02: the panel holds only the service key, so it cannot read
// `GET /v1/me`. It asks `GET /v2/engine`, which answers from the same backend
// switch (`KE_ENGINE=live` -> "ke"). An older backend without the route is M1.

export async function deploymentUsesKnowledgeEngine(): Promise<boolean> {
  try {
    const answer = await engineJson<{ knowledge_engine?: "m1" | "ke" }>("/v2/engine");
    return answer.knowledge_engine === "ke";
  } catch (error) {
    if (error instanceof EngineHttpError && error.status === 404) return false;
    throw error;
  }
}

// The panel's four steps, as the new engine's stages: reading, cleaning, the
// evidence C2 extracts, and the evidence index.
const PANEL_STAGES: Record<string, EngineDocumentPipelineStage["stage"]> = {
  parse: "parse",
  clean: "clean",
  extraction: "atomise",
  evidence_index: "embed",
};

/** A knowledge-engine document in the shape the internal panel already shows. */
export async function getKnowledgeDocumentDetail(
  clientId: string,
  documentId: string,
): Promise<EngineDocumentDetail> {
  const base = knowledgePath(clientId, documentId);
  const detail = await engineJson<KnowledgeDetail>(base);
  const finished = new Map<EngineDocumentPipelineStage["stage"], string>();
  for (const run of detail.stage_runs) {
    const stage = PANEL_STAGES[run.stage];
    if (!stage || run.status !== "succeeded" || !run.finished_at) continue;
    const prior = finished.get(stage);
    if (!prior || run.finished_at > prior) finished.set(stage, run.finished_at);
  }
  let evidence = 0;
  try {
    evidence = (await engineJson<{ total: number }>(`${base}/evidence?limit=1`)).total;
  } catch (error) {
    // No evidence released (yet), or none currently eligible: nothing extracted to count.
    if (!(error instanceof EngineHttpError && (error.status === 404 || error.status === 409))) throw error;
  }
  return {
    ...(await asScreenDocument(clientId, detail, detail)),
    atom_count: evidence,
    pipeline_stages: [...finished].map(([stage, completed_at]) => ({
      stage, actor: "knowledge engine", completed_at,
    })),
  };
}

/** One knowledge-engine document for the client's own screen: its detail, read
 *  once, with its §7.2 status. The client has no delete or reprocess for it
 *  until P8. */
export async function getClientKnowledgeDocument(clientId: string, documentId: string): Promise<EngineDocument> {
  const detail = await engineJson<KnowledgeDetail>(knowledgePath(clientId, documentId));
  return asScreenDocument(clientId, detail, detail);
}

/** Remove, in the new engine, is a withdrawal by the operator. */
export async function withdrawKnowledgeDocument(clientId: string, documentId: string): Promise<void> {
  await engineJson(
    `/v2/clients/${encodeURIComponent(clientId)}/documents/${encodeURIComponent(documentId)}/transitions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "withdraw", actor_role: "operator" }),
    },
  );
}

// ---- a client's limits (operator only; Cycle 5 P2.5) -------------------------
//
// `/v2/clients/{id}/limits` and its sub-routes: uploads per month, the three
// client budgets, extra uploads and the change history. The browser's extra-uploads
// `intent_key` is forwarded unchanged (plan §3.2); nothing here makes one, and
// nothing sends `changed_by`/`granted_by`: the backend stamps its own principal.

export type LimitsEditBody = {
  monthly_uploads?: number | null;
  daily_limit_usd?: number;
  writing_daily_usd?: number;
  writing_monthly_usd?: number;
  reason: string;
  expected_revision: number;
};

export type ExtraUploadsBody = { extra_uploads: number; reason: string; intent_key: string };

const limitsPath = (clientId: string) => `/v2/clients/${encodeURIComponent(clientId)}/limits`;

function sendLimitsJson(path: string, method: "PUT" | "POST", body: unknown): Promise<ClientLimits> {
  return engineJson(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function getClientLimits(clientId: string): Promise<ClientLimits> {
  return engineJson(limitsPath(clientId));
}

export function updateClientLimits(clientId: string, body: LimitsEditBody): Promise<ClientLimits> {
  return sendLimitsJson(limitsPath(clientId), "PUT", body);
}

export function giveExtraUploads(clientId: string, body: ExtraUploadsBody): Promise<ClientLimits> {
  return sendLimitsJson(`${limitsPath(clientId)}/extra-uploads`, "POST", body);
}

/** A page of the change history, newest first. `before` is the previous page's
 *  opaque `next` cursor, passed through as it came. */
export function listLimitChanges(
  clientId: string,
  page: { before?: string | null; limit?: string | null } = {},
): Promise<LimitChangesPage> {
  const query = new URLSearchParams();
  if (page.before) query.set("before", page.before);
  if (page.limit) query.set("limit", page.limit);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return engineJson(`${limitsPath(clientId)}/changes${suffix}`);
}

// ---- Ready to onboard (operator only; Cycle 5 P6.5) ---------------------------
//
// `/v1/clients/{id}/onboarding-packet`: the client's onboarding packet state,
// and Ready to onboard, which creates the packet once (by the backend's own
// intent key `onboarding:{client_id}`), queues its generation once and starts
// the monthly questions once. Rehaul only (404 `not_available` under M1).

export type OnboardingPacket = {
  state: "preparing" | "generating" | "failed" | "ready" | "complete";
  packet_id: string | null;
  total: number;
  remaining: number;
  created?: boolean;
  enqueued?: boolean;
  retried?: boolean;
  monthly_started?: boolean;
};

const onboardingPacketPath = (clientId: string) => `/v1/clients/${encodeURIComponent(clientId)}/onboarding-packet`;

export function getOnboardingPacket(clientId: string): Promise<OnboardingPacket> {
  return engineJson(onboardingPacketPath(clientId));
}

export function markReadyToOnboard(clientId: string): Promise<OnboardingPacket> {
  return engineJson(onboardingPacketPath(clientId), { method: "POST" });
}

// ---- Retry delete (operator only; Cycle 5 Ruling 93, whole-branch review A-I1) ----
//
// A Delete file whose purge used up its retries shows in System health. Staff's
// Delete file on the same source (`POST /v2/clients/{id}/sources/{doc}/lifecycle`,
// service key) is refused `409 source_deleting` but first queues the purge again:
// that refusal IS the success here. The expected revision is one no source ever
// reaches, so if the source were somehow not being deleted the backend refuses it
// `409 stale_source_state` and records nothing: this can never start a new delete.

/** Never a current revision: a source not being deleted is refused, never deleted. */
export const RETRY_DELETE_REVISION = 2_147_483_647;

export async function retrySourceDelete(clientId: string, documentId: string): Promise<{ restarted: true }> {
  try {
    await engineJson(`/v2/clients/${encodeURIComponent(clientId)}/sources/${encodeURIComponent(documentId)}/lifecycle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intent_key: `retry-delete:${documentId}:${crypto.randomUUID()}`,
        operation: "delete",
        expected_lifecycle_revision: RETRY_DELETE_REVISION,
      }),
    });
  } catch (error) {
    if (error instanceof EngineHttpError && error.status === 409 && error.detail === "source_deleting") {
      return { restarted: true };
    }
    throw error;
  }
  // Unreachable with a never-current revision; refuse rather than report a delete as a retry.
  throw new EngineHttpError("Engine request failed (409)", 409, "source_not_deleting");
}

// ---- System health (operator only; Cycle 5 P3.3) -----------------------------
//
// `GET /v2/ops/health`: the five System health sections, cross-tenant, service key
// only and rehaul-only (404 `not_available` under M1). Ids, classes, counts, times
// and money only; never a client's name or content.

export function getOpsHealth(): Promise<OpsHealth> {
  return engineJson("/v2/ops/health");
}

// ---- context + voice profile -----------------------------------------------

export type ContextBundle = {
  task: string;
  voice: {
    tone: string[];
    audience: string | null;
    do_phrases: string[];
    avoid_phrases: string[];
  };
  constraints: Array<Record<string, unknown>>;
  atoms: Array<Record<string, unknown>>;
  full_corpus: Array<{ document_id: string; source_type: string; text: string }>;
  completeness: { documents: number; atoms: number };
};

export function getContext(clientId: string, task: string, limit = 25): Promise<ContextBundle> {
  return engineJson(`/v1/clients/${clientId}/context`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task, limit }),
  });
}

export type VoiceProfile = {
  id: string;
  version: number;
  status: "draft" | "approved";
  payload: Record<string, unknown>;
  corpus: { document_ids?: string[]; atom_count?: number };
  diff: { changed_sections?: string[]; previous_version?: number | null };
  built_by: string;
  created_at: string;
};

export type EngineAtom = {
  id: string;
  atom_type: string;
  status: string;
  text: string;
  confidence: number | null;
  impact: number | null;
  evidence_kind: string;
  provenance: Record<string, unknown>;
  payload: Record<string, unknown>;
  created_at: string;
};

export function listAtoms(
  clientId: string,
  limit = 500,
  type?: string,
): Promise<EngineAtom[]> {
  const typeParam = type ? `&type=${encodeURIComponent(type)}` : "";
  return engineJson(`/v1/clients/${clientId}/atoms?limit=${limit}${typeParam}`);
}

export function decideAtom(
  clientId: string,
  atomId: string,
  decision: "confirm" | "deprecate",
  reason: string,
  actor: string,
): Promise<EngineAtom> {
  return engineJson(`/v1/clients/${clientId}/atoms/${atomId}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, reason, actor }),
  });
}

export function approveVoiceProfile(clientId: string, version: number): Promise<VoiceProfile> {
  return engineJson(`/v1/clients/${clientId}/voice-profile/${version}/approve`, {
    method: "POST",
  });
}

export async function getVoiceProfile(clientId: string): Promise<VoiceProfile | null> {
  try {
    return await engineJson<VoiceProfile>(`/v1/clients/${clientId}/voice-profile`);
  } catch (e) {
    if (e instanceof EngineHttpError && e.status === 404) return null;
    throw e;
  }
}

export function buildVoiceProfile(clientId: string): Promise<{ status: string }> {
  return engineJson(`/v1/clients/${clientId}/voice-profile`, { method: "POST" });
}

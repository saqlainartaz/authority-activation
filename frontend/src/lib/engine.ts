// Server-only client for the Content Engine (FastAPI on Render).
// The service key must NEVER reach the browser: import this file only from
// server components, route handlers, or server actions.

import "server-only";

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
    try {
      const parsed: unknown = text ? JSON.parse(text) : undefined;
      detail = parsed && typeof parsed === "object" && "detail" in parsed
        ? (parsed as { detail: unknown }).detail
        : parsed;
    } catch {
      detail = undefined;
    }
    throw new EngineHttpError(`Engine request failed (${res.status})`, res.status, detail);
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
 * A client can change it later in Settings → Scheduling → Time zone. */
export const DEFAULT_CLIENT_TIMEZONE = "America/New_York";

export function createClient(name: string): Promise<EngineClient> {
  return engineJson("/v1/clients", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, timezone: DEFAULT_CLIENT_TIMEZONE }),
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

// Server-only client for the product surface of the Content Engine (the
// `product/` routers: onboarding, generation, decisions, schedule, campaigns,
// the content library and the operator held queue).
// The service key must NEVER reach the browser: import this file only from
// server components, route handlers, or server actions.
//
// THIS FILE IS A SIBLING OF `lib/engine.ts`, NOT A REPLACEMENT FOR IT. Both
// exist, both are server-only, and neither imports the other. `engine.ts`
// calls ZERO `product/` routes — every path in it is `/v1/clients/...` engine
// surface (documents, atoms, context, voice profile) — and it attaches ONE
// header, because that surface authenticates only the calling service. Every
// client-credential route here needs TWO headers, and that is the whole reason
// this file exists rather than four more functions in that one. Deleting either
// file in favour of the other would silently drop one of the two credentials.
//
// WHY EVERY BROWSER CALL GOES THROUGH A NEXT ROUTE HANDLER (D7A-12). A valid
// onboarding token with no `X-API-Key` is a 401 — the two credentials are not
// alternatives and neither substitutes for the other (`docs/API_CONTRACT.md`
// § Auth). So a browser-direct design would have to ship `SERVICE_API_KEY` to
// a browser, which is the one thing the two-credential design exists to
// prevent. The browser talks to `/api/client/*`; those handlers call this file.

import "server-only";

import type { ContextV1 } from "@/agent/contracts/context";
import type { SocialPlatform } from "@/shared/channels";

const BASE = process.env.ENGINE_URL;
const KEY = process.env.ENGINE_SERVICE_KEY;

/** Every non-2xx answer from the product API, with the status as a NUMBER.
 *
 * `engine.ts` throws a bare `Error` whose message ends `-> {status}`, and a
 * caller has to string-match it to tell 404 from 500 (`engine.ts:168` does
 * exactly that). IC-14 branches on the status to choose a next step, and the
 * BFF handler forwards it, so the number is the contract here and the
 * human-readable message is a convenience beside it. `detail` is FastAPI's own
 * `detail` forwarded verbatim: several refusals in this API are
 * server-authored sentences that must reach the client unrewritten (the
 * campaign cap's 422 is the current example), and a handler that only had the
 * status would have to invent replacement prose.
 *
 * NOTE FOR THE BFF LAYER (plan 07A-04 owns this): `detail` may name internal
 * state. Decide per route what crosses to the browser — T-07A-03-05.
 */
export class ProductHttpError extends Error {
  status: number;
  detail: unknown;

  constructor(message: string, status: number, detail: unknown) {
    super(message);
    this.name = "ProductHttpError";
    this.status = status;
    this.detail = detail;
  }
}

export function productConfigured(): boolean {
  return Boolean(BASE && KEY);
}

// ---------------------------------------------------------------------------
// THE BFF TRANSLATION LAYER — the one place a thrown error becomes a
// `Response`, and the one place the `{ error }` body key is spelled.
//
// WHY IT LIVES HERE, BESIDE THE ERROR CLASS. `ProductHttpError` is declared
// above; turning one into an HTTP answer is the other half of the same
// decision. Seventeen route handlers importing ONE function is what keeps the
// `{ error }` key from acquiring a second spelling — `retry-fetch.ts:57` and
// `api.ts` both read `data.error`, and a different key name blanks
// `HttpError.message`, which takes IC-14's whole status table with it.
// `ProductHttpError`'s own docstring named plan 07A-04 as the owner of this
// decision (T-07A-03-05); this section is that decision.
//
// WHAT CROSSES TO THE BROWSER, AND WHAT DOES NOT:
//
//   * NOT `error.message`. It is `product POST /v1/generations -> 422: {...}` —
//     the UPSTREAM PATH plus the raw response body. Useful in a server log,
//     information disclosure in a browser.
//   * YES the API's own `detail`, on 4xx only. Several refusals in this API are
//     server-authored sentences meant to reach the client unrewritten (the
//     campaign cap's 422 is the current example), and `ErrorSurface` reads
//     `detail.current_state` / `detail.message` / `detail.field` structurally.
//   * NOT `detail` on 5xx. There is nothing a client can do with it and it is
//     the one place an unhandled server exception could surface internals.
// ---------------------------------------------------------------------------

/** The ONE sentence every client-credential refusal gets (Copy rule 2).
 *
 * All four refusals — header missing, token malformed, token unknown, token
 * revoked — are the same 401 with the same body BY DESIGN (D7A-13), so there is
 * exactly one honest message. Defined once, because two spellings of this
 * sentence are two different answers to the same question.
 *
 * REWORDED (fix wave, 2026-08-22, F4) from "this link has expired or has
 * already been used" — true only while a magic link was the only credential
 * this 401 could mean. A password session now ends the same way (revoked, or
 * past its 90-day ceiling) and answers with this exact sentence too, so the
 * wording had to stop naming "link" specifically. Changed together with its
 * three duplicates, byte-for-byte: `components/ErrorSurface.tsx`'s
 * `EXPIRED_LINK_MESSAGE`, and `content.ts`'s `login.linkDead` and
 * `login.setPassword.linkDead` — see `EXPIRED_LINK_MESSAGE`'s own comment for
 * why a fourth copy exists instead of one shared constant.
 *
 * NO LONGER EXPORTED (fix wave, 2026-08-22, M2-hygiene): this constant has
 * exactly one consumer, `expiredLinkResponse` immediately below, in the same
 * module. `export` was dead weight — nothing outside this file ever imported
 * it (its cross-file duplicates above exist BECAUSE it can't be imported,
 * `product.ts` opening with `import "server-only"`), so the keyword was
 * advertising a caller that never existed.
 */
const EXPIRED_LINK_SENTENCE =
  "This link or session is no longer valid — sign in again to continue.";

/** The gate's answer when this request carries no session cookie.
 *
 * A 401 with the one sentence and nothing else. No retry hint in the body: the
 * hint belongs to `ErrorSurface`, which renders no retry control on any refusal.
 */
export function expiredLinkResponse(): Response {
  return Response.json({ error: EXPIRED_LINK_SENTENCE }, { status: 401 });
}

/** The server's own sentence, dug out of FastAPI's three `detail` shapes.
 *
 * FastAPI answers with `{"detail": ...}` and the payload is one of three
 * things: a string (every `HTTPException` in this API), a LIST of
 * `{loc, msg, type}` records (Pydantic request validation — `extra="forbid"`
 * produces one of these), or an object (Phase 6's richer transition refusals,
 * `{current_state, attempted, message?}`). All three are handled because all
 * three are reachable from these seventeen routes.
 */
function sentenceFromDetail(detail: unknown): string | null {
  if (typeof detail === "string") return detail.trim() ? detail : null;

  if (Array.isArray(detail)) {
    const parts: string[] = [];
    for (const entry of detail) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as { loc?: unknown; msg?: unknown };
      if (typeof record.msg !== "string" || !record.msg.trim()) continue;
      // `loc` is `["body", "field", ...]`. The leading "body"/"query" is
      // FastAPI's plumbing and means nothing to a client, so it is dropped and
      // the FIELD NAME is kept — IC-14's 422 arm renders the field the server
      // named, and that is where it comes from.
      const where = Array.isArray(record.loc)
        ? record.loc
            .filter((part): part is string => typeof part === "string")
            .filter((part) => part !== "body" && part !== "query")
            .join(".")
        : "";
      parts.push(where ? `${where}: ${record.msg}` : record.msg);
    }
    return parts.length > 0 ? parts.join("; ") : null;
  }

  if (detail && typeof detail === "object") {
    const message = (detail as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return null;
}

/** Used only when the API sent no usable `detail` at all.
 *
 * Deliberately thin. IC-14's per-status NEXT STEP is `ErrorSurface`'s job and
 * is written there; this is the `error` sentence itself, and inventing prose
 * here would compete with the component that already owns it.
 */
function fallbackSentence(status: number): string {
  if (status === 404) return "That isn't in your library any more.";
  if (status >= 500) return "Something broke on our side. Nothing was saved — try again.";
  return `That didn't work (${status}).`;
}

/** The safe sentence for ANY status/detail pair from this API — exactly what
 *  `forwardProductError` sends the BROWSER, factored out (final whole-branch
 *  review, I4) so `agent/lib/executor.ts` can give the MODEL the identical
 *  projection rather than reinventing a second one that could quietly
 *  diverge from this one. `sentenceFromDetail` already refuses to leak
 *  anything beyond the API's own `detail` (a bare kind string on
 *  `/context`/`/drafts`'s refusals); nothing upstream-path-shaped or
 *  raw-body-shaped ever reaches this return. */
export function safeProductSentence(status: number, detail: unknown): string {
  return sentenceFromDetail(detail) ?? fallbackSentence(status);
}

/** A thrown error from `lib/product` as an HTTP answer, with the status kept.
 *
 * THE STATUS IS FORWARDED UNCHANGED, and every arm of IC-14 depends on that: a
 * 202 stays a 202, a 404 stays a 404 (IC-8.5 renders "not found", never "not
 * allowed"), and a 409's message is forwarded VERBATIM — the API already writes
 * a held item's 409 in the client's neutral vocabulary through `_PUBLIC_STATE`,
 * so the internal state name never crosses the credential and this layer must
 * not add one.
 *
 * A 401 is the one status whose text is REPLACED rather than forwarded. The
 * API's own 401 detail is `"Invalid or expired onboarding token"`-shaped
 * operator vocabulary; Copy rule 2 says the client sees one sentence.
 *
 * ANYTHING THAT IS NOT A `ProductHttpError` BECOMES A 502. That covers the
 * unconfigured-environment throw and a `TypeError` from `fetch` when the
 * backend is not listening — from the browser's point of view Next answered, so
 * it belongs in IC-14's "the server said no" class, and its 5xx arm already
 * says "nothing was saved — try again".
 */
export function forwardProductError(error: unknown): Response {
  if (error instanceof ProductHttpError) {
    if (error.status === 401) return expiredLinkResponse();
    const sentence = safeProductSentence(error.status, error.detail);
    // `detail` on 4xx only — see the section banner above.
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

/** A request body as a plain object, or `{}` — never a throw, never a `null`.
 *
 * Every mutating handler builds its forwarded body KEY BY KEY off this record,
 * so the parse has to be total: a malformed or absent body must become an empty
 * record and let the API's own `extra="forbid"` model name the missing field,
 * rather than turning into a 500 inside a route handler.
 *
 * `Record<string, unknown>` and not `any` on purpose — an `any` here would make
 * every allowlist read implicitly typed and the compiler would stop objecting
 * to a key that does not exist on the wire model.
 */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const parsed: unknown = await request.json().catch(() => null);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

/** Parse a FastAPI error body without ever letting the parse itself throw. */
async function readError(res: Response): Promise<{ text: string; detail: unknown }> {
  const text = await res.text().catch(() => "");
  let detail: unknown = undefined;
  if (text) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === "object" && "detail" in parsed) {
        detail = (parsed as { detail: unknown }).detail;
      } else {
        detail = parsed;
      }
    } catch {
      detail = text;
    }
  }
  return { text, detail };
}

function refuseUnconfigured(): never {
  throw new Error(
    "Engine not configured: set ENGINE_URL and ENGINE_SERVICE_KEY (server-side env).",
  );
}

// ---------------------------------------------------------------------------
// The two credential families get TWO cores, deliberately, and not one core
// with an optional `token` argument.
//
// A client-credential helper that forgot the service key produces a 401, and
// one that forgot the token produces the SAME 401 — both are failures a
// reviewer cannot see by reading a call site, and both are unit-testable only
// against a live server. With one core and an optional argument, forgetting the
// token is a missing property on an options object; with two cores, a
// client-credential helper that does not take a `token` parameter does not
// compile. The type system is doing the work the 401 would otherwise do at
// runtime, in production, on the demo.
//
// NO 404-AS-NULL ON EITHER CORE. `engine.ts::getVoiceProfile` swallows 404
// because an absent voice profile is a normal state on that surface. Here a
// 404 means "a row you cannot see" — RLS makes another tenant's row invisible,
// so the API genuinely cannot tell a foreign id from an absent one and answers
// both identically — and it must reach the caller AS A STATUS, because IC-8.5
// renders "not found" and never "not allowed". A helper that turned it into
// `null` would erase the difference between "gone" and "never yours".
// ---------------------------------------------------------------------------

/** Client credential: `X-API-Key` AND `X-Onboarding-Token`. Both, always. */
async function clientFetch(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<Response> {
  if (!BASE || !KEY) refuseUnconfigured();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "X-API-Key": KEY,
      "X-Onboarding-Token": token,
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const { text, detail } = await readError(res);
    throw new ProductHttpError(
      `product ${init.method ?? "GET"} ${path} -> ${res.status}: ${text}`,
      res.status,
      detail,
    );
  }
  return res;
}

/** Service credential: `X-API-Key` only. See the banner above `clientConsole`. */
async function serviceFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!BASE || !KEY) refuseUnconfigured();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "X-API-Key": KEY, ...(init.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const { text, detail } = await readError(res);
    throw new ProductHttpError(
      `product ${init.method ?? "GET"} ${path} -> ${res.status}: ${text}`,
      res.status,
      detail,
    );
  }
  return res;
}

async function clientJson<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  return (await clientFetch(path, token, init)).json() as Promise<T>;
}

async function serviceJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  return (await serviceFetch(path, init)).json() as Promise<T>;
}

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

// ---------------------------------------------------------------------------
// Shared wire shapes
// ---------------------------------------------------------------------------

/** Every mutating body on this API carries a caller-supplied key in its BODY.
 *
 * Not a header. `src/product/api/schemas.py` bounds it at 8-200 characters and
 * every mutating model sets `extra="forbid"`, so the spelling must be exactly
 * `idempotency_key` or the request is a 422. `crypto.randomUUID()` is 36.
 */
export type KeyedIn = { idempotency_key: string };

/** A receipt entry. `untrusted_fields` is EXACTLY `["claim_text", "quoted_span"]`.
 *
 * `source_label`, `line`, `body_start`, `body_end`, `timecode` and `speaker`
 * are server-authored and are NOT untrusted; blanket-marking the shape makes
 * Phase 5 SC-2 unprovable.
 *
 * `body_start`/`body_end` are Unicode CODE POINTS into `body`, `body_end`
 * EXCLUSIVE, and `null` means "to the end". JavaScript slices UTF-16 code
 * units, so a highlighter must go through `Array.from(body)` and never
 * `body.slice()` (RISK-10).
 *
 * `timecode` and `speaker` carry NULL on every claim this milestone (D-04).
 * Render nothing — no placeholder, no empty row, no "unknown".
 */
export type ReceiptClaim = {
  ordinal: number;
  claim_text: string;
  quoted_span: string | null;
  body_start: number;
  body_end: number | null;
  source_label: string;
  line: number | null;
  timecode: string | null;
  speaker: string | null;
  untrusted_fields: string[];
  trust: "untrusted";
};

/** A calendar slot as approve, reschedule and mark-posted return it. */
export type ScheduledSlot = {
  slot_id: string;
  slot_at: string;
  slot_zone: string;
  status: string;
  relaxation: string;
  cadence_version: string | null;
};

// ===========================================================================
// CLIENT CREDENTIAL — both headers. `token` is the raw onboarding token.
// The tenant is derived from that token by the API and is NEVER a parameter:
// not in a path, not in a query, not in a body (D-07). Every create body sets
// `extra="forbid"`, so sending a `client_id` is a 422 rather than a silent
// override.
// ===========================================================================

// ---- identity: GET /v1/me --------------------------------------------------
//
// Auth phase (2026-08-22). `GET /v1/me` accepts EITHER an onboarding token or a
// session token in the same `X-Onboarding-Token` header — the Python side
// dispatches on the token's own `s.` prefix, so this frontend never parses it.
// `client-session.ts::resolveClientId` is the one caller; it used to derive
// `client_id` from the campaigns envelope (`GET /v1/campaigns`), which worked
// only because every session at the time held an onboarding token. A session
// token carries no campaigns envelope, so identity now comes from the surface
// built to answer exactly this question, for both token shapes alike.

/** `GET /v1/me`'s wire shape. Mirrors `getOnboarding`'s idiom exactly: a plain
 * `clientJson` call that throws `ProductHttpError` on a non-2xx, never a `null`
 * return — a caller that needs "no session" as a distinct case reads the thrown
 * error's `.status`, the same way every other client-credential helper here
 * works. */
export type Me = { client_id: string; user_id: string; onboarding_complete: boolean };

export function getMe(token: string): Promise<Me> {
  return clientJson("/v1/me", token);
}

// ---- social accounts: server-side OAuth bridge ----------------------------

export type SocialAccount = {
  id: string;
  provider: "linkedin";
  account_kind: "person";
  provider_account_id: string;
  display_name: string;
  avatar_url: string | null;
  token_expires_at: string;
  scopes: string[];
  status: "connected" | "reauth_required" | "revoked";
  is_default: boolean;
  auto_publish_enabled: boolean;
  connected_by_user_id: string;
};

export function startLinkedInOAuth(token: string): Promise<{
  authorization_url: string;
  expires_at: string;
}> {
  return clientJson("/v1/social/linkedin/oauth/start", token, { method: "POST" });
}

export function completeLinkedInOAuth(
  token: string,
  code: string,
  state: string,
): Promise<SocialAccount> {
  return clientJson("/v1/social/linkedin/oauth/callback", token, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ code, state }),
  });
}

export function listSocialAccounts(token: string): Promise<SocialAccount[]> {
  return clientJson("/v1/social/accounts", token);
}

export function setSocialAutoPublish(token: string, accountId: string, enabled: boolean): Promise<SocialAccount> {
  return clientJson(`/v1/social/accounts/${encodeURIComponent(accountId)}/auto-publish`, token, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ enabled }),
  });
}

export type SocialProviderStatus = {
  provider: "linkedin";
  configured: boolean;
  publishing_enabled: boolean;
  capabilities: string[];
};

export function listSocialProviders(token: string): Promise<SocialProviderStatus[]> {
  return clientJson("/v1/social/providers", token);
}

export type SocialPublication = {
  id: string;
  content_item_id: string;
  content_version_id: string;
  schedule_slot_id: string;
  social_account_id: string | null;
  provider: "linkedin";
  dispatch_mode: "scheduled" | "immediate";
  status: "planned" | "connection_required" | "queued" | "publishing" | "published" | "failed" | "outcome_unknown" | "cancelled";
  provider_post_id: string | null;
  provider_media_id: string | null;
  error_code: string | null;
  error_message: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export function listSocialPublications(token: string): Promise<SocialPublication[]> {
  return clientJson("/v1/social/publications", token);
}

export function publishContentItemNow(
  token: string,
  contentItemId: string,
  idempotencyKey: string,
): Promise<SocialPublication> {
  return clientJson(`/v1/content-items/${encodeURIComponent(contentItemId)}/publish`, token, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ idempotency_key: idempotencyKey }),
  });
}

// ---- identity: POST /v1/auth/login -----------------------------------------
//
// Review fix (2026-08-22, F1). `api/login/route.ts` used to read
// `process.env.ENGINE_URL` / `ENGINE_SERVICE_KEY` and call `fetch` directly —
// `scripts/assert-internal-bff-boundary.mjs --bff`'s "only server-only
// product/engine helpers read engine credentials" check exists precisely to
// catch that, and it did. This is a SERVICE credential call — `X-API-Key`
// only, no `X-Onboarding-Token`, because the login IS what produces the token
// — so it uses `serviceJson`, the same core `clientConsole` and the other
// service-credential helpers below use, rather than inventing a third fetch
// core beside `clientFetch`/`serviceFetch`.

/** `POST /v1/auth/login`'s wire shape. `expires_at` is an ISO 8601 instant;
 * the route uses it to size the session cookie's `maxAge` rather than
 * hardcoding one (F3) — see `cookieMaxAgeSeconds` in `api/login/route.ts`. */
export type LoginResult = { token: string; expires_at: string };

/** `clientIp` is the route's own best-effort `X-Login-Client-IP` (F8/R8) —
 * omitted from the request entirely when `null`, never sent empty. Any
 * non-2xx becomes a `ProductHttpError`, exactly like every other helper in
 * this file; the route's own `catch` turns every cause (bad credentials, a
 * malformed request, an unreachable backend) into the SAME generic refusal,
 * so nothing about *why* the backend said no ever needs to leave this
 * function distinguishable. */
export function loginWithPassword(
  email: string,
  password: string,
  clientIp: string | null,
): Promise<LoginResult> {
  return serviceJson("/v1/auth/login", {
    method: "POST",
    headers: {
      ...JSON_HEADERS,
      ...(clientIp ? { "X-Login-Client-IP": clientIp } : {}),
    },
    body: JSON.stringify({ email, password }),
  });
}

// ---- identity: POST /v1/auth/set-password ----------------------------------
//
// Task 10, auth phase (2026-08-22). The invite/reset landing: a raw
// onboarding-shaped token — either a brand-new invite link's own token or an
// operator-issued password-reset link — carried as `X-Onboarding-Token`,
// exactly like every other CLIENT credential call in this file (`getMe`,
// `getOnboarding`, `putOnboarding`, ...). This is why `setPassword` is built
// on `clientJson`, not `serviceJson`: unlike `loginWithPassword` above (which
// has no credential yet and so uses the service core), the caller here
// already holds a token and this call proves it, the same way `putOnboarding`
// does.
//
// THE WIRE SHAPE IS `LoginResult` AGAIN, ON PURPOSE. The backend mints a real
// session on success (A11: the invite flow ends LOGGED IN) — same two fields,
// same meaning as a password login's own 200 — so this reuses that type
// rather than declaring a second one for what is, on the wire, the identical
// credential handover.
//
// Throws `ProductHttpError` on every non-2xx, same as every other helper
// here. `api/set-password/route.ts` reads `.status` to tell apart a 409
// (this email already has credentials — operator-fixable, and deliberately
// NOT folded into the generic 401 the way `api/login`'s own refusals are) and
// a 422 (the password is outside the backend's 12..200-character bound) from
// the 401 every other credential refusal in this app collapses to.

export function setPassword(token: string, password: string): Promise<LoginResult> {
  return clientJson("/v1/auth/set-password", token, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ password }),
  });
}

// ---- identity: POST /v1/auth/logout ----------------------------------------
//
// Fix wave, auth phase (2026-08-22, F2). Before this fix, `api/client-logout/
// route.ts` only ever cleared the browser's cookie — it never told the
// backend the session was over, so a signed-out session stayed valid server-
// side for up to the full 90-day absolute ceiling (`cookie-maxage.ts`). This
// is the missing other half: `POST /v1/auth/logout` revokes the SESSION the
// presented `X-Onboarding-Token` names, the same client-credential shape
// (`X-API-Key` + `X-Onboarding-Token`) every other call in this section
// carries, which is why this is built on `clientFetch`, not `clientJson` —
// the backend answers 204 with no body, and `clientJson`'s `.json()` would
// throw parsing one.
//
// A LEGACY ONBOARDING TOKEN 401s HERE, ON PURPOSE, AND THAT IS NOT A BUG THIS
// FUNCTION HIDES. `/v1/auth/logout` revokes a *session*; an onboarding token
// carried over from the magic-link exchange has no session row to revoke, so
// the backend refuses it. The caller (`api/client-logout/route.ts`) treats
// every throw from this function as best-effort and swallows it — clearing
// the browser's cookie must never depend on this call succeeding, or a
// legacy cookie during the password-login cutover would become un-clearable.
export async function logoutSession(token: string): Promise<void> {
  // Time-boxed, on purpose (fix wave, auth phase, 2026-08-22): revocation is
  // best-effort but the cookie clear is not, so a hung backend must never
  // make sign-out look dead. `AbortSignal.timeout` raises `AbortError` past
  // the budget, which `api/client-logout/route.ts`'s catch-all swallows the
  // same as any other failure from this call.
  await clientFetch("/v1/auth/logout", token, {
    method: "POST",
    signal: AbortSignal.timeout(2500),
  });
}

// ---- onboarding: GET/PUT /v1/onboarding -----------------------------------

export type OnboardingQuestion = {
  question_id: string;
  question_version: string;
  review_label: string;
  prompt: string;
  input_type: "long" | "single";
  required: boolean;
  choices: string[];
  max_text_chars: number;
};

export type OnboardingQuestionResponse = {
  question_id: string;
  question_version: string;
  selected: string[];
  text: string;
};

export type CanonicalOnboardingResponse = {
  question_id: string;
  question_version: string;
  question: string;
  answers: string[];
  submitted_at: string;
  ordinal: number;
};

export type QuestionnaireEnvelope = {
  version: string;
  responses: CanonicalOnboardingResponse[];
};

export type OnboardingPrefill = {
  user: { display_name: string; email: string; profession: string | null };
  audience_options: Array<{ key: string; label: string }>;
  answers: Record<string, unknown>;
  confirmed_at: string | null;
  guardrail_questions: Array<{ key: string; prompt: string; atom_type: string }>;
  questions: OnboardingQuestion[];
  trust: "untrusted";
};

/** The confirm body. ALL ELEVEN ANSWER FIELDS ARE ALWAYS SENT.
 *
 * `OnboardingConfirmRequest` defaults every list to `[]`, so an omitted key and
 * an empty list are the same request — which means a screen that omits a field
 * it did not render silently CLEARS whatever the client had already confirmed.
 * D-09 keeps the response editable after confirmation, so this is reachable on
 * the second visit rather than only in theory. Send all four, every time.
 *
 * The three guardrail lists map to the three published questions:
 * `never_claim → never_say`, `avoid_phrases → voice_constraints`, `tone → tone`.
 */
export type OnboardingConfirm = {
  audience: string[];
  never_say: string[];
  voice_constraints: string[];
  tone: string[];
  tldr: string[];
  insight: string[];
  pain_point: string[];
  objection: string[];
  proof_point: string[];
  quote: string[];
  terminology: string[];
  responses?: OnboardingQuestionResponse[];
  actor?: string;
};

export type DynamicOnboardingAtomType =
  | "tldr"
  | "insight"
  | "pain_point"
  | "objection"
  | "proof_point"
  | "quote"
  | "terminology";

export type DynamicOnboardingWriteback = {
  request_field: DynamicOnboardingAtomType;
  atom_type: DynamicOnboardingAtomType;
  atom_ids: string[];
  cleared: boolean;
};

export type OnboardingResponse = {
  answers: Record<string, unknown>;
  confirmed_at: string | null;
  updated_at: string;
  actor: string;
  dynamic_writeback: DynamicOnboardingWriteback[];
  trust: "untrusted";
};

export function getOnboarding(token: string): Promise<OnboardingPrefill> {
  return clientJson("/v1/onboarding", token);
}

export function putOnboarding(
  token: string,
  body: OnboardingConfirm,
): Promise<OnboardingResponse> {
  return clientJson("/v1/onboarding", token, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

// ---- chat sessions: fixed LinkedIn/social-post draft workspace ------------

/** The only readiness vocabulary projected by the persisted task snapshot. */
export type ChatReadiness = {
  status: "ready" | "answer_needed" | "blocked_by_conflict" | "optional_enrichment";
  reason: string | null;
  question: string | null;
  /** Which fact the block is waiting for. `status` and `question` are for a
   *  reader; this is the machine-readable half, and the two blocked cases need
   *  opposite handling — see `sendComposer` in `ChatPath`. */
  required_fact_key: string | null;
} | null;

/** A persisted source reference for the exact variant snapshot. */
export type ChatSource = {
  source_label: string;
  locator: string;
  trust?: "untrusted";
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | string;
  kind: string;
  body: string;
  /** Projected by `serialize_chat_session` since 2026-08-24 (§9 step 3), added
   *  FOR the TypeScript agent: `src/agent/transcript.ts::assembleTranscript`
   *  keys its skip list on this field, never on `kind`. Optional here only
   *  because it is genuinely absent on non-`command` rows — Python sets it to
   *  `None` there, not `""`. */
  command_kind?: string | null;
};

export type ChatVariant = {
  id: string;
  variant_no: number;
  status: "verified" | "rejected" | string;
  body: string;
  sources?: ChatSource[];
  /** Browser-only claim receipt for evidence highlighting while the verified
   * variant is still temporary. Runtime/model envelopes deliberately omit it. */
  receipt?: ReceiptClaim[];
};

export type ChatPendingConfirmation = {
  id: string;
  kind: "durable_fact" | "durable_constraint";
  phrase: string;
  expires_at: string;
};

/** A completed generation outcome with only browser-safe recovery guidance. */
export type ChatTerminalState = {
  kind: "refused" | "held";
  reason: string;
  client_fixable: boolean;
  next_action: "revise_request" | "review_context" | "try_again";
  recorded_at: string;
};

/** The server-owned session itself. Platform/artifact are fixed by the API. */
export type ChatSession = {
  id: string;
  status: "active" | "finished" | "expired";
  platform: SocialPlatform;
  artifact: "social_post";
  selected_variant_id: string | null;
  /** The session's own hidden content item, published by the engine so a finished
   * draft has somewhere to go: `approve` and `schedule` both resolve the version
   * from this item's live transition, so this is the only id either needs.
   *
   * READ-ONLY, and the direction matters. The browser allowlist still refuses a
   * content-item selector in any create, turn or command body — the client
   * RECEIVES this id, it never chooses one. Nullable because a session that has
   * not taken its first turn has no item yet.
   */
  content_item_id: string | null;
  generation_stage: "checking_context" | "writing" | "verifying_grounding" | null;
};

export type ChatSessionEnvelope = {
  session: ChatSession;
  messages: ChatMessage[];
  variants: ChatVariant[];
  selected_variant_id: string | null;
  pending_confirmation: ChatPendingConfirmation | null;
  readiness: ChatReadiness;
  generation_stage: ChatSession["generation_stage"];
  terminal_state: ChatTerminalState | null;
  next_action: string;
  payload: Record<string, unknown>;
};

export type NoActiveChatSession = {
  session: null;
  next_action: "start_new_post";
};

/** `message` is OPTIONAL, and a create is now RECORD-ONLY either way: it never
 *  generates. Its absence creates the session and runs no turn, which is how
 *  the agent route gets an id to stream to (§9 step 5). WITH a message, the
 *  guided turn this used to run is gone (step 6, backend task 2) — the
 *  message is recorded and nothing is generated from it. No browser sends one
 *  today (`useAgentTurn.ts` posts `{ idempotency_key }` alone), but the BFF
 *  stays tolerant of one being sent. */
export type ChatSessionCreate = {
  message?: string;
  platform: SocialPlatform;
  idempotency_key: string;
};

type ChatCommandBase = { idempotency_key: string };
type ChatMessageCommand = ChatCommandBase & { message: string };
type ChatVariantCommand = ChatCommandBase & { variant_id: string };
type ChatConfirmationCommand = ChatCommandBase & {
  pending_confirmation_id: string;
  confirmed: true;
};

/** Exact discriminated command vocabulary shared by shortcuts and natural turns.
 *
 *  NARROWED (§9 step 6, Task 9). `generate`, `revise`, `show_sources` and
 *  `reject_variant` are gone — they became agent tools at step 4
 *  (`prepare_generation`, `submit_draft`, `get_variant_sources`), the
 *  backend stopped validating them the same step (`DraftCommand` in
 *  `src/product/chat/commands.py`), and the browser has sent none of them
 *  since step 5. */
export type ChatCommandCreate =
  | (ChatVariantCommand & { kind: "copy_variant" | "select_variant" | "finish" })
  | (ChatMessageCommand & { kind: "answer_clarification" | "unsupported_lifecycle" })
  | (ChatMessageCommand & { kind: "propose_durable_fact" | "propose_constraint" | "clarify_scope" })
  | (ChatConfirmationCommand & { kind: "confirm_durable_fact" | "confirm_constraint" })
  | (ChatCommandBase & { kind: "start_new_post" });

export function activeChatSession(token: string, platform: SocialPlatform): Promise<ChatSessionEnvelope | NoActiveChatSession> {
  return clientJson(`/v1/chat/sessions/active?platform=${encodeURIComponent(platform)}`, token);
}

export function createChatSession(token: string, body: ChatSessionCreate): Promise<ChatSessionEnvelope> {
  return clientJson("/v1/chat/sessions", token, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

export function readChatSession(token: string, sessionId: string): Promise<ChatSessionEnvelope> {
  return clientJson(`/v1/chat/sessions/${encodeURIComponent(sessionId)}`, token);
}

// ---- the TS agent's runtime-only chat routes (§9 step 4) -------------------
//
// `RuntimeSessionOut`'s sibling of `ChatSessionOut` on the Python side:
// identical to `ChatSessionEnvelope` except browser evidence fields on variants
// (`sources` and `receipt`) are REMOVED —
// `.../messages` and `.../agent-turn` are called only by the Next server
// runtime that hosts the stateless agent, and a tool result is exactly what
// the model reads next, so `source_locator` (PROV-01 — a receipt field,
// server-written) must not ride this envelope even in stringified form. The
// browser-facing routes (`/commands`, session reads) keep using
// `ChatSessionEnvelope` with full evidence — the narrowing is
// per-caller, not a retraction (`chat.py::RuntimeSessionOut`'s own docstring).
// (`/turns` was itself deleted at step 6, alongside `sendChatTurn` above.)
export type RuntimeVariant = {
  id: string;
  variant_no: number;
  status: string;
  body: string;
};

export type RuntimeSessionEnvelope = {
  session: ChatSession;
  messages: ChatMessage[];
  variants: RuntimeVariant[];
  selected_variant_id: string | null;
  pending_confirmation: ChatPendingConfirmation | null;
  readiness: ChatReadiness;
  generation_stage: ChatSession["generation_stage"];
  terminal_state: ChatTerminalState | null;
  next_action: string;
  payload: Record<string, unknown>;
};

export type ClientMessageCreate = { message: string; idempotency_key: string };
export type AgentTurnCreate = { text: string; idempotency_key: string };

/** `POST /v1/chat/sessions/{id}/context`'s request body. No `client_id`
 *  (derived from the credential) and no `snapshot_id` (this route MINTS
 *  one) — see `ChatContextIn` on the Python side. */
export type ChatContextCreate = {
  message: string;
  operation: "generate" | "revise" | "resume";
  selected_variant_id?: string;
  clarification?: string;
  idempotency_key: string;
};

/**
 * Mints and freezes one `TaskSnapshotV1`, projected as `context.v1`. Called
 * ONLY by the Next server runtime hosting the stateless TS agent
 * (`agent/tools/prepare-generation.ts`) — never by a browser directly.
 *
 * FIX (final whole-branch review, C1). This route is guarded by
 * `require_onboarding_identity` (`src/product/api/chat.py:1306`) — the CLIENT
 * credential, both headers — not the service-only credential `@/lib/engine.ts`
 * attaches. `prepare-generation.ts` used to call `engineJson` (one header,
 * `X-API-Key`) and died at the first tool call on every real turn; this is
 * why that tool now calls this function instead, alongside
 * `recordClientTurn`/`recordAgentTurn` immediately above, which always used
 * `clientJson` correctly.
 */
export function createChatContext(
  token: string,
  sessionId: string,
  body: ChatContextCreate,
): Promise<ContextV1> {
  return clientJson(`/v1/chat/sessions/${encodeURIComponent(sessionId)}/context`, token, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

/** One citation as `POST /v1/chat/sessions/{id}/drafts` accepts it — the
 *  server's own real `atom_id`, never a model-facing handle. Mirrors
 *  `CitationIn` on the Python side. */
export type ChatDraftCitation = { atom_id: string; quoted_span: string; claim_text: string };

/** `usage`'s four keys are `number | null` throughout, matching
 *  `agent/lib/driver.ts`'s `TurnUsage` field-for-field and Python's
 *  `DraftSubmitIn.usage: dict[str, int | None] | None` (widened for this
 *  same review, C2) — `null` means "the provider reported nothing", which is
 *  not the same fact as zero and must survive this wire crossing intact. */
export type ChatDraftSubmitCreate = {
  snapshot_id: string;
  body: string;
  cited_atom_ids: ChatDraftCitation[];
  agent_text: string;
  idempotency_key: string;
  usage: {
    input_tokens: number | null;
    output_tokens: number | null;
    cache_read_input_tokens: number | null;
    cache_creation_input_tokens: number | null;
  };
  /** Task 12 (§9 step 6). Mirrors `DraftSubmitIn.skill_versions` — a list of
   *  objects, `[{slug, version}]`, never omit the object shape for a flat
   *  string or Python 422s. OPTIONAL on the Python side, but this repo's
   *  own runtime always has it: `route.ts` resolves it from server state
   *  before any tool runs, so `submit-draft.ts` sends it on every real
   *  submission. */
  skill_versions?: { slug: string; version: string }[];
};

/** `outcome`/`variant_id`/`rejection` all live NESTED under `payload` —
 *  `RuntimeSessionOut` on the Python side (`chat.py::_run_draft_operation`),
 *  never at this response's own top level. `submit-draft.ts` unwraps this
 *  itself; see that file's own docstring for the defect this shape fixed. */
export type ChatDraftSubmitResult = {
  payload: {
    outcome: "verified" | "held";
    variant_id?: string;
    rejection?: { kind: string };
  };
};

/**
 * Submits the agent's candidate draft for verification, and records its
 * reply in the SAME transaction (A19). Called ONLY by the Next server
 * runtime (`agent/tools/submit-draft.ts`) — never by a browser directly.
 *
 * FIX (final whole-branch review, C1), same defect and same fix as
 * `createChatContext` immediately above: this route is ALSO guarded by
 * `require_onboarding_identity` (`chat.py:1345`), and `submit-draft.ts` used
 * to call `engineJson` here too.
 */
export function submitChatDraft(
  token: string,
  sessionId: string,
  body: ChatDraftSubmitCreate,
): Promise<ChatDraftSubmitResult> {
  return clientJson(`/v1/chat/sessions/${encodeURIComponent(sessionId)}/drafts`, token, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

/** Records only — it interprets nothing (`chat.py::record_client_turn`'s own
 *  docstring). Writes `role="user", kind="task"`; no caller can choose either,
 *  because neither rides `ClientMessageCreate` at all. */
export function recordClientTurn(
  token: string,
  sessionId: string,
  body: ClientMessageCreate,
): Promise<RuntimeSessionEnvelope> {
  return clientJson(`/v1/chat/sessions/${encodeURIComponent(sessionId)}/messages`, token, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

/** The sibling of `recordClientTurn`: writes `role="assistant", kind="agent"`.
 *  Called only by the Next server runtime, at the end of its own turn loop —
 *  never in response to anything a browser sent directly. */
export function recordAgentTurn(
  token: string,
  sessionId: string,
  body: AgentTurnCreate,
): Promise<RuntimeSessionEnvelope> {
  return clientJson(`/v1/chat/sessions/${encodeURIComponent(sessionId)}/agent-turn`, token, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

/** `GET /v1/chat/sessions/{id}/variants/{variant_id}/sources` — added
 *  2026-08-26, §9 step 6 task 13. The fix for `get_variant_sources`, one of
 *  the agent's five tools: it posted the deleted `show_sources` command kind
 *  since step 6 task 2 removed it, and had thrown ever since
 *  (`agent/tools/get-variant-sources.ts`'s own history has the full account).
 *
 *  `VariantSourcesEnvelope` carries `source_label` ALONE, matching
 *  `VariantSourceOut` on the Python side field for field — there is no
 *  `locator` key on this type to leave unset, the same "structurally absent,
 *  not merely omitted" property `RuntimeSessionEnvelope` above states for
 *  `sources`. Guarded by `require_onboarding_identity` like every route in
 *  this section, so this calls `clientJson`, never `engineJson` — the same
 *  fix `createChatContext`/`submitChatDraft` needed at the final
 *  whole-branch review (C1). */
export type VariantSourcesEnvelope = { sources: { source_label: string }[] };

export function getChatVariantSources(
  token: string,
  sessionId: string,
  variantId: string,
): Promise<VariantSourcesEnvelope> {
  return clientJson(
    `/v1/chat/sessions/${encodeURIComponent(sessionId)}/variants/${encodeURIComponent(variantId)}/sources`,
    token,
  );
}

export function sendChatCommand(
  token: string,
  sessionId: string,
  body: ChatCommandCreate,
): Promise<ChatSessionEnvelope> {
  return clientJson(`/v1/chat/sessions/${encodeURIComponent(sessionId)}/commands`, token, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

// ---- the library: GET /v1/content-items, GET .../versions ----------------

export type ClientContentItem = {
  content_item_id: string;
  /** Null on a standalone item. Migration 0015 dropped the NOT NULL and
   * `library.py` reads the column straight through. Nothing renders it. */
  campaign_id: string | null;
  asset_kind: string;
  state: string | null;
  state_changed_at: string | null;
  latest_version_id: string | null;
  latest_version_no: number | null;
  manually_edited: boolean;
  version_count: number;
  created_at: string;
};

export type ClientContentLibrary = { items: ClientContentItem[]; count: number };

export type ContentVersionEntry = {
  content_version_id: string;
  version_no: number;
  body: string;
  body_sha256: string;
  manually_edited: boolean;
  state: string | null;
  created_at: string;
  receipt: ReceiptClaim[];
  untrusted_fields: string[];
  trust: "untrusted";
  media?: PostMedia | null;
};

export type PostMedia = {
  media_id: string;
  media_type: "image/jpeg" | "image/png" | "image/webp";
  byte_size: number;
  width: number;
  height: number;
  original_name: string;
  alt_text: string | null;
  download_url: string;
};

export type ContentVersionHistory = {
  content_item_id: string;
  versions: ContentVersionEntry[];
  count: number;
};

export function listContentItems(token: string): Promise<ClientContentLibrary> {
  return clientJson("/v1/content-items", token);
}

export function listVersions(
  token: string,
  contentItemId: string,
): Promise<ContentVersionHistory> {
  return clientJson(
    `/v1/content-items/${encodeURIComponent(contentItemId)}/versions`,
    token,
  );
}

// ---- the decision loop ---------------------------------------------------

/** What one approve did. **`slot` IS NULL ON AN ORDINARY APPROVE.**
 *
 * This used to be `slot: ScheduledSlot`, and that declaration was true only while
 * approve allocated a slot of its own. Pass 1 (spec 2026-08-20, decision D2)
 * deleted that allocator: `state: "approved"` with `slot: null` is now what every
 * approval of an unscheduled version returns, and a date enters the system through
 * `POST /v1/content-items/{id}/schedule` instead. A non-null slot here means the
 * approve RECLAIMED a parked slot (the edit-then-reapprove path, D6-19/D6-20).
 */
export type Approved = {
  content_item_id: string;
  content_version_id: string;
  state: "approved";
  slot: ScheduledSlot | null;
  approved_at: string;
};

export type RejectClaim = ReceiptClaim & { claim_id: string };

export type RejectOptions = {
  taps: string[];
  ban_available: boolean;
  claims: RejectClaim[];
  topic_options: Array<{ key: string; label: string; trust: "untrusted" }>;
};

/** `claim_id` is required for, and ONLY for, `never_say_this_again`.
 *
 * A model validator refuses both directions, so sending it with another tap is
 * a 422 and omitting it on that tap is a 422. `extra="forbid"`: an unknown
 * field is a 422 too.
 */
export type RejectIn = {
  idempotency_key: string;
  tap: "not_my_voice" | "not_accurate" | "never_say_this_again" | "just_not_this_one";
  note?: string | null;
  claim_id?: string | null;
  steer_topic_key?: string | null;
};

/** `regeneration` REMOVED, D-B (2026-08-25). Reject used to also enqueue a
 *  replacement generation; it now only records the rejection (and, on
 *  `never_say_this_again`, the constraint) and stops there. Mirrors
 *  `RejectedOut` on the Python side (`src/product/api/schemas.py`), which
 *  lost the same field the same day. A new draft is a chat action now, not
 *  something reject starts by itself. */
export type Rejected = {
  content_item_id: string;
  rejected_version_id: string;
  state: "rejected";
  constraint_written: boolean;
  ban_text_source: "atom" | "span" | "claim_text" | null;
};

export type EditIn = {
  idempotency_key: string;
  parent_version_id: string;
  body: string;
  media_id?: string | null;
  media_alt_text?: string | null;
};

export type Edited = {
  content_item_id: string;
  content_version_id: string;
  version_no: number;
  manually_edited: boolean;
  stripped_character_count: number;
  slot_moved_to_needs_reapproval: boolean;
  receipt: ReceiptClaim[];
  state: "draft";
};

export type Posted = {
  content_item_id: string;
  content_version_id: string;
  state: "posted";
  slot: ScheduledSlot & { posted_at: string };
};

export type Copy = {
  content_version_id: string;
  body: string;
  body_sha256: string;
  trust: "untrusted";
};

export function approve(token: string, contentItemId: string, body: KeyedIn): Promise<Approved> {
  return clientJson(`/v1/content-items/${encodeURIComponent(contentItemId)}/approve`, token, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

export function rejectOptions(token: string, contentItemId: string): Promise<RejectOptions> {
  return clientJson(
    `/v1/content-items/${encodeURIComponent(contentItemId)}/reject-options`,
    token,
  );
}

export function reject(token: string, contentItemId: string, body: RejectIn): Promise<Rejected> {
  return clientJson(`/v1/content-items/${encodeURIComponent(contentItemId)}/reject`, token, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

export function editDraft(token: string, contentItemId: string, body: EditIn): Promise<Edited> {
  return clientJson(`/v1/content-items/${encodeURIComponent(contentItemId)}/edit`, token, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

export async function uploadPostMedia(
  token: string,
  file: File,
  idempotencyKey: string,
): Promise<PostMedia> {
  const form = new FormData();
  form.set("file", file, file.name);
  form.set("idempotency_key", idempotencyKey);
  return (await clientFetch("/v1/post-media", token, { method: "POST", body: form })).json() as Promise<PostMedia>;
}

export function downloadPostMedia(token: string, mediaId: string): Promise<Response> {
  return clientFetch(`/v1/post-media/${encodeURIComponent(mediaId)}/download`, token);
}

export function markPosted(token: string, contentItemId: string, body: KeyedIn): Promise<Posted> {
  return clientJson(
    `/v1/content-items/${encodeURIComponent(contentItemId)}/mark-posted`,
    token,
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) },
  );
}

export function copyApproved(token: string, contentItemId: string): Promise<Copy> {
  return clientJson(`/v1/content-items/${encodeURIComponent(contentItemId)}/copy`, token);
}

// ---- the schedule --------------------------------------------------------

export type CalendarSlot = {
  slot_id: string;
  slot_at: string;
  slot_zone: string;
  status: string;
  relaxation: string;
  cadence_version: string | null;
  content_item_id: string;
  content_version_id: string;
  /** The item's own subject — always populated, `""` at worst. Pass 1 (2026-08-21)
   * added it and superseded `campaign_objective`, which was null on every
   * standalone item; the backend keeps that field for one more pass and Plan C
   * removes it. Declaring only this one is how this file records that nothing
   * reads the old pair. */
  objective: string;
  /** Null on a standalone item — which, since Phase 8 moved creation to the first
   * chat turn, is every item a client makes. Kept because an id is a real handle;
   * nothing renders it today. */
  campaign_id: string | null;
};

export type Calendar = { slots: CalendarSlot[]; count: number; trust: "untrusted" };

export type AwaitingReview = {
  items: Array<{
    content_item_id: string;
    content_version_id: string;
    version_no: number;
    manually_edited: boolean;
    created_at: string;
  }>;
  count: number;
};

/**
 * Home needs the exact queued version body for the shared DraftActions edit
 * path. The queue endpoint intentionally omits it, so compose the two client
 * credential reads here rather than widening the upstream wire shape.
 */
export type AwaitingReviewForHome = {
  items: Array<{
    content_item_id: string;
    content_version_id: string;
    version_no: number;
    manually_edited: boolean;
    created_at: string;
    body: string;
    trust: "untrusted";
    untrusted_fields: ["body"];
  }>;
  count: number;
};

/** `slot_at` must be an AWARE ISO timestamp — a naive one is a 422.
 *
 * `AwareDatetime` on the Python side. `new Date(...).toISOString()` is aware
 * (it ends in `Z`); a locally-formatted `"2026-08-20T09:00"` from a
 * `datetime-local` input is not, and must be converted before it is sent.
 */
export type RescheduleIn = { idempotency_key: string; slot_at: string };

export type Rescheduled = {
  content_item_id: string;
  content_version_id: string;
  slot: ScheduledSlot;
};

export function calendar(token: string): Promise<Calendar> {
  return clientJson("/v1/calendar", token);
}

export function awaitingReview(token: string): Promise<AwaitingReview> {
  return clientJson("/v1/content-items/awaiting-review", token);
}

export async function awaitingReviewWithBodies(token: string): Promise<AwaitingReviewForHome> {
  const queue = await awaitingReview(token);
  const items = await Promise.all(queue.items.map(async (queued) => {
    const history = await listVersions(token, queued.content_item_id);
    const version = history.versions.find(
      (version) => version.content_version_id === queued.content_version_id,
    );
    if (!version) {
      throw new Error(`Queued content version ${queued.content_version_id} was not found in its history.`);
    }
    return {
      content_item_id: queued.content_item_id,
      content_version_id: queued.content_version_id,
      version_no: queued.version_no,
      manually_edited: queued.manually_edited,
      created_at: queued.created_at,
      body: version.body,
      trust: "untrusted" as const,
      untrusted_fields: ["body"] as ["body"],
    };
  }));
  return { items, count: queue.count };
}

export function reschedule(
  token: string,
  slotId: string,
  body: RescheduleIn,
): Promise<Rescheduled> {
  return clientJson(`/v1/schedule-slots/${encodeURIComponent(slotId)}/reschedule`, token, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

/** The client's own scheduling act — where a date ENTERS the system (Pass 1, task 7).
 *
 * `POST /v1/content-items/{id}/schedule` is a `201` and a different action from
 * `reschedule`'s `200`: approve no longer allocates, so a first date is a create
 * and a change of mind is a move. The API models them as two response classes
 * (`ScheduledOut` / `RescheduledOut`) even though today's shape agrees, and this
 * file follows that rather than aliasing one to the other.
 *
 * `slot` is NEVER null here, unlike `Approved.slot`: a 201 from this route always
 * wrote or replayed exactly one row.
 *
 * `slot_at` must be an AWARE ISO instant, same rule and same reason as
 * `RescheduleIn.slot_at`. The BFF route builds it from the client's own configured
 * zone; nothing in a browser assembles it.
 */
export type ScheduleIn = { idempotency_key: string; slot_at: string };

export type Scheduled = {
  content_item_id: string;
  content_version_id: string;
  slot: ScheduledSlot;
};

export function scheduleContentItem(
  token: string,
  contentItemId: string,
  body: ScheduleIn,
): Promise<Scheduled> {
  return clientJson(`/v1/content-items/${encodeURIComponent(contentItemId)}/schedule`, token, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

// ---- the campaigns read --------------------------------------------------

export type ClientCampaign = {
  campaign_id: string;
  period_id: string;
  play_id: string;
  objective: string;
  starts_on: string;
  ends_on: string;
  is_active: boolean;
  created_at: string;
};

/** `client_id` here is SERVER-AUTHORED and is the only honest source of it.
 *
 * `active_cap` is published on purpose: the cap is enforced in the backend and
 * a screen disabled on a hardcoded 3 either blocks a legal create or offers one
 * the backend refuses. Read the number off the wire.
 *
 * `default_period_label` names the system-provisioned default campaign's
 * period, which the client's own list excludes by id. The BFF must STRIP it
 * before anything reaches the browser (T-07A-02-07) — plan 07A-04 owns that.
 */
export type ClientCampaigns = {
  client_id: string;
  campaigns: ClientCampaign[];
  active_count: number;
  active_cap: number;
  default_period_label: string;
  generated_at: string;
};

export function listClientCampaigns(token: string): Promise<ClientCampaigns> {
  return clientJson("/v1/campaigns", token);
}

// ---- the constraints surface: GET /v1/constraints, POST .../unban ---------
//
// 07B-02's two routes. Client credential, no tenant segment, no `client_id`
// accepted anywhere — the envelope RETURNS one, which is a different thing
// (D-07; the value is re-derived from the token on every request).

/** One live constraint, as the client bound by it reads it.
 *
 * `can_unban` IS THE SERVER'S RULE, PUBLISHED PER ROW. Do not derive it from
 * `origin`: the un-ban route answers 404 for anything not rejection-written, and
 * a screen with its own predicate eventually offers a control the backend
 * refuses or hides one it allows.
 *
 * `text` is the CLIENT'S OWN BYTES — a slice of their material resolved at ban
 * time, or a phrase they typed into onboarding. Escape it; never render it as
 * HTML or markdown.
 */
export type ClientConstraint = {
  atom_id: string;
  text: string;
  trust: "untrusted";
  origin: "rejection" | "standing_rule";
  atom_type: string;
  created_at: string;
  can_unban: boolean;
};

/** Both counts are computed by the backend FROM the returned list, so a caller
 * may sum the rows itself and get the same numbers. Do not issue a second read
 * for them — a second read is a second answer about a set that moved.
 */
export type ClientConstraints = {
  client_id: string;
  constraints: ClientConstraint[];
  rejection_count: number;
  standing_rule_count: number;
  generated_at: string;
};

export type UnbanIn = { idempotency_key: string; note?: string | null };

/** `already_deprecated: true` is a QUIET 200 REPLAY, not an error.
 *
 * The replay arm turns on the ATOM'S STATE rather than on the key, so a second
 * tap with a fresh key gets the same answer. `decided_at` on a replay is the
 * instant of the un-ban that already happened, and is null only for a shape this
 * route's scope cannot produce today.
 */
export type ConstraintUnbanned = {
  client_id: string;
  atom_id: string;
  status: string;
  already_deprecated: boolean;
  decided_at: string | null;
};

export function listConstraints(token: string): Promise<ClientConstraints> {
  return clientJson("/v1/constraints", token);
}

export function unbanConstraint(
  token: string,
  atomId: string,
  body: UnbanIn,
): Promise<ConstraintUnbanned> {
  return clientJson(`/v1/constraints/${encodeURIComponent(atomId)}/unban`, token, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

// ---- the atom review surface: GET /v1/atoms, POST .../decision ------------
//
// 07B-03's two routes.

/** The engine's nine `M1_ATOM_TYPES`, in the order `content_engine/models.py`
 * declares them.
 *
 * SPELLED ONCE, HERE, AND NOWHERE ELSE IN THIS FRONTEND. `src/lib/atom-labels.ts`
 * builds its `Record<AtomType, string>` off the union below, so adding a tenth
 * type to the backend and to this tuple makes an unlabelled type a COMPILE ERROR
 * rather than a raw `claims_blacklist` on a client's screen.
 *
 * These are INTERNAL VOCABULARY. Nothing here may reach a client-facing
 * response un-mapped (IC-7.2) — see `atom-labels.ts`.
 */
export const ATOM_TYPES = [
  "tldr",
  "insight",
  "pain_point",
  "objection",
  "proof_point",
  "quote",
  "terminology",
  "claims_blacklist",
  "voice_constraint",
] as const;

export type AtomType = (typeof ATOM_TYPES)[number];

export function isAtomType(value: unknown): value is AtomType {
  return typeof value === "string" && (ATOM_TYPES as readonly string[]).includes(value);
}

/** `text` is untrusted; `source_label` deliberately is NOT — it is
 * server-authored from the source document's type, the same map the receipt
 * uses, and marking it untrusted would assert the opposite of Phase 5 SC-2.
 * `untrusted_fields` publishes that split on the wire.
 *
 * THE WHOLE TEXT IS RETURNED, never a preview. A client who cannot read their
 * own material cannot review it: wrap it, do not clamp or hover it.
 */
export type ClientAtom = {
  atom_id: string;
  atom_type: string;
  can_deprecate: boolean;
  text: string;
  status: string;
  created_at: string;
  source_label: string;
  document_id: string;
  untrusted_fields: string[];
  trust: "untrusted";
};

/** `atom_counts` describes the RETURNED set — a request filtered to one type
 * returns one key. A screen wanting every badge asks for the unfiltered list and
 * gets rows and counts out of one consistent read.
 */
export type ClientAtoms = {
  client_id: string;
  atoms: ClientAtom[];
  atom_counts: Record<string, number>;
  generated_at: string;
};

/** `"override"` is NOT accepted by this route — it is the operator fork's verb,
 * and it EDITS the atom's text. The backend answers 422 naming the two below.
 */
export type ClientAtomDecisionIn = {
  decision: "confirm" | "deprecate";
  idempotency_key: string;
  note?: string | null;
};

/** `unchanged: true` is a quiet 200 replay, for `ConstraintUnbanned`'s reason. */
export type ClientAtomDecided = {
  client_id: string;
  atom_id: string;
  status: string;
  unchanged: boolean;
  decided_at: string | null;
};

/** `atomType` is narrowed to the nine before it is spelled into a query string.
 * An unknown value is a backend 422 whose message lists all nine; the caller
 * validates first so a typo in a screen is not a round trip.
 */
export function listClientAtoms(token: string, atomType?: AtomType | null): Promise<ClientAtoms> {
  const query = atomType ? `?atom_type=${encodeURIComponent(atomType)}` : "";
  return clientJson(`/v1/atoms${query}`, token);
}

export function decideClientAtom(
  token: string,
  atomId: string,
  body: ClientAtomDecisionIn,
): Promise<ClientAtomDecided> {
  return clientJson(`/v1/atoms/${encodeURIComponent(atomId)}/decision`, token, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

// ===========================================================================
// SERVICE CREDENTIAL — `X-API-Key` only, and `clientId` is resolved
// SERVER-SIDE by `client-session.ts::resolveClientId`, never from a browser.
//
// WHY EACH OF THESE IS HERE AND NOT IN THE FAMILY ABOVE. Read this before
// "tidying" one of them across: moving a function up produces a 401, and
// adding a browser-reachable `client_id` parameter to one produces a
// cross-tenant read.
//
//   * `clientConsole` — `GET /v1/clients/{client_id}/console` is
//     `require_service_token` and has no client-credential twin. It publishes
//     play eligibility and atom counts, which are operator-facing figures; the
//     campaigns screen needs `selected_play_id` and the eligible-play list from
//     it, so the Next server reads it with the service key and hands the screen
//     only what D7A-09 allows (no atom-type jargon, no override affordance).
//   * `listPeriodsAsService` / `createPeriodAsService` — periods are
//     OPERATOR-DEFINED ranges (D-15). There is no client route at all, and
//     D7A-11's hidden default period is provisioned through exactly this pair.
//   * `listCampaignsAsService` / `createCampaignAsService` — the CREATE is
//     proxied on purpose (D7A-09): it needs the play-eligibility gate, the
//     persona snapshot and the `derive_campaign_cadence` job, and
//     `GET /v1/campaigns` (above) is the client's read of the same rows. The
//     operator LIST survives because it also returns the hidden default, which
//     the client read excludes — an operator debugging provisioning has to be
//     able to see the row they provisioned.
//   * `createContentItemAsService` — `POST /v1/clients/{client_id}/campaigns/
//     {campaign_id}/content-items` is the ONLY route in this API that brings a
//     content item into existence, and PLAN-04 keeps the campaign in its path.
//     There is deliberately no `POST /v1/content-items`; adding one is the
//     shape D7A-11's default campaign would tempt somebody into.
//   * `heldQueue` / `releaseHeld` — operator surfaces by design (D7A-08,
//     D-13). A client never sees why their draft was held; the queue publishes
//     `rejection_kind` and `hold_origin`, which are exactly the internal state
//     the client's poll withholds. These belong under `/internal`, never on a
//     client screen.
//   * `listClientUsers` / `issueOnboardingTokenAsService` — the magic-link
//     generator's pair, and the SECOND of the two is the one place in this whole
//     API where a RAW CREDENTIAL EVER APPEARS IN A RESPONSE. See the annotation
//     on that function; it is the reason `/internal`'s link generator is the only
//     caller either may ever have.
// ===========================================================================

export type Console = {
  client_id: string;
  atom_counts: Record<string, number>;
  plays: Array<{
    play_id: string;
    internal_name: string;
    eligible: boolean;
    missing_atom_types: string[];
    is_fallback: boolean;
  }>;
  selected_play_id: string;
  voice_profile: {
    latest_version: number | null;
    approved_version: number | null;
  };
  generated_at: string;
};

export type Period = {
  id: string;
  client_id: string;
  level: string;
  starts_on: string;
  ends_on: string;
  label: string;
  created_at: string;
};

export type PeriodCreate = {
  level?: "month" | "quarter" | "year";
  starts_on: string;
  ends_on: string;
  label: string;
};

export type ServiceCampaign = {
  id: string;
  client_id: string;
  period_id: string;
  play_id: string;
  objective: string;
  persona_snapshot: Record<string, unknown>;
  starts_on: string;
  ends_on: string;
  play_overridden_at: string | null;
  play_override_missing_atom_types: string[] | null;
  created_at: string;
  trust: "untrusted";
};

/** No `objective` and there must never be one: PLAY-03 renders it from the play.
 *
 * `override` exists but D7A-09 forbids offering it to a client — an ineligible
 * play is rendered as unavailable with no override affordance and no atom-type
 * jargon. It is typed here because the operator console legitimately sets it.
 */
export type CampaignCreate = {
  period_id: string;
  play_id: string;
  client_name: string;
  starts_on: string;
  ends_on: string;
  override?: boolean;
  idempotency_key: string;
};

export type ContentItem = {
  id: string;
  client_id: string;
  /** Null on an item created through the standalone route. */
  campaign_id: string | null;
  /** The item's own subject, migration 0015's other half. Null on a pre-Pass-1
   * row that still inherits from its campaign. */
  objective: string | null;
  asset_kind: string;
  created_at: string;
};

export type HeldDraft = {
  content_item_id: string;
  /** Null on a standalone item; the operator queue publishes it as-is. */
  campaign_id: string | null;
  asset_kind: string;
  content_version_id: string;
  version_no: number;
  held_at: string;
  rejection_kind: string | null;
  first_rejection_kind: string | null;
  rejection_detail: Record<string, unknown>;
  hold_origin: "system" | "content" | "unknown";
  body: string;
  trust: "untrusted";
};

export type HeldQueue = {
  client_id: string;
  held_count: number;
  system_fault_count: number;
  items: HeldDraft[];
  generated_at: string;
};

export type HeldRelease = {
  content_item_id: string;
  content_version_id: string;
  from_state: string;
  to_state: string;
  actor: string;
  released_at: string;
};

export function clientConsole(clientId: string): Promise<Console> {
  return serviceJson(`/v1/clients/${encodeURIComponent(clientId)}/console`);
}

export function listPeriodsAsService(clientId: string): Promise<Period[]> {
  return serviceJson(`/v1/clients/${encodeURIComponent(clientId)}/periods`);
}

export function createPeriodAsService(clientId: string, body: PeriodCreate): Promise<Period> {
  return serviceJson(`/v1/clients/${encodeURIComponent(clientId)}/periods`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

export function listCampaignsAsService(clientId: string): Promise<ServiceCampaign[]> {
  return serviceJson(`/v1/clients/${encodeURIComponent(clientId)}/campaigns`);
}

export function createCampaignAsService(
  clientId: string,
  body: CampaignCreate,
): Promise<ServiceCampaign> {
  return serviceJson(`/v1/clients/${encodeURIComponent(clientId)}/campaigns`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

export function createContentItemAsService(
  clientId: string,
  campaignId: string,
  body: { asset_kind?: string; idempotency_key: string },
): Promise<ContentItem> {
  return serviceJson(
    `/v1/clients/${encodeURIComponent(clientId)}/campaigns/${encodeURIComponent(campaignId)}/content-items`,
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) },
  );
}

export function heldQueue(clientId: string): Promise<HeldQueue> {
  return serviceJson(`/v1/clients/${encodeURIComponent(clientId)}/held`);
}

/** THE RELEASE ROUTE TAKES NO BODY, and that is measured, not assumed.
 *
 * `src/product/api/operator_queue.py::release_held_draft(client_id,
 * content_item_id, request)` declares no body parameter, so there is no
 * `idempotency_key` to send and no model to forbid one — a body posted here is
 * ignored in silence, which is worse than a 422 because the caller believes the
 * key did something. Idempotence comes from the route's own precondition
 * instead: it refuses anything not currently held, so a second release meets a
 * clean 4xx naming the state. The plan's `<interfaces>` typed a `KeyedIn` here;
 * the Python source is authoritative and it does not take one.
 */
export function releaseHeld(clientId: string, contentItemId: string): Promise<HeldRelease> {
  return serviceJson(
    `/v1/clients/${encodeURIComponent(clientId)}/held/${encodeURIComponent(contentItemId)}/release`,
    { method: "POST" },
  );
}

// ---- the magic link: the people, then the credential -----------------------

/** A person prepared for this client. `UserOut` — `credential_hash` is absent
 *  from that model by design and must never be added here either. */
export type ProductUser = {
  id: string;
  client_id: string;
  email: string;
  display_name: string;
  profession: string | null;
  status: string;
  created_at: string;
};

/** The exact operator request shape. `profession` is required as a key, nullable as a value. */
export type ProductUserCreate = {
  email: string;
  display_name: string;
  profession: string | null;
};

/** Everyone prepared for this client, OLDEST FIRST — the route's own ordering.
 *
 * `src/product/api/users.py::list_users` orders by `User.created_at` and says so
 * in its docstring. The link generator depends on that order, so it is recorded
 * here rather than left as an accident of the caller's luck: the first element is
 * the first person the operator prepared for this client.
 *
 * ONBRD-01's precondition is that a person exists before anybody can be handed a
 * link, and this list is how a caller finds out whether that precondition holds.
 * An empty array is a legitimate answer, not an error.
 */
export function listClientUsers(clientId: string): Promise<ProductUser[]> {
  return serviceJson(`/v1/clients/${encodeURIComponent(clientId)}/users`);
}

export function createClientUser(
  clientId: string,
  body: ProductUserCreate,
): Promise<ProductUser> {
  return serviceJson(`/v1/clients/${encodeURIComponent(clientId)}/users`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

/** The three shapes a link can be minted as. Mirrors the backend's own
 * `purpose` literal on `POST .../onboarding-token` exactly (defaults to
 * `"onboarding"` there too) — `set-password` refuses anything outside
 * `("invite", "reset")` by design, so a caller minting either of those two
 * must say so explicitly; the historic magic-link flow keeps not saying
 * anything, which is what makes today's byte-unchanged callers still
 * byte-unchanged (fix wave, 2026-08-22, F1-console). */
export type OnboardingTokenPurpose = "onboarding" | "invite" | "reset";

/** A historical operator listing. Raw onboarding credentials and their digests
 * are absent. `purpose` was added by the same backend change that lets
 * `issueOnboardingTokenAsService` mint invite/reset links — the LIST route
 * grew the field so an operator scanning issued links can tell the three
 * kinds apart without re-deriving it from which button was clicked. */
export type OnboardingToken = {
  id: string;
  user_id: string;
  issued_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  purpose: OnboardingTokenPurpose;
};

export function listOnboardingTokens(clientId: string): Promise<OnboardingToken[]> {
  return serviceJson(`/v1/clients/${encodeURIComponent(clientId)}/onboarding-tokens`);
}

/** The backend owns idempotency: no request body or synthetic key is sent. */
export function revokeOnboardingToken(clientId: string, tokenId: string): Promise<OnboardingToken> {
  return serviceJson(
    `/v1/clients/${encodeURIComponent(clientId)}/onboarding-tokens/${encodeURIComponent(tokenId)}/revoke`,
    { method: "POST" },
  );
}

/** THE ONLY PLACE IN THIS WHOLE API WHERE A RAW CREDENTIAL REACHES A RESPONSE.
 *
 * `POST /v1/clients/{client_id}/users/{user_id}/onboarding-token` answers with
 * `OnboardingTokenIssued`, whose own docstring is worth quoting because it is the
 * reason this function is annotated rather than merely typed: *"THE ONLY SHAPE IN
 * THIS CODEBASE THAT EVER CARRIES A RAW CREDENTIAL… it CANNOT BE RE-DERIVED
 * afterwards by anyone including this service"* — only the sha256 digest is
 * stored, and `onboarding_tokens_hash_ck` constrains that column to
 * `^[0-9a-f]{64}$`, so the raw value is unstorable by construction.
 *
 * THREE RULES FOR EVERY CALLER, AND THEY ARE NOT STYLE:
 *
 *   1. NEVER LOG `token`. Not in a `console.*`, not in an error message, not in a
 *      thrown `Error`, not in a span attribute. `mint_onboarding_token` "WRITES
 *      NOTHING AND LOGS NOTHING" on the server side; a frontend log would be the
 *      one copy nobody revokes.
 *   2. NEVER STORE IT. It goes into exactly one URL, handed to one person. There
 *      is deliberately no "show me that link again" — an operator who loses it
 *      revokes and re-issues (D-08).
 *   3. ONE CALLER, EVER: `app/api/internal/client-login-link/route.ts`. The link
 *      generator is passcode-gated and its response body carries the URL. Any
 *      second caller widens the set of places a raw credential exists.
 *
 * THE ROUTE IS PER-USER, NOT PER-CLIENT, and that is measured rather than
 * assumed. `07A-06-PLAN.md`, `07A-CONTEXT.md` and `07A-16-PLAN.md` all spell it
 * `POST /v1/clients/{client_id}/onboarding-tokens`; that path does not exist.
 * `users.py:118` declares `POST /users/{user_id}/onboarding-token` (singular),
 * and the only routes on the plural path are the operator LIST and the per-token
 * REVOKE. A token belongs to a PERSON — `onboarding_tokens.user_id` is NOT NULL
 * behind a composite foreign key — so a `clientId`-only signature could not have
 * been implemented at all.
 *
 * `purpose` DEFAULTS TO `"onboarding"` (fix wave, 2026-08-22, F1-console) —
 * every caller of this function BEFORE that fix passed no third argument and
 * got exactly today's magic link, so the default keeps every one of them
 * byte-unchanged in behaviour. The backend accepts the same three literals in
 * an OPTIONAL JSON body and defaults the same way; this parameter is sent in
 * the body rather than left for the backend to default so the ONE caller that
 * now passes `invite`/`reset` (`client-login-link/route.ts`) is explicit about
 * which kind it is minting.
 */
export function issueOnboardingTokenAsService(
  clientId: string,
  userId: string,
  purpose: OnboardingTokenPurpose = "onboarding",
): Promise<OnboardingTokenIssued> {
  return serviceJson(
    `/v1/clients/${encodeURIComponent(clientId)}/users/${encodeURIComponent(userId)}/onboarding-token`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ purpose }),
    },
  );
}

/** `OnboardingTokenIssued`. `token_hash` IS ABSENT from the wire model and must
 *  stay absent here: the digest is the LOOKUP KEY `require_onboarding_identity`
 *  matches on, so publishing it would make any listing an oracle about which
 *  links are live. `purpose` rides alongside the raw token so the ONE caller
 *  that reads it (`client-login-link/route.ts`) can pick the right landing URL
 *  without a second round trip. */
export type OnboardingTokenIssued = {
  id: string;
  user_id: string;
  issued_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  token: string;
  purpose: OnboardingTokenPurpose;
};

// What a client is told when the knowledge engine does not accept an upload
// (Cycle 5 P2.7; spec §7.4, A18, A26). Client-safe and pure. The BFF's upload
// route (`app/api/client/documents`) calls `uploadErrorCopy` under the rehaul
// engine only; the Knowledge screen shows the sentence beside the file in Add
// files. Each refusal says that the file was not accepted and, for a limit, which
// limit and when it resets. A limit is never "try again shortly".
//
// The refusals `POST /v2/clients/{id}/documents` can answer
// (`src/content_engine/ke/api/uploads.py`, `ke/admission.py`):
// - 429 `monthly_upload_limit` with `limit` {used, allowed, used_fraction, resets_at, ...};
// - 429 an admission reason: `daily_spend_cap`, `global_daily_cap`, `in_flight_cap`,
//   `retained_bytes_cap`, `global_watermark`, `bound_breached`;
// - 503 `policy_missing` or `reconciliation_required`;
// - 413 the file is over the upload cap (the backend's 200 MB; the browser and
//   the BFF already refuse anything over D08's 20 MB);
// - 409 `upload_in_progress` / `upload_admission_changed` (the same bytes are being admitted);
// - 200 with `duplicate_of`: identical bytes are already a source (not a refusal; A18).
// The ~13-page limit and an unreadable file are found after the upload is
// accepted; the source's own status says so ("Needs your help", "Too long —
// split it into smaller files").

import { limitRefusalCopy, parseLimitRefusal } from "./limit-refusal";
import { TOO_LARGE_COPY, UNSUPPORTED_TYPE_COPY } from "./upload-contract";

const NOT_ACCEPTED = "Not accepted.";

/** A duplicate upload: identical bytes already are a source, so nothing new is
 *  added and the month's allowance is not used again (A18). */
export const DUPLICATE_UPLOAD_COPY = "Already in your sources. It was not added or counted again.";

/** The upload contract's own refusals (D08, `upload-contract.ts`): the browser and
 *  the BFF check them before sending, and a 413/415 from the backend reads the same. */
export { LEGACY_OFFICE_COPY, TOO_LARGE_COPY, UNSUPPORTED_TYPE_COPY } from "./upload-contract";
export const IN_PROGRESS_COPY =
  `${NOT_ACCEPTED} The same file is still being added. Check your sources in a moment before adding it again.`;
const CONTACT_SUPPORT = "Please contact support.";

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const whole = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;

/** The backend's code: a string `detail`, or `detail.code`. */
function codeOf(body: unknown): string | null {
  const detail = record(body)?.detail;
  if (typeof detail === "string") return detail;
  const code = record(detail)?.code;
  return typeof code === "string" ? code : null;
}

function monthlyUploadCopy(body: unknown): string {
  const raw = record(record(body)?.limit);
  const limit = parseLimitRefusal(raw);
  if (!limit || limit.meter !== "uploads_monthly") {
    // No readable reset: say which limit, and claim no date.
    return `${NOT_ACCEPTED} This month's upload limit is reached.`;
  }
  const used = whole(raw?.used);
  const allowed = whole(raw?.allowed);
  const counts = used !== null && allowed !== null ? ` ${used} of ${allowed} uploads used this month.` : "";
  return `${NOT_ACCEPTED}${counts} ${limitRefusalCopy(limit)}`;
}

/** Refusals that Settings -> Usage explains (spec §7.4: "View usage opens the
 *  current allowance/reset"): the month's uploads, and today's document processing. */
export function refusalShowsUsage(detail: unknown): boolean {
  return detail === "monthly_upload_limit" || detail === "daily_spend_cap";
}

/** The sentence for a refused knowledge-engine upload, from its status and body.
 *  Null for a status this helper does not speak for (the caller keeps its own
 *  copy for a server error). */
export function uploadErrorCopy(status: number, body: unknown): string | null {
  const code = codeOf(body);
  if (status === 429 && code === "monthly_upload_limit") return monthlyUploadCopy(body);
  switch (code) {
    // The client's documents daily budget (spec 10A.1: a UTC day).
    case "daily_spend_cap":
      return `${NOT_ACCEPTED} Today's document processing limit is reached. It resets at 00:00 UTC.`;
    // The deployment's limits are not the client's: neutral wording.
    case "global_daily_cap":
      return `${NOT_ACCEPTED} Processing is paused for everyone until 00:00 UTC.`;
    case "global_watermark":
      return `${NOT_ACCEPTED} The service can't take more files right now. ${CONTACT_SUPPORT}`;
    case "retained_bytes_cap":
      return `${NOT_ACCEPTED} This account's file storage is full. ${CONTACT_SUPPORT}`;
    case "in_flight_cap":
      return `${NOT_ACCEPTED} Too many files are being processed at once. Add it again when one of them is finished.`;
    case "policy_missing":
      return `${NOT_ACCEPTED} Uploads aren't set up for this account yet. ${CONTACT_SUPPORT}`;
    case "reconciliation_required":
    case "bound_breached":
      return `${NOT_ACCEPTED} Uploads are on hold for this account until our team checks it. ${CONTACT_SUPPORT}`;
    case "upload_in_progress":
    case "upload_admission_changed":
      return IN_PROGRESS_COPY;
  }
  if (status === 413) return TOO_LARGE_COPY;
  if (status === 415) return UNSUPPORTED_TYPE_COPY;
  // Any other limit: name no reset it was not given, and never "try again shortly".
  if (status === 429) return `${NOT_ACCEPTED} An upload limit for this account is reached. ${CONTACT_SUPPORT}`;
  return null;
}

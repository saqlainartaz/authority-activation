// POST /api/client/contributions -> POST /v1/contributions (Cycle 5 P6.8; spec 5.1; A09; review I-4).
//
// "What would you like us to know?" in Train Your AI. The backend records the
// note once per `intent_key` and applies it as one item of the kind the client
// chose: a fact added, or a proposed guidance line the client adds themselves.
// - The browser's `intent_key` is forwarded unchanged, and a retry of the same
//   note sends the same key, so a lost reply never records it twice. The BFF
//   never makes one up: a note without one is refused with 400 before the
//   backend is called.
// - Only `intent_key`, `text`, `kind` (`fact`, the default, or `writing`) and,
//   from Business DNA, `section` (the section the note was sent from; P9 fix round 1)
//   are forwarded; the client is the session's own.
// Rehaul only: under M1 the backend answers 404.

import { clientToken } from "@/lib/client-session";
import { contribute, expiredLinkResponse, forwardProductError, readJsonObject, type ContributionSection } from "@/lib/product";

/** The backend's own limit (`contributions.CONTRIBUTION_TEXT_MAX`): one note is one item. */
const CONTRIBUTION_TEXT_MAX = 500;
const KINDS = new Set(["fact", "writing"]);
const SECTIONS = new Set(["identity", "audience", "offers", "positioning", "proof"]);

export async function POST(request: Request) {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();
  const raw = await readJsonObject(request);
  const key = raw.intent_key;
  if (typeof key !== "string" || !key.trim() || key.length > 200) {
    return Response.json(
      { error: "This message has no intent key, so nothing was sent.", detail: "intent_key_required" },
      { status: 400 },
    );
  }
  const text = raw.text;
  if (typeof text !== "string" || !text.trim() || text.length > CONTRIBUTION_TEXT_MAX) {
    return Response.json(
      { error: `Write a message of up to ${CONTRIBUTION_TEXT_MAX.toLocaleString("en-GB")} characters.`, detail: "text_invalid" },
      { status: 400 },
    );
  }
  const kind = raw.kind ?? "fact";
  if (typeof kind !== "string" || !KINDS.has(kind)) {
    return Response.json(
      { error: "Choose what the note is about.", detail: "kind_invalid" },
      { status: 400 },
    );
  }
  const section = raw.section ?? null;
  if (section !== null && (typeof section !== "string" || !SECTIONS.has(section))) {
    return Response.json(
      { error: "That section can't take a note.", detail: "section_invalid" },
      { status: 400 },
    );
  }
  try {
    return Response.json(await contribute(token, {
      intent_key: key, text, kind: kind as "fact" | "writing",
      ...(section !== null ? { section: section as ContributionSection } : {}),
    }),
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return forwardProductError(error);
  }
}

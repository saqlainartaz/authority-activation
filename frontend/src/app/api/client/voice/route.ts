// POST /api/client/voice -- one voice preview (Cycle 5 P5.2; spec 6; A13, A14;
// Ruling 68).
//
// Runs the `voice_preview` agent operation (`src/agent/voice/voice-preview.ts`)
// through the agent machinery the chat uses: the c4 profile, the agent loop,
// the metered driver, and `runMeteredOperation`'s reserve -> cap -> settle on
// the Writing meter. The reservation and the reads live under the preview id
// the browser minted (`/v1/voice/previews/{id}/...`), never under a chat
// session, and nothing is recorded in any conversation.
//
// **This route writes no guidance.** It has no writing-settings write in
// scope: it READS the client's one general guidance as input (D06), and answers
// with a sample and PROPOSED guidance. Saving is the card's explicit Save,
// through `/api/client/writing-settings` with `expected_revision`. (Compare and
// the fact screen's `removed_lines` were removed as over-engineered, 2026-10-08.)
//
// Under M1 there is no voice preview: the route answers 404 and the card is
// not shown.

import { NoClientSession, requireClientToken } from "@/lib/client-session";
import {
  expiredLinkResponse,
  forwardProductError,
  getMe,
  getWritingPerspectives,
  getWritingSetting,
  postVoiceBudget,
  readJsonObject,
  usesKnowledgeEngine,
} from "@/lib/product";

import { deterministicDriver } from "@/agent/lib/deterministic-driver";
import { anthropicC4Driver } from "@/agent/lib/loop";
import {
  runVoicePreview,
  type VoiceBase,
  type VoicePerspective,
  type VoicePreviewOutcome,
  type VoiceRequestKind,
} from "@/agent/voice/voice-preview";
import { GUIDANCE_LIMIT, guidanceLength } from "@/refined/guidance";

// As the agent route: above the loop's own deadline, so its honest stop is
// what the client sees rather than a platform kill.
export const maxDuration = 300;

const DETERMINISTIC = process.env.AUTHORITY_AGENT_DRIVER === "deterministic";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEYS = new Set(["preview_id", "perspective", "kind", "instruction", "base", "style_note"]);
const KINDS: readonly string[] = ["generate", "adjust"];

const GENERAL_VOICE_LABEL = "the client's general voice";

type VoiceRequest = {
  previewId: string;
  perspective: VoicePerspective;
  kind: VoiceRequestKind;
  instruction: string | null;
  base: VoiceBase | null;
  styleNote: string | null;
};

function refuse(message: string, status = 422): Response {
  return Response.json({ error: message }, { status });
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && Array.from(trimmed).length <= max ? trimmed : null;
}

/** The request, read KEY BY KEY. Anything else is refused, not ignored. */
function parse(raw: Record<string, unknown>): VoiceRequest | string {
  if (Object.keys(raw).some((key) => !KEYS.has(key))) return "A voice preview takes only its own fields.";
  if (typeof raw.preview_id !== "string" || !UUID_V4.test(raw.preview_id)) return "preview_id must be a UUIDv4.";
  if (typeof raw.kind !== "string" || !KINDS.includes(raw.kind)) return "kind must be generate or adjust.";
  const kind = raw.kind as VoiceRequestKind;

  const p = raw.perspective as Record<string, unknown> | undefined;
  let perspective: VoicePerspective;
  if (!p || typeof p !== "object") return "Choose a voice.";
  if (p.mode === "neutral" && p.author_id === undefined && p.brand_id === undefined) perspective = { mode: "neutral" };
  else if (p.mode === "personal" && typeof p.author_id === "string" && UUID.test(p.author_id) && p.brand_id === undefined) {
    perspective = { mode: "personal", authorId: p.author_id };
  } else if (p.mode === "brand" && typeof p.brand_id === "string" && UUID.test(p.brand_id) && p.author_id === undefined) {
    perspective = { mode: "brand", brandId: p.brand_id };
  } else return "Choose a voice.";

  let instruction: string | null = null;
  if (kind === "adjust") {
    instruction = text(raw.instruction, 1_000);
    if (instruction === null) return "Say what should change, in up to 1,000 characters.";
  } else if (raw.instruction !== undefined) return "Only an adjustment carries an instruction.";

  let base: VoiceBase | null = null;
  if (kind !== "generate") {
    const b = raw.base as Record<string, unknown> | undefined;
    const sample = text(b?.sample, 3_000);
    const guidance = typeof b?.proposed_guidance === "string" ? b.proposed_guidance.trim() : "";
    if (!b || typeof b !== "object" || sample === null || !guidance || guidanceLength(guidance) > GUIDANCE_LIMIT) {
      return "An adjustment needs the version it starts from.";
    }
    base = { sample, proposedGuidance: guidance };
  } else if (raw.base !== undefined) return "A new sample starts from nothing.";

  let styleNote: string | null = null;
  if (raw.style_note !== undefined && raw.style_note !== null && raw.style_note !== "") {
    styleNote = text(raw.style_note, 2_000);
    if (styleNote === null) return "A style description can be at most 2,000 characters.";
  }
  return { previewId: raw.preview_id, perspective, kind, instruction, base, styleNote };
}

function body(previewId: string, outcome: VoicePreviewOutcome) {
  switch (outcome.outcome) {
    case "preview":
      return {
        outcome: "preview",
        preview_id: previewId,
        sample: outcome.sample,
        proposed_guidance: outcome.proposedGuidance,
        starting_proposal: outcome.startingProposal,
        approaching: outcome.approaching,
      };
    case "refused":
      return { outcome: "refused", message: outcome.message, retry: outcome.retry };
    case "failed":
      return { outcome: "failed", message: outcome.message, retry: outcome.retry };
  }
}

export async function POST(request: Request) {
  let token: string;
  try {
    token = await requireClientToken();
  } catch (error) {
    if (error instanceof NoClientSession) return expiredLinkResponse();
    throw error;
  }

  const parsed = parse(await readJsonObject(request));
  if (typeof parsed === "string") return refuse(parsed);

  try {
    // ke only: the backend's one engine switch, read per request.
    if (!usesKnowledgeEngine(await getMe(token))) {
      return refuse("Voice previews aren't available for this account.", 404);
    }

    // Who the voice is, by its label: checked against the permitted set the
    // backend derives, never taken from the browser.
    let voiceLabel = GENERAL_VOICE_LABEL;
    if (parsed.perspective.mode !== "neutral") {
      const options = await getWritingPerspectives(token);
      const wanted = parsed.perspective.mode === "personal" ? parsed.perspective.authorId : parsed.perspective.brandId;
      const list = parsed.perspective.mode === "personal" ? options.authors : options.brands;
      const found = list.find((option) => option.ref.id === wanted);
      if (!found) return refuse("Choose a voice from the list.");
      voiceLabel = found.label;
    }

    // The input the preview and later writing share: the one general text (D06).
    const saved = await getWritingSetting(token);
    const effective = saved ? { text: saved.text } : null;

    const outcome = await runVoicePreview({
      token,
      previewId: parsed.previewId,
      perspective: parsed.perspective,
      voiceLabel,
      kind: parsed.kind,
      instruction: parsed.instruction,
      base: parsed.base,
      styleNote: parsed.styleNote,
      effective,
      driver: DETERMINISTIC ? deterministicDriver : anthropicC4Driver,
      post: (budget) => postVoiceBudget(token, parsed.previewId, budget),
    });
    return Response.json(body(parsed.previewId, outcome), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return forwardProductError(error);
  }
}

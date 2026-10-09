import "server-only";

import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import type { Driver, ToolSpec } from "@/agent/lib/driver";
import type { WriterPrices } from "@/agent/lib/pricing";
import { createExecutor } from "@/agent/lib/executor";
import { runMeteredOperation, type BudgetPost } from "@/agent/lib/metered-operation";
import { skillVersion, type SkillVersion } from "@/agent/lib/prompt-versions";
import { buildToolSpecs } from "@/agent/lib/tool-schemas";
import { runAgentTurn, type ToolExecutor, type TurnTrace } from "@/agent/lib/turn";
import { meterTurn } from "@/agent/lib/turn-settlement";
import { PROFILES } from "@/agent/profile";
import { escapeForBody, type ModelMessage } from "@/agent/transcript";
import { approachingCopy } from "@/lib/limit-refusal";
import { GUIDANCE_LIMIT, guidanceLength, normaliseGuidance } from "@/refined/guidance";

/**
 * `voice_preview`: one short generated sample in a chosen voice, and the
 * guidance that would produce it (Cycle 5, P5.2; spec 6; A13, A14; Ruling 68).
 *
 * **An agent operation on the c4 profile, not a chat turn.** It runs the same
 * loop (`runAgentTurn`), the same executor for `read_knowledge` (so reads are
 * rendered into the same append-only handle namespace), and the same metered
 * driver and reservation as a reply (`runMeteredOperation`): reserved on the
 * Writing meter before any call, capped by the reservation's bounds, settled
 * from the calls that ran. What it does NOT have is a chat session: the reads
 * go to the preview's own view and the reservation is keyed to the preview
 * (`/v1/voice/previews/{id}/...`), so a writing session's read cap and draft
 * basis never see it, and nothing is recorded in any conversation.
 *
 * **It writes nothing.** The only tool besides `read_knowledge` is
 * `propose_voice`, which is local: it hands the sample and the proposed
 * guidance back to this module. No writing-settings call exists on this path;
 * the only write of guidance is the card's explicit Save, through the P5.1
 * route with `expected_revision`.
 *
 * **Facts stay out of the guidance** by instruction: the model is told that
 * guidance is how to write, never facts about the client, and the client reads
 * and edits the proposal before any Save. (The code fact screen with Restore
 * and Compare were removed as over-engineered, 2026-10-08.)
 *
 * **The sample carries no knowledge handles.** The model reads material as
 * `[K1] <material ...>` and cites by habit; the client reads the sample as
 * written, so code strips the handle markers (`stripHandles`) and the trace
 * keeps which ones were cited.
 */

export type VoicePerspective =
  | { mode: "neutral" }
  | { mode: "personal"; authorId: string }
  | { mode: "brand"; brandId: string };

export type VoiceRequestKind = "generate" | "adjust";

/** The version an Adjust works from, as the card showed it. */
export type VoiceBase = { sample: string; proposedGuidance: string };

export type VoicePreviewInput = {
  token: string;
  /** The browser's UUIDv4 for this generation; reused only by its retries. */
  previewId: string;
  perspective: VoicePerspective;
  /** Who the voice is, as the client knows them: "your general voice", or a
   *  permitted author's or brand's label. Never an id. */
  voiceLabel: string;
  kind: VoiceRequestKind;
  /** The client's adjustment, for `adjust`. */
  instruction: string | null;
  base: VoiceBase | null;
  /** An optional sample the client wrote, or a description of the style
   *  they want (A13: offered when there are no examples). */
  styleNote: string | null;
  /** The client's one saved general guidance (D06), or null. */
  effective: { text: string } | null;
  /** The provider driver; metered here. */
  driver: Driver;
  /** Where this preview's reservation lives. */
  post: BudgetPost;
};

export type VoicePreviewOutcome =
  | {
      outcome: "preview";
      sample: string;
      proposedGuidance: string;
      /** A13: no saved guidance and no example or style description. */
      startingProposal: boolean;
      /** The writing budget's 80% notice, as the composer words it. */
      approaching: string | null;
    }
  /** Nothing ran. `retry: "same"` only when nothing was reserved either (a
   *  reserve refusal), so retrying under this id cannot share a hold; a
   *  fail-closed refusal reserved and released, so its id is spent. */
  | { outcome: "refused"; message: string; retry: "same" | "new" }
  /** Always `retry: "new"` (Ruling 69): this id's reservation exists, and one
   *  id is one reservation and one run. */
  | { outcome: "failed"; message: string; retry: "new" };

export const VOICE_FAILED_COPY = "I couldn't write a sample this time. Nothing was saved — try again.";
export const VOICE_LOST_COPY = "That sample was written, but its answer was lost. Generate again for a new one.";
export const VOICE_IN_PROGRESS_COPY = "That sample is still being written. Try again in a moment for a new one.";

/** The voice preview's own tool. Local: it reaches no backend. */
export const PROPOSE_VOICE = "propose_voice";

const proposeVoiceSchema = z.object({
  sample: z
    .string()
    .min(1)
    .max(3_000)
    .describe("One short example post in the requested voice: LinkedIn length or shorter"),
  proposed_guidance: z
    .string()
    .min(1)
    .max(6_000)
    .describe("The writing guidance that would produce this voice, at most 2,000 characters. How to write only: never facts about the client"),
});

const PROPOSE_VOICE_SPEC: ToolSpec = {
  name: PROPOSE_VOICE,
  description:
    "Return the voice preview: the sample and the proposed guidance. Call it once, after reading. " +
    "Nothing is saved: the client reads the sample and decides.",
  inputSchema: z.toJSONSchema(proposeVoiceSchema) as Record<string, unknown>,
};

/** The c4 profile this operation runs on: its skill and contract. */
const VOICE_PROFILE = PROFILES["linkedin-c4"];

let promptFile: string | null = null;
let skillFile: string | null = null;

/** The voice prompt (frontmatter stripped) and the c4 skill, read once. */
function promptAndSkill(): { prompt: string; skill: string; versions: SkillVersion[] } {
  if (promptFile === null) {
    promptFile = fs.readFileSync(path.join(process.cwd(), "src/agent/prompts/voice-preview.md"), "utf8");
  }
  if (skillFile === null) {
    skillFile = fs.readFileSync(path.join(process.cwd(), "src/agent/skills", VOICE_PROFILE.skill, "SKILL.md"), "utf8");
  }
  const versions = [skillVersion("voice-preview", promptFile), skillVersion(VOICE_PROFILE.skill, skillFile)].filter(
    (entry): entry is SkillVersion => entry !== null,
  );
  return { prompt: promptFile.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim(), skill: skillFile, versions };
}

/** The voice request, as the model reads it. Everything client- or
 *  model-written is escaped, so it cannot forge a tag. */
export function voiceRequestMessage(input: Pick<
  VoicePreviewInput,
  "perspective" | "voiceLabel" | "kind" | "instruction" | "base" | "styleNote" | "effective"
>): ModelMessage {
  const voice = input.perspective.mode === "personal" ? "person" : input.perspective.mode === "brand" ? "brand" : "general";
  const parts = [
    `<voice-request kind="${input.kind}" voice="${voice}">`,
    `<voice-name>${escapeForBody(input.voiceLabel)}</voice-name>`,
    input.effective
      ? `<saved-guidance>\n${escapeForBody(input.effective.text)}\n</saved-guidance>`
      : "<saved-guidance>none</saved-guidance>",
  ];
  if (input.styleNote) parts.push(`<client-style>\n${escapeForBody(input.styleNote)}\n</client-style>`);
  if (input.base) {
    parts.push(
      `<base-version>\n<sample>\n${escapeForBody(input.base.sample)}\n</sample>\n` +
        `<guidance>\n${escapeForBody(input.base.proposedGuidance)}\n</guidance>\n</base-version>`,
    );
  }
  if (input.instruction) parts.push(`<client-instruction>${escapeForBody(input.instruction)}</client-instruction>`);
  parts.push("</voice-request>");
  return { role: "user", content: parts.join("\n") };
}

/** Wrap the metered driver so the operation ends the moment the proposal is
 *  in hand: no closing model call is made (and none is paid for) just to say
 *  so. The stand-in pass reaches no provider and is not metered. */
function endingAfter(driver: Driver, done: () => boolean, onStandIn: () => void = () => {}): Driver {
  return {
    toProviderTools: driver.toProviderTools,
    async runTurn(request) {
      if (done()) {
        onStandIn();
        return {
          text: "",
          toolCalls: [],
          stopReason: "end_turn",
          usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
        };
      }
      return driver.runTurn(request);
    },
  };
}

/** Sizes of the proposal, for the trace. Never words. */
type Screening = {
  sampleChars: number;
  guidanceChars: number;
  /** The knowledge handles the model cited in the sample, stripped from it. */
  sampleHandles: string[];
};

// A knowledge, draft or task-material handle as the model cites it: "[K4]",
// "[D1]", "[TA2]", or several in one bracket ("[K1, K2]").
const HANDLE_MARKER = /\[(?:K|D|TA)\d+(?:\s*,\s*(?:K|D|TA)\d+)*\]/g;
// A marker that opens a line takes the spaces after it; any other takes the
// spaces before it ("rehab [K1]." -> "rehab."). Line breaks are kept.
const LINE_START_MARKER = /^[ \t]*\[(?:K|D|TA)\d+(?:\s*,\s*(?:K|D|TA)\d+)*\][ \t]*/gm;
const INLINE_MARKER = /[ \t]*\[(?:K|D|TA)\d+(?:\s*,\s*(?:K|D|TA)\d+)*\]/g;

/** The sample without handle markers, and the handles it cited (P5 milestone
 *  review I-3). Code, not a prompt hope: the client sees the sample as is. */
function stripHandles(sample: string): { text: string; handles: string[] } {
  const handles = [...sample.matchAll(HANDLE_MARKER)].flatMap((match) => match[0].match(/(?:K|D|TA)\d+/g) ?? []);
  return { text: sample.replace(LINE_START_MARKER, "").replace(INLINE_MARKER, "").trim(), handles };
}

/** Run one voice preview, metered, and return what the card shows. */
export async function runVoicePreview(input: VoicePreviewInput): Promise<VoicePreviewOutcome> {
  const { prompt, skill, versions } = promptAndSkill();
  let prices: WriterPrices | undefined;
  const meter = meterTurn(input.driver, undefined, () => prices);

  // A reserve whose id already names a reservation is a 409 (Rulings 69,
  // 70): `turn_in_progress` while that run may still be going, otherwise the
  // earlier attempt already ran. Either way this id is spent.
  let earlier: "in_progress" | "finished" | null = null;
  const post: BudgetPost = async (body) => {
    try {
      return await input.post(body);
    } catch (error) {
      const failure = error as { status?: unknown; body?: { detail?: { code?: unknown } } };
      if (body.action === "reserve" && failure?.status === 409) {
        earlier = failure.body?.detail?.code === "turn_in_progress" ? "in_progress" : "finished";
      }
      throw error;
    }
  };

  let outcome: VoicePreviewOutcome = { outcome: "failed", message: VOICE_FAILED_COPY, retry: "new" };
  // What the run did, for the one trace line below: sizes, codes and the
  // loop's own trace (tools, passes, tokens, cache), never any words.
  let trace: TurnTrace | null = null;
  // The stand-in pass that ends the loop is not a model call; the trace
  // leaves it out so its pass count is the calls that were made.
  let standIns = 0;
  let screening: Screening | null = null;
  await runMeteredOperation({
    post,
    meter,
    onReserved: (reservation) => {
      prices = reservation.bounds?.prices;
    },
    onRefused: (message, stage) => {
      if (earlier !== null) {
        outcome = { outcome: "failed", message: earlier === "in_progress" ? VOICE_IN_PROGRESS_COPY : VOICE_LOST_COPY, retry: "new" };
      } else {
        outcome = { outcome: "refused", message, retry: stage === "reserve" ? "same" : "new" };
      }
    },
    run: async (reservation) => {
      let proposal: z.infer<typeof proposeVoiceSchema> | null = null;
      const { executor: knowledge } = createExecutor({
        sessionId: input.previewId,
        turnId: input.previewId,
        token: input.token,
        getUsage: () => meter.usage(),
        skillVersions: versions,
        contract: VOICE_PROFILE.contract,
        readTarget: { kind: "voice_preview", previewId: input.previewId },
      });
      const executor: ToolExecutor = async (name, args) => {
        if (name === "read_knowledge") return knowledge(name, args);
        if (name !== PROPOSE_VOICE) return { kind: "failed", reason: `unknown tool ${name}`, reachedPython: false };
        const parsed = proposeVoiceSchema.safeParse(args);
        if (!parsed.success) {
          return { kind: "rejected", reason: `invalid arguments for ${name}: ${parsed.error.message}`, reachedPython: false };
        }
        const length = guidanceLength(normaliseGuidance(parsed.data.proposed_guidance));
        if (length > GUIDANCE_LIMIT) {
          return {
            kind: "rejected",
            reason: `proposed_guidance is ${length} characters; the limit is ${GUIDANCE_LIMIT}. Shorten it and call ${name} again.`,
            reachedPython: false,
          };
        }
        proposal = parsed.data;
        return { kind: "ok", result: { accepted: true } };
      };

      try {
        const turn = await runAgentTurn({
          driver: endingAfter(meter.driver, () => proposal !== null, () => { standIns += 1; }),
          executor,
          tools: [...buildToolSpecs(["read_knowledge"], VOICE_PROFILE.contract), PROPOSE_VOICE_SPEC],
          system: [
            { text: prompt, cache: false },
            { text: skill, cache: true },
          ],
          messages: [voiceRequestMessage(input)],
          // The reservation's cap and per-call bound, as for a reply; a
          // preview needs a read or two and one proposal, so fewer tool calls.
          limits: { ...reservation.bounds.limits, maxToolCalls: 4 },
          prices: reservation.bounds.prices,
        });
        trace = turn.trace;
      } catch {
        return; // `outcome` stays failed; the reservation settles from what ran.
      }
      const proposed = proposal as z.infer<typeof proposeVoiceSchema> | null;
      if (proposed === null) return;

      const sample = stripHandles(proposed.sample);
      const guidance = normaliseGuidance(proposed.proposed_guidance);
      screening = {
        sampleChars: sample.text.length,
        guidanceChars: guidance.length,
        sampleHandles: sample.handles,
      };
      if (!guidance || !sample.text) return;
      outcome = {
        outcome: "preview",
        sample: sample.text,
        proposedGuidance: guidance,
        startingProposal: input.effective === null && !input.styleNote,
        approaching: reservation.approaching
          ? approachingCopy(reservation.approaching.resetsAt, reservation.approaching.meter)
          : null,
      };
    },
  });
  // Assigned inside the operation's callbacks, which control-flow analysis
  // does not follow: read back at their declared types.
  const final = outcome as VoicePreviewOutcome;
  const ran = trace as TurnTrace | null;
  const screened = screening as Screening | null;
  // ONE line per preview, like the chat's `[agent.turn]` (review M-2), so the
  // paid evaluation (P5.4) and cost reconciliation can see what each run did.
  console.info(
    "[agent.voice]",
    JSON.stringify({
      operation: "voice_preview",
      kind: input.kind,
      voice: input.perspective.mode,
      savedGuidance: input.effective !== null,
      styleNote: input.styleNote !== null,
      outcome: final.outcome,
      ...(final.outcome === "preview" ? {} : { retry: final.retry }),
      ...(screened ?? {}),
      ...(ran ? { ...ran, passes: ran.passes.slice(0, ran.passes.length - standIns) } : {}),
    }),
  );
  return final;
}

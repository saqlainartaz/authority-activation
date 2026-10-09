import "server-only";

import type {
  GuidelineV2,
  MaterialV1,
  SelectedDraftV2,
  SourceLabelV2,
  TaskFactV2,
} from "@/agent/contracts/context";
import type { SystemBlock } from "@/agent/lib/driver";
import { renderMaterial, type HandleMap } from "@/agent/render";
import { escapeForAttribute, escapeForBody, type ModelMessage } from "@/agent/transcript";

/**
 * §4.8's context ordering and §5.8's two cache breakpoints.
 *
 *   instructions -> skill -> material -> transcript -> turn context -> current turn
 *   |___________ stable across turns ___________|   |__ varies __|
 *
 * PURE, AND SEPARATE FROM `loop.ts` ON PURPOSE. Ordering is a correctness
 * property with its own failure mode — get it wrong and nothing errors, the
 * cache simply never hits and the bill quietly doubles — so it earns tests that
 * do not need a provider.
 */

/** Breakpoint 1. Instructions and skill are byte-identical for every client
 *  (neither file contains client data — `tests/agent/skill.test.ts` pins that),
 *  so this prefix caches ACROSS clients, not merely across passes of one turn. */
export function buildSystemBlocks(instructions: string, skill: string): SystemBlock[] {
  return [
    { text: instructions, cache: false },
    { text: skill, cache: true },
  ];
}

/**
 * Breakpoint 2 sits at the end of the material block: stable for the whole turn
 * INCLUDING §5.5's correction retry, which reuses the same snapshot. That retry
 * is the second-cheapest cache hit in the system and it comes free from putting
 * the boundary here rather than after the transcript.
 */

/**
 * The current turn's `<client-message>`, with the server's handle when there
 * is one.
 *
 * Shared by both contracts so the current turn and a replayed prior turn
 * render identically. Two spellings would eventually differ in the one
 * attribute a model is told to copy.
 */
function renderClientMessage(body: string, handle: string | null): string {
  const attribute = handle ? ` handle="${escapeForAttribute(handle)}"` : "";
  return `<client-message${attribute}>${escapeForBody(body)}</client-message>`;
}

export function buildTurnMessages(
  material: MaterialV1[],
  transcript: ModelMessage[],
  clientMessage: string,
  turnContext: ModelMessage[] = [],
  clientMessageHandle: string | null = null,
  // Main's whole-client source context (merged 2026-09-25): placed first, so
  // it is the most stable prefix of the conversation.
  sourceContext: ModelMessage[] = [],
): { messages: ModelMessage[]; handles: HandleMap; cacheThrough: number | null } {
  const { text, handles } = renderMaterial(material);

  const messages: ModelMessage[] = [
    ...sourceContext,
    { role: "user", content: `<material-set>\n${text}\n</material-set>` },
    ...transcript,
    ...turnContext,
    // See transcript.ts:36-40 for why this escaping matters: client bodies can forge tag boundaries.
    { role: "user", content: renderClientMessage(clientMessage, clientMessageHandle) },
  ];

  // The last message of the earlier conversation: the end of the part that
  // is identical from one turn to the next, and so the prompt-cache boundary
  // that pays across turns. The source context comes first, then the material
  // set, then the earlier conversation. `null` when there is no earlier
  // conversation to cache.
  const cacheThrough = transcript.length > 0 ? sourceContext.length + transcript.length : null;
  return { messages, handles, cacheThrough };
}

/**
 * The `<selected-draft>` block: the exact body being revised.
 *
 * Escaped with the same `escapeForBody` every client-supplied string goes
 * through. A draft body is the client's own text and can forge a tag boundary
 * just as a chat message can — and unlike a chat message, this one was
 * previously written by a model, which makes an injected `</selected-draft>`
 * a realistic rather than theoretical shape.
 *
 * `version` travels with the body so the model can say which version it
 * edited, and so a later submission's compare-and-set has something to quote.
 */
export function buildSelectedDraftBlock(
  draft: SelectedDraftV2,
  handle: string,
): ModelMessage {
  // **THE HANDLE, NEVER THE VARIANT ID.** This used to render
  // `variant="<the raw uuid>"` straight into the prompt, under a cycle whose
  // whole premise is that no identifier reaches a model. It survived two
  // independent reviews because the demonstration's identifier scan read the
  // SSE stream rather than the prompt; the first run that scanned what the
  // model was actually handed found it immediately. The caller mints the
  // handle and keeps the mapping, exactly as `renderMaterial` and
  // `buildDraftPayload` do for atom ids: the id is injected by the runtime,
  // and the model merely points at something it was shown.
  const open =
    `<selected-draft handle="${escapeForBody(handle)}"` +
    ` version="${draft.version_no}">`;
  return {
    role: "user",
    content: `${open}\n${escapeForBody(draft.body)}\n</selected-draft>${citationsBlock(draft, handle)}`,
  };
}

/**
 * What the draft cited, so a revision can keep its support.
 *
 * The model sees the transcript, not earlier turns' tool results, so without
 * this a revise turn held the draft's words and none of the handles behind
 * them. It could drop every citation or guess one. The server lists only the
 * citations the session's view still binds to the same material.
 *
 * **Data only.** How to keep one -- re-read a K/E/C handle with inspect; a
 * TA handle is already bound -- is in the `read_knowledge` and
 * `prepare_generation` descriptions, not here: this block reaches the model
 * inside a tool result, where an instruction is treated as untrusted.
 *
 * Outside `<selected-draft>` on purpose: inside it, a citation would read as
 * part of the body being revised.
 */
function citationsBlock(draft: SelectedDraftV2, handle: string): string {
  const citations = draft.citations ?? [];
  if (citations.length === 0) return "";
  const lines = citations.map(
    (citation) =>
      `  <citation handle="${escapeForAttribute(citation.handle)}">` +
      `${escapeForBody(citation.claim_text)}</citation>`,
  );
  return `\n<draft-citations draft="${escapeForAttribute(handle)}">\n${lines.join("\n")}\n</draft-citations>`;
}

/**
 * The `<task-facts>` block: what the client confirmed for this piece, citable.
 *
 * The client's own words, so escaped like every client string. Each carries
 * its `TA{n}` handle, which the executor has bound for the turn from the same
 * set the basis will record.
 */
export function buildTaskFactsBlock(facts: TaskFactV2[]): ModelMessage {
  const lines = facts.map(
    (fact) => `  <fact handle="${escapeForAttribute(fact.handle)}">${escapeForBody(fact.text)}</fact>`,
  );
  return {
    role: "user",
    // Data only: how to cite these is in the prepare_generation description.
    content: `<task-facts>\n${lines.join("\n")}\n</task-facts>`,
  };
}

/**
 * The `<sources>` block: what the material came from, and whether it is ready.
 *
 * Labels only. There is no id and no locator to render, because `context.v2`
 * does not carry one — handing the model a locator invites "as I said at
 * 14:32" in the body, a fabrication no grounding check catches because it is
 * prose rather than a citation.
 *
 * A `pending` or `failed` source is still listed. Omitting it would make a
 * source the client knows they uploaded look like one that does not exist,
 * which is the difference between "still processing" and "absent" that D7
 * requires be kept distinct.
 */
export function buildSourcesBlock(sources: SourceLabelV2[]): ModelMessage {
  const lines = sources
    .map(
      (source) =>
        `  <source status="${source.processing}">` +
        `${escapeForBody(source.label)}</source>`,
    )
    .join("\n");
  return { role: "user", content: `<sources>\n${lines}\n</sources>` };
}

/**
 * The `<guideline>` block: the one saved writing default for this voice.
 *
 * **Placed after material, and the position carries meaning.** Material is
 * what the post may say; a guideline is how the client wants it said. Putting
 * guidance before the facts it dresses would read as a constraint on what is
 * true rather than on how to phrase it.
 *
 * **Precedence travels as DATA here; the rule lives in the instructions.**
 * Contracts §4 fixes the order: security and authorized-use constraints
 * first, then the current task's directions, then scoped saved defaults, then
 * inferred voice. The block used to carry that rule as a sentence, but this
 * block reaches the model inside a tool result, and Claude is trained to
 * treat instructions inside tool results as possibly untrusted -- so an
 * instruction here is the weakest place for the one rule C4-15 turns on ("say
 * clients this once" must win over a saved "members, not clients" without
 * changing the setting). The rule is in `instructions.md`'s guideline
 * section, and a test fails if that section is ever dropped, which was the
 * reason the sentence was put here in the first place.
 *
 * **Escaped like every other client-supplied string.** A guideline is text a
 * client typed, and it can forge a tag boundary as readily as a chat message.
 *
 * **`revision` and `digest` travel with it** so a retained draft can pin
 * which text it was written under. §4 requires receipts to disclose a replay
 * limitation when text is purged rather than invent the old instruction, and
 * that disclosure needs the digest to have been recorded at the time.
 */
export function buildGuidelineBlock(guideline: GuidelineV2): ModelMessage {
  // **The revision, NOT the digest.** §2.1 keeps internal digests out of a
  // prompt: they are "omitted, not echoed as labels", and a sha256 rendered
  // as an attribute is an identifier the model can repeat into a body. The
  // digest still travels to the basis, where a receipt can pin exactly which
  // text a retained draft was written under — which is the only place §4
  // needs it.
  const open =
    `<guideline revision="${guideline.revision}" precedence="${escapeForAttribute(guideline.precedence)}">`;
  return {
    role: "user",
    content: `${open}\n${escapeForBody(guideline.text)}\n</guideline>`,
  };
}

/**
 * **`buildTurnMessagesV2` was here, and it is deliberately gone.**
 *
 * It rendered material, sources, the guideline and the selected draft into
 * the TURN MESSAGES, which assumes context is known before the model speaks.
 * It is not: under both contracts the model calls `prepare_generation` and
 * the context arrives in a tool RESULT. So nothing could ever call this
 * without re-architecting the turn, and for two tasks nothing did — it had
 * six test references and zero production ones, which is what the
 * reachability scan reports.
 *
 * The three block builders above survive because the executor renders them
 * into the tool result, where the model actually reads them. Keeping a
 * fourth function that only tests could reach would have left the suite
 * looking like it covered an assembly path the product does not have.
 */

/**
 * Today, in the client's own zone: `<today zone="Europe/London" date="2026-09-25">`.
 *
 * **The agent could not resolve "next Friday".** Asked to schedule a post for
 * "next Friday at 9am", it answered -- rightly, given what it could see -- that
 * it could not see today's date (first paid evaluation run, 2026-09-25). A
 * scheduling agent needs the client's calendar date; the zone is the client's
 * configured one, the same column the server stamps on every slot. Data only:
 * the block states a fact and instructs nothing.
 */
export function todayMessage(now: Date, zone: string): ModelMessage {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    role: "user",
    content: `<today zone="${escapeForBody(zone)}" date="${date}" weekday="${parts.weekday}" time="${parts.hour}:${parts.minute}"></today>`,
  };
}

// The voice card: preview a voice, then save the guidance only when the client
// says so (Cycle 5 P5.3; spec 6; A13, A14, A16; Ruling 68).
//
// Flow: choose a voice -> generate a sample -> Use this voice (or Adjust) ->
// the card shows the guidance that will be saved, editable -> Save. The sample
// is generated and never saved. NOTHING here writes guidance except the Save
// button, through the same P5.1 route and compare-and-set version as the
// Guidance tab. There is ONE general guidance text (D06): whichever voice the
// sample is written in, Save replaces the general text.
//
// Compare (A / B / Both / Neither and notes), the fact screen with Restore, and
// separate guidance per voice were removed as over-engineered, 2026-10-08
// (operator decision, docs/DECISIONS.md).
//
// Browser-safe and free of React, so the flow can be tested directly.

import type { GuidanceResult, SavedGuidance } from './guidance';

export const SAMPLE_LABEL = 'Example written by AI — not saved';
export const STARTING_PROPOSAL_COPY = 'Starting proposal';
export const STARTING_PROPOSAL_NOTE = 'There is no saved guidance or example to learn from yet, so this is a starting point to react to.';
export const GENERAL_VOICE_LABEL = 'General (all your writing)';
export const SAVED_COPY = 'Saved. All your writing will use this.';

/** Who a sample is written as. The guidance saved is always the general text. */
export type VoicePerspective =
  | { mode: 'neutral' }
  | { mode: 'personal'; authorId: string }
  | { mode: 'brand'; brandId: string };

/** One voice the client may choose for a sample. */
export type VoiceOption = { key: string; label: string; perspective: VoicePerspective };

export const GENERAL_VOICE: VoiceOption = { key: 'general', label: GENERAL_VOICE_LABEL, perspective: { mode: 'neutral' } };

/** One generated version: what the card shows and what Save would start from. */
export type VoiceVersion = {
  previewId: string;
  sample: string;
  proposedGuidance: string;
  startingProposal: boolean;
};

export type VoiceKind = 'generate' | 'adjust';

/** A generation in flight, or the last one, kept so Try again can repeat it.
 *  Ruling 69: one preview id is one reservation and one run, so a retry
 *  reuses the id ONLY after a reserve refusal (nothing was reserved); every
 *  other retry is a new attempt under a new id (`retryWith`). */
export type PendingRequest = {
  previewId: string;
  kind: VoiceKind;
  instruction: string | null;
  base: VoiceVersion | null;
};

export type VoiceCard = {
  voice: VoiceOption;
  styleNote: string;
  /** The sample shown, or null before the first one. */
  version: VoiceVersion | null;
  pending: PendingRequest | null;
  /** Whether Try again may reuse `pending`'s preview id. */
  retryWith: 'same' | 'new';
  busy: boolean;
  adjusting: boolean;
  instruction: string;
  /** The guidance that will be saved, as the client edits it. Null until the
   *  client uses a version or adjusts one. */
  guidanceDraft: string | null;
  message: string | null;
  approaching: string | null;
  /** The general saved setting: the version Save compares against (A16). */
  base: SavedGuidance | null;
  baseStatus: 'loading' | 'ready' | 'error';
  stale: boolean;
  saving: boolean;
  /** The text just saved, for "what future writing will remember". */
  savedText: string | null;
};

export function initialCard(voice: VoiceOption = GENERAL_VOICE, base: SavedGuidance | null = null, baseReady = true): VoiceCard {
  return {
    voice, styleNote: '', version: null, pending: null, retryWith: 'new', busy: false, adjusting: false, instruction: '',
    guidanceDraft: null, message: null, approaching: null,
    base, baseStatus: baseReady ? 'ready' : 'loading', stale: false, saving: false, savedText: null,
  };
}

export type VoiceAction =
  | { type: 'choose'; voice: VoiceOption }
  | { type: 'base-loaded'; base: SavedGuidance | null }
  | { type: 'base-failed'; message: string }
  | { type: 'style'; text: string }
  | { type: 'request'; pending: PendingRequest }
  | { type: 'preview'; version: VoiceVersion; approaching: string | null }
  | { type: 'refused'; message: string; retry: 'same' | 'new' }
  | { type: 'failed'; message: string }
  | { type: 'use'; version: VoiceVersion }
  | { type: 'adjust-open' }
  | { type: 'adjust-text'; text: string }
  | { type: 'adjust-cancel' }
  | { type: 'edit-guidance'; text: string }
  | { type: 'saving' }
  | { type: 'saved'; result: GuidanceResult }
  | { type: 'reset' };

export function voiceReducer(state: VoiceCard, action: VoiceAction): VoiceCard {
  switch (action.type) {
    case 'choose':
      // A new voice starts a new sample; the saved general guidance stays.
      return action.voice.key === state.voice.key
        ? state
        : initialCard(action.voice, state.base, state.baseStatus === 'ready');
    case 'base-loaded':
      return { ...state, base: action.base, baseStatus: 'ready', stale: false };
    case 'base-failed':
      return { ...state, baseStatus: 'error', message: action.message };
    case 'style':
      return { ...state, styleNote: action.text };
    case 'request':
      return { ...state, busy: true, pending: action.pending, message: null, savedText: null };
    case 'preview': {
      // An answer for a generation this card no longer waits for (the voice
      // was changed or the card reset meanwhile) is dropped.
      if (state.pending?.previewId !== action.version.previewId) return state;
      const kind = state.pending.kind;
      const common = { busy: false, pending: null, approaching: action.approaching, message: null, adjusting: false, instruction: '' };
      // A14: an adjusted version's guidance appears BEFORE any save.
      return { ...state, ...common, version: action.version, guidanceDraft: kind === 'adjust' ? action.version.proposedGuidance : null };
    }
    case 'refused':
      // Nothing ran. Only a reserve refusal (nothing held) may retry under its id.
      return { ...state, busy: false, message: action.message, retryWith: action.retry };
    case 'failed':
      // Something may have run, or may still be running: a retry is a new
      // attempt with a new id, its own reservation and its own settlement.
      return { ...state, busy: false, message: action.message, retryWith: 'new' };
    case 'use':
      // Using a version shows its guidance to edit. It does NOT save.
      return { ...state, version: action.version, guidanceDraft: action.version.proposedGuidance, message: null, savedText: null };
    case 'adjust-open':
      return { ...state, adjusting: true, message: null };
    case 'adjust-text':
      return { ...state, instruction: action.text };
    case 'adjust-cancel':
      return { ...state, adjusting: false, instruction: '' };
    case 'edit-guidance':
      return { ...state, guidanceDraft: action.text, savedText: null };
    case 'saving':
      return { ...state, saving: true, message: null };
    case 'saved': {
      const { result } = action;
      if (result.kind === 'saved') return { ...state, saving: false, stale: false, base: result.saved, savedText: result.saved?.text ?? null };
      if (result.kind === 'stale') return { ...state, saving: false, stale: true };
      if (result.kind === 'error') return { ...state, saving: false, message: result.message };
      return { ...state, saving: false };
    }
    case 'reset':
      return initialCard(state.voice, state.base, state.baseStatus === 'ready');
  }
}

// ---------------------------------------------------------------------------
// The wire.
// ---------------------------------------------------------------------------

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
const browserFetch: Fetcher = (input, init) => fetch(input, init);

/** General, then each permitted author and brand. A failed read offers General only. */
export async function loadVoiceOptions(fetcher: Fetcher = browserFetch): Promise<VoiceOption[]> {
  try {
    const response = await fetcher('/api/client/writing-perspectives', { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok) return [GENERAL_VOICE];
    const body = await response.json() as { authors?: unknown; brands?: unknown };
    const rows = (value: unknown) => (Array.isArray(value) ? value : []).filter(
      (row): row is { ref: { id: string }; label: string } =>
        typeof row?.label === 'string' && typeof row?.ref?.id === 'string',
    );
    return [
      GENERAL_VOICE,
      ...rows(body.authors).map(row => ({ key: `personal:${row.ref.id}`, label: `${row.label} (as yourself)`, perspective: { mode: 'personal', authorId: row.ref.id } as const })),
      ...rows(body.brands).map(row => ({ key: `brand:${row.ref.id}`, label: `${row.label} (as the brand)`, perspective: { mode: 'brand', brandId: row.ref.id } as const })),
    ];
  } catch {
    return [GENERAL_VOICE];
  }
}

/** A fresh id for every attempt; reused only to retry a reserve refusal. */
export function newPreviewId(): string {
  return crypto.randomUUID();
}

/** The BFF body for one generation. */
export function voiceBody(voice: VoiceOption, request: PendingRequest, styleNote: string) {
  const perspective = voice.perspective.mode === 'personal'
    ? { mode: 'personal', author_id: voice.perspective.authorId }
    : voice.perspective.mode === 'brand'
      ? { mode: 'brand', brand_id: voice.perspective.brandId }
      : { mode: 'neutral' };
  const note = styleNote.trim();
  return {
    preview_id: request.previewId,
    perspective,
    kind: request.kind,
    ...(request.kind === 'adjust' ? { instruction: request.instruction ?? '' } : {}),
    ...(request.base ? { base: { sample: request.base.sample, proposed_guidance: request.base.proposedGuidance } } : {}),
    ...(note ? { style_note: note } : {}),
  };
}

export type VoiceResult =
  | { kind: 'preview'; version: VoiceVersion; approaching: string | null }
  | { kind: 'refused'; message: string; retry: 'same' | 'new' }
  | { kind: 'failed'; message: string }
  | { kind: 'signed-out' };

const FAILED = 'The sample could not be written. Nothing was saved — try again.';

/** Ask for one generation. Any failure -- network, timeout, 5xx -- may have
 *  left a run going under this id, so it is never retried under it (Ruling 69). */
export async function requestVoice(voice: VoiceOption, request: PendingRequest, styleNote: string, fetcher: Fetcher = browserFetch): Promise<VoiceResult> {
  let response: Response;
  try {
    response = await fetcher('/api/client/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(voiceBody(voice, request, styleNote)),
    });
  } catch {
    return { kind: 'failed', message: FAILED };
  }
  const body = await response.json().catch(() => undefined) as Record<string, unknown> | undefined;
  if (response.status === 401) return { kind: 'signed-out' };
  if (!response.ok || !body) {
    const error = typeof body?.error === 'string' && body.error.trim() ? body.error : FAILED;
    return { kind: 'failed', message: error };
  }
  if (body.outcome === 'refused' && typeof body.message === 'string') {
    // `same` only when the server says nothing was reserved.
    return { kind: 'refused', message: body.message, retry: body.retry === 'same' ? 'same' : 'new' };
  }
  if (body.outcome === 'failed' && typeof body.message === 'string') return { kind: 'failed', message: body.message };
  if (
    body.outcome === 'preview' && typeof body.sample === 'string' && typeof body.proposed_guidance === 'string'
    && body.preview_id === request.previewId
  ) {
    return {
      kind: 'preview',
      version: {
        previewId: request.previewId,
        sample: body.sample,
        proposedGuidance: body.proposed_guidance,
        startingProposal: body.starting_proposal === true,
      },
      approaching: typeof body.approaching === 'string' ? body.approaching : null,
    };
  }
  return { kind: 'failed', message: FAILED };
}

// ---------------------------------------------------------------------------
// The card's actions, outside React so the flow is testable end to end: a
// store (the reducer's state and dispatch) and the wire. `save` is the only
// action that can write guidance, from the Save button; every other action
// reads, generates or edits the local draft.
// ---------------------------------------------------------------------------

export type VoiceStore = { get: () => VoiceCard; dispatch: (action: VoiceAction) => void };

export type VoiceDeps = {
  fetcher?: Fetcher;
  /** The general guidance saves and reloads through the Guidance tab's own
   *  server state, so the tab shows what the card saved. */
  saveGeneral: (draft: string, base: SavedGuidance | null) => Promise<GuidanceResult>;
  reloadGeneral: () => Promise<GuidanceResult>;
  newId?: () => string;
  onSignedOut: () => void;
  onSaved?: () => void;
};

export function voiceController(store: VoiceStore, deps: VoiceDeps) {
  const fetcher = deps.fetcher ?? browserFetch;
  const mint = deps.newId ?? newPreviewId;

  const send = async (pending: PendingRequest) => {
    const state = store.get();
    store.dispatch({ type: 'request', pending });
    const result = await requestVoice(state.voice, pending, state.styleNote, fetcher);
    if (result.kind === 'signed-out') deps.onSignedOut();
    else if (result.kind === 'preview') store.dispatch({ type: 'preview', version: result.version, approaching: result.approaching });
    else if (result.kind === 'refused') store.dispatch({ type: 'refused', message: result.message, retry: result.retry });
    else store.dispatch({ type: 'failed', message: result.message });
  };

  /** The version an Adjust works from, with any guidance edits. */
  const latest = (): VoiceVersion | null => {
    const { version, guidanceDraft } = store.get();
    return version && guidanceDraft !== null ? { ...version, proposedGuidance: guidanceDraft } : version;
  };

  return {
    choose: (voice: VoiceOption) => store.dispatch({ type: 'choose', voice }),
    style: (text: string) => store.dispatch({ type: 'style', text }),
    generate: () => send({ previewId: mint(), kind: 'generate', instruction: null, base: null }),
    async retry() {
      const { pending, retryWith } = store.get();
      if (!pending) return;
      // Ruling 69: the same id only after a reserve refusal; otherwise a new one.
      await send(retryWith === 'same' ? pending : { ...pending, previewId: mint() });
    },
    /** Shows the version's guidance to edit. Saves nothing. */
    use: (version: VoiceVersion) => store.dispatch({ type: 'use', version }),
    adjustOpen: () => store.dispatch({ type: 'adjust-open' }),
    adjustText: (text: string) => store.dispatch({ type: 'adjust-text', text }),
    adjustCancel: () => store.dispatch({ type: 'adjust-cancel' }),
    async adjust() {
      const base = latest();
      const instruction = store.get().instruction.trim();
      if (base && instruction) await send({ previewId: mint(), kind: 'adjust', instruction, base });
    },
    editGuidance: (text: string) => store.dispatch({ type: 'edit-guidance', text }),
    /** A WRITE, and only from the Save button: the one general guidance text. */
    async save() {
      const state = store.get();
      if (state.guidanceDraft === null) return;
      store.dispatch({ type: 'saving' });
      const result = await deps.saveGeneral(state.guidanceDraft, state.base);
      if (result.kind === 'signed-out') { deps.onSignedOut(); return; }
      store.dispatch({ type: 'saved', result });
      if (result.kind === 'saved') deps.onSaved?.();
    },
    async reload() {
      const result = await deps.reloadGeneral();
      if (result.kind === 'saved') store.dispatch({ type: 'base-loaded', base: result.saved });
      else if (result.kind === 'signed-out') deps.onSignedOut();
    },
    reset: () => store.dispatch({ type: 'reset' }),
  };
}

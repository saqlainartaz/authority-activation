// The client's saved writing guidance, as Train Your AI edits it (Cycle 5 P5.1;
// spec 6, D06, A13, A16).
//
// D06 (controller ruling 64): ONE editable text setting. Bullets are formatting
// inside the text, not separate switches, and the limit is the backend's own
// 2,000 characters (`src/product/api/writing_settings.py`). The text lives on
// the server, behind `/api/client/writing-settings`, so the voice preview and
// every later draft read the same saved text.
//
// Browser-safe and free of React, so the save rules can be tested directly.

export const GUIDANCE_LIMIT = 2_000;
export const NO_GUIDANCE_COPY = 'No writing guidance saved yet';
/** D06: what this tab edits, the one general text every voice uses. (Separate
 *  guidance per voice was removed as over-engineered, 2026-10-08.) */
export const GENERAL_GUIDANCE_COPY = 'General writing guidance — used for all your writing.';
export const STALE_GUIDANCE_COPY ='Your guidance was changed somewhere else. Reload to see the latest, then save again.';

/** The saved setting as the editor needs it: the version it read, and the text. */
export type SavedGuidance = { guidelineId: string; revision: number; text: string };

// ---------------------------------------------------------------------------
// Normalisation: what the backend's `visible` validator does, shown BEFORE save.
//
// The validator is `value.strip()`, and that is all it changes: inner blank
// lines, indentation and bullets are kept. Python's `str.strip()` removes the
// characters `str.isspace()` accepts, which is not quite JavaScript's `trim()`
// (Python also strips U+001C-U+001F and U+0085; it does NOT strip U+FEFF), so
// the set is spelled out here rather than borrowed from `trim()`.
//
// The length is counted in code points, like Python's `len()` and Pydantic's
// `max_length`, not in UTF-16 units: an emoji is one character to the backend.
// The editor sends the NORMALISED text, so the backend's length check and the
// count the client saw are of the same string.
// ---------------------------------------------------------------------------

const PYTHON_SPACE = '[\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const EDGE_SPACE = new RegExp(`^${PYTHON_SPACE}+|${PYTHON_SPACE}+$`, 'g');

export function normaliseGuidance(text: string): string {
  return text.replace(EDGE_SPACE, '');
}

export function guidanceLength(text: string): number {
  return Array.from(text).length;
}

export type GuidanceCheck = {
  /** Exactly what Save sends. */
  text: string;
  length: number;
  /** Characters over the limit; 0 when within it. */
  over: number;
  empty: boolean;
  /** The draft has blank space at its edges that saving will remove. */
  trimmed: boolean;
  ok: boolean;
};

export function checkGuidance(draft: string): GuidanceCheck {
  const text = normaliseGuidance(draft);
  const length = guidanceLength(text);
  const over = Math.max(0, length - GUIDANCE_LIMIT);
  const empty = length === 0;
  return { text, length, over, empty, trimmed: !empty && text !== draft, ok: !empty && over === 0 };
}

// ---------------------------------------------------------------------------
// The wire: `/api/client/writing-settings`.
// ---------------------------------------------------------------------------

export type GuidanceResult =
  | { kind: 'saved'; saved: SavedGuidance | null }
  | { kind: 'stale' }
  | { kind: 'signed-out' }
  | { kind: 'error'; message: string };

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
const browserFetch: Fetcher = (input, init) => fetch(input, init);
const ROUTE = '/api/client/writing-settings';

/** The setting from the wire, or `null` for "none saved". Throws on anything else. */
export function parseGuidance(body: unknown): SavedGuidance | null {
  if (body === null) return null;
  const record = body as { guideline_id?: unknown; revision?: unknown; text?: unknown } | undefined;
  if (
    !record || typeof record !== 'object'
    || typeof record.guideline_id !== 'string' || !record.guideline_id
    || typeof record.revision !== 'number' || !Number.isInteger(record.revision) || record.revision < 1
    || typeof record.text !== 'string'
  ) throw new Error('The saved guidance could not be read.');
  return { guidelineId: record.guideline_id, revision: record.revision, text: record.text };
}

/** The PUT body: the normalised text and the version this editor read. Both
 *  `expected_*` are `null` only when the editor read "none saved". */
export function putBody(text: string, base: SavedGuidance | null) {
  return {
    text,
    expected_revision: base ? base.revision : null,
    expected_guideline_id: base ? base.guidelineId : null,
  };
}

function isStale(status: number, body: unknown): boolean {
  const detail = (body as { detail?: { code?: unknown } } | null)?.detail;
  return status === 409 && detail?.code === 'stale_revision';
}

async function answer(response: Response, fallback: string, read: (body: unknown) => SavedGuidance | null): Promise<GuidanceResult> {
  const body: unknown = await response.json().catch(() => undefined);
  if (response.status === 401) return { kind: 'signed-out' };
  if (isStale(response.status, body)) return { kind: 'stale' };
  if (!response.ok) {
    const error = (body as { error?: unknown } | undefined)?.error;
    return { kind: 'error', message: typeof error === 'string' && error.trim() ? error : fallback };
  }
  try { return { kind: 'saved', saved: read(body) }; } catch (reason) {
    return { kind: 'error', message: reason instanceof Error ? reason.message : fallback };
  }
}

export async function loadGuidance(fetcher: Fetcher = browserFetch): Promise<GuidanceResult> {
  try {
    const response = await fetcher(ROUTE, { cache: 'no-store', headers: { Accept: 'application/json' } });
    return await answer(response, 'Your guidance could not be loaded.', parseGuidance);
  } catch { return { kind: 'error', message: 'Your guidance could not be loaded.' }; }
}

/** Save the draft over the version `base` names. Refused here, before any
 *  request, when the normalised text is empty or over the limit. */
export async function saveGuidance(
  draft: string,
  base: SavedGuidance | null,
  fetcher: Fetcher = browserFetch,
): Promise<GuidanceResult> {
  const check = checkGuidance(draft);
  if (check.empty) return { kind: 'error', message: 'Write some guidance before saving.' };
  if (check.over > 0) return { kind: 'error', message: `Guidance can be at most ${GUIDANCE_LIMIT.toLocaleString('en-GB')} characters.` };
  try {
    const response = await fetcher(ROUTE, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(putBody(check.text, base)),
    });
    return await answer(response, 'Your guidance was not saved.', body => {
      const saved = parseGuidance(body);
      if (!saved) throw new Error('Your guidance was not saved.');
      return saved;
    });
  } catch { return { kind: 'error', message: 'Your guidance was not saved.' }; }
}

/** Clear the version `base` names. A clear is compare-and-set like a save. */
export async function clearGuidance(
  base: SavedGuidance,
  fetcher: Fetcher = browserFetch,
): Promise<GuidanceResult> {
  const version = new URLSearchParams({ expected_revision: String(base.revision), expected_guideline_id: base.guidelineId });
  try {
    const response = await fetcher(`${ROUTE}?${version.toString()}`, { method: 'DELETE', headers: { Accept: 'application/json' } });
    return await answer(response, 'Your guidance was not cleared.', () => null);
  } catch { return { kind: 'error', message: 'Your guidance was not cleared.' }; }
}

// ---------------------------------------------------------------------------
// The editor. One rule above the rest: a server version arriving NEVER discards
// what the client typed. A stale save keeps the draft; a reload that brings a
// newer version keeps the unsaved draft beside it (`kept`).
// ---------------------------------------------------------------------------

export type GuidanceEditor = {
  status: 'loading' | 'ready' | 'error';
  /** The version this editor read; what Save and Clear compare against. */
  saved: SavedGuidance | null;
  draft: string;
  /** A save or clear was refused because the setting changed elsewhere. */
  stale: boolean;
  /** Typed text that a newer version replaced in the box, kept for the client. */
  kept: string | null;
  busy: boolean;
  error: string | null;
};

export const INITIAL_EDITOR: GuidanceEditor = { status: 'loading', saved: null, draft: '', stale: false, kept: null, busy: false, error: null };

export type GuidanceAction =
  | { type: 'loaded'; saved: SavedGuidance | null }
  | { type: 'load-failed'; message: string }
  | { type: 'edit'; draft: string }
  | { type: 'busy' }
  | { type: 'written'; result: GuidanceResult }
  | { type: 'use-kept' };

const sameVersion = (a: SavedGuidance | null, b: SavedGuidance | null) =>
  a === b || (a !== null && b !== null && a.guidelineId === b.guidelineId && a.revision === b.revision);

export function guidanceReducer(state: GuidanceEditor, action: GuidanceAction): GuidanceEditor {
  switch (action.type) {
    case 'loaded': {
      if (state.status === 'ready' && sameVersion(state.saved, action.saved)) return { ...state, stale: false, error: null };
      const dirty = state.draft !== (state.saved?.text ?? '') && normaliseGuidance(state.draft) !== '';
      return {
        ...state,
        status: 'ready',
        saved: action.saved,
        draft: action.saved?.text ?? '',
        stale: false,
        kept: dirty ? state.draft : state.kept,
        error: null,
      };
    }
    case 'load-failed':
      return { ...state, status: state.status === 'ready' ? 'ready' : 'error', busy: false, error: action.message };
    case 'edit':
      return { ...state, draft: action.draft, error: null };
    case 'busy':
      return { ...state, busy: true, error: null };
    case 'written': {
      const { result } = action;
      if (result.kind === 'saved') return { ...state, busy: false, saved: result.saved, draft: result.saved?.text ?? '', stale: false, error: null };
      if (result.kind === 'stale') return { ...state, busy: false, stale: true, error: null };
      if (result.kind === 'error') return { ...state, busy: false, error: result.message };
      return { ...state, busy: false };
    }
    case 'use-kept':
      return state.kept === null ? state : { ...state, draft: state.kept, kept: null, error: null };
  }
}

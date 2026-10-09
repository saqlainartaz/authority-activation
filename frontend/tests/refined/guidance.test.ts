import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GUIDANCE_LIMIT, INITIAL_EDITOR, checkGuidance, clearGuidance, guidanceLength, guidanceReducer,
  loadGuidance, normaliseGuidance, putBody, saveGuidance, type GuidanceEditor, type SavedGuidance,
} from '@/refined/guidance';

/**
 * Cycle 5 P5.1 (spec 6, D06, A13, A16): the saved writing guidance as Train Your
 * AI edits it. The A16 tests at the bottom run two editors through the REAL BFF
 * route and the REAL `lib/product` client, against a fake backend that keeps the
 * compare-and-set rules of `src/product/api/writing_settings.py`.
 */

const BASE: SavedGuidance = { guidelineId: 'g-1', revision: 2, text: 'Plain words.' };

describe('normalisation, shown before save (the backend `visible` validator)', () => {
  it('removes only blank space at the edges, keeping inner blank lines, indentation and bullets', () => {
    const text = '\n  - Short paragraphs\n\n    - nested,  two spaces\n\t* Plain words  \n\n';
    expect(normaliseGuidance(text)).toBe('- Short paragraphs\n\n    - nested,  two spaces\n\t* Plain words');
  });

  it("strips what Python's str.strip() strips, and not what it keeps", () => {
    expect(normaliseGuidance('\x1c\x85　Words \x1f')).toBe('Words');
    expect(normaliseGuidance('﻿Words')).toBe('﻿Words');
  });

  it('counts code points, as Python and Pydantic do', () => {
    expect(guidanceLength('ab')).toBe(2);
    expect(guidanceLength('\u{1F600}')).toBe(1);
  });

  it('accepts exactly 2,000 characters and blocks 2,001', () => {
    expect(checkGuidance('x'.repeat(GUIDANCE_LIMIT))).toMatchObject({ ok: true, length: 2000, over: 0 });
    expect(checkGuidance('x'.repeat(GUIDANCE_LIMIT + 1))).toMatchObject({ ok: false, length: 2001, over: 1 });
    // Edge space does not count: it is not sent.
    expect(checkGuidance(`  ${'x'.repeat(GUIDANCE_LIMIT)}\n`)).toMatchObject({ ok: true, length: 2000, trimmed: true });
    expect(checkGuidance(' \n ')).toMatchObject({ ok: false, empty: true });
  });
});

describe('the requests', () => {
  it('a first save sends both versions as null; a change sends the version it read', () => {
    expect(putBody('Mine.', null)).toEqual({ text: 'Mine.', expected_revision: null, expected_guideline_id: null });
    expect(putBody('Mine.', BASE)).toEqual({ text: 'Mine.', expected_revision: 2, expected_guideline_id: 'g-1' });
  });

  it('blocks 2,001 characters before sending anything', async () => {
    const fetcher = vi.fn(async () => Response.json(null));
    const result = await saveGuidance('x'.repeat(GUIDANCE_LIMIT + 1), BASE, fetcher);
    expect(result.kind).toBe('error');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sends exactly 2,000 characters, normalised, against the version read', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ perspective_mode: 'neutral', guideline_id: 'g-1', revision: 3, text_digest: 'd', text: 'x'.repeat(2000) }));
    const result = await saveGuidance(`\n${'x'.repeat(GUIDANCE_LIMIT)}  `, BASE, fetcher);
    expect(result).toEqual({ kind: 'saved', saved: { guidelineId: 'g-1', revision: 3, text: 'x'.repeat(2000) } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('/api/client/writing-settings');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({ text: 'x'.repeat(2000), expected_revision: 2, expected_guideline_id: 'g-1' });
  });

  it('reads a 409 stale_revision as stale, and other refusals as errors', async () => {
    const stale = async () => Response.json({ error: "That didn't work (409).", detail: { code: 'stale_revision', current_revision: 3 } }, { status: 409 });
    expect(await saveGuidance('Mine.', BASE, stale)).toEqual({ kind: 'stale' });
    expect(await clearGuidance(BASE, stale)).toEqual({ kind: 'stale' });
    const other = async () => Response.json({ error: 'choose an author first', detail: { code: 'clarification_required', detail: 'choose an author first' } }, { status: 409 });
    expect(await saveGuidance('Mine.', BASE, other)).toEqual({ kind: 'error', message: 'choose an author first' });
    expect(await loadGuidance(async () => Response.json({ error: 'x' }, { status: 401 }))).toEqual({ kind: 'signed-out' });
  });
});

describe('the editor', () => {
  const ready = (saved: SavedGuidance | null, draft = saved?.text ?? ''): GuidanceEditor => ({ ...INITIAL_EDITOR, status: 'ready', saved, draft });

  it('shows nothing as saved when the server has nothing saved', () => {
    const editor = guidanceReducer(INITIAL_EDITOR, { type: 'loaded', saved: null });
    expect(editor).toMatchObject({ status: 'ready', saved: null, draft: '', kept: null });
  });

  it('keeps the typed text on a stale save', () => {
    const typed = guidanceReducer(ready(BASE), { type: 'edit', draft: 'My new guidance' });
    const after = guidanceReducer(guidanceReducer(typed, { type: 'busy' }), { type: 'written', result: { kind: 'stale' } });
    expect(after).toMatchObject({ stale: true, busy: false, draft: 'My new guidance', saved: BASE });
  });

  it('keeps unsaved text beside a newer version when the client reloads', () => {
    const stale = { ...ready(BASE, 'My new guidance'), stale: true };
    const newer: SavedGuidance = { guidelineId: 'g-1', revision: 3, text: 'Their guidance' };
    const reloaded = guidanceReducer(stale, { type: 'loaded', saved: newer });
    expect(reloaded).toMatchObject({ stale: false, saved: newer, draft: 'Their guidance', kept: 'My new guidance' });
    expect(guidanceReducer(reloaded, { type: 'use-kept' })).toMatchObject({ draft: 'My new guidance', kept: null, saved: newer });
  });

  it('a successful save becomes the version the editor holds', () => {
    const saved: SavedGuidance = { guidelineId: 'g-1', revision: 3, text: 'Mine.' };
    const after = guidanceReducer({ ...ready(BASE, '  Mine.  '), busy: true }, { type: 'written', result: { kind: 'saved', saved } });
    expect(after).toMatchObject({ saved, draft: 'Mine.', busy: false, stale: false });
    // The server state echoing the same version back changes nothing.
    expect(guidanceReducer(after, { type: 'loaded', saved: { ...saved } })).toEqual(after);
  });
});

// ---------------------------------------------------------------------------
// A16: through the real route, against a backend with the real rules.
// ---------------------------------------------------------------------------

const session = vi.hoisted(() => ({ token: 'session-token' as string | null }));
vi.mock('@/lib/client-session', () => ({ clientToken: async () => session.token }));

/** The compare-and-set of `perspective.save_guideline` / `clear_guideline` and
 *  the `WritingSettingIn` model, for the neutral perspective of one client. */
function fakeBackend() {
  let row: { id: string; revision: number; text: string } | null = null;
  let ids = 0;
  const out = () => row && { perspective_mode: 'neutral', guideline_id: row.id, revision: row.revision, text_digest: 'digest', text: row.text };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const stale = () => json({ detail: { code: 'stale_revision', current_revision: row?.revision ?? null } }, 409);
  const fetch = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const headers = init.headers as Record<string, string>;
    if (headers['X-API-Key'] !== 'service-key' || headers['X-Onboarding-Token'] !== 'session-token') return json({ detail: 'no' }, 401);
    if (url.pathname !== '/v1/clients/me/writing-settings') return json({ detail: 'Not Found' }, 404);
    const method = init.method ?? 'GET';
    if (method === 'GET') return json(out());
    if (method === 'PUT') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      const extra = Object.keys(body).filter(key => !['text', 'expected_revision', 'expected_guideline_id'].includes(key));
      const raw = body.text;
      if (extra.length || typeof raw !== 'string' || Array.from(raw).length < 1 || Array.from(raw).length > 2000) return json({ detail: [{ loc: ['body', 'text'], msg: 'invalid' }] }, 422);
      const revision = body.expected_revision ?? null;
      const id = body.expected_guideline_id ?? null;
      if ((revision === null) !== (id === null)) return json({ detail: [{ loc: ['body'], msg: 'expected_revision and expected_guideline_id go together' }] }, 422);
      const text = raw.replace(/^\s+|\s+$/g, '');
      if (!text) return json({ detail: [{ loc: ['body', 'text'], msg: 'a guideline must contain visible text' }] }, 422);
      if (row && row.text === text && row.revision === (Number(revision) || 0) + 1 && (id === null || row.id === id)) return json(out());
      if ((row?.id ?? null) !== id || (row?.revision ?? null) !== revision) return stale();
      row = row ? { ...row, text, revision: row.revision + 1 } : { id: `g-${++ids}`, revision: 1, text };
      return json(out());
    }
    if (method === 'DELETE') {
      const revision = url.searchParams.get('expected_revision');
      const id = url.searchParams.get('expected_guideline_id');
      if (!revision || !id) return json({ detail: [{ loc: ['query'], msg: 'missing' }] }, 422);
      if (!row) return json({ cleared: false });
      if (row.id !== id || String(row.revision) !== revision) return stale();
      row = null;
      return json({ cleared: true });
    }
    return json({ detail: 'Method Not Allowed' }, 405);
  });
  return { fetch, current: () => row };
}

/** The browser's `fetch` to `/api/client/writing-settings`, answered by the real route. */
async function browser() {
  const handlers = await import('@/app/api/client/writing-settings/route');
  return async (input: string, init: RequestInit = {}) => {
    const request = new Request(`https://app.test${input}`, init);
    const method = init.method ?? 'GET';
    if (method === 'GET') return handlers.GET();
    if (method === 'PUT') return handlers.PUT(request);
    if (method === 'DELETE') return handlers.DELETE(request);
    throw new Error(method);
  };
}

describe('A16 through the real route', () => {
  beforeEach(() => {
    vi.resetModules();
    session.token = 'session-token';
    vi.stubEnv('ENGINE_URL', 'https://engine.test');
    vi.stubEnv('ENGINE_SERVICE_KEY', 'service-key');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function open(fetcher: Awaited<ReturnType<typeof browser>>) {
    const loaded = await loadGuidance(fetcher);
    if (loaded.kind !== 'saved') throw new Error(loaded.kind);
    return guidanceReducer(INITIAL_EDITOR, { type: 'loaded', saved: loaded.saved });
  }

  it('two editors: the older one gets the prompt, keeps its text, and the newer text is never overwritten', async () => {
    const server = fakeBackend();
    vi.stubGlobal('fetch', server.fetch);
    const fetcher = await browser();

    // A first save, from nothing.
    let first = await open(fetcher);
    first = guidanceReducer(first, { type: 'edit', draft: '- Plain words' });
    first = guidanceReducer(first, { type: 'written', result: await saveGuidance(first.draft, first.saved, fetcher) });
    expect(first.saved).toMatchObject({ revision: 1, text: '- Plain words' });

    // Both editors now hold revision 1.
    let second = await open(fetcher);
    expect(second.saved).toEqual(first.saved);

    // The first saves a change: revision 2.
    first = guidanceReducer(first, { type: 'edit', draft: '- Plain words\n- One person at a time' });
    first = guidanceReducer(first, { type: 'written', result: await saveGuidance(first.draft, first.saved, fetcher) });
    expect(first.saved).toMatchObject({ revision: 2 });

    // The second, still on revision 1, is refused and shown the prompt.
    second = guidanceReducer(second, { type: 'edit', draft: '- Long sentences' });
    const refused = await saveGuidance(second.draft, second.saved, fetcher);
    expect(refused).toEqual({ kind: 'stale' });
    second = guidanceReducer(second, { type: 'written', result: refused });
    expect(second).toMatchObject({ stale: true, draft: '- Long sentences' });
    expect(server.current()).toMatchObject({ revision: 2, text: '- Plain words\n- One person at a time' });

    // A clear from the stale version is refused the same way.
    expect(await clearGuidance(second.saved!, fetcher)).toEqual({ kind: 'stale' });
    expect(server.current()).toMatchObject({ revision: 2 });

    // Reload: the latest is shown, the typed text is kept beside it; saving it
    // again is now a deliberate change over revision 2.
    const latest = await loadGuidance(fetcher);
    if (latest.kind !== 'saved') throw new Error(latest.kind);
    second = guidanceReducer(second, { type: 'loaded', saved: latest.saved });
    expect(second).toMatchObject({ stale: false, draft: '- Plain words\n- One person at a time', kept: '- Long sentences' });
    second = guidanceReducer(second, { type: 'use-kept' });
    second = guidanceReducer(second, { type: 'written', result: await saveGuidance(second.draft, second.saved, fetcher) });
    expect(second.saved).toMatchObject({ revision: 3, text: '- Long sentences' });
  });

  it('2,000 characters with inner blank lines and bullets round-trip identical', async () => {
    const server = fakeBackend();
    vi.stubGlobal('fetch', server.fetch);
    const fetcher = await browser();
    const lines = '- First rule,  two spaces\n\n    * indented bullet\n\t- tabbed\n';
    const body = (lines.repeat(Math.ceil(2000 / lines.length)) ).slice(0, 1999) + '!';
    expect(guidanceLength(body)).toBe(2000);
    const typed = `\n\n${body}   \n`;

    const shown = checkGuidance(typed);
    expect(shown).toMatchObject({ text: body, length: 2000, ok: true, trimmed: true });
    const result = await saveGuidance(typed, null, fetcher);
    expect(result).toMatchObject({ kind: 'saved', saved: { text: body } });

    const reloaded = await loadGuidance(fetcher);
    expect(reloaded).toMatchObject({ kind: 'saved', saved: { text: body } });
    expect(server.current()?.text).toBe(body);
  });
});

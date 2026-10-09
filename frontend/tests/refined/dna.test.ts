import { describe, expect, it } from 'vitest';

import type { DnaOut, DnaProfile } from '@/lib/product';
import { knowledgeStatus } from '@/lib/knowledge-status';
import {
  chooseProfile, itemTags, loadDnaPage, processingSummary, REMEMBER_KEY, rememberedProfile, rememberProfile,
  showsSelector, type SelectionStore,
} from '@/refined/dna';
import type { ServerDocument } from '@/refined/knowledge-view';

/**
 * Cycle 5 P9.4 (spec 3.1-3.2; A01, A02; Ruling 88): Business DNA's rules, outside React.
 * - The only profile opens; with several, the remembered one if still permitted, else the
 *   selection state. A revoked remembered selection falls back and is forgotten.
 * - The page reads profiles, then DNA, then the files' status only when nothing is known,
 *   and NEVER the voice preview (no paid call on load).
 */

const ACME: DnaProfile = { id: '11111111-1111-4111-8111-111111111111', name: 'Acme Physio', kind: 'organization' };
const ANN: DnaProfile = { id: '22222222-2222-4222-8222-222222222222', name: 'Ann Lee', kind: 'person' };
const ACCOUNT: DnaProfile = { id: 'account', name: 'Acme', kind: 'account' };

const sections = (filled: boolean): DnaOut['sections'] => (['identity', 'audience', 'offers', 'positioning', 'proof', 'voice'] as const)
  .map(id => ({ id, items: filled && id === 'audience' ? [{ knowledge_id: 'k1', meaning_id: 'audience.segment',
    statement: 'Office workers.', modality: 'asserted', reported_by: null, interpretation: false }] : [] }));
const dna = (profile: DnaProfile, filled = true): DnaOut => ({ profile, sections: sections(filled), relationships: [], empty: !filled });

function memory(initial: string | null = null): SelectionStore & { value: string | null } {
  const store = {
    value: initial,
    getItem: (key: string) => (key === REMEMBER_KEY ? store.value : null),
    setItem: (_key: string, value: string) => { store.value = value; },
    removeItem: () => { store.value = null; },
  };
  return store;
}

type Route = (path: string) => { status: number; body: unknown };

function backend(route: Route) {
  const calls: string[] = [];
  const fetcher = async (input: string) => {
    calls.push(input);
    const { status, body } = route(input);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, fetcher };
}

describe('which profile opens (A01, A02)', () => {
  it('opens the only permitted profile and shows no selector', () => {
    expect(chooseProfile([ACCOUNT], null)).toEqual({ kind: 'open', id: 'account' });
    expect(chooseProfile([ACME], ANN.id)).toEqual({ kind: 'open', id: ACME.id });
    expect(showsSelector([ACME])).toBe(false);
  });

  it('reopens the remembered profile only while it is permitted, else asks', () => {
    expect(chooseProfile([ACME, ANN], ANN.id)).toEqual({ kind: 'open', id: ANN.id });
    expect(chooseProfile([ACME, ANN], 'revoked-id')).toEqual({ kind: 'choose' });
    expect(chooseProfile([ACME, ANN], null)).toEqual({ kind: 'choose' });
    expect(showsSelector([ACME, ANN])).toBe(true);
  });

  it('survives storage that refuses to be read or written', () => {
    const broken: SelectionStore = {
      getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    };
    expect(rememberedProfile(broken)).toBeNull();
    expect(() => rememberProfile(broken, ACME.id)).not.toThrow();
    expect(rememberedProfile(null)).toBeNull();
  });
});

describe('the page loads', () => {
  it('a revoked remembered selection falls back to the permitted choices and is forgotten', async () => {
    const store = memory('revoked-id');
    const { calls, fetcher } = backend(() => ({ status: 200, body: { profiles: [ACME, ANN] } }));

    const page = await loadDnaPage(fetcher, store);

    expect(page).toEqual({ kind: 'choose', profiles: [ACME, ANN] });
    expect(store.value).toBeNull();
    expect(calls).toEqual(['/api/client/profiles']);
  });

  it('a selection revoked between the two reads (404) also falls back', async () => {
    const store = memory(ANN.id);
    const { fetcher } = backend(path => path === '/api/client/profiles'
      ? { status: 200, body: { profiles: [ACME, ANN] } }
      : { status: 404, body: { error: "That profile isn't available.", detail: 'profile_not_found' } });

    expect(await loadDnaPage(fetcher, store)).toEqual({ kind: 'choose', profiles: [ACME, ANN] });
    expect(store.value).toBeNull();
  });

  it('opens the remembered profile, remembers a pick, and never asks for a voice sample', async () => {
    const store = memory(ANN.id);
    const { calls, fetcher } = backend(path => path === '/api/client/profiles'
      ? { status: 200, body: { profiles: [ACME, ANN] } }
      : { status: 200, body: dna(path.includes(ANN.id) ? ANN : ACME) });

    const page = await loadDnaPage(fetcher, store);
    expect(page.kind === 'open' && page.dna.profile).toEqual(ANN);
    const picked = await loadDnaPage(fetcher, store, ACME.id);
    expect(picked.kind === 'open' && picked.dna.profile).toEqual(ACME);
    expect(store.value).toBe(ACME.id);

    expect(calls).toEqual([
      '/api/client/profiles', `/api/client/profiles/${ANN.id}/dna`,
      '/api/client/profiles', `/api/client/profiles/${ACME.id}/dna`,
    ]);
    expect(calls.some(path => path.includes('voice'))).toBe(false);
  });

  it('reads the files only when nothing is known yet, and says what they are doing', async () => {
    const files: ServerDocument[] = [
      { id: 'd1', source_type: 'a.pdf', source_authority: 'CLIENT', status: 'uploaded', created_at: '2026-10-09T09:00:00Z',
        knowledge: knowledgeStatus({ state: 'ready' }, null, []) },
      { id: 'd2', source_type: 'b.pdf', source_authority: 'CLIENT', status: 'uploaded', created_at: '2026-10-09T09:00:00Z',
        knowledge: knowledgeStatus({ state: 'ready' }, null, []) },
    ];
    const { calls, fetcher } = backend(path => path === '/api/client/profiles'
      ? { status: 200, body: { profiles: [ACCOUNT] } }
      : path === '/api/client/documents' ? { status: 200, body: files } : { status: 200, body: dna(ACCOUNT, false) });

    const page = await loadDnaPage(fetcher, memory());

    expect(page.kind === 'open' && page.processing).toBe(`Your files: 2 ${files[0].knowledge!.label}.`);
    expect(calls).toEqual(['/api/client/profiles', '/api/client/profiles/account/dna', '/api/client/documents']);
    expect(calls.some(path => path.includes('voice'))).toBe(false);
  });

  it('does not read the files when the profile has knowledge', async () => {
    const { calls, fetcher } = backend(path => path === '/api/client/profiles'
      ? { status: 200, body: { profiles: [ACCOUNT] } } : { status: 200, body: dna(ACCOUNT) });

    const page = await loadDnaPage(fetcher, memory());

    expect(page.kind === 'open' && page.processing).toBeNull();
    expect(calls).toEqual(['/api/client/profiles', '/api/client/profiles/account/dna']);
  });

  it('a signed-out session is reported, and a failure is an error, never an empty page', async () => {
    expect(await loadDnaPage(backend(() => ({ status: 401, body: {} })).fetcher, memory())).toEqual({ kind: 'signed-out' });
    const failed = await loadDnaPage(backend(() => ({ status: 502, body: {} })).fetcher, memory());
    expect(failed.kind).toBe('error');
  });
});

describe('honest labels and status', () => {
  it('a plan stays a plan; reports and interpretations say what they are', () => {
    expect(itemTags({ modality: 'asserted', reported_by: null, interpretation: false })).toEqual([]);
    expect(itemTags({ modality: 'planned', reported_by: null, interpretation: false })).toEqual(['Plan']);
    expect(itemTags({ modality: 'reported', reported_by: 'A patient', interpretation: false })).toEqual(['Reported by A patient']);
    expect(itemTags({ modality: 'asserted', reported_by: null, interpretation: true })).toEqual(['Interpretation']);
  });

  it('summarises the files in the Knowledge screen’s own words, with no percentage', () => {
    expect(processingSummary(null)).toBeNull();
    expect(processingSummary([])).toBe('No files added yet.');
  });
});

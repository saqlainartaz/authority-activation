// Business DNA on the new engine (Cycle 5 P9.4; spec 3.1-3.2; A01-A03; Ruling 88).
//
// Browser-safe and free of React, so the page's rules can be tested directly:
// - which profile opens (`chooseProfile`): the only one; else the last one the
//   browser remembers, if it is still permitted; else the selection state. The
//   remembered id lives in this browser only (`localStorage`), and every read
//   re-checks permission on the server, so a revoked one falls back (A02);
// - the page's loads (`loadDnaPage`): the permitted profiles, then that profile's
//   DNA, then -- only when nothing is known yet -- the files' real processing
//   status. Never the voice preview: a sample is generated only when the client
//   asks (no paid call on page load);
// - the honest copy: the empty states are word for word from spec 3.1/3.2, and a
//   plan, a report or an interpretation is labelled as what it is. Nothing is
//   scored, counted toward a percentage or invented.

import type { DnaItem, DnaOut, DnaProfile, DnaSectionId } from '@/lib/product';
import { KNOWLEDGE_LABELS } from '@/lib/knowledge-status';
import type { ServerDocument } from './knowledge-view';

export const DNA_TITLE = 'Business DNA';
export const DNA_DESCRIPTION = 'What your writing assistant knows about your business, from your files and what you have told us.';
export const STILL_BUILDING = "We're still building your business profile";
export const CHOOSE_PROFILE = 'Choose which business to view';
export const VOICE_NOT_SET = 'Voice not set';
export const SHOW_SAMPLE = 'Show a sample';
export const SAMPLE_NOTE = 'This is generated writing to show your voice. It is not information about your business.';
export const CORRECT_ACTION = 'Correct or add';
export const ADD_FILES = 'Add files';
export const TELL_US = 'Tell us about your business';

/** The sections in page order, with their titles and honest empty states (spec 3.1). */
export const DNA_SECTIONS: ReadonlyArray<{ id: DnaSectionId; title: string; empty: string }> = [
  { id: 'identity', title: 'Identity', empty: 'No description added yet.' },
  { id: 'audience', title: 'Audience', empty: 'Audience details not added yet' },
  { id: 'offers', title: 'Offers and problems', empty: 'No offers added yet. Tell us about one.' },
  { id: 'positioning', title: 'Positioning', empty: 'Tell us what makes your approach different.' },
  { id: 'proof', title: 'Proof stories', empty: 'No examples added yet' },
  { id: 'voice', title: 'Voice sample', empty: VOICE_NOT_SET },
];

/** Items a compact section shows before "Show all". */
export const COMPACT_ITEMS = 3;

export const KIND_LABELS: Record<DnaProfile['kind'], string> = {
  person: 'Person', organization: 'Business', brand: 'Brand', account: 'Your account',
};

/** What an item is, when it is not a plain statement: a plan stays a plan. */
export function itemTags(item: Pick<DnaItem, 'modality' | 'reported_by' | 'interpretation'>): string[] {
  const tags: string[] = [];
  if (item.modality === 'planned') tags.push('Plan');
  if (item.modality === 'hypothetical') tags.push('Possibility');
  if (item.modality === 'requested') tags.push('Request');
  if (item.modality === 'reported') tags.push(item.reported_by ? `Reported by ${item.reported_by}` : 'Reported');
  if (item.interpretation) tags.push('Interpretation');
  return tags;
}

// ---- the remembered selection (this browser only) -------------------------------

export const REMEMBER_KEY = 'rf-dna-profile';

export type SelectionStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The browser's storage, or none: private windows and previews may refuse it. */
export function browserStore(): SelectionStore | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

export function rememberedProfile(store: SelectionStore | null): string | null {
  try { return store?.getItem(REMEMBER_KEY) ?? null; } catch { return null; }
}

export function rememberProfile(store: SelectionStore | null, id: string | null): void {
  try {
    if (id === null) store?.removeItem(REMEMBER_KEY);
    else store?.setItem(REMEMBER_KEY, id);
  } catch { /* remembering is a convenience only */ }
}

export type ProfileChoice = { kind: 'open'; id: string } | { kind: 'choose' };

/** The sole permitted profile; else the remembered one if still permitted; else the selection state. */
export function chooseProfile(profiles: readonly DnaProfile[], remembered: string | null): ProfileChoice {
  if (profiles.length === 1) return { kind: 'open', id: profiles[0].id };
  if (remembered && profiles.some(profile => profile.id === remembered)) return { kind: 'open', id: remembered };
  return { kind: 'choose' };
}

/** The selector appears only when more than one profile is permitted. */
export function showsSelector(profiles: readonly DnaProfile[]): boolean {
  return profiles.length > 1;
}

// ---- the files' real processing status, for the empty state -----------------------

/** "Your files: 2 Processing · 1 Available." from the Knowledge screen's own labels; null when unknown. */
export function processingSummary(documents: readonly ServerDocument[] | null): string | null {
  if (documents === null) return null;
  if (documents.length === 0) return 'No files added yet.';
  const counts = new Map<string, number>();
  for (const document of documents) {
    const label = document.knowledge?.label;
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const order = Object.values(KNOWLEDGE_LABELS) as string[];
  const parts = [...counts].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([label, count]) => `${count} ${label}`);
  return parts.length ? `Your files: ${parts.join(' · ')}.` : null;
}

// ---- the page's loads --------------------------------------------------------------

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export type DnaPage =
  | { kind: 'signed-out' }
  | { kind: 'error'; message: string }
  | { kind: 'choose'; profiles: DnaProfile[] }
  | { kind: 'open'; profiles: DnaProfile[]; dna: DnaOut; processing: string | null };

const LOAD_FAILED = 'Business DNA could not be loaded. Try again in a moment.';

async function getJson(fetcher: Fetcher, path: string): Promise<{ status: number; body: unknown }> {
  const response = await fetcher(path, { cache: 'no-store', headers: { Accept: 'application/json' } });
  return { status: response.status, body: await response.json().catch(() => null) };
}

/** Load the page: profiles, the chosen profile's DNA, and (only when it is empty) the files' status.
 *  `wanted` is a profile the client just picked; otherwise the remembered one is tried. */
export async function loadDnaPage(fetcher: Fetcher, store: SelectionStore | null, wanted: string | null = null): Promise<DnaPage> {
  try {
    const listed = await getJson(fetcher, '/api/client/profiles');
    if (listed.status === 401) return { kind: 'signed-out' };
    const profiles = (listed.body as { profiles?: DnaProfile[] } | null)?.profiles;
    if (listed.status !== 200 || !Array.isArray(profiles) || profiles.length === 0) return { kind: 'error', message: LOAD_FAILED };
    const remembered = wanted ?? rememberedProfile(store);
    const choice = chooseProfile(profiles, remembered);
    if (choice.kind === 'choose') {
      if (remembered) rememberProfile(store, null); // no longer permitted: forget it
      return { kind: 'choose', profiles };
    }
    const read = await getJson(fetcher, `/api/client/profiles/${encodeURIComponent(choice.id)}/dna`);
    if (read.status === 401) return { kind: 'signed-out' };
    if (read.status === 404) {
      // Revoked between the two reads: forget it and offer what is permitted.
      rememberProfile(store, null);
      return profiles.length > 1 ? { kind: 'choose', profiles } : { kind: 'error', message: LOAD_FAILED };
    }
    const dna = read.body as DnaOut | null;
    if (read.status !== 200 || !dna || !Array.isArray(dna.sections)) return { kind: 'error', message: LOAD_FAILED };
    if (profiles.length > 1) rememberProfile(store, choice.id);
    let processing: string | null = null;
    if (dna.empty) {
      try {
        const files = await getJson(fetcher, '/api/client/documents');
        processing = files.status === 200 && Array.isArray(files.body) ? processingSummary(files.body as ServerDocument[]) : null;
      } catch { processing = null; }
    }
    return { kind: 'open', profiles, dna, processing };
  } catch {
    return { kind: 'error', message: LOAD_FAILED };
  }
}

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { toast } from 'sonner';
import { POSTS, FULL, paraText, type Post, type Version } from '@/shared/data';
import { channelFromAssetKind } from '@/shared/channels';
import { restoreSetup, setupComplete, type Setup, type SetupAnswer } from './setup-packets';

export type SavedPost = Post & {
  body: string;
  date?: string;
  version?: Version;
  backendState?: string | null;
  versionId?: string | null;
  slotId?: string | null;
  media?: SavedPostMedia | null;
};
export type SavedPostMedia = { media_id: string; media_type: 'image/jpeg' | 'image/png' | 'image/webp'; byte_size: number; width: number; height: number; original_name: string; alt_text: string | null; download_url: string };
export type Rule = { id: string; text: string; enabled: boolean };
type Profile = { name: string; headline: string };
type Connection = 'demo' | 'loading' | 'connected' | 'error';
type Data = { posts: SavedPost[]; answers: Record<string, string[]>; onboarding: Setup; rules: Rule[]; preferences: boolean[]; timeZone: string; profile: Profile; sourceCount: number };
type LibraryItem = { content_item_id: string; asset_kind: string; state: string | null; latest_version_id: string | null; created_at: string };
type VersionEntry = { content_version_id: string; body: string; created_at: string; media?: SavedPostMedia | null };
type VersionHistory = { versions: VersionEntry[] };
type CalendarEnvelope = { slots: Array<{ slot_id: string; slot_at: string; slot_zone: string; status: string; content_item_id: string; objective: string }> };
type ProfileEnvelope = { identity: { display_name: string; profession: string | null; client_name: string; timezone: string }; document_count: number };

const DEMO = process.env.NEXT_PUBLIC_AUTHORITY_DEMO === '1';
const EMPTY: Data = { posts: [], answers: {}, onboarding: { answers: {}, completed: false }, preferences: [true, true, true], timeZone: 'UTC', profile: { name: 'Your profile', headline: '' }, rules: [], sourceCount: 0 };
const FIXTURES: Data = {
  posts: POSTS.map(p => ({ ...p, body: p.id === 6 ? FULL.paras.filter(p => !p.miss).map(paraText).join('\n\n') : p.id === 2 ? 'We spent four months building the wrong thing. Here is what we learned.' : p.id === 7 ? 'Three days, not six weeks. Here is the maths, with the invoice.' : p.snip, date: p.day ? `2026-03-${String(p.day).padStart(2, '0')}` : undefined })),
  answers: {}, onboarding: { answers: {}, completed: false }, preferences: [true, true, true], timeZone: 'Europe/London', profile: { name: 'Saqlain Artaz', headline: 'Founder at InsideSuccess' }, sourceCount: 14,
  rules: [
    { id: 'clients', text: 'Never name a competitor.', enabled: true },
    { id: 'voice', text: 'Write like I am talking to one person.', enabled: true },
    { id: 'question', text: 'Always end on a question.', enabled: false },
    { id: 'plain', text: 'Short paragraphs. Plain words. Never say utilize.', enabled: true },
  ],
};
const KEY = 'authority-refined-local-v1';

function restoreDemo(): Data {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (d && Array.isArray(d.posts) && Array.isArray(d.rules) && d.answers && Array.isArray(d.preferences)) return { ...FIXTURES, ...d, onboarding: restoreSetup(d.onboarding), profile: { ...FIXTURES.profile, ...d.profile }, timeZone: typeof d.timeZone === 'string' ? d.timeZone : FIXTURES.timeZone };
  } catch { /* A demo may fall back to packaged fixtures. */ }
  return FIXTURES;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}

function displayDate(value: string): string { return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(new Date(value)); }
function statusFor(state: string | null, scheduled: boolean): Post['status'] { if (scheduled) return 'scheduled'; return state === 'approved' || state === 'posted' ? 'approved' : 'draft'; }

async function loadPosts(): Promise<{ posts: SavedPost[]; profile: ProfileEnvelope; zone: string }> {
  const [library, calendar, profile] = await Promise.all([
    getJson<{ items: LibraryItem[] }>('/api/client/content-items'),
    getJson<CalendarEnvelope>('/api/client/calendar'),
    getJson<ProfileEnvelope>('/api/client/profile'),
  ]);
  const histories = await Promise.all(library.items.map(item => item.latest_version_id ? getJson<VersionHistory>(`/api/client/content-items/${encodeURIComponent(item.content_item_id)}/versions`) : Promise.resolve({ versions: [] })));
  const posts = library.items.flatMap((item, index): SavedPost[] => {
    const latest = histories[index].versions.find(version => version.content_version_id === item.latest_version_id) ?? histories[index].versions.at(-1);
    if (!latest) return [];
    // A content edit invalidates its approval and moves the prior slot to
    // `needs_reapproval`.  That slot remains useful audit history, but it is no
    // longer an active schedule and must not make the edited draft look live.
    const slot = calendar.slots.find(candidate => candidate.content_item_id === item.content_item_id && candidate.status === 'scheduled');
    const instant = slot ? new Date(slot.slot_at) : null;
    const body = latest.body;
    return [{
      id: item.content_item_id, ch: channelFromAssetKind(item.asset_kind) ?? 'li', name: slot?.objective?.trim() || body.split(/\r?\n/)[0]?.slice(0, 72) || 'Untitled post', snip: body.split(/\r?\n/)[0] || '', body,
      status: statusFor(item.state, Boolean(slot)), backendState: item.state, created: displayDate(item.created_at),
      when: instant ? `${new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: slot!.slot_zone }).format(instant)}, ${new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: slot!.slot_zone }).format(instant)}` : undefined,
      date: instant ? new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: slot!.slot_zone }).format(instant) : undefined,
      day: instant ? Number(new Intl.DateTimeFormat('en', { day: 'numeric', timeZone: slot!.slot_zone }).format(instant)) : undefined,
      versionId: latest.content_version_id, slotId: slot?.slot_id ?? null,
      media: latest.media ?? null,
      version: { paras: body.split(/\r?\n\r?\n/).map(text => ({ g: '', segs: [{ t: text }] })), sources: [], count: `${body.length} / 3,000` },
    }];
  });
  return { posts, profile, zone: profile.identity.timezone };
}

function useDataValue() {
  const pathname = usePathname();
  const [data, setData] = useState<Data>(() => DEMO ? restoreDemo() : EMPTY);
  const [connection, setConnection] = useState<Connection>(DEMO ? 'demo' : 'loading');
  const connectedDataLoaded = useRef(DEMO);
  const refreshPosts = useCallback(async () => {
    if (DEMO) return;
    try {
      const loaded = await loadPosts();
      setData(current => ({ ...current, posts: loaded.posts, timeZone: loaded.zone, sourceCount: loaded.profile.document_count, profile: { name: loaded.profile.identity.display_name, headline: loaded.profile.identity.profession || loaded.profile.identity.client_name } }));
      setConnection('connected');
    } catch (reason) { setConnection('error'); throw reason; }
  }, []);

  useEffect(() => { if (DEMO) { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* Demo storage is best-effort. */ } } }, [data]);
  useEffect(() => {
    if (DEMO) return;
    if (/\/refined\/(signin|invite|onboarding)$/.test(pathname)) {
      connectedDataLoaded.current = false;
      setData(EMPTY);
      setConnection('loading');
      return;
    }
    if (connectedDataLoaded.current) return;
    connectedDataLoaded.current = true;
    void refreshPosts().catch(reason => {
      connectedDataLoaded.current = false;
      toast.error(reason instanceof Error ? reason.message : 'Could not load your workspace.');
    });
  }, [pathname, refreshPosts]);
  const localOnly = useCallback((message: string) => { toast.info(DEMO ? message : `${message} This remains local because the previous backend has no matching operation.`); }, []);

  return useMemo(() => ({
    ...data, connection, isDemo: DEMO, refreshPosts,
    setSetupAnswer: (id: string, answer: SetupAnswer) => setData(d => ({ ...d, onboarding: { completed: false, answers: { ...d.onboarding.answers, [id]: answer } } })),
    completeSetupLocal: () => setData(d => setupComplete(d.onboarding) ? { ...d, onboarding: { ...d.onboarding, completed: true } } : d),
    setTimeZone: async (timeZone: string) => {
      if (DEMO) { setData(d => ({ ...d, timeZone })); return true; }
      const response = await fetch('/api/client/timezone', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ timezone: timeZone }) });
      const body = await response.json().catch(() => ({})) as { timezone?: string; error?: string };
      if (!response.ok || !body.timezone) { toast.error(body.error || 'Time zone was not saved.'); return false; }
      setData(d => ({ ...d, timeZone: body.timezone! })); toast.success('Time zone saved'); return true;
    },
    setProfile: (profile: Profile) => { if (DEMO) setData(d => ({ ...d, profile })); else localOnly('Profile editing is unavailable.'); },
    exportData: () => { const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = DEMO ? 'authority-demo-data.json' : 'authority-browser-view.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); },
    savePostLocal: (post: SavedPost) => setData(d => ({ ...d, posts: d.posts.some(p => p.id === post.id) ? d.posts.map(p => p.id === post.id ? post : p) : [...d.posts, post] })),
    answer: (id: string, value: string[]) => { setData(d => ({ ...d, answers: { ...d.answers, [id]: value } })); if (!DEMO) localOnly('Training answers are kept in this browser session only.'); },
    setRule: (rule: Rule) => { setData(d => ({ ...d, rules: d.rules.some(r => r.id === rule.id) ? d.rules.map(r => r.id === rule.id ? rule : r) : [...d.rules, rule] })); if (!DEMO) localOnly('Guidance is kept in this browser session only.'); },
    setPreference: (i: number, checked: boolean) => { setData(d => ({ ...d, preferences: d.preferences.map((v, j) => i === j ? checked : v) })); if (!DEMO) localOnly('This preference is kept in this browser session only.'); },
  }), [connection, data, localOnly, refreshPosts]);
}

const Context = createContext<ReturnType<typeof useDataValue> | null>(null);
export function DataProvider({ children }: { children: ReactNode }) { const value = useDataValue(); return <Context.Provider value={value}>{children}</Context.Provider>; }
export function useData() { const value = useContext(Context); if (!value) throw new Error('Missing DataProvider'); return value; }

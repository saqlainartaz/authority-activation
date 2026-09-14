import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { POSTS, FULL, paraText, type Post, type Version } from '@/shared/data';
import { restoreSetup, setupComplete, type Setup, type SetupAnswer } from './setup-packets';

export type SavedPost = Post & { body: string; date?: string; version?: Version };
type Rule = { id: string; text: string; enabled: boolean };
type Data = { posts: SavedPost[]; answers: Record<string, string[]>; onboarding: Setup; rules: Rule[]; preferences: boolean[]; timeZone: string; profile: { name: string; headline: string } };
const initial: Data = {
  posts: POSTS.map(p => ({ ...p, body: p.id === 6 ? FULL.paras.filter(p => !p.miss).map(paraText).join('\n\n') : p.id === 2 ? 'We spent four months building the wrong thing. Here is what we learned.' : p.id === 7 ? 'Three days, not six weeks. Here is the maths, with the invoice.' : p.snip, date: p.day ? `2026-03-${String(p.day).padStart(2, '0')}` : undefined })),
  answers: {}, onboarding: { answers: {}, completed: false }, preferences: [true, true, true], timeZone: 'Europe/London', profile: { name: 'Saqlain Artaz', headline: 'Founder at InsideSuccess' },
  rules: [
    { id: 'clients', text: 'Never name a competitor.', enabled: true },
    { id: 'voice', text: 'Write like I am talking to one person.', enabled: true },
    { id: 'question', text: 'Always end on a question.', enabled: false },
    { id: 'plain', text: 'Short paragraphs. Plain words. Never say utilize.', enabled: true },
  ],
};
const KEY = 'authority-refined-local-v1';
function restore(): Data {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (d && Array.isArray(d.posts) && d.posts.every((p: SavedPost) => typeof p.id === 'number' && typeof p.body === 'string') && Array.isArray(d.rules) && d.answers && Array.isArray(d.preferences)) return { ...initial, ...d, onboarding: restoreSetup(d.onboarding), profile: { ...initial.profile, ...d.profile }, timeZone: typeof d.timeZone === 'string' ? d.timeZone : initial.timeZone };
  } catch { /* Start with sample data if browser storage is unavailable. */ }
  return initial;
}
function useDataValue() {
  const [data, setData] = useState<Data>(restore);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { toast.error('Changes are available for this session. Browser storage is unavailable.'); } }, [data]);
  return {
    ...data,
    setSetupAnswer: (id: string, answer: SetupAnswer) => setData(d => ({ ...d, onboarding: { completed: false, answers: { ...d.onboarding.answers, [id]: answer } } })),
    completeSetup: () => setData(d => setupComplete(d.onboarding) ? { ...d, onboarding: { ...d.onboarding, completed: true } } : d),
    setTimeZone: (timeZone: string) => setData(d => ({ ...d, timeZone })),
    setProfile: (profile: Data['profile']) => setData(d => ({ ...d, profile })),
    exportData: () => { const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'authority-preview-data.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); },
    savePost: (post: SavedPost) => setData(d => ({ ...d, posts: d.posts.some(p => p.id === post.id) ? d.posts.map(p => p.id === post.id ? post : p) : [...d.posts, post] })),
    answer: (id: string, value: string[]) => setData(d => ({ ...d, answers: { ...d.answers, [id]: value } })),
    setRule: (rule: Rule) => setData(d => ({ ...d, rules: d.rules.some(r => r.id === rule.id) ? d.rules.map(r => r.id === rule.id ? rule : r) : [...d.rules, rule] })),
    setPreference: (i: number, checked: boolean) => setData(d => ({ ...d, preferences: d.preferences.map((v, j) => i === j ? checked : v) })),
  };
}
const Context = createContext<ReturnType<typeof useDataValue> | null>(null);
export function DataProvider({ children }: { children: ReactNode }) { const value = useDataValue(); return <Context.Provider value={value}>{children}</Context.Provider>; }
export function useData() { const value = useContext(Context); if (!value) throw new Error('Missing DataProvider'); return value; }

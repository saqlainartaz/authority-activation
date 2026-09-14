import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FULL, SHORT, DEMO_MSG, REPLY_FULL, REPLY_SHORT, TITLE, XPOSTS, paraText, versionChars, type Channel, type Para, type Version } from '@/shared/data';
import { useData } from './state';
import { toast as notify } from 'sonner';
import { PACKETS, packetAnswer } from './setup-packets';
type Msg = { who: 'u'; text: string } | { who: 't'; n: number } | { who: 'a'; text: string; text2: string; strong: string };
type State = { composer: string; phase: 'empty' | 'reading' | 'streaming' | 'record'; thread: Msg[]; variant: 'full' | 'short'; version: Version; pos: number; formats: Channel[]; fmt: Channel; view: 'write' | 'preview'; status: 'draft' | 'approved' | 'scheduled'; settled: boolean; lens: boolean; typing: boolean; hasRecord: boolean; title: string; id: number; when?: string; date?: string };
const initial = (): State => ({ composer: '', phase: 'empty', thread: [], variant: 'full', version: FULL, pos: 0, formats: ['li', 'x'], fmt: 'li', view: 'write', status: 'draft', settled: false, lens: false, typing: false, hasRecord: false, title: TITLE, id: Date.now() });
export function useWorkspace() {
  const d = useData();
  const [params, setParams] = useSearchParams();
  const [s, set] = useState<State>(() => {
    const post = d.posts.find(p => p.id === Number(params.get('post')));
    const fresh = initial();
    if (params.get('welcome') === '1' && d.onboarding.completed) {
      const company = packetAnswer(PACKETS[4], d.onboarding.answers.company)?.join(' ') || '';
      fresh.thread = [{ who: 'a', text: `I’m your writing assistant. Your setup answers are saved.\n\nYou described the company this way: ${company}`, text2: '', strong: 'Tell me what happened this week, or choose a template to start a draft.' }];
    }
    return post ? { ...initial(), id: post.id, phase: 'record', settled: true, hasRecord: true, title: post.name, status: post.status, fmt: post.ch, formats: [post.ch], when: post.when, date: post.date, version: post.version || { paras: post.body.split('\n\n').map(t => ({ g: '', segs: [{ t }] })), sources: [], count: `${post.body.length} / 3,000` } } : fresh;
  });
  const timer = useRef<number | undefined>(undefined);
  const delay = useRef<number | undefined>(undefined);
  useEffect(() => () => { clearInterval(timer.current); clearTimeout(delay.current); }, []);
  const patch = (p: Partial<State>) => set(x => ({ ...x, ...p }));
  function stream(variant: 'full' | 'short') {
    const version = variant === 'full' ? FULL : SHORT;
    const total = versionChars(version);
    clearInterval(timer.current);
    patch({ phase: 'streaming', version, variant, pos: 0, view: 'write', lens: false, typing: false, settled: false, status: 'draft' });
    const started = Date.now();
    timer.current = window.setInterval(() => {
      const pos = Math.min(total, Math.floor((Date.now() - started) * .28));
      if (pos === total) {
        clearInterval(timer.current);
        set(x => ({ ...x, phase: 'record', pos, hasRecord: true, thread: [...x.thread, { who: 't', n: version.paras.length }, { who: 'a', ...(variant === 'full' ? REPLY_FULL : REPLY_SHORT) }] }));
      } else patch({ pos });
    }, 35);
  }
  function send(text: string, channels: Channel[]) {
    if (!['empty', 'record'].includes(s.phase)) return;
    patch({ phase: 'reading', thread: [{ who: 'u', text: text.trim() || DEMO_MSG }], formats: channels.length ? channels : ['li'], fmt: channels[0] || 'li', settled: false });
    delay.current = window.setTimeout(() => stream('full'), 850);
  }
  function askChange(text: string) {
    if (s.phase !== 'record' || !text.trim()) return;
    const variant = /short|punch/i.test(text) ? 'short' : /long/i.test(text) ? 'full' : null;
    set(x => ({ ...x, thread: [...x.thread, { who: 'u', text }], typing: true }));
    delay.current = window.setTimeout(() => {
      if (variant) stream(variant);
      else set(x => ({ ...x, typing: false, thread: [...x.thread, { who: 'a', text: 'You can type “make it shorter” or “make it longer” to try a sample rewrite, or edit the draft directly.', text2: '', strong: '' }] }));
    }, 500);
  }
  const visible: { done: Para[]; partial?: string } = (() => {
    if (s.phase !== 'streaming') return { done: s.version.paras };
    let used = 0; const done: Para[] = [];
    for (const p of s.version.paras) { const length = paraText(p).length + 1; if (used + length <= s.pos) done.push(p); else return { done, partial: s.pos > used ? paraText(p).slice(0, s.pos - used) : undefined }; used += length; }
    return { done };
  })();
  function stop() {
    clearInterval(timer.current); clearTimeout(delay.current);
    if (s.phase === 'reading') { patch({ phase: 'empty' }); return; }
    const paras: Para[] = [...visible.done, ...(visible.partial ? [{ g: '' as const, segs: [{ t: visible.partial }] }] : [])];
    patch({ phase: 'record', version: { ...s.version, paras }, hasRecord: true, typing: false });
  }
  function save(status: State['status'], when?: string, date?: string) {
    const isSampleX = s.fmt === 'x' && !params.has('post');
    const body = isSampleX ? XPOSTS.map(p => p.t).join('\n\n') : s.version.paras.filter(p => !p.miss).map(paraText).join('\n\n');
    if (!body.trim()) { notify.error('Write something before saving.'); return; }
    d.savePost({ id: s.id, ch: s.fmt, name: s.title, snip: body.split('\n')[0], body, status, created: 'Today', when, date, day: date ? Number(date.slice(-2)) : undefined, version: s.fmt === 'li' ? s.version : undefined });
    reset();
    notify.success(status === 'draft' ? 'Draft saved to your Library' : when ? `Scheduled for ${when}` : 'Approved and saved to your Library');
  }
  const reset = () => { clearInterval(timer.current); clearTimeout(delay.current); set(initial()); if (params.has('post')) setParams({}, { replace: true }); };
  const total = versionChars(s.version);
  const claims = s.version.paras.flatMap(p => p.segs.flatMap(seg => seg.claim ? [seg.claim] : []));
  const sourced = claims.filter(c => !c.bad).length;
  return {
    ...s, visible, total, xPosts: params.has('post') ? s.version.paras.map(p => ({ t: paraText(p), n: `${paraText(p).length} / 280` })) : XPOSTS, paragraphsDone: visible.done.length + (visible.partial ? 1 : 0), progress: total ? Math.min(100, s.pos / total * 100) : 0,
    evidence: `${sourced} of ${claims.length} claims sourced`, evidenceShort: claims.length ? `${sourced} of ${claims.length} claims sourced` : 'Your writing',
    lastAgent: [...s.thread].reverse().find((m): m is Extract<Msg, { who: 'a' }> => m.who === 'a'), toast: undefined as string | undefined,
    send, askChange, stop, keep: () => save('draft'), approve: (when?: string, date?: string) => save(when ? 'scheduled' : 'approved', when, date),
    newPost: () => { if (s.phase !== 'empty' && !s.settled) return false; reset(); return true; }, discard: reset, openRecord: () => patch({ phase: 'record', hasRecord: true }),
    setComposer: (composer: string) => patch({ composer }),
    setFmt: (fmt: Channel) => patch({ fmt }), setView: (view: 'write' | 'preview') => patch({ view }), toggleLens: () => patch({ lens: !s.lens }),
    rename: (title: string) => patch({ title: title.trim() || 'Untitled', settled: false }),
    editPara: (index: number, text: string) => {
      if (text === paraText(s.version.paras[index])) return;
      patch({ version: { ...s.version, paras: s.version.paras.map((p, i) => i === index ? { g: '', segs: [{ t: text }] } : p) }, settled: false, status: 'draft' });
    },
  };
}
export type Workspace = ReturnType<typeof useWorkspace>;

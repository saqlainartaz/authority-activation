import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from './navigation';
import { COPY, FULL, SHORT, DEMO_MSG, REPLY_FULL, REPLY_SHORT, TITLE, XPOSTS, paraText, versionChars, type Channel, type Para, type Version } from '@/shared/data';
import { useData } from './state';
import { toast as notify } from 'sonner';
import { PACKETS, packetAnswer } from './setup-packets';
import { useChatSession } from '@/components/compose/useChatSession';
import { getJson, postJson } from '@/lib/api';
import {
  assembleWorkspaceConversation,
  settledWorkspacePhase,
  showsDraft,
  type WorkspaceConversationMessage,
  type WorkspacePhase,
} from './workspace-presentation';
import { versionFromBody, versionFromReceipt, type ReceiptClaim } from './evidence';

type Msg = WorkspaceConversationMessage | { who: 't'; n: number };
type State = { composer: string; phase: WorkspacePhase; thread: Msg[]; variant: 'full' | 'short'; version: Version; pos: number; formats: Channel[]; fmt: Channel; view: 'write' | 'preview'; status: 'draft' | 'approved' | 'scheduled'; settled: boolean; lens: boolean; typing: boolean; hasRecord: boolean; title: string; id: number | string; when?: string; date?: string };
type VersionHistory = { versions: Array<{ content_version_id: string; body: string; receipt?: ReceiptClaim[] }> };

const initial = (): State => ({ composer: '', phase: 'empty', thread: [], variant: 'full', version: FULL, pos: 0, formats: ['li', 'x'], fmt: 'li', view: 'write', status: 'draft', settled: false, lens: false, typing: false, hasRecord: false, title: TITLE, id: Date.now() });

export function useWorkspace() {
  const d = useData();
  const [params, setParams] = useSearchParams();
  const chat = useChatSession(params.get('session'));
  const requestedPost = params.get('post');
  const [s, set] = useState<State>(() => {
    const post = d.posts.find(p => String(p.id) === params.get('post'));
    const fresh = initial();
    if (params.get('welcome') === '1' && d.onboarding.completed) {
      const company = packetAnswer(PACKETS[4], d.onboarding.answers.company)?.join(' ') || '';
      fresh.thread = [{ who: 'a', text: `I’m your writing assistant. Your setup answers are saved.\n\nYou described the company this way: ${company}`, text2: '', strong: 'Tell me what happened this week, or choose a template to start a draft.' }];
    }
    return post ? { ...initial(), id: post.id, phase: 'record', settled: true, hasRecord: true, title: post.name, status: post.status, fmt: post.ch, formats: [post.ch], when: post.when, date: post.date, version: post.version || versionFromBody(post.body) } : fresh;
  });
  const timer = useRef<number | undefined>(undefined);
  const delay = useRef<number | undefined>(undefined);
  const lastServerVariant = useRef<string | null>(null);
  const chatPhaseKind = chat.phase.kind;
  const chatPhaseText = chat.phase.kind === 'working' ? chat.phase.text : '';
  const chatEchoKey = chat.echo.join('\u0000');
  useEffect(() => () => { clearInterval(timer.current); clearTimeout(delay.current); }, []);

  useEffect(() => {
    if (!requestedPost) return;
    const post = d.posts.find(candidate => String(candidate.id) === requestedPost);
    if (!post || (String(s.id) === requestedPost && s.hasRecord)) return;
    set({
      ...initial(),
      id: post.id,
      phase: 'record',
      settled: true,
      hasRecord: true,
      title: post.name,
      status: post.status,
      fmt: post.ch,
      formats: [post.ch],
      when: post.when,
      date: post.date,
      version: post.version || versionFromBody(post.body),
    });
  }, [d.posts, requestedPost, s.hasRecord, s.id]);
  const patch = (p: Partial<State>) => set(x => ({ ...x, ...p }));

  const selectedVariant = chat.session?.variants.find(variant => variant.id === chat.session?.selected_variant_id) ?? chat.session?.variants.at(-1);
  const selectedBody = selectedVariant?.body ?? null;
  const selectedContentItemId = chat.session?.session.content_item_id ?? null;

  useEffect(() => {
    if (d.isDemo || !selectedBody || !selectedContentItemId) return;
    let active = true;
    void getJson<VersionHistory>(`/api/client/content-items/${encodeURIComponent(selectedContentItemId)}/versions`)
      .then(history => {
        if (!active) return;
        const entry = [...history.versions].reverse().find(version => version.body === selectedBody);
        if (!entry?.receipt?.length) return;
        const version = versionFromReceipt(selectedBody, entry.receipt);
        set(current => String(current.id) === selectedContentItemId
          ? { ...current, version, pos: versionChars(version) }
          : current);
      })
      .catch(() => {
        // Draft rendering remains available when an older backend does not expose receipts.
        // The UI continues to show only the source labels that backend actually returned.
      });
    return () => { active = false; };
  }, [d.isDemo, selectedBody, selectedContentItemId]);

  useEffect(() => {
    if (d.isDemo || params.has('post')) return;
    const envelope = chat.session;
    if (!envelope) {
      if (chat.phase.kind === 'working') {
        const streamedText = chat.phase.text.trim();
        set(current => {
          const live = { who: 'a' as const, text: streamedText, text2: '', strong: '' };
          const thread = streamedText
            ? current.thread.at(-1)?.who === 'a'
              ? [...current.thread.slice(0, -1), live]
              : [...current.thread, live]
            : current.thread;
          return {
            ...current,
            phase: streamedText ? 'streaming' : 'reading',
            typing: true,
            thread,
          };
        });
        return;
      }
      set(current => ({ ...current, phase: settledWorkspacePhase(current.hasRecord), typing: false }));
      return;
    }
    const selected = envelope.variants.find(variant => variant.id === envelope.selected_variant_id) ?? envelope.variants.at(-1);
    const working = chat.phase.kind === 'working';
    const streamedText = chat.phase.kind === 'working' ? chat.phase.text.trim() : '';
    const visibleThread = assembleWorkspaceConversation(envelope.messages, chat.echo, streamedText);
    if (selected && selected.id !== lastServerVariant.current) {
      lastServerVariant.current = selected.id;
      const version = versionFromBody(selected.body, selected.sources ?? []);
      set(current => ({ ...current, id: envelope.session.content_item_id ?? current.id, phase: 'record', version, pos: versionChars(version), hasRecord: true, settled: true, typing: working, thread: visibleThread, formats: ['li'], fmt: 'li', status: 'draft', title: selected.body.split(/\r?\n/)[0]?.slice(0, 72) || TITLE }));
    } else {
      set(current => ({ ...current, phase: working ? (chat.phase.kind === 'working' && chat.phase.text ? 'streaming' : 'reading') : settledWorkspacePhase(current.hasRecord), typing: working, thread: visibleThread.length ? visibleThread : current.thread }));
    }
    const id = envelope.session.id;
    if (params.get('session') !== id) {
      const next = new URLSearchParams(params);
      next.set('session', id);
      next.delete('welcome');
      setParams(next, { replace: true });
    }
  }, [chatEchoKey, chatPhaseKind, chatPhaseText, chat.session, d.isDemo, params, setParams]);

  function streamDemo(variant: 'full' | 'short') {
    const version = variant === 'full' ? FULL : SHORT;
    const total = versionChars(version);
    clearInterval(timer.current);
    patch({ phase: 'streaming', version, variant, pos: 0, view: 'write', lens: false, typing: false, settled: false, status: 'draft' });
    const started = Date.now();
    timer.current = window.setInterval(() => {
      const pos = Math.min(total, Math.floor((Date.now() - started) * .28));
      if (pos === total) { clearInterval(timer.current); set(x => ({ ...x, phase: 'record', pos, hasRecord: true, thread: [...x.thread, { who: 't', n: version.paras.length }, { who: 'a', ...(variant === 'full' ? REPLY_FULL : REPLY_SHORT) }] })); }
      else patch({ pos });
    }, 35);
  }

  function send(text: string, channels: Channel[]) {
    if (!['empty', 'record'].includes(s.phase)) return;
    const message = text.trim() || DEMO_MSG;
    if (!d.isDemo && channels.includes('li')) {
      if (channels.includes('x')) notify.info('LinkedIn is connected. X remains a local demonstration because the previous backend supports LinkedIn only.');
      patch({ phase: 'reading', thread: [...s.thread, { who: 'u', text: message }], formats: ['li'], fmt: 'li', settled: false });
      chat.sendTurn(message);
      return;
    }
    if (!d.isDemo) notify.info('X generation remains a local demonstration; the previous backend has no X draft contract.');
    patch({ phase: 'reading', thread: [{ who: 'u', text: message }], formats: channels.length ? channels : ['li'], fmt: channels[0] || 'li', settled: false });
    delay.current = window.setTimeout(() => streamDemo('full'), 850);
  }

  function askChange(text: string) {
    if (s.phase !== 'record' || !text.trim()) return;
    if (!d.isDemo && s.fmt === 'li') { patch({ typing: true }); chat.sendTurn(text); return; }
    const variant = /short|punch/i.test(text) ? 'short' : /long/i.test(text) ? 'full' : null;
    set(x => ({ ...x, thread: [...x.thread, { who: 'u', text }], typing: true }));
    delay.current = window.setTimeout(() => { if (variant) streamDemo(variant); else set(x => ({ ...x, typing: false, thread: [...x.thread, { who: 'a', text: 'You can type “make it shorter” or “make it longer” to try a sample rewrite, or edit the draft directly.', text2: '', strong: '' }] })); }, 500);
  }

  const visible: { done: Para[]; partial?: string } = (() => {
    if (s.phase !== 'streaming' || !d.isDemo) return { done: s.version.paras };
    let used = 0; const done: Para[] = [];
    for (const p of s.version.paras) { const length = paraText(p).length + 1; if (used + length <= s.pos) done.push(p); else return { done, partial: s.pos > used ? paraText(p).slice(0, s.pos - used) : undefined }; used += length; }
    return { done };
  })();

  function stop() {
    clearInterval(timer.current); clearTimeout(delay.current);
    if (!d.isDemo && (s.phase === 'reading' || s.phase === 'streaming')) { chat.cancelTurn(); patch({ phase: s.hasRecord ? 'record' : 'empty', typing: false }); notify.info('Stopped showing this response. The previous backend has no server-side turn-cancellation endpoint.'); return; }
    if (s.phase === 'reading') { patch({ phase: 'empty' }); return; }
    const paras: Para[] = [...visible.done, ...(visible.partial ? [{ g: '' as const, segs: [{ t: visible.partial }] }] : [])];
    patch({ phase: 'record', version: { ...s.version, paras }, hasRecord: true, typing: false });
  }

  const resetLocal = (sessionId?: string) => {
    clearInterval(timer.current);
    clearTimeout(delay.current);
    lastServerVariant.current = null;
    set(initial());
    if (sessionId) setParams({ session: sessionId }, { replace: true });
    else if (params.has('post') || params.has('session')) setParams({}, { replace: true });
  };

  async function startNewPost() {
    if (d.isDemo || chat.activeSessionId === null) {
      chat.cancelTurn();
      resetLocal();
      return true;
    }
    try {
      chat.cancelTurn();
      const replacement = await chat.sendCommand({ kind: 'start_new_post' }, crypto.randomUUID());
      if (!replacement) throw new Error('The current conversation is not available.');
      resetLocal(replacement.session.id);
      return true;
    } catch (reason) {
      notify.error(reason instanceof Error ? reason.message : 'The conversation was not ended. Try again.');
      return false;
    }
  }

  async function save(status: State['status'], when?: string, date?: string, time?: string) {
    const isSampleX = s.fmt === 'x' && !params.has('post');
    const body = isSampleX ? XPOSTS.map(p => p.t).join('\n\n') : s.version.paras.filter(p => !p.miss).map(paraText).join('\n\n');
    if (!body.trim()) { notify.error('Write something before saving.'); return false; }
    if (d.isDemo || s.fmt === 'x' || typeof s.id === 'number') {
      d.savePostLocal({ id: s.id, ch: s.fmt, name: s.title, snip: body.split('\n')[0], body, status, created: 'Today', when, date, day: date ? Number(date.slice(-2)) : undefined, version: s.fmt === 'li' ? s.version : undefined });
      resetLocal(); notify.success(status === 'draft' ? 'Draft saved to your demo Library' : when ? `Demo scheduled for ${when}` : 'Approved in the demo Library'); return true;
    }
    const contentItemId = s.id;
    try {
      let history = await getJson<VersionHistory>(`/api/client/content-items/${encodeURIComponent(contentItemId)}/versions`);
      let latest = history.versions.at(-1);
      if (!latest) {
        const variantId = chat.session?.selected_variant_id;
        if (!variantId) throw new Error('The selected draft is not available.');
        await chat.sendCommand({ kind: 'finish', variant_id: variantId }, crypto.randomUUID());
        history = await getJson<VersionHistory>(`/api/client/content-items/${encodeURIComponent(contentItemId)}/versions`);
        latest = history.versions.at(-1);
      }
      if (!latest) throw new Error('The draft version is not available.');
      if (latest.body !== body) {
        const edited = await postJson<{ content_version_id: string }>(`/api/client/content-items/${encodeURIComponent(contentItemId)}/edit`, { parent_version_id: latest.content_version_id, body }, { idempotencyKey: crypto.randomUUID() });
        latest = { content_version_id: edited.content_version_id, body };
      }
      if (status !== 'draft') await postJson(`/api/client/content-items/${encodeURIComponent(contentItemId)}/approve`, undefined, { idempotencyKey: crypto.randomUUID() });
      if (status === 'scheduled') {
        if (!date || !time) throw new Error('Pick a date and a time.');
        await postJson(`/api/client/content-items/${encodeURIComponent(contentItemId)}/schedule`, { date, time }, { idempotencyKey: crypto.randomUUID() });
      }
      await d.refreshPosts();
      resetLocal();
      notify.success(status === 'draft' ? 'Draft saved to your Library' : when ? `Scheduled for ${when}` : 'Approved and saved to your Library');
      return true;
    } catch (reason) { notify.error(reason instanceof Error ? reason.message : 'Nothing was saved. Try again.'); return false; }
  }

  const total = versionChars(s.version);
  const claims = s.version.paras.flatMap(p => p.segs.flatMap(seg => seg.claim ? [seg.claim] : []));
  const sourced = claims.filter(c => !c.bad).length;
  const showDraft = showsDraft(s.phase, s.hasRecord, d.isDemo);
  const agentActivity = chat.phase.kind === 'working'
    ? chat.phase.text ? null : chat.phase.label || (chat.session ? COPY.reading : 'Starting your session')
    : s.phase === 'reading'
      ? chat.session ? COPY.reading : 'Starting your session'
      : null;
  const agentNotice = chat.phase.kind === 'terminal'
    ? chat.phase.reason
    : chat.phase.kind === 'refusal'
      ? chat.phase.error.message
      : chat.phase.kind === 'expired'
        ? 'This conversation has expired. Start a new post to continue.'
        : chat.phase.kind === 'unknown'
          ? 'This conversation could not be restored. Refresh the page or start a new post.'
          : null;
  return {
    ...s, visible, total, showDraft, agentActivity, agentNotice, xPosts: params.has('post') ? s.version.paras.map(p => ({ t: paraText(p), n: `${paraText(p).length} / 280` })) : XPOSTS, paragraphsDone: visible.done.length + (visible.partial ? 1 : 0), progress: total ? Math.min(100, s.pos / total * 100) : 0,
    evidence: s.version.sources.length ? `${s.version.sources.length} sources retained` : `${sourced} of ${claims.length} claims sourced`, evidenceShort: s.version.sources.length ? `${s.version.sources.length} sources` : claims.length ? `${sourced} of ${claims.length} claims sourced` : 'Your writing', hasEvidenceClaims: claims.length > 0,
    lastAgent: [...s.thread].reverse().find((m): m is Extract<Msg, { who: 'a' }> => m.who === 'a'), toast: undefined as string | undefined,
    send, askChange, stop, keep: () => save('draft'), approve: (when?: string, date?: string, time?: string) => save(when ? 'scheduled' : 'approved', when, date, time),
    startNewPost, openRecord: () => patch({ phase: 'record', hasRecord: true }),
    setComposer: (composer: string) => patch({ composer }), setFmt: (fmt: Channel) => patch({ fmt }), setView: (view: 'write' | 'preview') => patch({ view }), toggleLens: () => patch({ lens: !s.lens }),
    rename: (title: string) => patch({ title: title.trim() || 'Untitled', settled: false }),
    editPara: (index: number, text: string) => { if (text === paraText(s.version.paras[index])) return; patch({ version: { ...s.version, paras: s.version.paras.map((p, i) => i === index ? { g: '', segs: [{ t: text }] } : p) }, settled: false, status: 'draft' }); },
  };
}
export type Workspace = ReturnType<typeof useWorkspace>;

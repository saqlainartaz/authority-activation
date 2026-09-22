import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from './navigation';
import { COPY, FULL, SHORT, DEMO_MSG, REPLY_FULL, REPLY_SHORT, TITLE, XPOSTS, paraText, versionChars, type Channel, type Para, type Version } from '@/shared/data';
import { useData, type SavedPostMedia } from './state';
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
import { versionFromBody, versionFromReceipt, versionFromVariant, versionWithEditedBody, type ReceiptClaim } from './evidence';
import { CHANNELS, CHANNEL_KEYS, DEFAULT_CHANNEL, channelsFromIntent, type SocialPlatform } from '@/shared/channels';

type Msg = WorkspaceConversationMessage | { who: 't'; n: number };
type State = { composer: string; phase: WorkspacePhase; thread: Msg[]; variant: 'full' | 'short'; version: Version; pos: number; formats: Channel[]; fmt: Channel; view: 'write' | 'preview'; status: 'draft' | 'approved' | 'scheduled'; settled: boolean; lens: boolean; typing: boolean; hasRecord: boolean; title: string; id: number | string; when?: string; date?: string; media: SavedPostMedia | null; mediaTouched: boolean; mediaUploading: boolean };
type VersionHistory = { versions: Array<{ content_version_id: string; body: string; receipt?: ReceiptClaim[]; media?: SavedPostMedia | null }> };
type BatchRun = { channels: Channel[]; message: string; index: number; started: boolean; baseline: Partial<Record<Channel, string>>; baselineTaskCount: Partial<Record<Channel, number>>; failed: Channel[] };
type ChannelDraft = { id: number | string; version: Version; title: string; thread: Msg[] };

const initial = (): State => ({ composer: '', phase: 'empty', thread: [], variant: 'full', version: FULL, pos: 0, formats: [DEFAULT_CHANNEL], fmt: DEFAULT_CHANNEL, view: 'write', status: 'draft', settled: false, lens: false, typing: false, hasRecord: false, title: TITLE, id: Date.now(), media: null, mediaTouched: false, mediaUploading: false });

export function useWorkspace() {
  const d = useData();
  const [params, setParams] = useSearchParams();
  const requestedPost = params.get('post');
  const initialSession = useRef(params.get('session'));
  const initialChannel = useRef<Channel>((params.get('channel') as Channel | null) ?? DEFAULT_CHANNEL);
  const initialFormats = useRef<Channel[]>(
    (params.get('channels')?.split(',') ?? []).filter(
      (value): value is Channel => CHANNEL_KEYS.includes(value as Channel),
    ),
  );
  const [s, set] = useState<State>(() => {
    const post = d.posts.find(p => String(p.id) === params.get('post'));
    const fresh = initial();
    fresh.fmt = CHANNEL_KEYS.includes(initialChannel.current) ? initialChannel.current : DEFAULT_CHANNEL;
    fresh.formats = initialFormats.current.includes(fresh.fmt)
      ? initialFormats.current
      : [fresh.fmt];
    if (params.get('welcome') === '1' && d.onboarding.completed) {
      const company = packetAnswer(PACKETS[4], d.onboarding.answers.company)?.join(' ') || '';
      fresh.thread = [{ who: 'a', text: `I’m your writing assistant. Your setup answers are saved.\n\nYou described the company this way: ${company}`, text2: '', strong: 'Tell me what happened this week, or choose a template to start a draft.' }];
    }
    return post ? { ...initial(), id: post.id, phase: 'record', settled: true, hasRecord: true, title: post.name, status: post.status, fmt: post.ch, formats: [post.ch], when: post.when, date: post.date, version: post.version || versionFromBody(post.body), media: post.media ?? null } : fresh;
  });
  // Resolve a direct session link once. Format switches update the address bar
  // but must not tear down and re-key four live hooks while the user is moving
  // between drafts; each hook already owns the authoritative active session
  // for its platform after that initial restore.
  const linkedInChat = useChatSession(initialChannel.current === 'li' ? initialSession.current : null, 'linkedin');
  const instagramChat = useChatSession(initialChannel.current === 'ig' ? initialSession.current : null, 'instagram');
  const xChat = useChatSession(initialChannel.current === 'x' ? initialSession.current : null, 'x');
  const facebookChat = useChatSession(initialChannel.current === 'fb' ? initialSession.current : null, 'facebook');
  const chats = { li: linkedInChat, ig: instagramChat, x: xChat, fb: facebookChat } as const;
  const chat = chats[s.fmt];
  const timer = useRef<number | undefined>(undefined);
  const delay = useRef<number | undefined>(undefined);
  const lastServerVariant = useRef<Partial<Record<Channel, string>>>({});
  const batch = useRef<BatchRun | null>(null);
  const mediaByChannel = useRef<Partial<Record<Channel, SavedPostMedia | null>>>({});
  const draftsByChannel = useRef<Partial<Record<Channel, ChannelDraft>>>({});
  const manualFormat = useRef<Channel | null>(null);
  const [batchRevision, setBatchRevision] = useState(0);
  const chatPhaseKind = chat.phase.kind;
  const chatPhaseText = chat.phase.kind === 'working' ? chat.phase.text : '';
  const chatEchoKey = chat.echo.join('\u0000');
  useEffect(() => () => { clearInterval(timer.current); clearTimeout(delay.current); }, []);

  useEffect(() => {
    const run = batch.current;
    if (!run) return;
    const channel = run.channels[run.index];
    const active = chats[channel];
    const latest = active.session?.variants.find(variant => variant.id === active.session?.selected_variant_id) ?? active.session?.variants.at(-1);
    const advance = (failed: boolean) => {
      if (failed) run.failed.push(channel);
      if (run.index + 1 < run.channels.length) {
        run.index += 1;
        run.started = false;
        set(current => ({ ...current, fmt: run.channels[run.index], phase: 'reading', typing: true }));
        setBatchRevision(value => value + 1);
        return;
      }
      batch.current = null;
      const visibleChannel = [...run.channels].reverse().find(item => draftsByChannel.current[item] !== undefined);
      const visibleDraft = visibleChannel ? draftsByChannel.current[visibleChannel] : undefined;
      set(current => visibleChannel && visibleDraft ? {
        ...current,
        fmt: visibleChannel,
        id: visibleDraft.id,
        version: visibleDraft.version,
        pos: versionChars(visibleDraft.version),
        phase: 'record',
        hasRecord: true,
        settled: true,
        typing: false,
        thread: visibleDraft.thread,
        title: visibleDraft.title,
        media: mediaByChannel.current[visibleChannel] ?? null,
        mediaTouched: mediaByChannel.current[visibleChannel] !== undefined,
      } : { ...current, phase: current.hasRecord ? 'record' : 'empty', typing: false });
      if (run.failed.length) {
        notify.error(`${run.failed.map(item => CHANNELS[item].label).join(', ')} could not be generated. Completed channels were kept.`);
      }
    };
    if (!run.started) {
      if (!active.canSend) return;
      run.started = true;
      active.sendTurn(run.message);
      setBatchRevision(value => value + 1);
      return;
    }
    if (active.phase.kind === 'working' || active.restoring) return;
    if (latest && latest.id !== run.baseline[channel]) {
      const version = versionFromVariant(latest);
      draftsByChannel.current[channel] = {
        id: active.session?.session.content_item_id ?? Date.now(),
        version,
        title: latest.body.split(/\r?\n/)[0]?.slice(0, 72) || TITLE,
        thread: active.session
          ? assembleWorkspaceConversation(active.session.messages, active.echo, '')
          : [],
      };
      advance(false);
      return;
    }
    const taskCount = active.session?.messages.filter(message => message.kind === 'task').length ?? 0;
    if (taskCount > (run.baselineTaskCount[channel] ?? 0)) {
      // The turn completed and persisted the request but produced no draft
      // (for example, it asked a clarification). Treat that channel as an
      // independent failure so the remaining requested channels still run.
      advance(true);
      return;
    }
    if (['refusal', 'terminal', 'expired', 'unknown'].includes(active.phase.kind)) advance(true);
  }, [
    batchRevision,
    facebookChat.canSend, facebookChat.phase.kind, facebookChat.restoring, facebookChat.session,
    instagramChat.canSend, instagramChat.phase.kind, instagramChat.restoring, instagramChat.session,
    linkedInChat.canSend, linkedInChat.phase.kind, linkedInChat.restoring, linkedInChat.session,
    xChat.canSend, xChat.phase.kind, xChat.restoring, xChat.session,
  ]);

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
      media: post.media ?? null,
    });
  }, [d.posts, requestedPost, s.hasRecord, s.id]);
  const patch = (p: Partial<State>) => set(x => ({ ...x, ...p }));

  const selectedVariant = chat.session?.variants.find(variant => variant.id === chat.session?.selected_variant_id) ?? chat.session?.variants.at(-1);
  const selectedBody = selectedVariant?.body ?? null;
  const selectedContentItemId = chat.session?.session.content_item_id ?? null;
  const selectedReceipt = selectedVariant?.receipt;

  useEffect(() => {
    if (d.isDemo || selectedReceipt?.length || !selectedBody || !selectedContentItemId) return;
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
  }, [d.isDemo, selectedBody, selectedContentItemId, selectedReceipt]);

  useEffect(() => {
    if (d.isDemo || params.has('post')) return;
    // The batch coordinator reads each hook directly and owns its channel
    // cache. Synchronising the currently rendered hook here at the same time
    // can associate a late render with the next channel's key.
    if (batch.current) return;
    if (manualFormat.current !== null && manualFormat.current !== s.fmt) return;
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
    if (selected && selected.id !== lastServerVariant.current[s.fmt]) {
      lastServerVariant.current[s.fmt] = selected.id;
      const version = versionFromVariant(selected);
      draftsByChannel.current[s.fmt] = {
        id: envelope.session.content_item_id ?? Date.now(),
        version,
        title: selected.body.split(/\r?\n/)[0]?.slice(0, 72) || TITLE,
        thread: visibleThread,
      };
      set(current => ({
        ...current,
        id: envelope.session.content_item_id ?? current.id,
        // Each channel settles independently. Keep the shared workspace in
        // its busy state until the batch coordinator has advanced through
        // every requested channel, otherwise save actions flash between
        // turns and can expose an incomplete channel cache.
        phase: batch.current ? 'reading' : 'record',
        version,
        pos: versionChars(version),
        hasRecord: true,
        settled: !batch.current,
        typing: Boolean(batch.current) || working,
        thread: visibleThread,
        status: 'draft',
        title: selected.body.split(/\r?\n/)[0]?.slice(0, 72) || TITLE,
        media: null,
        mediaTouched: false,
      }));
    } else {
      set(current => ({
        ...current,
        phase: batch.current ? 'reading' : working ? (chat.phase.kind === 'working' && chat.phase.text ? 'streaming' : 'reading') : settledWorkspacePhase(current.hasRecord),
        typing: Boolean(batch.current) || working,
        thread: visibleThread.length ? visibleThread : current.thread,
      }));
    }
    const id = envelope.session.id;
    const formatList = s.formats.join(',');
    if (params.get('session') !== id || params.get('channel') !== s.fmt || params.get('channels') !== formatList) {
      const next = new URLSearchParams(params);
      next.set('session', id);
      next.set('channel', s.fmt);
      next.set('channels', formatList);
      next.delete('welcome');
      setParams(next, { replace: true });
    }
  }, [chatEchoKey, chatPhaseKind, chatPhaseText, chat.session, d.isDemo, params, s.fmt, s.formats, setParams]);

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
    if (!['empty', 'record'].includes(s.phase)) return false;
    const message = text.trim() || DEMO_MSG;
    const intended = channelsFromIntent(message);
    const requested = intended.length ? intended : channels;
    if (!requested.length) { notify.error('Select at least one channel.'); return false; }
    manualFormat.current = null;
    for (const channel of requested) delete draftsByChannel.current[channel];
    patch({ phase: 'reading', thread: [...s.thread, { who: 'u', text: message }], formats: requested, fmt: requested[0], settled: false, typing: true });
    if (!d.isDemo) {
      batch.current = {
        channels: requested,
        message,
        index: 0,
        started: false,
        failed: [],
        baseline: Object.fromEntries(requested.map(channel => {
          const session = chats[channel].session;
          const selected = session?.variants.find(variant => variant.id === session.selected_variant_id) ?? session?.variants.at(-1);
          return [channel, selected?.id];
        })),
        baselineTaskCount: Object.fromEntries(requested.map(channel => [
          channel,
          chats[channel].session?.messages.filter(message => message.kind === 'task').length ?? 0,
        ])),
      };
      setBatchRevision(value => value + 1);
      return true;
    }
    delay.current = window.setTimeout(() => streamDemo('full'), 850);
    return true;
  }

  function askChange(text: string) {
    if (s.phase !== 'record' || !text.trim()) return false;
    if (!d.isDemo && !chat.canSend) return false;
    if (!d.isDemo) { patch({ typing: true }); chat.sendTurn(text); return true; }
    const variant = /short|punch/i.test(text) ? 'short' : /long/i.test(text) ? 'full' : null;
    set(x => ({ ...x, thread: [...x.thread, { who: 'u', text }], typing: true }));
    delay.current = window.setTimeout(() => { if (variant) streamDemo(variant); else set(x => ({ ...x, typing: false, thread: [...x.thread, { who: 'a', text: 'You can type “make it shorter” or “make it longer” to try a sample rewrite, or edit the draft directly.', text2: '', strong: '' }] })); }, 500);
    return true;
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
    lastServerVariant.current = {};
    manualFormat.current = null;
    draftsByChannel.current = {};
    set(initial());
    if (sessionId) setParams({ session: sessionId, channel: s.fmt }, { replace: true });
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

  async function attachImage(file: File) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      notify.error('Choose a JPEG, PNG, or WebP image.');
      return;
    }
    if (file.size > 4_000_000) {
      notify.error('Images must be 4 MB or smaller.');
      return;
    }
    if (d.isDemo) {
      notify.info('Image persistence is available when the connected backend is running.');
      return;
    }
    patch({ mediaUploading: true });
    const form = new FormData();
    form.set('file', file, file.name);
    form.set('idempotency_key', crypto.randomUUID());
    try {
      const response = await fetch('/api/client/post-media', { method: 'POST', body: form });
      const body = await response.json().catch(() => ({})) as SavedPostMedia & { error?: string };
      if (!response.ok) throw new Error(body.error || `Image upload failed (${response.status}).`);
      mediaByChannel.current[s.fmt] = body;
      set(current => ({ ...current, media: body, mediaTouched: true, mediaUploading: false, status: 'draft', settled: false }));
    } catch (reason) {
      patch({ mediaUploading: false });
      notify.error(reason instanceof Error ? reason.message : 'The image was not uploaded.');
    }
  }

  function removeImage() {
    mediaByChannel.current[s.fmt] = null;
    patch({ media: null, mediaTouched: true, status: 'draft', settled: false });
  }

  function setMediaAlt(altText: string) {
    if (!s.media) return;
    const media = { ...s.media, alt_text: altText.slice(0, 1000) || null };
    mediaByChannel.current[s.fmt] = media;
    patch({ media, mediaTouched: true, status: 'draft', settled: false });
  }

  async function save(status: State['status'], when?: string, date?: string, time?: string) {
    const body = s.version.paras.filter(p => !p.miss).map(paraText).join('\n\n');
    if (!body.trim()) { notify.error('Write something before saving.'); return false; }
    if (d.isDemo || typeof s.id === 'number') {
      d.savePostLocal({ id: s.id, ch: s.fmt, name: s.title, snip: body.split('\n')[0], body, status, created: 'Today', when, date, day: date ? Number(date.slice(-2)) : undefined, version: s.version });
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
      if (latest.body !== body || s.mediaTouched) {
        const edited = await postJson<{ content_version_id: string }>(`/api/client/content-items/${encodeURIComponent(contentItemId)}/edit`, {
          parent_version_id: latest.content_version_id,
          body,
          ...(s.mediaTouched ? { media_id: s.media?.media_id ?? null, media_alt_text: s.media?.alt_text ?? null } : {}),
        }, { idempotencyKey: crypto.randomUUID() });
        latest = { content_version_id: edited.content_version_id, body, media: s.media };
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

  function selectFormat(fmt: Channel) {
    manualFormat.current = fmt;
    mediaByChannel.current[s.fmt] = s.media;
    const cached = draftsByChannel.current[fmt];
    if (cached) {
      set(current => ({
        ...current,
        fmt,
        id: cached.id,
        version: cached.version,
        pos: versionChars(cached.version),
        phase: 'record',
        hasRecord: true,
        typing: false,
        thread: cached.thread,
        title: cached.title,
        media: mediaByChannel.current[fmt] ?? null,
        mediaTouched: mediaByChannel.current[fmt] !== undefined,
      }));
      return;
    }
    const target = chats[fmt];
    const envelope = target.session;
    const selected = envelope?.variants.find(variant => variant.id === envelope.selected_variant_id) ?? envelope?.variants.at(-1);
    if (!envelope || !selected) { patch({ fmt }); return; }
    const version = versionFromVariant(selected);
    set(current => ({
      ...current,
      fmt,
      id: envelope.session.content_item_id ?? current.id,
      version,
      pos: versionChars(version),
      phase: target.phase.kind === 'working' ? 'streaming' : 'record',
      hasRecord: true,
      typing: target.phase.kind === 'working',
      thread: assembleWorkspaceConversation(envelope.messages, target.echo, target.phase.kind === 'working' ? target.phase.text : ''),
      title: selected.body.split(/\r?\n/)[0]?.slice(0, 72) || TITLE,
      media: mediaByChannel.current[fmt] ?? null,
      mediaTouched: mediaByChannel.current[fmt] !== undefined,
    }));
  }

  const total = versionChars(s.version);
  const claims = s.version.paras.flatMap(p => p.segs.flatMap(seg => seg.claim ? [seg.claim] : []));
  const sourced = claims.filter(c => !c.bad).length;
  const showDraft = showsDraft(s.phase, s.hasRecord, d.isDemo);
  const agentActivity = chat.restoring
    ? 'Restoring your session'
    : chat.phase.kind === 'working'
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
    canSend: d.isDemo || chat.canSend,
    send, askChange, stop, keep: () => save('draft'), approve: (when?: string, date?: string, time?: string) => save(when ? 'scheduled' : 'approved', when, date, time),
    attachImage, removeImage, setMediaAlt,
    startNewPost, openRecord: () => patch({ phase: 'record', hasRecord: true }),
    setComposer: (composer: string) => patch({ composer }), setFmt: selectFormat, setView: (view: 'write' | 'preview') => patch({ view }), toggleLens: () => patch({ lens: !s.lens }),
    rename: (title: string) => patch({ title: title.trim() || 'Untitled', settled: false }),
    editBody: (body: string) => { if (body === s.version.paras.map(paraText).join('\n\n')) return; patch({ version: versionWithEditedBody(s.version, body), settled: false, status: 'draft' }); },
    editPara: (index: number, text: string) => { if (text === paraText(s.version.paras[index])) return; patch({ version: { ...s.version, paras: s.version.paras.map((p, i) => i === index ? { g: '', segs: [{ t: text }] } : p) }, settled: false, status: 'draft' }); },
  };
}
export type Workspace = ReturnType<typeof useWorkspace>;

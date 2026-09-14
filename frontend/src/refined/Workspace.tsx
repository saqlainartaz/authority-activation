import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, Square, Plus, Pencil, ChevronDown, ChevronLeft, ChevronRight, ListChecks, Star, RotateCcw, MessageSquare, Check, Eye } from 'lucide-react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/components/ui/input-group';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useWorkspace, type Workspace as WS } from './useWorkspace';
import Schedule from './Schedule';
import AgentThread from './AgentThread';
import PageHeading from './PageHeading';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useData } from './state';
import { useMobile, useTwoPane } from '@/shared/frame';
import { CITES, COPY, PERSON, TEMPLATES, type Channel, type Para } from '@/shared/data';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = { how: ListChecks, win: Star, mistake: RotateCcw, question: MessageSquare };
const Mark = ({ ch, className }: { ch: Channel; className?: string }) => (
  <span className={cn('inline-flex size-4 items-center justify-center rounded-[4px] text-[8px] font-bold text-white', ch === 'li' ? 'bg-[#0A66C2]' : 'bg-black', className)}>{ch === 'li' ? 'in' : 'X'}</span>
);

function Cite({ n }: { n: string }) {
  const c = CITES[n];
  return (
    <Popover>
      <PopoverTrigger className={cn('cursor-pointer pl-px align-super font-sans text-[9.5px] font-bold', c.bad ? 'text-[var(--miss)]' : 'text-[var(--cite)]')}>{n}</PopoverTrigger>
      <PopoverContent className="w-72 text-sm">
        <p className={cn('post-p mb-2 font-serif leading-relaxed', c.bad && 'text-[var(--miss)]')}>{c.q}{c.mark && <mark className="rounded bg-[var(--cite-bg)] px-0.5 text-inherit">{c.mark}</mark>}</p>
        <p className="flex gap-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">{c.s}</span><span className="ml-auto font-mono">{c.loc}</span></p>
      </PopoverContent>
    </Popover>
  );
}

function ParaView({ p, lens, onEdit }: { p: Para; lens: boolean; onEdit?: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  if (editing) return <Textarea autoFocus aria-label="Edit paragraph" className="rf-paragraph-editor" value={text} onChange={e => setText(e.target.value)} onBlur={() => { onEdit?.(text); setEditing(false); }} />;
  return (
    <p tabIndex={onEdit ? 0 : undefined} aria-label={onEdit ? 'Draft paragraph. Press Enter to edit.' : undefined} onDoubleClick={() => { if (onEdit) { setText(p.segs.map(s => s.t).join('')); setEditing(true); } }} onKeyDown={event => { if (event.key === 'Enter' && event.target === event.currentTarget && onEdit) { event.preventDefault(); setText(p.segs.map(s => s.t).join('')); setEditing(true); } }} className={cn('post-p m-0 font-serif text-[15.5px] leading-[1.72]', lens ? 'text-muted-foreground/50' : 'text-foreground')}>
      {p.segs.map((s, i) =>
        s.claim ? (
          <span key={i} className={cn('underline decoration-2 underline-offset-4', s.claim.bad ? 'text-[var(--miss)] decoration-[var(--miss-line)]' : 'decoration-[var(--cite-line)]', lens && 'text-foreground')}>
            {s.t}<Cite n={s.claim.n} />
          </span>
        ) : (<span key={i}>{s.t}</span>),
      )}
    </p>
  );
}

function Sheet({ ws }: { ws: WS }) {
  const v = ws.version;
  const { profile } = useData();
  if (ws.view === 'preview') {
    return (
      <Card className="sheet mx-auto w-full max-w-[520px]"><CardContent className="pt-6">
        <div className="mb-4 flex items-center gap-3"><Avatar className="size-10"><AvatarFallback>{PERSON.initials}</AvatarFallback></Avatar><div><p className="text-sm font-semibold leading-tight">{profile.name}</p><p className="text-xs text-muted-foreground">{profile.headline} · {ws.fmt === 'li' ? 'LinkedIn' : 'X'}</p></div></div>
        {ws.fmt === 'li' ? v.paras.filter((p) => !p.miss).map((p, i) => <p key={i} className="mb-3 font-serif text-[15.5px] leading-[1.72]">{p.segs.map((s) => s.t).join('')}</p>) : ws.xPosts.map((u, i) => <p key={i} className="mb-3 font-serif text-[15px] leading-[1.7]">{u.t}</p>)}
      </CardContent></Card>
    );
  }
  if (ws.fmt === 'x' && ws.phase === 'record') {
    return (
      <Card className="sheet mx-auto w-full max-w-[520px] rounded-b-none"><CardContent className="pt-6">
        {ws.xPosts.map((u, i) => (
          <div key={i} className="mb-2 grid grid-cols-[18px_1fr] gap-x-3"><span className="pt-1 text-right font-mono text-[11px] text-muted-foreground">{i + 1}/</span><div className="border-l-2 border-border pb-3 pl-3.5"><p className="m-0 font-serif text-[15px] leading-[1.7]">{u.t}</p><p className="mt-1.5 font-mono text-[11px] text-muted-foreground">{u.n}</p></div></div>
        ))}
      </CardContent></Card>
    );
  }
  return (
    <Card className={cn('sheet mx-auto w-full max-w-[520px] rounded-b-none', ws.phase === 'streaming' ? 'min-h-[60vh]' : 'min-h-[calc(100%-2.25rem)]')}><CardContent className="pt-6 pb-24">
      <div className="grid grid-cols-[18px_1fr] gap-x-3 gap-y-3.5">
        {ws.visible.done.map((p, i) => (
          <div key={i} className="contents">
            <span className={cn('text-right font-mono text-xs leading-[1.72] select-none', p.g === 'c' ? 'text-[var(--cite-mark)]' : p.g === 'm' ? 'text-[var(--miss-mark)]' : 'text-transparent')}>—</span>
            <ParaView p={p} lens={ws.lens} onEdit={ws.phase === 'record' ? text => ws.editPara(i, text) : undefined} />
          </div>
        ))}
        {ws.visible.partial !== undefined && (
          <div className="contents"><span /><p className="m-0 font-serif text-[15.5px] leading-[1.72]">{ws.visible.partial}<span className="ml-0.5 inline-block h-[1em] w-0.5 animate-pulse bg-foreground align-[-2px]" /></p></div>
        )}
      </div>
      {ws.phase === 'record' && (
        <div className="sources mt-7 border-t pt-4">
          <p className="ui-label mb-2 text-xs text-muted-foreground">Sources</p>
          {v.sources.map((s) => <p key={s.n} className="flex items-baseline gap-3 py-1 text-xs"><span className={cn('w-3 font-semibold', s.bad ? 'text-[var(--miss)]' : 'text-[var(--cite)]')}>{s.n}</span><span>{s.t}</span><span className="locator ml-auto font-mono text-[10.5px] text-muted-foreground">{s.loc}</span></p>)}
        </div>
      )}
    </CardContent></Card>
  );
}

/** How much of the draft carries a source, and the lens that shows which parts do not. It sits in
 *  a bar rather than floating: a pill hovering over a scrolling document lands on a live sentence
 *  at some scroll position whatever padding is under it, and that is what read as chrome dropped
 *  onto the screen. `short` is the phone form, four words instead of a sentence. */
function Evidence({ ws, iconLens, className }: { ws: WS; iconLens?: boolean; className?: string }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-1.5 text-xs', className)}>
      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <span className="size-1.5 shrink-0 rounded-full bg-[var(--cite-mark)]" />
        <span className="truncate">{ws.evidenceShort}</span>
      </span>
      <Button variant={ws.lens ? 'default' : 'ghost'} size={iconLens ? 'icon-xs' : 'xs'} className="shrink-0 gap-1.5 rounded-full" onClick={ws.toggleLens} aria-label={iconLens ? 'Evidence lens' : undefined}>
        <Eye className="size-3" />{!iconLens && 'Evidence lens'}
      </Button>
    </div>
  );
}

function FormatTabs({ ws }: { ws: WS }) {
  return (
    <div className="mx-auto mb-2 flex w-full max-w-[520px] items-center">
      <ToggleGroup value={[ws.fmt]} onValueChange={(v) => { const k = v[v.length - 1]; if (k) ws.setFmt(k as Channel); }} variant="outline" size="sm">
        {ws.formats.includes('li') && <ToggleGroupItem value="li" className="gap-1.5 px-3"><Mark ch="li" /> LinkedIn</ToggleGroupItem>}
        {ws.formats.includes('x') && <ToggleGroupItem value="x" className="gap-1.5 px-3"><Mark ch="x" /> X post</ToggleGroupItem>}
      </ToggleGroup>
      <span className="locator ml-auto font-mono text-[11px] text-muted-foreground">{ws.phase === 'streaming' ? `${Math.min(ws.pos, ws.total).toLocaleString()} / 3,000` : ws.fmt === 'li' ? ws.version.count : '4 posts'}</span>
    </div>
  );
}

/** The registry's InputGroup is the composer: a textarea with a block-end addon row for controls.
 *  Hand-rolling this was where the old build leaked its own spacing and focus behaviour. */
function Composer({ ws, placeholder, channels, onChannels, initialText, selectedChannels }: { ws: WS; placeholder: string; channels?: Channel[]; onChannels?: (c: Channel[]) => void; initialText?: string; selectedChannels?: Channel[] }) {
  const text = ws.composer;
  const setText = ws.setComposer;
  useEffect(() => { if (initialText) setText(initialText); }, [initialText]);
  const submit = () => { if (ws.phase === 'empty') ws.send(text, channels ?? selectedChannels ?? ['li', 'x']); else ws.askChange(text); setText(''); };
  return (
    <div className="w-full">
      <InputGroup className="rounded-xl">
        <InputGroupTextarea value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} className="min-h-11 px-3"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} />
        <InputGroupAddon align="block-end">
          {channels && onChannels && (
            <ToggleGroup multiple value={channels} onValueChange={(v) => onChannels(v as Channel[])} variant="outline" size="sm">
              <ToggleGroupItem value="li" className="gap-1.5"><Mark ch="li" /> LinkedIn {channels.includes('li') && <Check className="size-3" />}</ToggleGroupItem>
              <ToggleGroupItem value="x" className="gap-1.5"><Mark ch="x" /> X {channels.includes('x') && <Check className="size-3" />}</ToggleGroupItem>
            </ToggleGroup>
          )}
          {ws.phase === 'streaming'
            ? <InputGroupButton size="icon-sm" variant="default" className="ml-auto rounded-full" onClick={ws.stop} aria-label="Stop"><Square className="size-3 fill-current" /></InputGroupButton>
            : <InputGroupButton size="icon-sm" variant="default" className="ml-auto rounded-full" onClick={submit} aria-label="Send"><ArrowUp /></InputGroupButton>}
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}

function Thread({ ws, inlineDraft = false, draft }: { ws: WS; inlineDraft?: boolean; draft?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3.5">
      <AgentThread ws={ws} inlineDraft={inlineDraft} draft={draft} />
      {ws.phase === 'reading' && (<><Badge variant="outline" className="w-fit animate-pulse font-normal text-muted-foreground">{COPY.reading}…</Badge><Card><CardContent className="space-y-2.5 p-4"><Skeleton className="h-3 w-2/5" /><Skeleton className="h-3 w-3/4" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-2/3" /></CardContent></Card></>)}
      {ws.phase === 'streaming' && <Badge variant="outline" className="w-fit animate-pulse font-normal text-muted-foreground">{COPY.writing(ws.paragraphsDone, ws.version.paras.length)}</Badge>}
      {ws.typing && <div className="flex gap-1 px-2 py-2"><span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" /><span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:.15s]" /><span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:.3s]" /></div>}
    </div>
  );
}

/** On a narrow screen the result is part of the assistant's message. Preview
 * changes this card in place; save actions remain beside the composer. */
function InlineDraft({ ws, onRename }: { ws: WS; onRename: () => void }) {
  const { profile } = useData();
  const [editing, setEditing] = useState(false);
  const streaming = ws.phase === 'streaming';
  const preview = ws.view === 'preview' && !streaming;
  useEffect(() => { if (streaming) setEditing(false); }, [streaming]);
  return <Card className="rf-inline-draft" role="article" aria-label="Draft result">
    <div className="rf-inline-draft-heading"><span>{streaming ? 'Writing your draft' : ws.status === 'draft' ? 'Draft' : ws.status === 'approved' ? 'Approved' : 'Scheduled'}</span>{!streaming && <Button variant="ghost" size="icon" aria-label="Rename draft" onClick={onRename}><Pencil /></Button>}<h2>{streaming ? 'Your post is taking shape…' : ws.title}</h2></div>
    <div className="rf-inline-draft-controls"><FormatTabs ws={ws} />{!streaming && <div className="rf-inline-view-controls"><Button variant={preview ? 'secondary' : 'ghost'} aria-pressed={preview} onClick={() => { setEditing(false); ws.setView(preview ? 'write' : 'preview'); }}><Eye />{preview ? 'Back to draft' : 'Preview post'}</Button><Button variant={editing ? 'secondary' : 'ghost'} aria-pressed={editing} onClick={() => { ws.setView('write'); setEditing(value => !value); }} disabled={ws.fmt === 'x'}><Pencil />{editing ? 'Done editing' : 'Edit text'}</Button></div>}</div>
    <div className={`rf-inline-draft-text ${preview ? 'rf-inline-feed-preview' : ''}`}>
      {preview && <div className="rf-inline-author"><Avatar className="size-9"><AvatarFallback>{PERSON.initials}</AvatarFallback></Avatar><span><b>{profile.name}</b><small>{profile.headline} · {ws.fmt === 'li' ? 'LinkedIn' : 'X'}</small></span></div>}
      {ws.fmt === 'x' && !streaming ? ws.xPosts.map((post, i) => <p className="post-p" key={i}>{post.t}</p>) : ws.visible.done.map((p, i) => preview ? !p.miss && <p className="post-p" key={i}>{p.segs.map(s => s.t).join('')}</p> : editing ? <Textarea key={i} aria-label={`Edit paragraph ${i + 1}`} className="rf-paragraph-editor" value={p.segs.map(s => s.t).join('')} onChange={event => ws.editPara(i, event.target.value)} /> : <div key={i}><ParaView p={p} lens={ws.lens} />{p.miss && <span className="rf-inline-needs-source">Needs a source · excluded from the feed preview</span>}</div>)}
      {streaming && <p className="post-p">{ws.visible.partial}<span className="rf-inline-caret" aria-hidden="true" /></p>}
    </div>
    {!streaming && !preview && <Collapsible className="rf-inline-evidence"><CollapsibleTrigger render={<Button variant="ghost" />} className="rf-inline-evidence-trigger"><span>{ws.evidenceShort}</span><ChevronDown /></CollapsibleTrigger><CollapsibleContent><Evidence ws={ws} />{ws.version.sources.length ? <ul>{ws.version.sources.map(source => <li key={source.n}><span>{source.n}. {source.t}</span><small>{source.loc}</small></li>)}</ul> : <p>No source citations in this draft.</p>}</CollapsibleContent></Collapsible>}
    {streaming && <div className="rf-inline-draft-actions"><span>{COPY.writing(ws.paragraphsDone, ws.version.paras.length)}</span><Button variant="outline" onClick={ws.stop}><Square /> Stop</Button></div>}
  </Card>;
}

function TemplateCarousel({ onSelect }: { onSelect: (starter: string) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  const move = (index: number) => {
    const panel = track.current;
    const slide = panel?.children[index] as HTMLElement | undefined;
    if (panel && slide) panel.scrollTo({ left: slide.offsetLeft, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };
  return <section className="rf-template-carousel" aria-label="Writing templates" aria-roledescription="carousel">
    <div className="rf-template-navigation"><span>Start with a template</span><span className="rf-template-count" aria-live="polite">{current + 1} / {TEMPLATES.length}</span><Button variant="outline" size="icon" aria-label="Previous template" disabled={current === 0} onClick={() => move(current - 1)}><ChevronLeft /></Button><Button variant="outline" size="icon" aria-label="Next template" disabled={current === TEMPLATES.length - 1} onClick={() => move(current + 1)}><ChevronRight /></Button></div>
    <div className="rf-template-track" ref={track} onScroll={event => { const panel = event.currentTarget; const slides = Array.from(panel.children) as HTMLElement[]; const nearest = slides.reduce((best, slide, index) => Math.abs(slide.offsetLeft - panel.scrollLeft) < Math.abs(slides[best].offsetLeft - panel.scrollLeft) ? index : best, 0); setCurrent(nearest); }}>
      {TEMPLATES.map((template, index) => { const Icon = ICONS[template.id]; return <div className="rf-template-slide" key={template.id} role="group" aria-roledescription="slide" aria-label={`${index + 1} of ${TEMPLATES.length}`}><Item render={<button type="button" />} variant="outline" onClick={() => onSelect(template.starter)} onFocus={() => move(index)}><ItemMedia variant="icon"><Icon className="size-4" /></ItemMedia><ItemContent><ItemTitle>{template.name}</ItemTitle><ItemDescription>{template.line}</ItemDescription></ItemContent></Item></div>; })}
    </div>
  </section>;
}

function Fresh({ ws, mobile }: { ws: WS; mobile: boolean }) {
  const [channels, setChannels] = useState<Channel[]>(['li', 'x']);
  const [starter, setStarter] = useState('');
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', mobile ? '' : 'items-center justify-center overflow-auto')}>
      <div className={cn('flex w-full flex-col', mobile ? 'rf-fresh-content' : 'max-w-[640px]')}>
        {ws.thread.length > 0 && <div className="rf-setup-welcome"><AgentThread ws={ws} /></div>}
        <h2 className={cn('font-semibold tracking-tight', mobile ? 'mt-auto text-[27px] leading-tight' : 'text-2xl')}>{COPY.fresh}</h2>
        {mobile ? <p className="mt-2 mb-6 flex-none text-sm text-muted-foreground">{COPY.freshSub}</p> : (
          <div className="my-4 flex items-center gap-2 text-xs text-muted-foreground">{COPY.channels}
            <ToggleGroup multiple value={channels} onValueChange={(v) => setChannels(v as Channel[])} variant="outline" size="sm">
              <ToggleGroupItem value="li" className="gap-1.5"><Mark ch="li" /> LinkedIn {channels.includes('li') && <Check className="size-3" />}</ToggleGroupItem>
              <ToggleGroupItem value="x" className="gap-1.5"><Mark ch="x" /> X {channels.includes('x') && <Check className="size-3" />}</ToggleGroupItem>
            </ToggleGroup>
          </div>
        )}
        {!mobile && <Composer ws={ws} placeholder={COPY.placeholder} initialText={starter} selectedChannels={channels} />}
        {!mobile && <p className="ui-label mt-6 mb-2.5 text-xs text-muted-foreground">{COPY.templates}</p>}
        {mobile ? <TemplateCarousel onSelect={value => ws.setComposer(value)} /> : <div className="grid grid-cols-2 gap-2.5">
          {TEMPLATES.map((t) => { const I = ICONS[t.id]; return (
            <Item key={t.id} render={<button type="button" />} variant="outline" className={cn('cursor-pointer items-start text-left hover:bg-muted/50', mobile && 'min-w-[64%] shrink-0 snap-start')} onClick={() => setStarter(t.starter)}>
              <ItemMedia variant="icon"><I className="size-4" /></ItemMedia>
              <ItemContent className="gap-0.5">
                <ItemTitle>{t.name}</ItemTitle>
                <ItemDescription>{t.line}</ItemDescription>
              </ItemContent>
            </Item>); })}
        </div>}
      </div>
      {mobile && <div className="sticky bottom-0 border-t bg-background/90 p-3 backdrop-blur"><Composer ws={ws} placeholder={COPY.placeholder} initialText={starter} channels={channels} onChannels={setChannels} /></div>}
    </div>
  );
}

export default function Workspace() {
  const ws = useWorkspace();
  const mobile = useMobile();
  const twoPane = useTwoPane();
  const [sched, setSched] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [rename, setRename] = useState(false);
  const [title, setTitle] = useState('');
  const conversationScroll = useRef<HTMLDivElement>(null);
  const followConversation = useRef(true);
  useLayoutEffect(() => {
    const panel = conversationScroll.current;
    if (panel && panel.clientHeight > 0 && followConversation.current) panel.scrollTop = panel.scrollHeight;
  }, [ws.pos, ws.thread.length, ws.phase]);
  const hasRecord = ws.phase === 'streaming' || ws.phase === 'record';
  const tryNew = () => { if (!ws.newPost()) setDiscard(true); };

  const record = hasRecord && (
    <div className="flex h-full min-h-0 flex-col">
      {/* One header shape at every width: the title owns its row, and what is true about the draft
          sits under it with the view switch. Packing all five into one row is what forced the
          title to truncate at widths where it had no need to. */}
      <div className="flex-none px-5 pt-3 pb-2">
        <div className="flex items-center gap-1">
          <h2 className={cn('post-title min-w-0 flex-1 truncate font-serif text-[22px] font-medium tracking-tight', !ws.title && 'text-muted-foreground/50')}>{ws.title || 'Untitled'}</h2>
          <Button variant="ghost" size="icon" aria-label="Rename" onClick={() => { setTitle(ws.title); setRename(true); }}><Pencil /></Button>
        </div>
        {ws.phase === 'record' && (
          <div className="mt-1 flex items-center gap-2">
            <Badge variant={ws.status === 'approved' ? 'default' : 'secondary'}>{ws.status === 'draft' ? 'Draft' : ws.status === 'approved' ? 'Approved' : 'Scheduled'}</Badge>
            {ws.view === 'write' && <Evidence ws={ws} iconLens={mobile} className="min-w-0" />}
            <Tabs className="ml-auto shrink-0" value={ws.view} onValueChange={(v) => ws.setView(v as 'write' | 'preview')}><TabsList><TabsTrigger value="write">Write</TabsTrigger><TabsTrigger value="preview">Preview</TabsTrigger></TabsList></Tabs>
          </div>
        )}
      </div>
      <div className="relative flex-1 min-h-0 overflow-auto border-t bg-muted/40 px-5 pt-4 pb-5">
        <FormatTabs ws={ws} />
        <Sheet ws={ws} />
      </div>
      {ws.phase === 'record' && <footer className="flex flex-none items-center justify-end gap-2 border-t bg-background px-3 py-2.5" aria-label="Draft actions"><Button variant="outline" size="sm" disabled={ws.typing} onClick={ws.keep}>{COPY.keep}</Button><Button size="sm" disabled={ws.typing} onClick={() => setSched(true)}>{COPY.approve}</Button></footer>}
    </div>
  );

  const agent = (
    <div className="flex min-h-0 flex-1 flex-col">
      {ws.phase === 'empty' ? <Fresh ws={ws} mobile={mobile} /> : (
        <>
          <div ref={conversationScroll} onScroll={e => { const panel = e.currentTarget; followConversation.current = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 80; }} className="rf-conversation-scroll flex min-h-0 flex-1 flex-col overflow-auto px-6 py-5"><div className="mx-auto w-full max-w-[680px]"><Thread ws={ws} inlineDraft={!twoPane} draft={!twoPane ? <InlineDraft ws={ws} onRename={() => { setTitle(ws.title); setRename(true); }} /> : undefined} /></div></div>
          <div className="rf-workspace-composer flex-none px-6 pb-5"><div className="mx-auto max-w-[680px]">
            {!twoPane && ws.phase === 'record' && <div className="rf-composer-post-actions" role="group" aria-label="Post actions"><Button variant="outline" disabled={ws.typing} onClick={ws.keep}>{COPY.keep}</Button><Button disabled={ws.typing} onClick={() => setSched(true)}>{COPY.approve}</Button></div>}
            <Composer ws={ws} placeholder={COPY.changePlaceholder} />
          </div></div>
        </>
      )}
    </div>
  );


  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-background text-foreground">
      <header className="rf-workspace-header rf-refined-header flex h-13 flex-none items-center gap-2 border-b px-4">
        <PageHeading title="Workspace" />
        <span className="flex-1" />
        {(hasRecord || ws.hasRecord) && <Button variant="ghost" size="sm" className="rf-header-new-post" onClick={tryNew}><Plus /> {COPY.newPost}</Button>}
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
      {twoPane ? (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">{agent}</div>
          {/* The document grows with the screen, but never starves the agent. A fixed 600px left
              the agent 244px at the 1100px two-pane threshold, narrow enough to wrap a short
              message onto five lines. */}
          {hasRecord && <aside className="w-[clamp(440px,52%,640px)] flex-none border-l">{record}</aside>}
        </div>
      ) : (
        <div className="rf-workspace-panel">{agent}</div>
      )}
      </div>
      <Schedule open={sched} onClose={() => setSched(false)} onPick={(label, date) => { setSched(false); ws.approve(label || undefined, date); }} />
      <Dialog open={rename} onOpenChange={setRename}><DialogContent><DialogHeader><DialogTitle>Rename post</DialogTitle><DialogDescription>A title to find this post in your Library.</DialogDescription></DialogHeader><Input autoFocus aria-label="Post title" value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && title.trim()) { ws.rename(title); setRename(false); } }} /><DialogFooter><Button variant="outline" onClick={() => setRename(false)}>Cancel</Button><Button disabled={!title.trim()} onClick={() => { ws.rename(title); setRename(false); }}>Save title</Button></DialogFooter></DialogContent></Dialog>
      {mobile ? (
        <Drawer open={discard} onOpenChange={setDiscard} showSwipeHandle>
          <DrawerContent><DrawerHeader><DrawerTitle>{COPY.discardTitle}</DrawerTitle><DrawerDescription>{COPY.discardBody}</DrawerDescription></DrawerHeader>
            <DrawerFooter className="flex-row"><Button variant="outline" className="flex-1" onClick={() => setDiscard(false)}>{COPY.keepEditing}</Button><Button className="flex-1" onClick={() => { setDiscard(false); ws.discard(); }}>{COPY.discard}</Button></DrawerFooter>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={discard} onOpenChange={setDiscard}>
          <DialogContent className="sm:max-w-[420px]"><DialogHeader><DialogTitle>{COPY.discardTitle}</DialogTitle><DialogDescription>{COPY.discardBody}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDiscard(false)}>{COPY.keepEditing}</Button><Button onClick={() => { setDiscard(false); ws.discard(); }}>{COPY.discard}</Button></DialogFooter></DialogContent>
        </Dialog>
      )}
      {(twoPane || !hasRecord) && ws.toast && (
        <div role="status" className="absolute bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg">{ws.toast}</div>
      )}
    </div>
  );
}

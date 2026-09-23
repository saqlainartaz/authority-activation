import { useEffect, useState } from 'react';
import { useNavigate } from './navigation';
import { format } from 'date-fns';
import { Check, Copy, Download, Search, List, Columns3, SlidersHorizontal } from 'lucide-react';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Calendar } from '@/components/ui/calendar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerTrigger, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter } from '@/components/ui/drawer';
import { useData, type SavedPost } from './state';
import ChannelMark from './ChannelMark';
import Schedule from './Schedule';
import { useMobile } from '@/shared/frame';
import PageHeading from './PageHeading';
import FormattedText from './FormattedText';
import { getJson, postJson } from '@/lib/api';
import { rescheduleSlotInstant, scheduleZone } from './schedule-zone';
import { CHANNELS, CHANNEL_KEYS, type Channel } from '@/shared/channels';

const labels = { draft: 'Draft', approved: 'Approved', scheduled: 'Scheduled', posted: 'Posted' };
const lanes = ['draft', 'approved', 'scheduled', 'posted'] as const;
type Publication = { id: string; status: 'planned' | 'connection_required' | 'queued' | 'publishing' | 'published' | 'failed' | 'outcome_unknown' | 'cancelled'; error_message: string | null };
function backendLabel(value?: string | null) {
  if (!value) return null;
  return value.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());
}
function scheduleLabel(post: SavedPost): string {
  if (post.status !== 'scheduled') return backendLabel(post.backendState) || labels[post.status];
  if (post.ch !== 'li' || post.publication?.status === 'planned') return 'Planned';
  if (post.publication?.status === 'connection_required') return 'Connection required';
  return labels.scheduled;
}
function Status({ value, backendState, post }: { value: keyof typeof labels; backendState?: string | null; post?: SavedPost }) {
  const label = post ? scheduleLabel(post) : value === 'scheduled' ? labels.scheduled : backendLabel(backendState) || labels[value];
  return <Badge variant="outline" className={`rf-status rf-status-${value}`}><i />{label}</Badge>;
}
export default function Library() {
  const d = useData();
  const today = d.isDemo ? new Date(2026, 2, 4) : new Date();
  const navigate = useNavigate();
  const mobile = useMobile();
  const [boardStatus, setBoardStatus] = useState('draft');
  const [view, setView] = useState('table');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [channels, setChannels] = useState<string[]>([]);
  const [date, setDate] = useState<Date>();
  const [peekId, setPeekId] = useState<number | string | null>(null);
  const [schedule, setSchedule] = useState(false);
  const [compact, setCompact] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [publishingEnabled, setPublishingEnabled] = useState(false);
  const [linkedInConnected, setLinkedInConnected] = useState(false);
  const [postingId, setPostingId] = useState<string | null>(null);
  const [pendingPublicationId, setPendingPublicationId] = useState<string | null>(null);
  useEffect(() => {
    if (d.isDemo) return;
    let active = true;
    Promise.all([
      getJson<Array<{ provider: string; publishing_enabled: boolean }>>('/api/client/social/providers'),
      getJson<Array<{ provider: string; status: string; is_default: boolean }>>('/api/client/social/accounts'),
    ])
      .then(([providers, accounts]) => { if (active) { setPublishingEnabled(providers.some(provider => provider.provider === 'linkedin' && provider.publishing_enabled)); setLinkedInConnected(accounts.some(account => account.provider === 'linkedin' && account.status === 'connected' && account.is_default)); } })
      .catch(() => { if (active) { setPublishingEnabled(false); setLinkedInConnected(false); } });
    return () => { active = false; };
  }, [d.isDemo]);
  useEffect(() => {
    if (d.isDemo) return;
    const refresh = () => { if (document.visibilityState === 'visible') void d.refreshPosts().catch(() => undefined); };
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [d.isDemo, d.refreshPosts]);
  useEffect(() => {
    if (!pendingPublicationId) return;
    let active = true;
    let attempts = 0;
    const check = async () => {
      try {
        const publications = await getJson<Publication[]>('/api/client/social/publications');
        if (!active) return;
        const result = publications.find(item => item.id === pendingPublicationId);
        if (result?.status === 'published') { setPendingPublicationId(null); await d.refreshPosts(); toast.success('Published on LinkedIn'); }
        else if (result && ['failed', 'outcome_unknown', 'cancelled'].includes(result.status)) { setPendingPublicationId(null); toast.error(result.error_message || `Publishing ${result.status.replaceAll('_', ' ')}. Check the publication status before retrying.`); }
      } catch { /* Keep the queued receipt; a transient read failure must not imply a failed post. */ }
      attempts += 1;
      if (attempts >= 40 && active) setPendingPublicationId(null);
    };
    void check();
    const timer = window.setInterval(() => { void check(); }, 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [pendingPublicationId, d.refreshPosts]);
  const peek = d.posts.find(p => p.id === peekId);
  const selectedScheduleZone = scheduleZone(peek ?? null, d.timeZone);
  const filtered = d.posts.filter(p => (status === 'all' || p.status === status) && (!channels.length || channels.includes(p.ch)) && (!query || `${p.name} ${p.body}`.toLowerCase().includes(query.toLowerCase())) && (!date || p.date === format(date, 'yyyy-MM-dd')));
  const hasFilters = status !== 'all' || channels.length > 0 || !!query || !!date;
  const filterCount = Number(status !== 'all') + Number(channels.length > 0) + Number(!!date);
  const filterSummary = [status !== 'all' && labels[status as keyof typeof labels], channels.length > 0 && channels.map(c => CHANNELS[c as Channel].label).join(' + '), date && format(date, 'd MMM')].filter(Boolean).join(' · ');
  const statusCount = (value: string) => d.posts.filter(p => (value === 'all' || p.status === value) && (!channels.length || channels.includes(p.ch)) && (!query || `${p.name} ${p.body}`.toLowerCase().includes(query.toLowerCase())) && (!date || p.date === format(date, 'yyyy-MM-dd'))).length;
  const densityControl = <label className="rf-density-control">Compact rows<Switch checked={compact} onCheckedChange={setCompact} /></label>;
  const searchControl = <div className="rf-library-search"><Search /><Input placeholder="Search posts" aria-label="Search posts" value={query} onChange={e => setQuery(e.target.value)} /></div>;
  const boardLane = status === 'all' ? boardStatus : status;
  const boardPosts = (value: string) => filtered.filter(p => p.status === value).map(post => <button key={post.id} className="rf-board-post" onClick={() => setPeekId(post.id)}><Card><CardContent><ChannelMark channel={post.ch} /><h3>{post.name}</h3><p>{post.body.split('\n')[0]}</p><small>{post.when || post.created}</small></CardContent></Card></button>);
  function clear() { setQuery(''); setStatus('all'); setChannels([]); setDate(undefined); }
  const copy = async (post: SavedPost) => { try { await navigator.clipboard.writeText(post.body); toast.success('Post copied'); } catch { toast.error('Could not access the clipboard.'); } };
  const publishNow = async (post: SavedPost) => {
    if (typeof post.id !== 'string') return;
    setPostingId(post.id);
    try {
      const publication = await postJson<Publication>(`/api/client/content-items/${encodeURIComponent(post.id)}/publish`, undefined, { idempotencyKey: crypto.randomUUID() });
      setPendingPublicationId(publication.id);
      toast.info('Post queued for LinkedIn. We will confirm when it publishes.');
      await d.refreshPosts();
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Could not queue the post.'); }
    finally { setPostingId(null); }
  };
  const applySchedule = async (when: string, date?: string, time?: string) => {
    if (!peek) return;
    if (d.isDemo || typeof peek.id === 'number') {
      d.savePostLocal({ ...peek, status: when ? 'scheduled' : 'approved', when: when || undefined, date, day: date ? Number(date.slice(-2)) : undefined, slotZone: when ? selectedScheduleZone : null });
      setSchedule(false);
      toast.success(when ? `Demo scheduled for ${when}` : 'Approved in demo storage');
      return;
    }
    try {
      const id = encodeURIComponent(peek.id);
      if (peek.status === 'draft') await postJson(`/api/client/content-items/${id}/approve`, undefined, { idempotencyKey: crypto.randomUUID() });
      if (when) {
        if (!date || !time) throw new Error('Pick a date and a time.');
        if (peek.slotId) {
          await postJson(`/api/client/schedule-slots/${encodeURIComponent(peek.slotId)}/reschedule`, { slot_at: rescheduleSlotInstant(peek, date, time) }, { idempotencyKey: crypto.randomUUID() });
        }
        else await postJson(`/api/client/content-items/${id}/schedule`, { date, time }, { idempotencyKey: crypto.randomUUID() });
      } else if (peek.slotId) {
        throw new Error('The previous backend cannot remove a schedule while keeping the item approved. Choose another date instead.');
      }
      await d.refreshPosts();
      setSchedule(false);
      toast.success(when ? `Scheduled for ${when}` : 'Approved without a date');
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'The schedule was not changed.'); }
  };
  return <>
    <header className="rf-topbar rf-refined-header rf-library-header"><PageHeading title="Library" />{mobile ? <Select value={view} onValueChange={value => value && setView(String(value))}><SelectTrigger aria-label="Library view" className="rf-library-view-picker"><SelectValue>{view === 'table' ? 'Table' : 'Board'}</SelectValue></SelectTrigger><SelectContent align="end" alignItemWithTrigger={false}><SelectItem value="table"><List />Table</SelectItem><SelectItem value="board"><Columns3 />Board</SelectItem></SelectContent></Select> : searchControl}</header>
    <Tabs value={view} onValueChange={value => setView(String(value))} className="rf-library-tabs">
      <div className="rf-library-toolbar"><TabsList aria-label="Library view"><TabsTrigger value="table"><List /> Table</TabsTrigger><TabsTrigger value="board"><Columns3 /> Board</TabsTrigger></TabsList>{view === 'table' && <div className="rf-desktop-density">{densityControl}</div>}</div>
      <div className="rf-library-mobile-filters">
        {mobile && searchControl}
        <Drawer open={filtersOpen} onOpenChange={setFiltersOpen} showSwipeHandle><DrawerTrigger render={<Button variant="outline" className="rf-mobile-filter-trigger" />}><SlidersHorizontal />Filters{filterCount > 0 && <span className="rf-count">{filterCount}</span>}</DrawerTrigger>
          <DrawerContent className="rf-filters-sheet"><DrawerHeader><DrawerTitle>Filter posts</DrawerTitle><DrawerDescription>Choose which posts appear in your Library.</DrawerDescription></DrawerHeader><div className="rf-filters-sheet-body">
            <fieldset><legend>Status</legend><RadioGroup aria-label="Post status" value={status} onValueChange={value => setStatus(String(value))}>{['all', ...lanes].map(value => <label key={value}><Radio.Root value={value} className="rf-radio"><Radio.Indicator className="rf-radio-dot" /></Radio.Root><span>{value === 'all' ? 'All posts' : value === 'draft' ? 'Drafts' : labels[value as keyof typeof labels]}</span><small>{statusCount(value)}</small></label>)}</RadioGroup></fieldset>
            <fieldset><legend>Channel</legend>{CHANNEL_KEYS.map(value => <label key={value}><Checkbox checked={channels.includes(value)} onCheckedChange={checked => setChannels(c => checked ? [...c, value] : c.filter(x => x !== value))} /><ChannelMark channel={value} /><span>{CHANNELS[value].label}</span></label>)}</fieldset>
            <label className="rf-filter-date">Scheduled date<Input type="date" value={date ? format(date, 'yyyy-MM-dd') : ''} onChange={event => setDate(event.target.value ? new Date(`${event.target.value}T12:00:00`) : undefined)} /></label>
          </div><DrawerFooter><Button variant="ghost" disabled={!hasFilters} onClick={clear}>Clear filters</Button><Button onClick={() => setFiltersOpen(false)}>Show {filtered.length} {filtered.length === 1 ? 'post' : 'posts'}</Button></DrawerFooter></DrawerContent>
        </Drawer>
        {view === 'table' && <div className="rf-library-list-summary"><span>{filtered.length} {filtered.length === 1 ? 'post' : 'posts'}</span>{densityControl}</div>}
        {filterSummary && <p className="rf-applied-filters">{filterSummary}<button onClick={() => { setStatus('all'); setChannels([]); setDate(undefined); }}>Clear</button></p>}
      </div>
      <div className="rf-library-filters"><Tabs value={status} onValueChange={value => setStatus(String(value))}><TabsList variant="line" aria-label="Post status">{['all', ...lanes].map(value => <TabsTrigger key={value} value={value}>{value === 'all' ? 'All' : value === 'draft' ? 'Drafts' : labels[value as keyof typeof labels]}<span className="rf-count">{statusCount(value)}</span></TabsTrigger>)}</TabsList></Tabs>
        <Popover><PopoverTrigger render={<Button variant="outline" className="rf-filter-button" />}>{channels.length === 1 ? CHANNELS[channels[0] as Channel].label : 'Channel'}</PopoverTrigger><PopoverContent className="rf-filter-popover" align="start">{CHANNEL_KEYS.map(value => <label key={value}><Checkbox checked={channels.includes(value)} onCheckedChange={checked => setChannels(c => checked ? [...c, value] : c.filter(x => x !== value))} /><ChannelMark channel={value} />{CHANNELS[value].label}</label>)}</PopoverContent></Popover>
        <Popover><PopoverTrigger render={<Button variant="outline" className="rf-filter-button" />}>{date ? format(date, 'd MMM') : 'Date'}</PopoverTrigger><PopoverContent className="w-auto p-0"><Calendar mode="single" selected={date} onSelect={setDate} defaultMonth={today} today={today} /></PopoverContent></Popover>{hasFilters && <Button variant="ghost" onClick={clear}>Clear filters</Button>}
      </div>
      <TabsContent value="table" className="rf-library-content"><Table className={compact ? 'rf-library-table rf-compact' : 'rf-library-table'}><colgroup><col className="rf-library-channel-column" /><col /><col className="rf-library-status-column" /><col className="rf-library-created-column" /></colgroup><TableHeader><TableRow><TableHead><span className="sr-only">Channel</span></TableHead><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead></TableRow></TableHeader><TableBody>{filtered.map(post => <TableRow key={post.id} data-content-id={post.id}><TableCell><ChannelMark channel={post.ch} /></TableCell><TableCell><button className="rf-post-open" onClick={() => setPeekId(post.id)}><b>{post.name}</b>{!compact && <span>{post.body.split('\n')[0]}</span>}</button></TableCell><TableCell><Status value={post.status} backendState={post.backendState} post={post} /></TableCell><TableCell>{post.created}</TableCell></TableRow>)}</TableBody></Table>{!filtered.length && <div className="rf-empty"><h2>No posts found</h2><p>Try a different search or clear your filters.</p><Button variant="outline" onClick={clear}>Clear filters</Button></div>}</TabsContent>
      <TabsContent value="board" className={mobile ? 'rf-mobile-board' : 'rf-board'}>{mobile ? <Tabs value={boardLane} onValueChange={value => { setBoardStatus(String(value)); if (status !== 'all') setStatus(String(value)); }} className="rf-board-status-tabs"><TabsList variant="line" aria-label="Board status">{lanes.map(value => <TabsTrigger key={value} value={value}>{value === 'draft' ? 'Drafts' : labels[value]}<span className="rf-count">{statusCount(value)}</span></TabsTrigger>)}</TabsList>{lanes.map(value => <TabsContent key={value} value={value} className="rf-board-lane">{boardPosts(value)}{!filtered.some(p => p.status === value) && <div className="rf-empty"><h2>No {value === 'draft' ? 'drafts' : `${value} posts`}</h2><p>{hasFilters ? 'Try clearing your filters to see more posts.' : 'Posts will appear here when you save or approve them.'}</p>{hasFilters && <Button variant="outline" onClick={clear}>Clear filters</Button>}</div>}</TabsContent>)}</Tabs> : lanes.map(value => <section key={value}><h2><Status value={value} /><span>{filtered.filter(p => p.status === value).length}</span></h2>{boardPosts(value)}</section>)}</TabsContent>
    </Tabs>
    <Dialog open={!!peek && !schedule} onOpenChange={open => !open && !schedule && setPeekId(null)}><DialogContent className="rf-peek"><DialogHeader><DialogTitle>{peek?.name}</DialogTitle><DialogDescription>{peek ? `${CHANNELS[peek.ch].label} post` : 'Post'}</DialogDescription></DialogHeader>
      {peek && (peek.status !== 'draft' || peek.backendState) && <div className="rf-schedule-receipt" role="status"><Check /><div><b>{scheduleLabel(peek)}</b><p>{peek.when ? `${peek.when}${peek.slotZone ? ` (${peek.slotZone})` : ''}` : peek.backendState === 'posted' ? 'Recorded by the backend as posted.' : 'Approved without a date. Schedule it whenever you’re ready.'}</p></div></div>}
      {peek?.publication && <p role="status" className="rf-local-note">LinkedIn: {peek.publication.status.replaceAll('_', ' ')}{peek.publication.error_message ? ` · ${peek.publication.error_message}` : ''}{peek.publication.provider_post_id ? ` · ${peek.publication.provider_post_id}` : ''}</p>}
      {peek?.status === 'scheduled' && peek.ch !== 'li' && <p role="status" className="rf-local-note">Calendar plan only. This channel does not have automatic publishing yet.</p>}
      {peek?.status === 'scheduled' && peek.ch === 'li' && peek.publication?.status === 'planned' && <p role="status" className="rf-local-note">Calendar plan only. Turn on auto-publish in Settings to queue future LinkedIn posts.</p>}
      {peek?.status === 'scheduled' && peek.ch === 'li' && peek.publication?.status === 'connection_required' && <p role="status" className="rf-local-note">Not queued. Connect or reconnect LinkedIn in Settings before the scheduled time.</p>}
      <div className="rf-post-person"><span>SA</span><div><b>Saqlain Artaz</b><p>Founder at InsideSuccess · {peek ? CHANNELS[peek.ch].label : ''}</p></div></div>{peek?.media && <figure className="rf-library-media"><img src={`/api/client/post-media/${encodeURIComponent(peek.media.media_id)}?preview=1`} alt={peek.media.alt_text || ''} /><figcaption>{peek.media.original_name}</figcaption></figure>}<div className="rf-peek-body">{peek?.body.split('\n\n').map((p, i) => <p key={i}><FormattedText text={p} /></p>)}</div><DialogFooter>{peek?.media && <Button variant="outline" render={<a href={`/api/client/post-media/${encodeURIComponent(peek.media.media_id)}`} download />}><Download /> Download image</Button>}<Button variant="outline" onClick={() => peek && copy(peek)}><Copy /> Copy text</Button>{peek?.status !== 'posted' && <Button variant="outline" onClick={() => setSchedule(true)}>{peek?.status === 'scheduled' ? 'Change schedule' : 'Schedule'}</Button>}{peek?.ch === 'li' && peek.status === 'approved' && (!peek.publication || peek.publication.status === 'connection_required') && !d.isDemo && <Button disabled={!publishingEnabled || !linkedInConnected || postingId === peek.id} title={!publishingEnabled ? 'LinkedIn publishing is disabled in this environment.' : !linkedInConnected ? 'Connect LinkedIn in Settings first.' : undefined} onClick={() => void publishNow(peek)}>{postingId === peek.id ? 'Queueing…' : 'Post now'}</Button>}<Button onClick={() => peek && navigate(`/refined/workspace?post=${peek.id}`)}>Open</Button></DialogFooter></DialogContent></Dialog>
    <Schedule open={schedule} onClose={() => setSchedule(false)} onPick={applySchedule} timeZone={selectedScheduleZone} allowWithoutDate={peek?.status !== 'scheduled'} />
  </>;
}

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Search, SlidersHorizontal } from 'lucide-react';
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
function Status({ value, backendState, post }: { value: keyof typeof labels; backendState?: string | null; post?: SavedPost }) {
  const label = value === 'scheduled' || post?.status === 'scheduled' ? labels.scheduled : backendLabel(backendState) || labels[value];
  return <Badge variant="outline" className={`rf-status rf-status-${value}`}><i />{label}</Badge>;
}
export default function Library() {
  const d = useData();
  const today = d.isDemo ? new Date(2026, 2, 4) : new Date();
  const mobile = useMobile();
  const [boardStatus, setBoardStatus] = useState('draft');
  const view = d.libraryView;
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [channels, setChannels] = useState<string[]>([]);
  const [date, setDate] = useState<Date>();
  const [peekId, setPeekId] = useState<number | string | null>(null);
  const [schedule, setSchedule] = useState(false);
  const compact = d.compactRows;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [publishingEnabled, setPublishingEnabled] = useState(false);
  const [linkedInConnected, setLinkedInConnected] = useState(false);
  const [postingId, setPostingId] = useState<string | null>(null);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<SavedPost['id'] | null>(null);
  const [deleting, setDeleting] = useState(false);
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
  const deleteTarget = d.posts.find(p => p.id === deleteId);
  const selectedScheduleZone = scheduleZone(peek ?? null, d.timeZone);
  const filtered = d.posts.filter(p => (status === 'all' || p.status === status) && (!channels.length || channels.includes(p.ch)) && (!query || `${p.name} ${p.body}`.toLowerCase().includes(query.toLowerCase())) && (!date || p.date === format(date, 'yyyy-MM-dd')));
  const hasFilters = status !== 'all' || channels.length > 0 || !!query || !!date;
  const filterCount = Number(status !== 'all') + Number(channels.length > 0) + Number(!!date);
  const filterSummary = [status !== 'all' && labels[status as keyof typeof labels], channels.length > 0 && channels.map(c => CHANNELS[c as Channel].label).join(' + '), date && format(date, 'd MMM')].filter(Boolean).join(' · ');
  const statusCount = (value: string) => d.posts.filter(p => (value === 'all' || p.status === value) && (!channels.length || channels.includes(p.ch)) && (!query || `${p.name} ${p.body}`.toLowerCase().includes(query.toLowerCase())) && (!date || p.date === format(date, 'yyyy-MM-dd'))).length;
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
  const returnToDraft = async (post: SavedPost) => {
    if (d.isDemo || typeof post.id === 'number') {
      d.savePostLocal({ ...post, status: 'draft', when: undefined, date: undefined, day: undefined, slotId: null, slotZone: null, publication: null });
      toast.success('Returned to Draft');
      return;
    }
    setWithdrawingId(post.id);
    try {
      await postJson(`/api/client/content-items/${encodeURIComponent(post.id)}/return-to-draft`, undefined, { idempotencyKey: crypto.randomUUID() });
      await d.refreshPosts();
      toast.success('Schedule cancelled. Post returned to Draft.');
      setPeekId(null);
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Could not withdraw the schedule.'); }
    finally { setWithdrawingId(null); }
  };
  const deletePost = async (post: SavedPost) => {
    setDeleting(true);
    try {
      if (d.isDemo || typeof post.id === 'number') d.removePostLocal(post.id);
      else {
        await postJson(`/api/client/content-items/${encodeURIComponent(post.id)}/delete`, undefined, { idempotencyKey: crypto.randomUUID() });
        await d.refreshPosts();
      }
      setDeleteId(null);
      toast.success('Post removed from Library');
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Could not remove this post.'); }
    finally { setDeleting(false); }
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
    <header className="rf-topbar rf-refined-header rf-library-header"><PageHeading title="Library" />{!mobile && searchControl}</header>
    <Tabs value={view} className="rf-library-tabs">
      <div className="rf-library-mobile-filters">
        {mobile && searchControl}
        <Drawer open={filtersOpen} onOpenChange={setFiltersOpen} showSwipeHandle><DrawerTrigger render={<Button variant="outline" className="rf-mobile-filter-trigger" />}><SlidersHorizontal />Filters{filterCount > 0 && <span className="rf-count">{filterCount}</span>}</DrawerTrigger>
          <DrawerContent className="rf-filters-sheet"><DrawerHeader><DrawerTitle>Filter posts</DrawerTitle><DrawerDescription>Choose which posts appear in your Library.</DrawerDescription></DrawerHeader><div className="rf-filters-sheet-body">
            <fieldset><legend>Status</legend><RadioGroup aria-label="Post status" value={status} onValueChange={value => setStatus(String(value))}>{['all', ...lanes].map(value => <label key={value}><Radio.Root value={value} className="rf-radio"><Radio.Indicator className="rf-radio-dot" /></Radio.Root><span>{value === 'all' ? 'All posts' : value === 'draft' ? 'Drafts' : labels[value as keyof typeof labels]}</span><small>{statusCount(value)}</small></label>)}</RadioGroup></fieldset>
            <fieldset><legend>Channel</legend>{CHANNEL_KEYS.map(value => <label key={value}><Checkbox checked={channels.includes(value)} onCheckedChange={checked => setChannels(c => checked ? [...c, value] : c.filter(x => x !== value))} /><ChannelMark channel={value} /><span>{CHANNELS[value].label}</span></label>)}</fieldset>
            <label className="rf-filter-date">Scheduled date<Input type="date" value={date ? format(date, 'yyyy-MM-dd') : ''} onChange={event => setDate(event.target.value ? new Date(`${event.target.value}T12:00:00`) : undefined)} /></label>
          </div><DrawerFooter><Button variant="ghost" disabled={!hasFilters} onClick={clear}>Clear filters</Button><Button onClick={() => setFiltersOpen(false)}>Show {filtered.length} {filtered.length === 1 ? 'post' : 'posts'}</Button></DrawerFooter></DrawerContent>
        </Drawer>
        {view === 'table' && <div className="rf-library-list-summary"><span>{filtered.length} {filtered.length === 1 ? 'post' : 'posts'}</span></div>}
        {filterSummary && <p className="rf-applied-filters">{filterSummary}<button onClick={() => { setStatus('all'); setChannels([]); setDate(undefined); }}>Clear</button></p>}
      </div>
      <div className="rf-library-filters"><Tabs value={status} onValueChange={value => setStatus(String(value))}><TabsList variant="line" aria-label="Post status">{['all', ...lanes].map(value => <TabsTrigger key={value} value={value}>{value === 'all' ? 'All' : value === 'draft' ? 'Drafts' : labels[value as keyof typeof labels]}<span className="rf-count">{statusCount(value)}</span></TabsTrigger>)}</TabsList></Tabs>
        <Popover><PopoverTrigger render={<Button variant="outline" className="rf-filter-button" />}>{channels.length === 1 ? CHANNELS[channels[0] as Channel].label : 'Channel'}</PopoverTrigger><PopoverContent className="rf-filter-popover" align="start">{CHANNEL_KEYS.map(value => <label key={value}><Checkbox checked={channels.includes(value)} onCheckedChange={checked => setChannels(c => checked ? [...c, value] : c.filter(x => x !== value))} /><ChannelMark channel={value} />{CHANNELS[value].label}</label>)}</PopoverContent></Popover>
        <Popover><PopoverTrigger render={<Button variant="outline" className="rf-filter-button" />}>{date ? format(date, 'd MMM') : 'Date'}</PopoverTrigger><PopoverContent className="w-auto p-0"><Calendar mode="single" selected={date} onSelect={setDate} defaultMonth={today} today={today} /></PopoverContent></Popover>{hasFilters && <Button variant="ghost" onClick={clear}>Clear filters</Button>}
      </div>
      <TabsContent value="table" className="rf-library-content"><Table className={compact ? 'rf-library-table rf-compact' : 'rf-library-table'}><colgroup><col className="rf-library-channel-column" /><col /><col className="rf-library-status-column" /><col className="rf-library-created-column" /></colgroup><TableHeader><TableRow><TableHead><span className="sr-only">Channel</span></TableHead><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead></TableRow></TableHeader><TableBody>{filtered.map(post => <TableRow key={post.id} data-content-id={post.id}><TableCell><ChannelMark channel={post.ch} /></TableCell><TableCell><button className="rf-post-open" onClick={() => setPeekId(post.id)}><b>{post.name}</b>{!compact && <span>{post.body.split('\n')[0]}</span>}</button></TableCell><TableCell><Status value={post.status} backendState={post.backendState} post={post} /></TableCell><TableCell>{post.created}</TableCell></TableRow>)}</TableBody></Table>{!filtered.length && <div className="rf-empty"><h2>No posts found</h2><p>Try a different search or clear your filters.</p><Button variant="outline" onClick={clear}>Clear filters</Button></div>}</TabsContent>
      <TabsContent value="board" className={mobile ? 'rf-mobile-board' : 'rf-board'}>{mobile ? <Tabs value={boardLane} onValueChange={value => { setBoardStatus(String(value)); if (status !== 'all') setStatus(String(value)); }} className="rf-board-status-tabs"><TabsList variant="line" aria-label="Board status">{lanes.map(value => <TabsTrigger key={value} value={value}>{value === 'draft' ? 'Drafts' : labels[value]}<span className="rf-count">{statusCount(value)}</span></TabsTrigger>)}</TabsList>{lanes.map(value => <TabsContent key={value} value={value} className="rf-board-lane">{boardPosts(value)}{!filtered.some(p => p.status === value) && <div className="rf-empty"><h2>No {value === 'draft' ? 'drafts' : `${value} posts`}</h2><p>{hasFilters ? 'Try clearing your filters to see more posts.' : 'Posts will appear here when you save or approve them.'}</p>{hasFilters && <Button variant="outline" onClick={clear}>Clear filters</Button>}</div>}</TabsContent>)}</Tabs> : lanes.map(value => <section key={value}><h2><Status value={value} /><span>{filtered.filter(p => p.status === value).length}</span></h2>{boardPosts(value)}</section>)}</TabsContent>
    </Tabs>
    <Dialog open={!!peek && !schedule} onOpenChange={open => !open && !schedule && setPeekId(null)}>
      <DialogContent className="rf-peek">
        <div className="rf-peek-preview" aria-label="Post preview">
          <p className="rf-peek-section-label">Post preview</p>
          <article className="rf-peek-post">
            <div className="rf-post-person"><span>{d.profile.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'PP'}</span><div><b>{d.profile.name}</b><p>{d.profile.headline ? `${d.profile.headline} · ` : ''}{peek ? CHANNELS[peek.ch].label : ''}</p></div></div>
            <div className="rf-peek-body">{peek?.body.split('\n\n').map((p, i) => <p key={i}><FormattedText text={p} /></p>)}</div>
            {peek?.media && <figure className="rf-library-media"><img src={`/api/client/post-media/${encodeURIComponent(peek.media.media_id)}?preview=1`} alt={peek.media.alt_text || ''} /></figure>}
          </article>
        </div>
        <div className="rf-peek-info">
          <DialogHeader className="rf-peek-heading">
            <DialogDescription>{peek ? `${CHANNELS[peek.ch].label} post` : 'Post'}</DialogDescription>
            <DialogTitle>{peek?.name}</DialogTitle>
          </DialogHeader>
          {peek && <div className="rf-peek-properties">
            <div className="rf-peek-property"><span>Status</span><Status value={peek.status} backendState={peek.backendState} post={peek} /></div>
            <div className="rf-peek-property"><span>Channel</span><div className="rf-peek-property-value"><ChannelMark channel={peek.ch} />{CHANNELS[peek.ch].label}</div></div>
            {peek.when && <div className="rf-peek-property"><span>Scheduled for</span><div className="rf-peek-property-value rf-peek-date">{peek.when}{peek.slotZone ? <small>{peek.slotZone}</small> : null}</div></div>}
            {!peek.when && peek.status === 'approved' && <p className="rf-peek-note">Approved without a date. Schedule it whenever you’re ready.</p>}
            {peek.backendState === 'posted' && <p className="rf-peek-note">Recorded by the backend as posted.</p>}
            {peek.publication && <div className="rf-peek-property"><span>LinkedIn delivery</span><p className="rf-peek-property-value" role="status">{backendLabel(peek.publication.status)}{peek.publication.error_message ? ` · ${peek.publication.error_message}` : ''}{peek.publication.provider_post_id ? ` · ${peek.publication.provider_post_id}` : ''}</p></div>}
            {peek.status === 'scheduled' && peek.ch !== 'li' && <p role="status" className="rf-peek-note">Calendar plan only. This channel does not have automatic publishing yet.</p>}
            {peek.status === 'scheduled' && peek.ch === 'li' && peek.publication?.status === 'planned' && <p role="status" className="rf-peek-note">Calendar plan only. Turn on auto-publish in Settings to queue future LinkedIn posts.</p>}
            {peek.status === 'scheduled' && peek.ch === 'li' && peek.publication?.status === 'connection_required' && <p role="status" className="rf-peek-note">Not queued. Connect or reconnect LinkedIn in Settings before the scheduled time.</p>}
          </div>}
        </div>
        <DialogFooter className="rf-peek-actions">
          <div className="rf-peek-main-actions">
            {peek?.status !== 'posted' && <Button onClick={() => setSchedule(true)}>{peek?.status === 'scheduled' ? 'Change schedule' : 'Schedule'}</Button>}
            {peek?.ch === 'li' && peek.status === 'approved' && (!peek.publication || peek.publication.status === 'connection_required') && !d.isDemo && <Button variant="outline" disabled={!publishingEnabled || !linkedInConnected || postingId === peek.id} title={!publishingEnabled ? 'LinkedIn publishing is disabled in this environment.' : !linkedInConnected ? 'Connect LinkedIn in Settings first.' : undefined} onClick={() => void publishNow(peek)}>{postingId === peek.id ? 'Queueing…' : 'Post now'}</Button>}
            {peek?.status === 'scheduled' && <Button variant="outline" disabled={withdrawingId === peek.id} onClick={() => void returnToDraft(peek)}>{withdrawingId === peek.id ? 'Withdrawing…' : 'Return to Draft'}</Button>}
          </div>
          <div className="rf-peek-utility-actions">
            <Button variant="outline" onClick={() => peek && copy(peek)}>Copy text</Button>
            {peek && <Button variant="outline" className="rf-peek-delete" onClick={() => { setDeleteId(peek.id); setPeekId(null); }}>Delete post</Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={deleteId !== null} onOpenChange={open => { if (!open && !deleting) setDeleteId(null); }}><DialogContent><DialogHeader><DialogTitle>Remove this post?</DialogTitle><DialogDescription>{deleteTarget?.name || 'This post'} will disappear from your Library. Any unpublished schedule will be cancelled. Its text, image, and history remain stored for audit; a post already published on LinkedIn will stay there.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={deleting} onClick={() => setDeleteId(null)}>Cancel</Button><Button variant="destructive" disabled={deleting || !deleteTarget} onClick={() => { if (deleteTarget) void deletePost(deleteTarget); }}>{deleting ? 'Removing…' : 'Delete from Library'}</Button></DialogFooter></DialogContent></Dialog>
    <Schedule open={schedule} onClose={() => setSchedule(false)} onPick={applySchedule} timeZone={selectedScheduleZone} allowWithoutDate={peek?.status !== 'scheduled'} />
  </>;
}

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Check, Copy, Search, CalendarDays, List, Columns3, SlidersHorizontal } from 'lucide-react';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Calendar, CalendarDayButton } from '@/components/ui/calendar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerTrigger, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter } from '@/components/ui/drawer';
import { useData, type SavedPost } from './state';
import { ChannelMark } from './Home';
import Schedule from './Schedule';
import { useMobile } from '@/shared/frame';
import PageHeading from './PageHeading';

const labels = { draft: 'Draft', approved: 'Approved', scheduled: 'Scheduled' };
function Status({ value }: { value: keyof typeof labels }) { return <Badge variant="outline" className={`rf-status rf-status-${value}`}><i />{labels[value]}</Badge>; }
export default function Library() {
  const d = useData();
  const navigate = useNavigate();
  const mobile = useMobile();
  const [boardStatus, setBoardStatus] = useState('draft');
  const [view, setView] = useState('table');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [channels, setChannels] = useState<string[]>([]);
  const [date, setDate] = useState<Date>();
  const [selectedDay, setSelectedDay] = useState(new Date(2026, 2, 4));
  const [peekId, setPeekId] = useState<number | null>(null);
  const [schedule, setSchedule] = useState(false);
  const [compact, setCompact] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const peek = d.posts.find(p => p.id === peekId);
  const filtered = d.posts.filter(p => (status === 'all' || p.status === status) && (!channels.length || channels.includes(p.ch)) && (!query || `${p.name} ${p.body}`.toLowerCase().includes(query.toLowerCase())) && (!date || p.date === format(date, 'yyyy-MM-dd')));
  const hasFilters = status !== 'all' || channels.length > 0 || !!query || !!date;
  const filterCount = Number(status !== 'all') + Number(channels.length > 0) + Number(!!date);
  const filterSummary = [status !== 'all' && labels[status as keyof typeof labels], channels.length > 0 && channels.map(c => c === 'li' ? 'LinkedIn' : 'X').join(' + '), date && format(date, 'd MMM')].filter(Boolean).join(' · ');
  const statusCount = (value: string) => d.posts.filter(p => (value === 'all' || p.status === value) && (!channels.length || channels.includes(p.ch)) && (!query || `${p.name} ${p.body}`.toLowerCase().includes(query.toLowerCase())) && (!date || p.date === format(date, 'yyyy-MM-dd'))).length;
  const densityControl = <label className="rf-density-control">Compact rows<Switch checked={compact} onCheckedChange={setCompact} /></label>;
  const searchControl = <div className="rf-library-search"><Search /><Input placeholder="Search posts" aria-label="Search posts" value={query} onChange={e => setQuery(e.target.value)} /></div>;
  const boardLane = status === 'all' ? boardStatus : status;
  const boardPosts = (value: string) => filtered.filter(p => p.status === value).map(post => <button key={post.id} className="rf-board-post" onClick={() => setPeekId(post.id)}><Card><CardContent><ChannelMark channel={post.ch} /><h3>{post.name}</h3><p>{post.body.split('\n')[0]}</p><small>{post.when || post.created}</small></CardContent></Card></button>);
  function clear() { setQuery(''); setStatus('all'); setChannels([]); setDate(undefined); }
  const copy = async (post: SavedPost) => { try { await navigator.clipboard.writeText(post.body); toast.success('Post copied'); } catch { toast.error('Could not access the clipboard.'); } };
  return <>
    <header className="rf-topbar rf-refined-header rf-library-header"><PageHeading title="Library" />{mobile ? <Select value={view} onValueChange={value => value && setView(String(value))}><SelectTrigger aria-label="Library view" className="rf-library-view-picker"><SelectValue>{view === 'table' ? 'Table' : view === 'board' ? 'Board' : 'Calendar'}</SelectValue></SelectTrigger><SelectContent align="end" alignItemWithTrigger={false}><SelectItem value="table"><List />Table</SelectItem><SelectItem value="board"><Columns3 />Board</SelectItem><SelectItem value="calendar"><CalendarDays />Calendar</SelectItem></SelectContent></Select> : searchControl}</header>
    <Tabs value={view} onValueChange={value => setView(String(value))} className="rf-library-tabs">
      <div className="rf-library-toolbar"><TabsList aria-label="Library view"><TabsTrigger value="table"><List /> Table</TabsTrigger><TabsTrigger value="board"><Columns3 /> Board</TabsTrigger><TabsTrigger value="calendar"><CalendarDays /> Calendar</TabsTrigger></TabsList>{view === 'table' && <div className="rf-desktop-density">{densityControl}</div>}</div>
      <div className="rf-library-mobile-filters">
        {mobile && searchControl}
        <Drawer open={filtersOpen} onOpenChange={setFiltersOpen} showSwipeHandle><DrawerTrigger render={<Button variant="outline" className="rf-mobile-filter-trigger" />}><SlidersHorizontal />Filters{filterCount > 0 && <span className="rf-count">{filterCount}</span>}</DrawerTrigger>
          <DrawerContent className="rf-filters-sheet"><DrawerHeader><DrawerTitle>Filter posts</DrawerTitle><DrawerDescription>Choose which posts appear in your Library.</DrawerDescription></DrawerHeader><div className="rf-filters-sheet-body">
            <fieldset><legend>Status</legend><RadioGroup aria-label="Post status" value={status} onValueChange={value => setStatus(String(value))}>{['all', 'draft', 'approved', 'scheduled'].map(value => <label key={value}><Radio.Root value={value} className="rf-radio"><Radio.Indicator className="rf-radio-dot" /></Radio.Root><span>{value === 'all' ? 'All posts' : value === 'draft' ? 'Drafts' : labels[value as keyof typeof labels]}</span><small>{statusCount(value)}</small></label>)}</RadioGroup></fieldset>
            <fieldset><legend>Channel</legend>{[['li', 'LinkedIn'], ['x', 'X']].map(([value, label]) => <label key={value}><Checkbox checked={channels.includes(value)} onCheckedChange={checked => setChannels(c => checked ? [...c, value] : c.filter(x => x !== value))} /><ChannelMark channel={value} /><span>{label}</span></label>)}</fieldset>
            <label className="rf-filter-date">Scheduled date<Input type="date" value={date ? format(date, 'yyyy-MM-dd') : ''} onChange={event => setDate(event.target.value ? new Date(`${event.target.value}T12:00:00`) : undefined)} /></label>
          </div><DrawerFooter><Button variant="ghost" disabled={!hasFilters} onClick={clear}>Clear filters</Button><Button onClick={() => setFiltersOpen(false)}>Show {filtered.length} {filtered.length === 1 ? 'post' : 'posts'}</Button></DrawerFooter></DrawerContent>
        </Drawer>
        {view === 'table' && <div className="rf-library-list-summary"><span>{filtered.length} {filtered.length === 1 ? 'post' : 'posts'}</span>{densityControl}</div>}
        {filterSummary && <p className="rf-applied-filters">{filterSummary}<button onClick={() => { setStatus('all'); setChannels([]); setDate(undefined); }}>Clear</button></p>}
      </div>
      <div className="rf-library-filters"><Tabs value={status} onValueChange={value => setStatus(String(value))}><TabsList variant="line" aria-label="Post status">{['all', 'draft', 'approved', 'scheduled'].map(value => <TabsTrigger key={value} value={value}>{value === 'all' ? 'All' : value === 'draft' ? 'Drafts' : labels[value as keyof typeof labels]}<span className="rf-count">{statusCount(value)}</span></TabsTrigger>)}</TabsList></Tabs>
        <Popover><PopoverTrigger render={<Button variant="outline" className="rf-filter-button" />}>{channels.length === 1 ? channels[0] === 'li' ? 'LinkedIn' : 'X' : 'Channel'}</PopoverTrigger><PopoverContent className="rf-filter-popover" align="start">{[['li', 'LinkedIn'], ['x', 'X']].map(([value, label]) => <label key={value}><Checkbox checked={channels.includes(value)} onCheckedChange={checked => setChannels(c => checked ? [...c, value] : c.filter(x => x !== value))} /><ChannelMark channel={value} />{label}</label>)}</PopoverContent></Popover>
        <Popover><PopoverTrigger render={<Button variant="outline" className="rf-filter-button" />}>{date ? format(date, 'd MMM') : 'Date'}</PopoverTrigger><PopoverContent className="w-auto p-0"><Calendar mode="single" selected={date} onSelect={setDate} defaultMonth={new Date(2026, 2, 1)} today={new Date(2026, 2, 4)} /></PopoverContent></Popover>{hasFilters && <Button variant="ghost" onClick={clear}>Clear filters</Button>}
      </div>
      <TabsContent value="table" className="rf-library-content"><Table className={compact ? 'rf-library-table rf-compact' : 'rf-library-table'}><colgroup><col className="rf-library-channel-column" /><col /><col className="rf-library-status-column" /><col className="rf-library-created-column" /></colgroup><TableHeader><TableRow><TableHead><span className="sr-only">Channel</span></TableHead><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead></TableRow></TableHeader><TableBody>{filtered.map(post => <TableRow key={post.id}><TableCell><ChannelMark channel={post.ch} /></TableCell><TableCell><button className="rf-post-open" onClick={() => setPeekId(post.id)}><b>{post.name}</b>{!compact && <span>{post.body.split('\n')[0]}</span>}</button></TableCell><TableCell><Status value={post.status} /></TableCell><TableCell>{post.created}</TableCell></TableRow>)}</TableBody></Table>{!filtered.length && <div className="rf-empty"><h2>No posts found</h2><p>Try a different search or clear your filters.</p><Button variant="outline" onClick={clear}>Clear filters</Button></div>}</TabsContent>
      <TabsContent value="board" className={mobile ? 'rf-mobile-board' : 'rf-board'}>{mobile ? <Tabs value={boardLane} onValueChange={value => { setBoardStatus(String(value)); if (status !== 'all') setStatus(String(value)); }} className="rf-board-status-tabs"><TabsList variant="line" aria-label="Board status">{(['draft', 'approved', 'scheduled'] as const).map(value => <TabsTrigger key={value} value={value}>{value === 'draft' ? 'Drafts' : labels[value]}<span className="rf-count">{statusCount(value)}</span></TabsTrigger>)}</TabsList>{(['draft', 'approved', 'scheduled'] as const).map(value => <TabsContent key={value} value={value} className="rf-board-lane">{boardPosts(value)}{!filtered.some(p => p.status === value) && <div className="rf-empty"><h2>No {value === 'draft' ? 'drafts' : `${value} posts`}</h2><p>{hasFilters ? 'Try clearing your filters to see more posts.' : 'Posts will appear here when you save or approve them.'}</p>{hasFilters && <Button variant="outline" onClick={clear}>Clear filters</Button>}</div>}</TabsContent>)}</Tabs> : (['draft', 'approved', 'scheduled'] as const).map(value => <section key={value}><h2><Status value={value} /><span>{filtered.filter(p => p.status === value).length}</span></h2>{boardPosts(value)}</section>)}</TabsContent>
      <TabsContent value="calendar" className="rf-calendar-layout"><Calendar mode="single" selected={selectedDay} onSelect={value => value && setSelectedDay(value)} defaultMonth={new Date(2026, 2, 1)} today={new Date(2026, 2, 4)} weekStartsOn={1} className="rf-full-calendar" components={{ DayButton: props => { const posts = filtered.filter(p => p.date === format(props.day.date, 'yyyy-MM-dd')); return <CalendarDayButton {...props}><span className="rf-day-number">{props.day.date.getDate()}</span>{posts.slice(0, 3).map(p => <span className="rf-calendar-event" key={p.id}>{p.name}</span>)}{posts.length > 3 && <span>+{posts.length - 3} more</span>}</CalendarDayButton>; } }} /><aside className="rf-day-agenda"><h2>{format(selectedDay, 'EEEE, d MMMM')}</h2>{filtered.filter(p => p.date === format(selectedDay, 'yyyy-MM-dd')).map(post => <button key={post.id} onClick={() => setPeekId(post.id)}><ChannelMark channel={post.ch} /><span><b>{post.name}</b><small>{post.when?.split(', ')[1]}</small></span></button>)}{!filtered.some(p => p.date === format(selectedDay, 'yyyy-MM-dd')) && <p>No posts scheduled for this day.</p>}</aside></TabsContent>
    </Tabs>
    <Dialog open={!!peek && !schedule} onOpenChange={open => !open && !schedule && setPeekId(null)}><DialogContent className="rf-peek"><DialogHeader><DialogTitle>{peek?.name}</DialogTitle><DialogDescription>{peek?.ch === 'li' ? 'LinkedIn post' : 'X post'}</DialogDescription></DialogHeader>
      {peek && peek.status !== 'draft' && <div className="rf-schedule-receipt" role="status"><Check /><div><b>{labels[peek.status]}</b><p>{peek.when || 'Approved without a date. Schedule it whenever you’re ready.'}</p></div></div>}
      <div className="rf-post-person"><span>SA</span><div><b>Saqlain Artaz</b><p>Founder at InsideSuccess · {peek?.ch === 'li' ? 'LinkedIn' : 'X'}</p></div></div><div className="rf-peek-body">{peek?.body.split('\n\n').map((p, i) => <p key={i}>{p}</p>)}</div><DialogFooter><Button variant="outline" onClick={() => peek && copy(peek)}><Copy /> Copy text</Button><Button variant="outline" onClick={() => setSchedule(true)}>{peek?.status === 'scheduled' ? 'Change schedule' : 'Schedule'}</Button><Button onClick={() => peek && navigate(`/refined/workspace?post=${peek.id}`)}>Open</Button></DialogFooter></DialogContent></Dialog>
    <Schedule open={schedule} onClose={() => setSchedule(false)} onPick={(when, date) => { if (peek) d.savePost({ ...peek, status: when ? 'scheduled' : 'approved', when: when || undefined, date, day: date ? Number(date.slice(-2)) : undefined }); setSchedule(false); toast.success(when ? `Scheduled for ${when}` : 'Approved without a date'); }} />
  </>;
}

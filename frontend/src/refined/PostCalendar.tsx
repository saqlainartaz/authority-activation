import { useState } from 'react';
import { format } from 'date-fns';
import { Calendar, CalendarDayButton } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import ChannelMark from './ChannelMark';
import type { SavedPost } from './state';

export default function PostCalendar({ posts, today, onOpen }: { posts: SavedPost[]; today: Date; onOpen: (id: SavedPost['id']) => void }) {
  const [selectedDay, setSelectedDay] = useState(today);
  const selectedKey = format(selectedDay, 'yyyy-MM-dd');
  const scheduled = posts.filter(post => post.status === 'scheduled' && post.date);
  const agenda = scheduled.filter(post => post.date === selectedKey).sort((a, b) => (a.when || '').localeCompare(b.when || ''));
  return <section className="rf-home-calendar" aria-labelledby="rf-calendar-title">
    <div className="rf-calendar-heading"><div><h3 id="rf-calendar-title">Content calendar</h3><p>Plan and review your scheduled posts.</p></div><Button variant="outline" size="sm" onClick={() => setSelectedDay(today)}>Today</Button></div>
    <div className="rf-calendar-layout">
      <Calendar mode="single" selected={selectedDay} onSelect={value => value && setSelectedDay(value)} defaultMonth={today} today={today} weekStartsOn={1} className="rf-full-calendar" components={{ DayButton: props => {
        const dayPosts = scheduled.filter(post => post.date === format(props.day.date, 'yyyy-MM-dd'));
        return <CalendarDayButton {...props} aria-label={`${format(props.day.date, 'EEEE, d MMMM')}, ${dayPosts.length} scheduled ${dayPosts.length === 1 ? 'post' : 'posts'}`}><span className="rf-day-number">{props.day.date.getDate()}</span><span className="rf-calendar-dots" aria-hidden="true">{dayPosts.slice(0, 3).map(post => <i key={post.id} />)}</span><span className="rf-calendar-titles">{dayPosts.slice(0, 2).map(post => <span className="rf-calendar-event" key={post.id}>{post.name}</span>)}</span>{dayPosts.length > 2 && <small>+{dayPosts.length - 2} more</small>}</CalendarDayButton>;
      } }} />
      <aside className="rf-day-agenda"><h2>{format(selectedDay, 'EEEE, d MMMM')}</h2>{agenda.map(post => <button key={post.id} onClick={() => onOpen(post.id)}><ChannelMark channel={post.ch} /><span><b>{post.name}</b><small>{post.when?.split(', ')[1] || 'Scheduled'}</small></span></button>)}{!agenda.length && <p>No posts scheduled for this day.</p>}</aside>
    </div>
  </section>;
}

import { useNavigate } from './navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useData } from './state';
import PageHeading from './PageHeading';
import PostCalendar from './PostCalendar';

function calendarDateInZone(now: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en', {
    year: 'numeric', month: 'numeric', day: 'numeric', timeZone,
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value);
  return new Date(value('year'), value('month') - 1, value('day'), 12);
}

export default function Home({ questions }: { questions: number }) {
  const navigate = useNavigate();
  const d = useData();
  const now = d.isDemo ? new Date(2026, 2, 4, 9) : new Date();
  const calendarToday = d.isDemo ? now : calendarDateInZone(now, d.timeZone);
  const dateLabel = d.isDemo ? 'Wednesday, 4 March' : new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: d.timeZone }).format(now);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: d.timeZone }).format(now));
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return <>
    <header className="rf-topbar rf-home-topbar rf-refined-header"><PageHeading title="Home" /></header>
    <div className="rf-home-scroll"><div className="rf-home-grid">
      <div className="rf-greeting"><div className="rf-mobile-avatar" aria-hidden="true">{d.profile.name.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase()}</div><div><h2>{greeting}, {d.profile.name.split(/\s+/)[0]}</h2><p>{dateLabel}</p></div></div>
      <PostCalendar posts={d.posts} today={calendarToday} onOpen={id => navigate(`/refined/workspace?post=${id}`)} />
      <Card className="rf-summary"><CardContent>
        <h3>This month</h3>
        <dl className="rf-stats"><div><dd>{d.posts.length}</dd><dt>posts</dt></div><div><dd>{d.posts.filter(post => post.status === 'scheduled').length}</dd><dt>scheduled</dt></div><div><dd>{d.sourceCount}</dd><dt>sources</dt></div></dl>
        <h3 className="rf-agent-title">Your agent</h3>
        <div className="rf-agent-line"><span>{d.isDemo && questions ? `${questions} questions waiting` : d.isDemo ? 'You’re all caught up' : 'Review your knowledge'}</span><Button variant="link" className="rf-answer" onClick={() => navigate('/refined/train?tab=questions')}>{d.isDemo && questions ? 'Answer' : 'Review'}</Button></div>
      </CardContent></Card>
    </div></div>
  </>;
}

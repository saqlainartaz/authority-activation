import { useState } from 'react';
import { useNavigate } from './navigation';
import { ArrowRight, Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Item, ItemContent, ItemTitle, ItemDescription } from '@/components/ui/item';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { useData } from './state';
import PageHeading from './PageHeading';

export const TODAY_POSTS = [
  { id: 'launch', time: '09:00', channel: 'li', title: 'Q4 launch announcement', text: 'We spent four months building the wrong thing. Here is what we learned.' },
  { id: 'onboarding', time: '12:30', channel: 'li', title: 'What our onboarding actually costs', text: 'Three days, not six weeks. Here is the maths, with the invoice.' },
  { id: 'hiring', time: '17:00', channel: 'x', title: 'Hiring: senior engineer', text: 'Not because we are scaling. Because we are shipping.' },
];

export function ChannelMark({ channel }: { channel: string }) {
  return <span role="img" className={`rf-channel rf-channel-${channel}`} aria-label={channel === 'li' ? 'LinkedIn' : 'X'}>{channel === 'li' ? 'in' : <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l7.9-9L.8 2h6.5l5.1 6.8L18.9 2Zm-1.1 18h1.8L6.3 3.9H4.4L17.8 20Z" /></svg>}</span>;
}

function CopyPost({ text, title }: { text: string; title: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('Post copied');
      window.setTimeout(() => setCopied(false), 1800);
    } catch { toast.error('Could not access the clipboard. Please try again.'); }
  }
  return <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon" className="rf-copy" aria-label={`Copy ${title}`} onClick={copy} />}>
    {copied ? <Check /> : <Copy />}
  </TooltipTrigger><TooltipContent>{copied ? 'Copied' : 'Copy text'}</TooltipContent></Tooltip>;
}

export default function Home({ questions }: { questions: number }) {
  const navigate = useNavigate();
  const d = useData();
  const now = d.isDemo ? new Date(2026, 2, 4, 9) : new Date();
  const todayKey = d.isDemo ? '2026-03-04' : new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: d.timeZone }).format(now);
  const dateLabel = d.isDemo ? 'Wednesday, 4 March' : new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: d.timeZone }).format(now);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: d.timeZone }).format(now));
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const posts = d.posts.filter(p => p.status === 'scheduled' && p.date === todayKey).sort((a, b) => (a.when || '').localeCompare(b.when || ''));
  return <>
    <header className="rf-topbar rf-home-topbar rf-refined-header"><PageHeading title="Home" /></header>
    <div className="rf-home-scroll"><div className="rf-home-grid">
      <div className="rf-greeting"><div className="rf-mobile-avatar" aria-hidden="true">{d.profile.name.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase()}</div><div><h2>{greeting}, {d.profile.name.split(/\s+/)[0]}</h2><p>{dateLabel}</p></div></div>
      <Card className="rf-hero"><CardContent>
        <h3>Write this week's post</h3>
        <p>Tell me what happened this week and I will draft something you can actually use. {d.sourceCount} {d.sourceCount === 1 ? 'source' : 'sources'} available.</p>
        <Button className="rf-hero-button" onClick={() => navigate('/refined/workspace')}>Open the workspace <ArrowRight /></Button>
      </CardContent></Card>
      <Card className="rf-summary"><CardContent>
        <h3>This month</h3>
        <dl className="rf-stats"><div><dd>{d.posts.length}</dd><dt>posts</dt></div><div><dd>{d.isDemo ? '4' : '—'}</dd><dt>day streak</dt></div><div><dd>{d.sourceCount}</dd><dt>sources</dt></div></dl>
        <h3 className="rf-agent-title">Your agent</h3>
        <div className="rf-agent-line"><span>{d.isDemo && questions ? `${questions} questions waiting` : d.isDemo ? 'You’re all caught up' : 'Review your knowledge'}</span><Button variant="link" className="rf-answer" onClick={() => navigate('/refined/train?tab=questions')}>{d.isDemo && questions ? 'Answer' : 'Review'}</Button></div>
      </CardContent></Card>
      <section className="rf-today" aria-labelledby="rf-today-title"><h3 id="rf-today-title">Today</h3>
        <Card className="rf-day-card"><CardContent><ul>
          {posts.map(post => <li key={post.id}><Item className="rf-post-row">
            <time dateTime={`${todayKey}T${post.when?.split(', ')[1] || '09:00'}`} className="rf-post-time">{post.when?.split(', ')[1] || post.when}</time>
            <ChannelMark channel={post.ch} />
            <ItemContent><ItemTitle>{post.name}</ItemTitle><ItemDescription>{post.body.split('\n')[0]}</ItemDescription></ItemContent>
            <CopyPost text={post.body} title={post.name} />
          </Item></li>)}
          {!posts.length && <li className="rf-today-empty">Nothing scheduled for today. Your saved posts are in the Library.</li>}
        </ul></CardContent></Card>
      </section>
    </div></div>
  </>;
}

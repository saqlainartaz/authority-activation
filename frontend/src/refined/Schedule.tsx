import { useState } from 'react';
import { format } from 'date-fns';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useData } from './state';

export default function Schedule({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (label: string, date?: string) => void }) {
  const [day, setDay] = useState<Date | undefined>();
  const [time, setTime] = useState('09:00');
  const { timeZone } = useData();
  return <Dialog open={open} onOpenChange={value => !value && onClose()}><DialogContent className="rf-schedule"><DialogHeader><DialogTitle>Schedule</DialogTitle><DialogDescription>Pick a day and a time, or approve without a date.</DialogDescription></DialogHeader>
    <div className="rf-quick-dates"><Button variant="outline" onClick={() => setDay(new Date(2026, 2, 5))}>Tomorrow</Button><Button variant="outline" onClick={() => setDay(new Date(2026, 2, 9))}>Next Monday</Button></div>
    <Calendar mode="single" selected={day} onSelect={setDay} defaultMonth={new Date(2026, 2, 1)} today={new Date(2026, 2, 4)} disabled={{ before: new Date(2026, 2, 4) }} weekStartsOn={1} className="rf-schedule-calendar" />
    <label className="rf-time-label">Time<Input type="time" aria-label="Time" value={time} onChange={e => setTime(e.target.value)} /></label><p className="rf-local-note">Time zone: {timeZone.replaceAll('_', ' ')}</p>
    <DialogFooter><Button variant="ghost" onClick={() => onPick('')}>Approve without a date</Button><Button disabled={!day || !/^\d{2}:\d{2}$/.test(time)} onClick={() => day && onPick(`${format(day, 'EEE d MMM')}, ${time} (${timeZone})`, format(day, 'yyyy-MM-dd'))}>Schedule</Button></DialogFooter>
  </DialogContent></Dialog>;
}

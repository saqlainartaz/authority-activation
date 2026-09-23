import { useState } from 'react';
import { addDays, format, nextMonday } from 'date-fns';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useData } from './state';
import { todayInZone } from '@/lib/zoned-instant';

export default function Schedule({ open, onClose, onPick, timeZone, allowWithoutDate = true }: { open: boolean; onClose: () => void; onPick: (label: string, date?: string, time?: string) => void | Promise<void>; timeZone?: string | null; allowWithoutDate?: boolean }) {
  const [day, setDay] = useState<Date | undefined>();
  const [time, setTime] = useState('09:00');
  const [saving, setSaving] = useState(false);
  const { timeZone: clientTimeZone, isDemo } = useData();
  const zone = timeZone === undefined ? clientTimeZone : timeZone;
  const today = isDemo ? new Date(2026, 2, 4) : zone ? new Date(`${todayInZone(zone)}T12:00:00`) : new Date();
  const submit = async (label: string, date?: string, selectedTime?: string) => {
    if (saving) return;
    setSaving(true);
    try { await onPick(label, date, selectedTime); }
    finally { setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={value => !value && onClose()}><DialogContent className="rf-schedule"><DialogHeader><DialogTitle>Schedule</DialogTitle><DialogDescription>Pick a day and a time, or approve without a date.</DialogDescription></DialogHeader>
    <div className="rf-quick-dates"><Button variant="outline" disabled={saving} onClick={() => setDay(addDays(today, 1))}>Tomorrow</Button><Button variant="outline" disabled={saving} onClick={() => setDay(nextMonday(today))}>Next Monday</Button></div>
    <Calendar mode="single" selected={day} onSelect={setDay} defaultMonth={today} today={today} disabled={{ before: today }} weekStartsOn={1} className="rf-schedule-calendar" />
    <label className="rf-time-label">Time<Input type="time" aria-label="Time" disabled={saving} value={time} onChange={e => setTime(e.target.value)} /></label><p className="rf-local-note">{zone ? `Time zone: ${zone.replaceAll('_', ' ')}` : 'Schedule time zone unavailable. Refresh and try again.'}</p>
    <DialogFooter>{allowWithoutDate && <Button variant="ghost" disabled={saving} onClick={() => submit('')}>Approve without a date</Button>}<Button disabled={saving || !zone || !day || !/^\d{2}:\d{2}$/.test(time)} onClick={() => day && zone && submit(`${format(day, 'EEE d MMM')}, ${time} (${zone})`, format(day, 'yyyy-MM-dd'), time)}>{saving ? 'Saving…' : 'Schedule'}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

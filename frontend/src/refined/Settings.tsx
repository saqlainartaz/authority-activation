import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, ShieldCheck, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useMobile } from '@/shared/frame';
import { useData } from './state';
import { useNavigate } from 'react-router-dom';
import { useTheme, type Appearance } from './Theme';

const sections = [['account', 'Account', 'Name, headline, password, log out'], ['preferences', 'Preferences', 'Appearance, learning, time zone'], ['usage', 'Usage', 'Generations left this month'], ['data', 'Data', 'Export and manage your data']];
const preferences = [
  ['Only use my sources', 'Nothing is stated as fact unless it came from your material. Turn this off and the agent can add its own thinking, always in italics and flagged.'],
  ['Learn from what I write', 'Posts you write or edit yourself become voice samples. This is how drafts start sounding like you.'],
  ['Learn from what I reject', 'When you rewrite a draft, remember what you changed.'],
];
function Body({ onLogout }: { onLogout: () => void }) {
  const d = useData();
  const { appearance, setAppearance } = useTheme();
  const mobile = useMobile();
  const [section, setSection] = useState('preferences');
  const [showSection, setShowSection] = useState(false);
  const [profile, setProfile] = useState(d.profile);
  const [saved, setSaved] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const navigationRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (mobile) { if (showSection) headingRef.current?.focus(); else navigationRef.current?.querySelector<HTMLButtonElement>('[data-active]')?.focus(); } }, [mobile, showSection]);
  const preference = (i: number) => <div className="rf-setting-row" key={i}><span><b>{preferences[i][0]}</b><small id={`rf-pref-detail-${i}`}>{preferences[i][1]}</small></span><Switch checked={d.preferences[i]} onCheckedChange={value => d.setPreference(i, value)} aria-label={preferences[i][0]} aria-describedby={`rf-pref-detail-${i}`} /></div>;
  return <Tabs orientation="vertical" value={section} onValueChange={value => { setSection(String(value)); setShowSection(true); }} className={`rf-settings-layout ${mobile && showSection ? 'rf-settings-detail' : ''}`}>
    <div className="rf-settings-sidebar" ref={navigationRef}><div className="rf-settings-person"><span className="rf-logo">SA</span><span><b>{d.profile.name}</b><small>Preview account</small></span></div><TabsList variant="line" aria-label="Settings sections" className="rf-settings-nav">{sections.map(([id, title, description]) => <TabsTrigger key={id} value={id} onClick={() => setShowSection(true)}><span><b>{title}</b><small>{description}</small></span>{mobile && <ChevronRight size={16} />}</TabsTrigger>)}</TabsList></div>
    <div className="rf-settings-body">
      <div className="rf-settings-section-title">{mobile && <Button variant="ghost" size="icon" aria-label="Back to settings sections" onClick={() => setShowSection(false)}><ArrowLeft /></Button>}<h3 ref={headingRef} tabIndex={-1}>{sections.find(s => s[0] === section)?.[1]}</h3></div>
      <TabsContent value="account"><form onSubmit={e => { e.preventDefault(); d.setProfile({ name: profile.name.trim(), headline: profile.headline.trim() }); setSaved(true); }}>
        <label className="rf-account-field">Your name<small>Appears on post previews so they look like your feed.</small><Input required value={profile.name} onChange={e => { setSaved(false); setProfile({ ...profile, name: e.target.value }); }} /></label>
        <label className="rf-account-field">Headline<small>The line under your name in a LinkedIn preview.</small><Input value={profile.headline} onChange={e => { setSaved(false); setProfile({ ...profile, headline: e.target.value }); }} /></label>
        <Button type="submit" disabled={!profile.name.trim()}>Save profile</Button>{saved && <span role="status" className="rf-profile-saved">Saved on this device</span>}
      </form><div className="rf-setting-row"><span><b>Password</b><small>No account service is connected to this preview.</small></span><Button variant="outline" disabled>Change</Button></div><div className="rf-setting-row"><span><b>Log out</b><small>Return to the preview sign-in screen. Your posts stay in the Library.</small></span><Button variant="outline" onClick={onLogout}>Log out</Button></div></TabsContent>
      <TabsContent value="preferences"><section className="rf-preference-group"><h4>Appearance</h4><div className="rf-setting-row rf-timezone-row"><span><b>Theme</b><small>Choose a theme or follow your device.</small></span><Select value={appearance} onValueChange={value => value && setAppearance(value as Appearance)}><SelectTrigger aria-label="Theme"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="light">Light</SelectItem><SelectItem value="dark">Dark</SelectItem><SelectItem value="system">System</SelectItem></SelectContent></Select></div></section><section className="rf-preference-group"><h4>Writing</h4>{preference(0)}</section><section className="rf-preference-group"><h4>Learning</h4>{preference(1)}{preference(2)}</section><section className="rf-preference-group"><h4>Scheduling</h4><div className="rf-setting-row rf-timezone-row"><span><b>Time zone</b><small>Used for every scheduled post.</small></span><Select value={d.timeZone} onValueChange={value => value && d.setTimeZone(value)}><SelectTrigger aria-label="Time zone"><SelectValue /></SelectTrigger><SelectContent>{['Europe/London', 'Europe/Warsaw', 'America/New_York', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Kolkata', 'Australia/Sydney', 'UTC'].map(zone => <SelectItem key={zone} value={zone}>{zone.replaceAll('_', ' ')}</SelectItem>)}</SelectContent></Select></div></section></TabsContent>
      <TabsContent value="usage"><div className="rf-usage"><b>260</b><span>of 500 generations left this month</span><progress value={260} max={500} aria-label="Sample generations remaining" /><small>Sample usage · Standard plan</small></div><div className="rf-setting-row"><span><b>Plan</b><small>Everything is included. The only limit is generations.</small></span><span>Standard</span></div><div className="rf-setting-row"><span><b>What counts as a generation</b><small>One draft, one rewrite, or one format made from another. Edits you type yourself are free.</small></span></div></TabsContent>
      <TabsContent value="data"><div className="rf-data-card"><div className="rf-data-promise"><ShieldCheck size={21} /><span><b>Never used to train anyone’s model</b><small>This preview keeps your changes on this device. No AI service is connected.</small></span></div><dl><div><dd>14</dd><dt>sample sources</dt></div><div><dd>{d.posts.length}</dd><dt>posts and drafts</dt></div><div><dd>Local</dd><dt>storage</dt></div></dl></div><div className="rf-setting-row"><span><b>Export everything</b><small>Download this preview’s posts, guidance, answers, profile, and preferences as JSON. Added documents are stored separately; download them from Knowledge.</small></span><Button variant="outline" onClick={d.exportData}>Export</Button></div><div className="rf-setting-row"><span><b>Delete all sources</b><small>Keeps your posts. Drafts go back to guesswork. Available when source storage is connected.</small></span><Button variant="outline" disabled>Delete sources</Button></div><div className="rf-setting-row"><span><b>Delete account</b><small>Removes everything permanently. No account is connected in this preview.</small></span><Button variant="outline" disabled>Delete account</Button></div></TabsContent>
      <p className="rf-local-note">Prototype settings are saved on this device. Account services and AI learning are not connected.</p>
    </div>
  </Tabs>;
}
export default function Settings({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const mobile = useMobile();
  const navigate = useNavigate();
  const logout = () => { onOpenChange(false); navigate('/refined/signin'); };
  return mobile ? <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle><DrawerContent className="rf-settings-mobile"><DrawerHeader><DrawerTitle>Settings</DrawerTitle><DrawerClose render={<Button variant="ghost" size="icon" aria-label="Close settings" className="ml-auto" />}><X /></DrawerClose><DrawerDescription className="sr-only">Account, preferences, usage and data.</DrawerDescription></DrawerHeader><Body onLogout={logout} /></DrawerContent></Drawer> : <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="rf-settings rf-settings-full"><DialogHeader><DialogTitle>Settings</DialogTitle><DialogDescription className="sr-only">Account, preferences, usage and data.</DialogDescription></DialogHeader><Body onLogout={logout} /></DialogContent></Dialog>;
}

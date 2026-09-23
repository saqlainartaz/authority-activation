import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, ShieldCheck, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMobile } from '@/shared/frame';
import { useData } from './state';
import { useNavigate } from './navigation';
import { useTheme, type Appearance } from './Theme';
import { getJson } from '@/lib/api';
import ChannelMark from './ChannelMark';

type Provider = { provider: 'linkedin'; configured: boolean; publishing_enabled: boolean; capabilities: string[] };
type Account = { id: string; provider: 'linkedin'; display_name: string; token_expires_at: string; status: 'connected' | 'reauth_required' | 'revoked'; is_default: boolean; auto_publish_enabled: boolean };
const oauthMessages: Record<string, string> = {
  connected: 'LinkedIn returned to the app. The verified connection status is shown below.',
  denied: 'LinkedIn authorization was cancelled. Nothing was connected.',
  'invalid-response': 'LinkedIn returned an invalid authorization response. Please try again.',
  'session-expired': 'Your app session expired during connection. Sign in and try again.',
  failed: 'LinkedIn could not be connected. Please try again or contact support.',
};
const sections = [['account', 'Account', 'Name, headline, password, log out'], ['preferences', 'Preferences', 'Appearance, Library and time zone'], ['integrations', 'Integrations', 'Connect social accounts'], ['usage', 'Usage', 'Generations left this month'], ['data', 'Data', 'Export and manage your data']];

function Integrations({ isDemo, result }: { isDemo: boolean; result?: string }) {
  const [provider, setProvider] = useState<Provider | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(!isDemo);
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [changingAuto, setChangingAuto] = useState(false);
  useEffect(() => {
    if (isDemo) return;
    let active = true;
    Promise.all([getJson<Provider[]>('/api/client/social/providers'), getJson<Account[]>('/api/client/social/accounts')])
      .then(([providers, linkedAccounts]) => { if (active) { setProvider(providers.find(item => item.provider === 'linkedin') ?? null); setAccounts(linkedAccounts.filter(item => item.provider === 'linkedin')); setError(''); } })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load social accounts.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isDemo]);
  const connect = async () => {
    setConnecting(true);
    setError('');
    try {
      const response = await fetch('/api/client/social/linkedin/start', { method: 'POST', cache: 'no-store' });
      const body = await response.json().catch(() => ({})) as { authorization_url?: string; error?: string };
      if (!response.ok || !body.authorization_url) throw new Error(body.error || 'Could not start LinkedIn connection.');
      const target = new URL(body.authorization_url);
      if (target.protocol !== 'https:' || target.hostname !== 'www.linkedin.com' || target.pathname !== '/oauth/v2/authorization') throw new Error('LinkedIn returned an unexpected authorization address.');
      window.location.assign(target.toString());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start LinkedIn connection.');
      setConnecting(false);
    }
  };
  const account = accounts.find(item => item.is_default && item.status === 'connected') ?? accounts.find(item => item.status === 'connected') ?? accounts[0];
  const status = account?.status === 'connected' ? 'Connected' : account?.status === 'reauth_required' ? 'Reconnect required' : account?.status === 'revoked' ? 'Disconnected' : 'Not connected';
  const expiry = account?.status === 'connected' ? new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(account.token_expires_at)) : null;
  const changeAuto = async (enabled: boolean) => {
    if (!account) return;
    setChangingAuto(true);
    setError('');
    try {
      const response = await fetch(`/api/client/social/accounts/${encodeURIComponent(account.id)}/auto-publish`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }), cache: 'no-store',
      });
      const body = await response.json().catch(() => ({})) as Account & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Could not change auto-publish.');
      setAccounts(current => current.map(item => item.id === body.id ? body : item));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not change auto-publish.'); }
    finally { setChangingAuto(false); }
  };
  return <section className="rf-preference-group"><h4>Social accounts</h4>
    {result && oauthMessages[result] && <p role="status" className="rf-local-note">{oauthMessages[result]}</p>}
    <div className="rf-integration-card"><ChannelMark channel="li" className="rf-integration-icon" /><div className="rf-integration-details"><div className="rf-integration-heading"><b>LinkedIn</b><span role="status" className={`rf-integration-status ${account?.status === 'connected' ? 'is-connected' : ''}`}>{loading ? 'Loading…' : isDemo ? 'Preview only' : status}</span></div><small>Personal profile{account?.display_name ? ` · ${account.display_name}` : ''}</small>{expiry && <small>Expires {expiry}</small>}</div>
      <Button variant="outline" disabled={isDemo || loading || connecting || !provider?.configured} onClick={connect}>{connecting ? 'Connecting…' : account?.status === 'connected' ? 'Reconnect' : 'Connect LinkedIn'}</Button></div>
    {account?.status === 'connected' && <div className="rf-setting-row"><span><b>Auto-publish scheduled LinkedIn posts</b><small>On by default when you connect. Turning it off keeps future schedules as plans and cancels queued scheduled deliveries. Turning it back on queues future plans. Post now remains available.</small></span><Switch aria-label="Auto-publish scheduled LinkedIn posts" checked={account.auto_publish_enabled} disabled={changingAuto || isDemo} onCheckedChange={value => void changeAuto(value)} /></div>}
    {error && <p role="alert" className="rf-local-note">{error}</p>}
    {!loading && !isDemo && provider && !provider.configured && <p className="rf-integration-note">Reconnect is unavailable until LinkedIn is configured for this environment.</p>}
    {provider && !provider.publishing_enabled && <p className="rf-integration-note">Publishing is off in this environment.</p>}
    <p className="rf-local-note">LinkedIn personal profiles are the first integration. Other networks can be added later.</p>
  </section>;
}

function Body({ onLogout, initialSection, linkedInResult }: { onLogout: () => void; initialSection?: string; linkedInResult?: string }) {
  const d = useData();
  const { appearance, setAppearance } = useTheme();
  const mobile = useMobile();
  const [section, setSection] = useState(initialSection || 'preferences');
  const [showSection, setShowSection] = useState(false);
  const [profile, setProfile] = useState(d.profile);
  const [saved, setSaved] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const navigationRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (mobile) { if (showSection) headingRef.current?.focus(); else navigationRef.current?.querySelector<HTMLButtonElement>('[data-active]')?.focus(); } }, [mobile, showSection]);
  useEffect(() => { if (initialSection) { setSection(initialSection); setShowSection(true); } }, [initialSection]);
  return <Tabs orientation="vertical" value={section} onValueChange={value => { setSection(String(value)); setShowSection(true); }} className={`rf-settings-layout ${mobile && showSection ? 'rf-settings-detail' : ''}`}>
    <div className="rf-settings-sidebar" ref={navigationRef}><div className="rf-settings-person"><span className="rf-logo">SA</span><span><b>{d.profile.name}</b><small>Preview account</small></span></div><TabsList variant="line" aria-label="Settings sections" className="rf-settings-nav">{sections.map(([id, title, description]) => <TabsTrigger key={id} value={id} onClick={() => setShowSection(true)}><span><b>{title}</b><small>{description}</small></span>{mobile && <ChevronRight size={16} />}</TabsTrigger>)}</TabsList></div>
    <div className="rf-settings-body">
      <div className="rf-settings-section-title">{mobile && <Button variant="ghost" size="icon" aria-label="Back to settings sections" onClick={() => setShowSection(false)}><ArrowLeft /></Button>}<h3 ref={headingRef} tabIndex={-1}>{sections.find(s => s[0] === section)?.[1]}</h3></div>
      <TabsContent value="account"><form onSubmit={e => { e.preventDefault(); d.setProfile({ name: profile.name.trim(), headline: profile.headline.trim() }); setSaved(d.isDemo); }}>
        <label className="rf-account-field">Your name<small>Appears on post previews so they look like your feed.</small><Input required value={profile.name} onChange={e => { setSaved(false); setProfile({ ...profile, name: e.target.value }); }} /></label>
        <label className="rf-account-field">Headline<small>The line under your name in a LinkedIn preview.</small><Input value={profile.headline} onChange={e => { setSaved(false); setProfile({ ...profile, headline: e.target.value }); }} /></label>
        <Button type="submit" disabled={!profile.name.trim()}>Save profile</Button>{saved && <span role="status" className="rf-profile-saved">Saved in demo storage</span>}
      </form><div className="rf-setting-row"><span><b>Password</b><small>No account service is connected to this preview.</small></span><Button variant="outline" disabled>Change</Button></div><div className="rf-setting-row"><span><b>Log out</b><small>Return to the preview sign-in screen. Your posts stay in the Library.</small></span><Button variant="outline" onClick={onLogout}>Log out</Button></div></TabsContent>
      <TabsContent value="preferences">
        <section className="rf-preference-group">
          <h4>Appearance</h4>
          <div className="rf-setting-row rf-timezone-row"><span><b>Theme</b><small>Choose a theme or follow your device.</small></span><Select value={appearance} onValueChange={value => value && setAppearance(value as Appearance)}><SelectTrigger aria-label="Theme"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="light">Light</SelectItem><SelectItem value="dark">Dark</SelectItem><SelectItem value="system">System</SelectItem></SelectContent></Select></div>
          <div className="rf-setting-row rf-timezone-row"><span><b>Library view</b><small>Choose how posts appear in your Library.</small></span><Select value={d.libraryView} onValueChange={value => { if (value === 'table' || value === 'board') d.setLibraryView(value); }}><SelectTrigger aria-label="Library view"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="table">Table</SelectItem><SelectItem value="board">Board</SelectItem></SelectContent></Select></div>
          <div className="rf-setting-row"><span><b>Compact rows</b><small>Show a tighter Table layout.</small></span><Switch aria-label="Compact rows" checked={d.compactRows} onCheckedChange={d.setCompactRows} /></div>
        </section>
        <section className="rf-preference-group"><h4>Scheduling</h4><div className="rf-setting-row rf-timezone-row"><span><b>Time zone</b><small>Used to interpret new schedule dates. Existing slots keep the time zone recorded when they were scheduled.</small></span><Select value={d.timeZone} onValueChange={value => value && d.setTimeZone(value)}><SelectTrigger aria-label="Time zone"><SelectValue /></SelectTrigger><SelectContent>{['Europe/London', 'Europe/Warsaw', 'America/New_York', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Kolkata', 'Australia/Sydney', 'UTC'].map(zone => <SelectItem key={zone} value={zone}>{zone.replaceAll('_', ' ')}</SelectItem>)}</SelectContent></Select></div></section>
      </TabsContent>
      <TabsContent value="integrations"><Integrations isDemo={d.isDemo} result={linkedInResult} /></TabsContent>
      <TabsContent value="usage">{d.isDemo ? <div className="rf-usage"><b>260</b><span>of 500 sample generations left this month</span><progress value={260} max={500} aria-label="Sample generations remaining" /><small>Demo usage · not supplied by a backend</small></div> : <div className="rf-usage"><b>—</b><span>Usage balance is not reported by the previous backend</span><small>No plan or quota has been invented.</small></div>}<div className="rf-setting-row"><span><b>What counts as a generation</b><small>Provider usage is recorded server-side when available; this backend exposes no client quota endpoint.</small></span></div></TabsContent>
      <TabsContent value="data"><div className="rf-data-card"><div className="rf-data-promise"><ShieldCheck size={21} /><span><b>Never used to train anyone’s model</b><small>This preview keeps your changes on this device. No AI service is connected.</small></span></div><dl><div><dd>14</dd><dt>sample sources</dt></div><div><dd>{d.posts.length}</dd><dt>posts and drafts</dt></div><div><dd>Local</dd><dt>storage</dt></div></dl></div><div className="rf-setting-row"><span><b>Export everything</b><small>Download this preview’s posts, guidance, answers, profile, and preferences as JSON. Added documents are stored separately; download them from Knowledge.</small></span><Button variant="outline" onClick={d.exportData}>Export</Button></div><div className="rf-setting-row"><span><b>Delete all sources</b><small>Keeps your posts. Drafts go back to guesswork. Available when source storage is connected.</small></span><Button variant="outline" disabled>Delete sources</Button></div><div className="rf-setting-row"><span><b>Delete account</b><small>Removes everything permanently. No account is connected in this preview.</small></span><Button variant="outline" disabled>Delete account</Button></div></TabsContent>
      <p className="rf-local-note">{d.isDemo ? 'Demo settings are saved on this device.' : 'Time zone is connected. Writing preferences, profile editing, and guidance remain browser-local because the previous backend has no matching write routes.'}</p>
    </div>
  </Tabs>;
}
export default function Settings({ open, onOpenChange, initialSection, linkedInResult }: { open: boolean; onOpenChange: (open: boolean) => void; initialSection?: string; linkedInResult?: string }) {
  const mobile = useMobile();
  const navigate = useNavigate();
  const logout = async () => { await fetch('/api/client-logout', { method: 'POST' }).catch(() => undefined); onOpenChange(false); navigate('/refined/signin', { replace: true }); };
  return mobile ? <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle><DrawerContent className="rf-settings-mobile"><DrawerHeader><DrawerTitle>Settings</DrawerTitle><DrawerClose render={<Button variant="ghost" size="icon" aria-label="Close settings" className="ml-auto" />}><X /></DrawerClose><DrawerDescription className="sr-only">Account, preferences, integrations, usage and data.</DrawerDescription></DrawerHeader><Body onLogout={logout} initialSection={initialSection} linkedInResult={linkedInResult} /></DrawerContent></Drawer> : <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="rf-settings rf-settings-full"><DialogHeader><DialogTitle>Settings</DialogTitle><DialogDescription className="sr-only">Account, preferences, integrations, usage and data.</DialogDescription></DialogHeader><Body onLogout={logout} initialSection={initialSection} linkedInResult={linkedInResult} /></DialogContent></Dialog>;
}

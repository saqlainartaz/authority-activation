'use client';

import { useCallback, useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import Settings from './Settings';
import Workspace from './Workspace';
import Library from './Library';
import Home from './Home';
import Shell from './Shell';
import { DataProvider, useData } from './state';
import Training from './Training';
import Auth from './Auth';
import Onboarding from './Onboarding';
import BusinessDna from './BusinessDna';
import { ThemeProvider, useTheme } from './Theme';
import { useLocation } from './navigation';
import { trainingBadgeCount } from './questions';
import { SettingsOpener } from './settings-opener';

export default function Refined() {
  return <ThemeProvider><DataProvider><RefinedApp /></DataProvider></ThemeProvider>;
}
function RefinedApp() {
  const d = useData();
  const { dark } = useTheme();
  const questions = trainingBadgeCount(d.isDemo, d.answers);
  const location = useLocation();
  const [settings, setSettings] = useState(false);
  const [linkedInResult, setLinkedInResult] = useState<string>();
  // A section asked for by a link such as Knowledge's "View usage" (P2.7).
  const [settingsSection, setSettingsSection] = useState<string>();
  const openSettings = useCallback((section: string) => { setSettingsSection(section); setSettings(true); }, []);
  const openSettingsHome = useCallback(() => { setSettingsSection(undefined); setSettings(true); }, []);
  useEffect(() => { document.documentElement.dataset.refined = 'true'; document.title = 'Promo Partner'; return () => { delete document.documentElement.dataset.refined; }; }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get('linkedin');
    if (!result) return;
    setLinkedInResult(result);
    setSettings(true);
    url.searchParams.delete('linkedin');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);
  const entry = location.pathname.split('/')[2];
  if (['signin', 'invite', 'onboarding'].includes(entry)) return <TooltipProvider delay={350}>{entry === 'onboarding' ? <Onboarding /> : <Auth key={entry} invite={entry === 'invite'} />}<Toaster theme={dark ? 'dark' : 'light'} position="bottom-right" richColors /></TooltipProvider>;
  const screen = entry === 'workspace' ? <Workspace /> : entry === 'library' ? <Library /> : entry === 'train' ? <Training /> : entry === 'profile' ? <BusinessDna /> : <Home questions={questions} />;
  return <TooltipProvider delay={350}><SettingsOpener.Provider value={openSettings}><Shell active={location.pathname.split('/')[2] || 'home'} questions={questions} onSettings={openSettingsHome}>
    {screen}
  </Shell>
  <Settings open={settings} onOpenChange={setSettings} initialSection={linkedInResult ? 'integrations' : settingsSection} showInitialSection={!linkedInResult && Boolean(settingsSection)} linkedInResult={linkedInResult} /><Toaster theme={dark ? 'dark' : 'light'} position="bottom-right" richColors />
  </SettingsOpener.Provider></TooltipProvider>;
}
